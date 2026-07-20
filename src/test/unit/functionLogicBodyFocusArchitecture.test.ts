/**
 * Architecture guards for the dynamic body-focus feature. They keep pure
 * projection rules separate from DOM adapters and prevent deep feature imports.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const FEATURE_ROOT = "src/webview/codeFlow/bodyFocus";
const FEATURE_FILES = [
  "functionLogicBodyFocus.ts",
  "functionLogicBodyFocusBrowserSource.ts",
  "functionLogicBodyFocusStyles.ts",
  "index.ts"
];

test("body focus stays modular, iterative, and below the implementation line limit", () => {
  for (const name of FEATURE_FILES) {
    const source = readSource(`${FEATURE_ROOT}/${name}`);
    const lineCount = source.split(/\r?\n/u).length;
    assert.ok(lineCount <= 800, `${name} has ${lineCount} lines`);
    assert.doesNotMatch(source, /from "(?:\.\.\/)+(?:application|extension|vscode)/u);
  }

  const projection = readSource(`${FEATURE_ROOT}/functionLogicBodyFocus.ts`);
  const browser = readSource(`${FEATURE_ROOT}/functionLogicBodyFocusBrowserSource.ts`);
  const publicApi = readSource(`${FEATURE_ROOT}/index.ts`);
  const renderer = readSource("src/webview/codeFlow/functionLogicBrowserSource.ts");

  assert.doesNotMatch(projection, /^import /mu);
  assert.match(projection, /while \(candidateId/u);
  assert.match(projection, /while \(cursor/u);
  assert.match(projection, /visitedOwnerIds/u);
  assert.match(browser, /from "\.\/functionLogicBodyFocus"/u);
  assert.doesNotMatch(browser, /vscode\.postMessage/u);
  assert.match(publicApi, /createFunctionLogicBodyHierarchy/u);
  assert.match(publicApi, /getFunctionLogicBodyFocusBrowserSource/u);
  assert.match(renderer, /from "\.\/bodyFocus"/u);
  assert.doesNotMatch(renderer, /from "\.\/bodyFocus\//u);
});

/** Reads one repository source file for stable boundary assertions. */
function readSource(path: string): string {
  return readFileSync(path, "utf8");
}
