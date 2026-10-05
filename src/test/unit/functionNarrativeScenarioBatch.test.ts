/** Dense batch contracts preserve all source decisions while bounding generated local prose. */
import assert from "node:assert/strict";
import test from "node:test";
import { buildFunctionNarrativeScenarioFrames } from "../../application/functionNarratives";
import { createLocalNarrativeSchema } from "../../llm/functionNarratives/responseSchema";
import type { FunctionNarrativeContext, FunctionNarrativeFlowStep } from "../../shared/functionNarratives";

/** Sixty long predicates exceed the legacy output shape, but all have retained source identities. */
function denseContext(): FunctionNarrativeContext {
  const steps: FunctionNarrativeFlowStep[] = Array.from({ length: 60 }, (_, index) => ({
    kind: "condition", code: `flag_${index}_` + "longSourcePredicate".repeat(12), confidence: "exact",
    source: { snippetId: "root", startLine: index + 1, endLine: index + 1 }, branch: { outcome: index % 2 ? "false" : "true", confidence: "exact" }
  }));
  steps.push({ kind: "return", code: "return total", confidence: "exact", source: { snippetId: "root", startLine: 61, endLine: 61 } });
  return { functionName: "dense", language: "typescript", limited: false, scenarioBatch: { offset: 9 },
    snippets: [{ id: "root", role: "function", startLine: 1, endLine: 61, text: steps.map((step) => step.code).join("\n"), truncated: false }],
    sourceFlow: { basis: "source-control-flow", limited: false, paths: [{ steps, confidence: "exact", status: "source-terminal" }] } };
}

test("dense fixed conditions keep every source choice and never remove code from the model input", () => {
  const context = denseContext(), before = JSON.stringify(context);
  const frames = buildFunctionNarrativeScenarioFrames(context);
  assert.equal(frames.length, 1); assert.ok(frames[0].when.length <= 4);
  const conditions = frames[0].when.join(" · ");
  for (let index = 0; index < 60; index++) assert.ok(conditions.includes(`root L${index + 1}–${index + 1}: ${index % 2 ? "false" : "true"}`));
  assert.equal(frames[0].outcome, "return total"); assert.equal(JSON.stringify(context), before);
});

test("local batch prose has its own budget while fixed scenario slots remain exact", () => {
  const context = denseContext(); context.sourceFlow!.paths.push(context.sourceFlow!.paths[0]);
  const schema = createLocalNarrativeSchema(context, "ko") as any;
  assert.equal(schema.properties.scenarios.minItems, 2); assert.equal(schema.properties.scenarios.maxItems, 2);
  assert.equal(schema.properties.summary.maxLength, 240);
  for (const slot of schema.properties.scenarios.items) {
    assert.equal(slot.properties.explanation.maxLength, 480); assert.equal(slot.properties.steps.maxItems, 3);
    assert.equal(slot.properties.steps.items.properties.reason.maxLength, 120);
    assert.deepEqual(slot.properties.when.const, buildFunctionNarrativeScenarioFrames(context)[0].when);
  }
});
