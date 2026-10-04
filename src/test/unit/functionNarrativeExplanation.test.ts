/** Detailed-explanation contracts apply to both providers while preserving bounded, source-numbered input. */
import assert from "node:assert/strict";
import test from "node:test";
import { buildFunctionNarrativePrompt, parseFunctionNarrative } from "../../application/functionNarratives";
import { buildLocalNarrativePrompt } from "../../llm/functionNarratives/localPrompt";
import { createLocalNarrativeSchema } from "../../llm/functionNarratives/responseSchema";
import type { FunctionNarrativeContext } from "../../shared/functionNarratives";

const context: FunctionNarrativeContext = { functionName: "classify", language: "kotlin", limited: false,
  snippets: [{ id: "root", role: "function", startLine: 20, endLine: 23,
    text: 'fun classify(enabled: Boolean): String {\n if (!enabled) return "disabled"\n return "ordinary"\n}', truncated: false }] };

test("both providers teach statement-level reasoning and early-return effects with a separate worked example", () => {
  for (const language of ["ko", "en"] as const) {
    const local = buildLocalNarrativePrompt(context, language);
    const connected = buildFunctionNarrativePrompt(context, language);
    for (const prompt of [local, connected[0]]) {
      assert.ok(prompt.includes(language === "ko" ? "분기 판단" : "branch decision"));
      assert.ok(prompt.includes(language === "ko" ? "건너뛰" : "skipped"));
      assert.ok(prompt.includes(language === "ko" ? "해설 예제" : "Worked explanation example"));
      assert.ok(prompt.includes(language === "ko" ? "입력 예시만" : "input example alone"));
    }
    const data = JSON.parse(connected[1]) as FunctionNarrativeContext;
    assert.match(data.snippets[0].text, /^20: fun classify/u);
    assert.match(data.snippets[0].text, /21:  if/u);
    assert.ok(!connected[1].includes("trainingExample"));
    assert.equal(context.snippets[0].text.startsWith("fun classify"), true);
  }
});

test("local generation can explain a guard and both result branches in up to five cited steps", () => {
  const schema = createLocalNarrativeSchema(context) as any;
  assert.equal(schema.properties.scenarios.maxItems, 3);
  assert.equal(schema.properties.scenarios.items.properties.steps.maxItems, 5);
  assert.deepEqual(schema.properties.scenarios.items.properties.steps.items.required, ["text", "reason", "effect", "source"]);
  assert.deepEqual(schema.properties.scenarios.items.properties.steps.items.properties.source.properties.snippetId.enum, ["root"]);
});

test("detailed reasons and effects are validated while earlier text-only responses remain readable", () => {
  const narrative = { summary: "Choose a label.", scenarios: [{ title: "Disabled", when: ["enabled=false"],
    steps: [{ text: "Evaluate the guard.", reason: "!enabled is true.", effect: "Return disabled and skip ordinary.",
      source: { snippetId: "root", startLine: 21, endLine: 21 } }], outcome: "disabled", assumptions: [] }], limitations: [] };
  assert.deepEqual(parseFunctionNarrative(JSON.stringify(narrative), context), narrative);
  const invalid = structuredClone(narrative); invalid.scenarios[0].steps[0].reason = "x".repeat(601);
  assert.throws(() => parseFunctionNarrative(JSON.stringify(invalid), context));
  const legacy = structuredClone(narrative) as any;
  delete legacy.scenarios[0].steps[0].reason; delete legacy.scenarios[0].steps[0].effect;
  assert.deepEqual(parseFunctionNarrative(JSON.stringify(legacy), context), legacy);
});
