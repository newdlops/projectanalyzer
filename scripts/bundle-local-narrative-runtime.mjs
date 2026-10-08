/** Bundles same-directory CommonJS helpers at packaging time; source modules and development output remain independently testable. */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/** Closed same-directory modules preserve Node require/dirname semantics; external literal dependencies remain visible to closure checks. */
export async function bundleLocalNarrativeRuntime(entryPath) {
  const directory = path.dirname(entryPath), pending = [path.basename(entryPath)], modules = new Map();
  for (let cursor = 0; cursor < pending.length; cursor++) {
    const name = pending[cursor]; if (modules.has(name)) continue;
    const code = await readFile(path.join(directory, name), 'utf8');
    const source = ts.createSourceFile(name, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const nodes = [source], replacements = [];
    while (nodes.length) {
      const node = nodes.pop();
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require'
        && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
        const specifier = node.arguments[0].text;
        if (/^\.\/[a-zA-Z0-9_-]+(?:\.js)?$/u.test(specifier)) {
          const dependency = specifier.slice(2).replace(/\.js$/u, '') + '.js';
          pending.push(dependency);
          replacements.push({ start: node.getStart(source), end: node.end, text: '__load(' + JSON.stringify(dependency) + ')' });
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
  const factories = [...modules].map(([name, code]) => JSON.stringify(name)
    + ': function(module, exports, __load, require, __dirname, __filename) {\n' + code + '\n}').join(',\n');
  const result = '/** Packaging bundle of the modular local narrative adapter; watchdog stays a standalone child entrypoint. */\n'
    + '"use strict";\nconst __factories = {\n' + factories + '\n};\nconst __cache = new Map();\n'
    + 'function __load(name) {\n if (__cache.has(name)) return __cache.get(name).exports;\n'
    + ' const factory = __factories[name]; if (!factory) throw new Error("Missing bundled module");\n'
    + ' const loaded = { exports: {} }; __cache.set(name, loaded);\n'
    + ' factory(loaded, loaded.exports, __load, require, __dirname, require("node:path").join(__dirname, name));\n return loaded.exports;\n}\n'
    + 'module.exports = __load(' + JSON.stringify(path.basename(entryPath)) + ');\n';
  await writeFile(entryPath, result);
  return { modules: modules.size, bytes: Buffer.byteLength(result) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const result = await bundleLocalNarrativeRuntime(path.join(projectRoot, 'out/llm/functionNarratives/index.js'));
  console.log(`Bundled ${result.modules} local narrative modules (${result.bytes} bytes); watchdog remains independent.`);
  // The call-reading feature stays modular in source/dev output, while its
  // public facade includes same-directory helpers within the existing file cap.
  const calls = await bundleLocalNarrativeRuntime(path.join(projectRoot, 'out/application/functionCallNarratives/index.js'));
  console.log(`Bundled ${calls.modules} call reading modules (${calls.bytes} bytes).`);
}
