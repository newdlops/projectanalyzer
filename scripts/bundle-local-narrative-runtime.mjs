/** Bundles a feature's local CommonJS tree at packaging time; source modules and development output remain independently testable. */
import { readFile, writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { bundleNativeNarrativeCodec } from './bundle-native-narrative-codec.mjs';

/** Resolve whole local modules using Node's file/directory rules; keep external literal dependencies visible to package checks. */
export async function bundleLocalNarrativeRuntime(entryPath, { additionalEntries = [], sharedBundleFile } = {}) {
  const entry = await realpath(entryPath), directory = path.dirname(entry);
  const entries = [entry, ...await Promise.all(additionalEntries.map(file => realpath(file)))];
  if (entries.some(file => path.dirname(file) !== directory)) throw new Error('Shared narrative entrypoints must have one directory.');
  if (sharedBundleFile !== undefined && !/^[a-zA-Z0-9_.-]+\.js$/u.test(sharedBundleFile)) throw new Error('A local shared bundle filename is required.');
  const pending = [...entries], modules = new Map();
  const identity = file => path.relative(directory, file).split(path.sep).join('/');
  let sourceBytes = 0;
  for (let cursor = 0; cursor < pending.length; cursor++) {
    const file = pending[cursor], name = identity(file); if (modules.has(name)) continue;
    if (modules.size >= 512) throw new Error('Local narrative bundle exceeds its module budget.');
    const code = await readFile(file, 'utf8'); sourceBytes += Buffer.byteLength(code);
    if (sourceBytes > 6 * 1024 * 1024) throw new Error('Local narrative bundle exceeds its source budget.');
    if (file.endsWith('.json')) { modules.set(name, 'module.exports = JSON.parse(' + JSON.stringify(code) + ');'); continue; }
    if (!file.endsWith('.js') && !file.endsWith('.cjs')) throw new Error('Local narrative bundle accepts CommonJS and JSON only.');
    const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const nodes = [source], seen = new Set(), replacements = [], resolve = createRequire(file);
    while (nodes.length) {
      const node = nodes.pop(); if (seen.has(node)) continue; seen.add(node);
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require'
        && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
        const specifier = node.arguments[0].text;
        if (/^\.{1,2}\//u.test(specifier)) {
          const target = await realpath(resolve.resolve(specifier)), relative = path.relative(directory, target);
          if (relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
            // Nested helpers still call the facade's real Node require, so an
            // external dependency must be rebased to that facade's directory.
            const external = relative.split(path.sep).join('/');
            replacements.push({ start: node.getStart(source), end: node.end, text: 'require(' + JSON.stringify(external.startsWith('.') ? external : './' + external) + ')' });
          } else {
            pending.push(target);
            replacements.push({ start: node.getStart(source), end: node.end, text: '__load(' + JSON.stringify(identity(target)) + ')' });
          }
        }
      }
      ts.forEachChild(node, child => { nodes.push(child); });
    }
    let bundled = code;
    for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
      bundled = bundled.slice(0, replacement.start) + replacement.text + bundled.slice(replacement.end);
    }
    modules.set(name, bundled);
  }
  if (sharedBundleFile !== undefined && modules.has(sharedBundleFile)) throw new Error('Shared bundle filename conflicts with an original module.');
  const factories = [...modules].map(([name, code]) => JSON.stringify(name)
    + ': function(module, exports, __load, require, __dirname, __filename) {\n' + code + '\n}').join(',\n');
  const result = '/** Packaging bundle of the modular local narrative adapter; watchdog stays a standalone child entrypoint. */\n'
    + '"use strict";\nconst __factories = {\n' + factories + '\n};\nconst __cache = new Map(); let __depth = 0;\n'
    + 'function __load(name) {\n if (__cache.has(name)) return __cache.get(name).exports;\n'
    + ' const factory = __factories[name]; if (!factory) throw new Error("Missing bundled module");\n'
    // Synchronous CommonJS loading requires nested factories. Cache-before-load
    // terminates cycles; the fixed depth bound also covers long acyclic chains.
    + ' if (__depth >= 128) throw new Error("Local narrative CommonJS depth limit");\n'
    + ' const loaded = { exports: {} }; __cache.set(name, loaded); __depth++;\n'
    + ' try { const filename = require("node:path").join(__dirname, name); factory(loaded, loaded.exports, __load, require, require("node:path").dirname(filename), filename); return loaded.exports; }\n'
    + ' catch (error) { __cache.delete(name); throw error; } finally { __depth--; }\n}\n'
    + (sharedBundleFile === undefined ? 'module.exports = __load(' + JSON.stringify(identity(entry)) + ');\n' : 'module.exports = __load;\n');
  let bytes = Buffer.byteLength(result);
  if (sharedBundleFile === undefined) {
    if (entries.length !== 1) throw new Error('Multiple public entrypoints require one shared bundle.');
    await writeFile(entry, result);
  } else {
    // Keep every existing public module path while sharing one cache and one
    // copy of internal exports across all facades, including cyclic imports.
    await writeFile(path.join(directory, sharedBundleFile), result);
    for (const file of entries) {
      const facade = '/** Public facade for the shared packaged module tree. */\nmodule.exports = require('
        + JSON.stringify('./' + sharedBundleFile) + ')(' + JSON.stringify(identity(file)) + ');\n';
      await writeFile(file, facade); bytes += Buffer.byteLength(facade);
    }
  }
  return { modules: modules.size, entrypoints: entries.length, bytes };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const result = await bundleLocalNarrativeRuntime(path.join(projectRoot, 'out/llm/functionNarratives/index.js'));
  console.log(`Bundled ${result.modules} local narrative modules (${result.bytes} bytes); watchdog remains independent.`);
  // The call-reading feature stays modular in source/dev output, while its
  // public facade includes same-directory helpers within the existing file cap.
  const calls = await bundleLocalNarrativeRuntime(path.join(projectRoot, 'out/application/functionCallNarratives/index.js'));
  console.log(`Bundled ${calls.modules} call reading modules (${calls.bytes} bytes).`);
  // Callee syntax helpers keep the same public facade and relative language
  // adapters. Packing them together preserves the existing package file cap.
  const syntax = await bundleLocalNarrativeRuntime(path.join(projectRoot, 'out/analyzer/functionCalls/index.js'));
  console.log(`Bundled ${syntax.modules} call syntax modules (${syntax.bytes} bytes).`);
  const logic = await bundleLocalNarrativeRuntime(path.join(projectRoot, 'out/analyzer/functionLogic/index.js'), {
    additionalEntries: [path.join(projectRoot, 'out/analyzer/functionLogic/typescriptFunctionLogicSyntax.js')],
    sharedBundleFile: '__function-logic-bundle.js'
  });
  console.log(`Bundled ${logic.modules} function logic modules behind ${logic.entrypoints} shared-cache facades (${logic.bytes} bytes).`);
  const codec = await bundleNativeNarrativeCodec(path.join(projectRoot, 'out/llm/nativeNarrativeCodec/index.js'));
  console.log(`Bundled ${codec.modules} native codec/validator modules (${codec.bytes} bytes).`);
}
