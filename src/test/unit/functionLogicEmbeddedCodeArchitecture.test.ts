/**
 * Embedded-code architecture tests protect feature-folder boundaries, bounded
 * iterative traversal, file readability, and the non-execution contract.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const projectRoot = path.resolve(__dirname, "../../..");
const featureRoot = path.join(
  projectRoot,
  "src/analyzer/functionLogic/embeddedCode"
);

test("keeps embedded-code implementation files readable and feature-local", () => {
  const files = fs.readdirSync(featureRoot)
    .filter((name) => name.endsWith(".ts"))
    .sort();

  assert.ok(files.includes("index.ts"));
  assert.ok(files.includes("types.ts"));
  for (const name of files) {
    const source = fs.readFileSync(path.join(featureRoot, name), "utf8");
    const lineCount = source.split("\n").length;
    assert.ok(lineCount <= 800, `${name} has ${lineCount} lines`);
    assert.doesNotMatch(source, /from\s+["'][^"']*(?:webview|extension|vscode|protocol)/u);
    assert.match(source, /^\/\*\*/u, `${name} needs a responsibility header`);
  }
});

test("keeps discovery and planning bounded, iterative, and non-executing", () => {
  const discovery = readFeature("typescriptEmbeddedCodeDiscovery.ts");
  const planner = readFeature("typescriptEmbeddedProgramPlanner.ts");
  const support = readFeature("typescriptEmbeddedProgramSupport.ts");
  const expansion = readFeature("typescriptEmbeddedCodeExpansion.ts");
  const combined = [discovery, planner, support, expansion].join("\n");

  assert.match(discovery, /MAX_EMBEDDED_CODE_CHARACTERS\s*=\s*24_000/u);
  assert.match(discovery, /MAX_EMBEDDED_CODE_PIECES\s*=\s*64/u);
  assert.match(expansion, /MAX_EMBEDDED_CODE_REGIONS\s*=\s*16/u);
  assert.match(planner, /while \(scopeCursor < pendingScopes\.length\)/u);
  assert.match(support, /while \(pending\.length > 0/u);
  assert.doesNotMatch(combined, /\beval\s*\(/u);
  assert.doesNotMatch(combined, /\bnew\s+Function\s*\(/u);
  assert.doesNotMatch(combined, /\bimport\s*\(/u);
  assert.doesNotMatch(combined, /\brequire\s*\(/u);
});

/** Reads one feature source file for contract-level assertions. */
function readFeature(name: string): string {
  return fs.readFileSync(path.join(featureRoot, name), "utf8");
}

