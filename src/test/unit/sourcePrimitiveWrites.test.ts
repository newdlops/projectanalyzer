/** Verify exact source-owned write data and conservative unsupported fallbacks. */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readSourcePrimitiveWrite } from "../../llm/functionNarratives/operationValues";
import { createLocalNarrativeSchema } from "../../llm/functionNarratives/responseSchema";
import { normalizeLocalNarrativeResponse } from "../../llm/functionNarratives/localResponse";
import type { FunctionNarrativeContext, FunctionNarrativeFlowStep } from "../../shared/functionNarratives";

test("whole declarations/direct assignments retain zero, false and null in Kotlin and TypeScript", () => {
  for (const [language, code, target, value] of [
    ["kotlin", "var index = 0", "index", 0], ["typescript", "let index = 0;", "index", 0],
    ["kotlin", "val ready: Boolean = false", "ready", false], ["typescript", "const ready: boolean = false;", "ready", false],
    ["kotlin", "var value: Int? = null", "value", null], ["typescript", "let value: number | null = null;", "value", null],
    ["kotlin", "index = -2", "index", -2], ["javascript", "index = 1e2;", "index", 100],
    ["kotlin", "var 위치 = 0", "위치", 0], ["typescript", "let $position = 0;", "$position", 0]
  ] as const) {
    const result = readSourcePrimitiveWrite(language, code, target);
    assert.ok(result); assert.equal(result.value, value); assert.equal(JSON.parse(result.json), value);
  }
});

test("already-lowered primitive operands retain the original literal contract", () => {
  for (const literal of ["0", "-2", "1e2", "true", "false", "null"]) {
    const expected = JSON.parse(literal);
    assert.equal(readSourcePrimitiveWrite("kotlin", literal, "value")?.value, expected);
  }
});

test("unknown aliases, calls, accesses, assignment chains and unsupported literal spellings remain unknown", () => {
  for (const [language, code, target] of [
    ["kotlin", "var index: IndexAlias = 0", "index"], ["typescript", "let index: IndexAlias = 0;", "index"],
    ["kotlin", "var index = next()", "index"], ["typescript", "let index = data.value;", "index"],
    ["typescript", "index = other = 0;", "index"], ["typescript", "data.index = 0;", "index"],
    ["kotlin", "var index = 1L", "index"], ["kotlin", "var index = 1_000", "index"],
    ["typescript", "let index = 0x10;", "index"], ["typescript", "let index = 1n;", "index"],
    ["kotlin", "var index = 0 + 1", "index"], ["kotlin", "var index = 0", "other"],
    ["python", "index = 0", "index"], ["kotlin", "var index = 1e999", "index"]
  ]) assert.equal(readSourcePrimitiveWrite(language, code, target), undefined, code);
});

/** An exact initialization in an array context tests the formerly missing IR path. */
function nodeContext(language: "kotlin" | "typescript", confidence: "exact" | "inferred" = "exact"): FunctionNarrativeContext {
  const code = language === "kotlin" ? "var position = 0" : "let position = 0;";
  const source = { snippetId: "root", startLine: 2, endLine: 2 };
  const target: FunctionNarrativeFlowStep = { kind: "mutation", code, source, confidence, writeTargets: ["position"] };
  return { functionName: "initializePosition", language, detailLevel: "rich", limited: false,
    parameters: [{ name: "items", type: language === "kotlin" ? "IntArray" : "readonly number[]" }],
    returnTypeText: language === "kotlin" ? "Int" : "number", valueNames: ["items", "position", "condition", "result"],
    snippets: [{ id: "root", role: "function", startLine: 1, endLine: 4, truncated: false,
      text: language === "kotlin" ? "fun initializePosition(items: IntArray): Int {\n    var position = 0\n    return position\n}"
        : "function initializePosition(items: readonly number[]): number {\n    let position = 0;\n    return position;\n}" }],
    nodeTask: { frame: { when: [], outcome: "return position" },
      example: { inputs: [{ name: "items", json: "[]" }], result: "0" }, targets: [target],
      reading: { explanation: "The model describes this path.", priorState: [] } } };
}

test("array-context grammar binds the exact numeric initializer while model prose stays free", () => {
  for (const language of ["kotlin", "typescript"] as const) {
    const context = nodeContext(language), before = JSON.stringify(context);
    const schema = createLocalNarrativeSchema(context, "en") as any;
    const values = schema.properties.steps.items[0].properties.values;
    assert.equal(values.items[0].properties.name.const, "position");
    assert.equal(values.items[0].properties.after.const, 0);
    for (const field of ["text", "syntax", "reason", "effect"])
      assert.equal(Object.hasOwn(schema.properties.steps.items[0].properties[field], "const"), false);
    assert.equal(JSON.stringify(context), before);
  }
});

test("wrong zero initializer values reject without normalization repair, and valid data preserves all prose", () => {
  for (const language of ["kotlin", "typescript"] as const) {
    const context = nodeContext(language), target = context.nodeTask!.targets[0];
    const response = (after: unknown) => ({ steps: [{ code: target.code, source: target.source,
      syntax: "Model syntax.", text: "Model action.", reason: "Model derivation.", effect: "Model effect.",
      values: [{ name: "position", before: "not declared", after }] }] });
    for (const wrong of [false, "false", "0", null, 1, [], {}]) {
      const text = JSON.stringify(response(wrong));
      assert.throws(() => normalizeLocalNarrativeResponse(text, context), /invalid-response/u);
      assert.equal(text, JSON.stringify(response(wrong)));
    }
    const original = response(0), normalized = JSON.parse(normalizeLocalNarrativeResponse(JSON.stringify(original), context));
    assert.equal(normalized.steps[0].values[0].after, "0");
    for (const field of ["syntax", "text", "reason", "effect", "code", "source"])
      assert.deepEqual(normalized.steps[0][field], (original.steps[0] as any)[field]);
  }
});

test("inferred source writes retain their original unknown display-value contract", () => {
  const schema = createLocalNarrativeSchema(nodeContext("kotlin", "inferred"), "en") as any;
  const after = schema.properties.steps.items[0].properties.values.items[0].properties.after;
  assert.equal(Object.hasOwn(after, "const"), false); assert.equal(after.type, "string");
});
