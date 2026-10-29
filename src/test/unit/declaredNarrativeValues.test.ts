/** Regression checks for declared array kinds, nullable elements, unknown aliases and response boundaries. */
import assert from "node:assert/strict";
import test from "node:test";
import { createDeclaredValueSchema, matchesDeclaredValueSchema } from "../../llm/functionNarratives/typedValues";
import { createLocalNarrativeSchema } from "../../llm/functionNarratives/responseSchema";
import { normalizeLocalNarrativeResponse } from "../../llm/functionNarratives/localResponse";
import type { FunctionNarrativeContext } from "../../shared/functionNarratives";

/** A fresh declaration fixture exercises value contracts without any failed source family or model. */
function context(language: string, type: string): FunctionNarrativeContext {
  return { functionName: "retain", language, detailLevel: "rich", limited: false,
    parameters: [{ name: "items", type }], returnTypeText: language === "kotlin" ? "Int" : "number",
    snippets: [{ id: "root", role: "function", startLine: 1, endLine: 1,
      text: language === "kotlin" ? `fun retain(items: ${type}): Int = 0` : `function retain(items: ${type}): number { return 0; }`, truncated: false }] };
}

test("primitive arrays require actual arrays and reject wrong element kinds", () => {
  for (const [language, type, accepted, rejected] of [
    ["kotlin", "IntArray", [0, -1, 4], [1, true]],
    ["kotlin", "kotlin.DoubleArray", [0, 1.5], [1, "2"]],
    ["kotlin", "BooleanArray", [true, false], [true, 1]],
    ["typescript", "number[]", [0, -1.5, 3], [0, null]],
    ["typescript", "readonly string[]", ["", "text"], ["text", 1]]
  ] as const) {
    const schema = createDeclaredValueSchema(language, type);
    assert.equal(schema.type, "array"); assert.equal(matchesDeclaredValueSchema([], schema), true);
    assert.equal(matchesDeclaredValueSchema(accepted, schema), true);
    for (const value of [0, "[]", {}, null, rejected]) assert.equal(matchesDeclaredValueSchema(value, schema), false);
  }
});

test("nullable array and nullable element are independent, including non-null routes", () => {
  const type = "Array<Int?>?", schema = createDeclaredValueSchema("kotlin", type);
  assert.equal(matchesDeclaredValueSchema(null, schema), true);
  assert.equal(matchesDeclaredValueSchema([null, 2], schema), true);
  assert.equal(matchesDeclaredValueSchema([true], schema), false);
  const nonNull = createDeclaredValueSchema("kotlin", type, true);
  assert.equal(matchesDeclaredValueSchema(null, nonNull), false);
  assert.equal(matchesDeclaredValueSchema([null, 2], nonNull), true);
  assert.equal(matchesDeclaredValueSchema([null], createDeclaredValueSchema("kotlin", "IntArray?")), false);
});

test("nested explicit arrays validate every element without recursive calls", () => {
  for (const [language, type] of [["typescript", "number[][]"], ["kotlin", "Array<IntArray>"]]) {
    const schema = createDeclaredValueSchema(language, type);
    assert.equal(matchesDeclaredValueSchema([[1, 2], [], [3]], schema), true);
    for (const value of [[1], [[1], [false]], [[null]], 0]) assert.equal(matchesDeclaredValueSchema(value, schema), false);
  }
});

test("aliases keep unknown elements while explicit array shape and original non-null choices remain", () => {
  assert.deepEqual(createDeclaredValueSchema("kotlin", "UserAlias"), {});
  assert.deepEqual(createDeclaredValueSchema("typescript", "IntArray"), {});
  assert.deepEqual(createDeclaredValueSchema("typescript", "Array<UserAlias>"), {});
  const items = createDeclaredValueSchema("typescript", "UserAlias[]");
  assert.deepEqual(items, { type: "array", items: {} });
  assert.equal(matchesDeclaredValueSchema([1, "text", null, { kind: "unknown" }], items), true);
  assert.equal(matchesDeclaredValueSchema(1, items), false);
  const nonNull = createDeclaredValueSchema("kotlin", "UserAlias?", true);
  assert.equal(matchesDeclaredValueSchema(null, nonNull), false);
  assert.equal(matchesDeclaredValueSchema({ kind: "unknown" }, nonNull), true);
});

