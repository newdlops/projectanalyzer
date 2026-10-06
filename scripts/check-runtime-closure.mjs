/** Checks that every relative CommonJS dependency of the shipped runtime is present in the VSIX. */
import { readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

/**
 * Reads the current compiled files without inflating the archive. Dormant outputs
 * may be excluded, but a shipped module must resolve all of its local dependencies.
 * Nonliteral requires fail closed because a static package check cannot prove them.
 */
export async function validateRuntimeClosure(entries, outputDirectory) {
  const prefix = "extension/out/";
  const files = new Set(entries.filter(entry => entry.path.startsWith(prefix)).map(entry => entry.path.slice(prefix.length)));
  const errors = [];
  for (const relative of files) {
    if (!relative.endsWith(".js")) continue;
    const source = await readFile(path.join(outputDirectory, relative), "utf8");
    const syntax = ts.createSourceFile(relative, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
    const stack = [syntax];
    while (stack.length) {
      const node = stack.pop();
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require") {
        const argument = node.arguments[0];
        if (node.arguments.length !== 1 || !argument || !ts.isStringLiteralLike(argument)) {
          errors.push(`unverifiable dynamic require in extension/out/${relative}`);
        } else if (argument.text.startsWith(".")) {
          const target = path.posix.normalize(path.posix.join(path.posix.dirname(relative), argument.text));
          const candidates = /\.(?:js|json)$/u.test(target) ? [target] : [target + ".js", target + ".json", target + "/index.js"];
          if (!candidates.some(candidate => files.has(candidate))) errors.push(`missing runtime dependency: extension/out/${relative} -> ${argument.text}`);
        }
      }
      ts.forEachChild(node, child => { stack.push(child); });
    }
  }
  return errors;
}
