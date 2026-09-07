/**
 * Contract checks for the bounded browser-only interprocedural Scenario machine.
 * Behavioral direct/two-level cases live beside the shared Scenario evaluator
 * fixtures; this test prevents a regression to recursive program execution.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionLogicScenarioEvaluatorBrowserSource } from "../../webview/codeFlow/valuePreview";

test("uses opaque call links and an iterative tagged Scenario call machine", () => {
  const source = getFunctionLogicScenarioEvaluatorBrowserSource();
  for (const tag of ["program-enter", "block-step", "expression-enter", "call-enter", "call-return"]) {
    assert.match(source, new RegExp(`tag: "${tag}"`, "u"));
  }
  assert.doesNotMatch(source, /evaluateProgram\s*\(/u);
  assert.doesNotMatch(source, /evaluateExpression\s*\(/u);
  assert.match(source, /programBundle/u);
  assert.match(source, /linksByCallId/u);
});