test("reused element schemas check all values and malformed schema cycles are bounded", () => {
  const schema = createDeclaredValueSchema("kotlin", "Array<Int?>");
  assert.equal(matchesDeclaredValueSchema([1, null, 2, null, "wrong"], schema), false);
  const cyclic: Record<string, any> = {}; cyclic.anyOf = [cyclic];
  assert.equal(matchesDeclaredValueSchema(0, cyclic), false);
  assert.equal(matchesDeclaredValueSchema({ items: [1], label: "x" }, { const: { label: "x", items: [1] } }), true);
});

test("local grammar and normalizer reject scalar or literal-text array examples without repair", () => {
  for (const [language, type] of [["kotlin", "IntArray"], ["typescript", "number[]"]]) {
    const fixture = context(language, type), schema = createLocalNarrativeSchema(fixture) as any;
    const rule = schema.properties.scenarios.items.properties.exampleInputs.items[0].properties.value;
    assert.equal(rule.type, "array");
    const payload = (value: unknown) => JSON.stringify({ scenarios: [{ exampleInputs: [{ name: "items", value }], exampleResult: 0 }] });
    for (const wrong of [0, true, "[0]", { 0: 1 }, [true]]) assert.throws(() => normalizeLocalNarrativeResponse(payload(wrong), fixture), /invalid-response/u);
    for (const value of [[], [0], [1, 2]]) {
      const normalized = JSON.parse(normalizeLocalNarrativeResponse(payload(value), fixture));
      assert.deepEqual(JSON.parse(normalized.scenarios[0].exampleInputs[0].json), value);
      assert.equal(normalized.scenarios[0].exampleResult, "0");
    }
  }
});

test("declared nested array results enforce element kinds while partial null stays supported", () => {
  const fixture = { ...context("typescript", "number[]"), parameters: [], returnTypeText: "number[][]" };
  const payload = (exampleResult: unknown) => JSON.stringify({ scenarios: [{ exampleInputs: [], exampleResult }] });
  for (const value of [[[1], []], null]) assert.doesNotThrow(() => normalizeLocalNarrativeResponse(payload(value), fixture));
  for (const value of [[[true]], [1], "[[1]]"]) assert.throws(() => normalizeLocalNarrativeResponse(payload(value), fixture), /invalid-response/u);
});

test("valid typed arrays retain model-authored values/prose and complete source context", () => {
  const fixture = context("kotlin", "Array<Int?>?"), before = JSON.stringify(fixture);
  const value = [3, null, -2], original = { summary: "The model describes the source.", limitations: ["No execution was observed."],
    scenarios: [{ exampleInputs: [{ name: "items", value }], exampleResult: 0, title: "Model title",
      explanation: "Model explanation", analysis: { pathReason: "Model path", stateChange: "Model state", alternative: "Model alternative" },
      steps: [{ syntax: "Model syntax", text: "Model action", reason: "Model reason", effect: "Model effect" }] }] };
  const normalized = JSON.parse(normalizeLocalNarrativeResponse(JSON.stringify(original), fixture));
  assert.deepEqual(JSON.parse(normalized.scenarios[0].exampleInputs[0].json), value);
  for (const field of ["title", "explanation", "analysis", "steps"]) assert.deepEqual(normalized.scenarios[0][field], (original.scenarios[0] as any)[field]);
  assert.equal(normalized.summary, original.summary); assert.deepEqual(normalized.limitations, original.limitations);
  assert.equal(JSON.stringify(fixture), before);
});
