/** Package the native codecs and only their locked validator closure in one CommonJS facade, preserving existing VSIX budgets. */
import { readFile, writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { builtinModules, createRequire } from 'node:module';
import ts from 'typescript';

const PINNED_PACKAGES = ['ajv', 'fast-deep-equal', 'fast-uri', 'json-schema-traverse', 'require-from-string'];
const workspaceRequire = createRequire(import.meta.url), builtin = new Set(builtinModules.map(name => name.replace(/^node:/, '')));

/** Resolve a finite queue of real JS/JSON modules; no user source or model/runtime process is evaluated during bundling. */
export async function bundleNativeNarrativeCodec(entryPath) {
  const entry = await realpath(entryPath), directory = path.dirname(entry), vendors = new Map();
  for (const name of PINNED_PACKAGES) {
    const manifest = await realpath(workspaceRequire.resolve(name + '/package.json'));
    vendors.set(path.dirname(manifest), name);
  }
  const identity = file => {
    const local = path.relative(directory, file);
    if (!local.startsWith('..' + path.sep) && !path.isAbsolute(local)) return './' + local.split(path.sep).join('/');
    for (const [root, name] of vendors) {
      const relative = path.relative(root, file);
      if (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) return 'vendor/' + name + '/' + relative.split(path.sep).join('/');
    }
    throw new Error('Native codec bundling reached an undeclared runtime dependency.');
  };
  const modules = new Map(), pending = [entry]; let sourceBytes = 0;
  for (let cursor = 0; cursor < pending.length; cursor++) {
    const file = pending[cursor]; if (modules.has(file)) continue;
    if (modules.size >= 512) throw new Error('Native codec bundle exceeds its module budget.');
    const id = identity(file), text = await readFile(file, 'utf8'); sourceBytes += Buffer.byteLength(text);
    if (sourceBytes > 6 * 1024 * 1024) throw new Error('Native codec bundle exceeds its source budget.');
    if (file.endsWith('.json')) { modules.set(file, { id, code: 'module.exports = JSON.parse(' + JSON.stringify(text) + ');' }); continue; }
    if (!file.endsWith('.js') && !file.endsWith('.cjs')) throw new Error('Native codec bundle accepts CommonJS and JSON only.');
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), stack = [source], replacements = [];
    const resolve = createRequire(file), isVendor = id.startsWith('vendor/');
    while (stack.length) {
      const node = stack.pop();
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        if (node.arguments.length !== 1 || !ts.isStringLiteral(node.arguments[0])) throw new Error('Native codec bundle contains a dynamic require.');
        const specifier = node.arguments[0].text;
        if (builtin.has(specifier.replace(/^node:/, ''))) continue;
        if (specifier.startsWith('.') && !isVendor) {
          const target = await realpath(resolve.resolve(specifier)), relative = path.relative(directory, target);
          // Shared feature facades keep their original relative Node boundary at the codec directory.
          if (relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
            const external = path.relative(directory, target).split(path.sep).join('/');
            replacements.push({ start: node.getStart(source), end: node.end, text: 'require(' + JSON.stringify(external.startsWith('.') ? external : './' + external) + ')' }); continue;
          }
          pending.push(target); replacements.push({ start: node.getStart(source), end: node.end, text: '__load(' + JSON.stringify(identity(target)) + ')' });
        } else {
          const target = await realpath(specifier.startsWith('.') ? resolve.resolve(specifier) : workspaceRequire.resolve(specifier));
          const targetId = identity(target); if (!targetId.startsWith('vendor/')) throw new Error('Native codec vendor crossed into feature source.');
          pending.push(target); replacements.push({ start: node.getStart(source), end: node.end, text: '__load(' + JSON.stringify(targetId) + ')' });
        }
      }
      ts.forEachChild(node, child => { stack.push(child); });
    }
    let code = text;
    for (const replacement of replacements.sort((left, right) => right.start - left.start)) code = code.slice(0, replacement.start) + replacement.text + code.slice(replacement.end);
    modules.set(file, { id, code });
  }
  const factories = [...modules.values()].map(({ id, code }) => JSON.stringify(id) + ': function(module, exports, __load, require, __dirname, __filename) {\n' + code + '\n}').join(',\n');
  // CommonJS requires synchronous nested factories. Cache-before-load terminates cycles;
  // the explicit 128-level bound prevents an acyclic chain from exhausting the JS stack.
  const result = '/** Native narrative codec and locked validator runtime; licenses are in THIRD_PARTY_NOTICES.md. */\n'
    + '"use strict";\nconst __factories = {\n' + factories + '\n};\nconst __cache = new Map(); let __depth = 0;\n'
    + 'function __load(id) {\n if (__cache.has(id)) return __cache.get(id).exports;\n'
    + ' const factory = __factories[id]; if (!factory) throw new Error("Missing native codec bundle module");\n'
    + ' if (__depth >= 128) throw new Error("Native codec CommonJS depth limit");\n'
    + ' const loaded = { exports: {} }; __cache.set(id, loaded); __depth++;\n'
    + ' try { const filename = require("node:path").join(__dirname, id); factory(loaded, loaded.exports, __load, require, require("node:path").dirname(filename), filename); return loaded.exports; }\n'
    + ' catch (error) { __cache.delete(id); throw error; } finally { __depth--; }\n}\n'
    + 'module.exports = __load(' + JSON.stringify(identity(entry)) + ');\n';
  await writeFile(entry, result);
  return { modules: modules.size, vendorModules: [...modules.values()].filter(value => value.id.startsWith('vendor/')).length, bytes: Buffer.byteLength(result) };
}
