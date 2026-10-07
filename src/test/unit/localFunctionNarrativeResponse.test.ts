/** Local response adaptation preserves real JSON inputs and the existing strict portable Host contract. */
import assert from "node:assert/strict";
import test from "node:test";
import { normalizeLocalNarrativeResponse } from "../../llm/functionNarratives/localResponse";
import { createLocalNarrativeSchema } from "../../llm/functionNarratives/responseSchema";
import { buildLocalNarrativePrompt } from "../../llm/functionNarratives/localPrompt";
import { parseFunctionNarrative } from "../../application/functionNarratives";
import type { FunctionNarrativeContext } from "../../shared/functionNarratives";

const context: FunctionNarrativeContext = { functionName: "inspect", language: "python", detailLevel: "rich", limited: false,
  parameters: [{ name: "company" }, { name: "items" }],
  snippets: [{ id: "root", role: "function", startLine: 1, endLine: 2, text: "def inspect(company, items):\n    return None", truncated: false }] };
const response = { summary: "Read the company and items.", scenarios: [{ title: "Input", when: [], assumptions: [],
  explanation: "The supplied company and item values are illustrative inputs.",
  analysis: { pathReason: "The source has no decision.", stateChange: "No value changes.", alternative: "There is no alternate source branch." },
  steps: [{ text: "Return None.", reason: "The explicit return has no value.", effect: "Finish the function.", syntax: "None denotes absence of a value.",
    source: { snippetId: "root", startLine: 2, endLine: 2 } }], outcome: "No value.",
  exampleInputs: [{ name: "company", value: { registered: false, number: null, label: 'quoted "회사"' } }, { name: "items", value: ["A", 0, true, null] }], exampleResult: null
}], limitations: [] };

test("local object/array inputs become portable JSON text and pass the unchanged Host validator", () => {
  const normalized = normalizeLocalNarrativeResponse(JSON.stringify(response), context);
  const parsed = parseFunctionNarrative(normalized, context, "en");
  assert.deepEqual(parsed.scenarios[0].example!.inputs.map(input => JSON.parse(input.json)), response.scenarios[0].exampleInputs.map(input => input.value));
  const schema = createLocalNarrativeSchema(context) as any;
  assert.deepEqual(schema.properties.scenarios.items.properties.exampleInputs.items[0].required, ["name", "value"]);
  assert.match(buildLocalNarrativePrompt(context, "ko"), /실제 JSON 값/u);
  assert.match(buildLocalNarrativePrompt(context, "en"), /actual JSON value/u);
});

test("normalization rejects unsafe, oversized, deep, duplicate and overflowing JSON rather than repairing literals", () => {
  const payload = (inputs: unknown) => JSON.stringify({ scenarios: [{ exampleInputs: inputs, exampleResult: null }] });
  const input = (value: unknown) => [{ name: "company", value }];
  for (const text of [
    payload(input(JSON.parse('{"__proto__":{}}'))), payload(input("x".repeat(1201))),
    payload(input([[[[[[[[0]]]]]]]])), payload([{ name: "company", value: 1 }, { name: "company", value: 2 }]),
    '{"scenarios":[{"exampleInputs":[{"name":"company","value":1e999}],"exampleResult":null}]}',
    payload([{ name: "company", value: {}, json: "{}" }]), payload([{ name: "company", json: "{'enabled': True}" }])
  ]) assert.throws(() => normalizeLocalNarrativeResponse(text, context), /invalid-response/u);
  assert.equal(normalizeLocalNarrativeResponse('{"steps":[]}', { ...context, detailLevel: undefined }), '{"steps":[]}');
});

test("JSON results retain their actual value and numeric annotations reject equations or wrong result kinds", () => {
  for (const result of [30, true, null, "", 'quoted "value"', [1, false], { amount: 30 }]) {
    const normalized = JSON.parse(normalizeLocalNarrativeResponse(JSON.stringify({ scenarios: [{ exampleInputs: [], exampleResult: result }] }), context));
    assert.deepEqual(JSON.parse(normalized.scenarios[0].exampleResult), result);
  }
  const numeric = { ...context, language: "typescript", returnTypeText: "number" };
  for (const result of ["15 * 2 = 30", true, { amount: 30 }]) {
    assert.throws(() => normalizeLocalNarrativeResponse(JSON.stringify({ scenarios: [{ exampleInputs: [], exampleResult: result }] }), numeric), /invalid-response/u);
  }
  assert.equal(JSON.parse(normalizeLocalNarrativeResponse('{"scenarios":[{"exampleInputs":[],"exampleResult":30}]}', numeric)).scenarios[0].exampleResult, "30");
  for (const result of [JSON.parse('{"__proto__":{}}'), [[[[[[[[0]]]]]]]], "x".repeat(1201)]) {
    assert.throws(() => normalizeLocalNarrativeResponse(JSON.stringify({ scenarios: [{ exampleInputs: [], exampleResult: result }] }), context), /invalid-response/u);
  }
  assert.throws(() => normalizeLocalNarrativeResponse('{"scenarios":[{"exampleInputs":[],"exampleResult":1e999}]}', numeric), /invalid-response/u);
});

test("fixed Boolean/null choices use real JSON values and non-null routes exclude null in local grammar", () => {
  const sourceFlow: FunctionNarrativeContext["sourceFlow"] = { basis: "source-control-flow", limited: false, paths: [{ status: "source-terminal", confidence: "exact", steps: [
    { kind: "condition", code: "enabled", confidence: "exact", source: { snippetId: "root", startLine: 1, endLine: 1 }, branch: { outcome: "true", confidence: "exact", inputCondition: "company = true" } }
  ] }] };
  const constrained = createLocalNarrativeSchema({ ...context, sourceFlow, scenarioBatch: { offset: 0 } }) as any;
  const fields = constrained.properties.scenarios.items[0].properties.exampleInputs.items;
  assert.deepEqual(fields[0].properties.value, { const: true });
  assert.equal(Object.hasOwn(fields[0].properties, "json"), false);
  for (const outcome of ["true", "false"]) {
    const step = { ...sourceFlow.paths[0].steps[0], loweredPredicate: "company != null",
      branch: { outcome, confidence: "exact" as const } };
    const nullable = createLocalNarrativeSchema({ ...context, language: "kotlin", scenarioBatch: { offset: 0 },
      sourceFlow: { ...sourceFlow, paths: [{ ...sourceFlow.paths[0], steps: [step] }] } }) as any;
    const value = nullable.properties.scenarios.items[0].properties.exampleInputs.items[0].properties.value;
    if (outcome === "false") assert.deepEqual(value, { const: null });
    else assert.deepEqual(value.anyOf.map((choice: any) => choice.type), ["string", "number", "boolean", "array", "object"]);
  }
});

test("numeric writes and returns encode actual JSON while rejecting operand equations and wrong kinds", () => {
  const write = { kind: "mutation" as const, code: "let adjusted = amount + 5;", confidence: "exact" as const,
    writeTargets: ["adjusted"], source: { snippetId: "root", startLine: 1, endLine: 1 } };
  const terminal = { kind: "return" as const, code: "return adjusted * 2;", confidence: "exact" as const,
    source: { snippetId: "root", startLine: 2, endLine: 2 } };
  const numeric: FunctionNarrativeContext = { ...context, language: "typescript", returnTypeText: "number",
    parameters: [{ name: "amount", type: "number" }], valueNames: ["amount", "adjusted", "result"],
    valueFacts: [{ target: "adjusted", operation: "add", operands: ["amount", "5"], source: write.source }],
    nodeTask: { frame: { when: [], outcome: "return adjusted * 2;" }, example: { inputs: [{ name: "amount", json: "10" }], result: "null" }, targets: [write, terminal] } };
  const payload = (after: unknown, result: unknown) => JSON.stringify({ steps: [
    { values: [{ name: "adjusted", before: "not defined", after }] }, { values: [{ name: "result", before: "not returned", after: result }] }
  ] });
  const normalized = JSON.parse(normalizeLocalNarrativeResponse(payload(15, 30), numeric));
  assert.deepEqual(normalized.steps.map((step: any) => step.values[0].after), ["15", "30"]);
  for (const [after, result] of [["10 + 5", 30], [15, "15 * 2 = 30"], [true, 30], [15, { value: 30 }]]) {
    assert.throws(() => normalizeLocalNarrativeResponse(payload(after, result), numeric), /invalid-response/u);
  }
  const schema = createLocalNarrativeSchema(numeric) as any;
  assert.ok(Object.keys(schema.properties.steps.items[1].properties).indexOf("reason") < Object.keys(schema.properties.steps.items[1].properties).indexOf("values"));
  assert.equal(schema.properties.steps.items[1].properties.values.maxItems, 1);
  assert.equal(schema.properties.steps.items[0].properties.values.maxItems, 1);
});

test("final summaries compare fixed nested JSON results by value rather than object identity", () => {
  const result = { label: "result", items: [1, true, null] };
  const grounded: FunctionNarrativeContext = { ...context, parameters: [], sourceFlow: { basis: "source-control-flow", limited: false,
    paths: [{ status: "source-terminal", confidence: "exact", steps: [{ kind: "return", code: "return result", confidence: "exact",
      source: { snippetId: "root", startLine: 2, endLine: 2 } }] }] },
    summaryTask: { inputs: [], steps: [], resultJson: JSON.stringify(result), completed: [], omittedValues: 0 } };
  const payload = (value: unknown) => JSON.stringify({ scenarios: [{ exampleInputs: [], exampleResult: value }] });
  const normalized = JSON.parse(normalizeLocalNarrativeResponse(payload({ items: [1, true, null], label: "result" }), grounded));
  assert.deepEqual(JSON.parse(normalized.scenarios[0].exampleResult), result);
  assert.throws(() => normalizeLocalNarrativeResponse(payload({ ...result, items: [2, true, null] }), grounded), /invalid-response/u);
});

test("exact literal returns preserve source truth and closed primitive summaries cannot invent prerequisites", () => {
  const terminal = { kind: "return" as const, code: "return false", confidence: "exact" as const,
    source: { snippetId: "root", startLine: 2, endLine: 2 } };
  const local: FunctionNarrativeContext = { ...context, language: "kotlin", returnTypeText: "Boolean",
    parameters: [{ name: "enabled", type: "Boolean" }], valueNames: ["enabled", "condition", "result"],
    sourceFlow: { basis: "source-control-flow", limited: false, paths: [{ status: "source-terminal", confidence: "exact", steps: [terminal] }] } };
  const schema = createLocalNarrativeSchema(local, "ko") as any;
  assert.equal(schema.properties.scenarios.items[0].properties.steps.items[0].properties.values.const[0].after, "false");
  assert.match(schema.properties.scenarios.items[0].properties.steps.items[0].properties.syntax.const, /리터럴 false/u);
  const final = { ...local, summaryTask: { inputs: [{ name: "enabled", json: "false" }], resultJson: "false", steps: [], completed: [], omittedValues: 0 } };
  const closed = createLocalNarrativeSchema(final) as any;
  assert.deepEqual(closed.properties.scenarios.items[0].properties.assumptions, { const: [] });
  assert.deepEqual(closed.properties.limitations, { const: [] });
  for (const context of [{ ...final, limited: true }, { ...final, groundingLimited: true },
    { ...final, parameters: [{ name: "enabled", type: "Unknown" }] },
    { ...final, language: "typescript", parameters: [{ name: "enabled", type: "boolean" }],
      sourceFlow: { ...local.sourceFlow!, paths: [{ ...local.sourceFlow!.paths[0], steps: [{ ...terminal, code: "return () => 1" }] }] } },
    { ...final, sourceFlow: { ...local.sourceFlow!, paths: [{ ...local.sourceFlow!.paths[0], steps: [{ ...terminal, code: "return helper(enabled)" }] }] } }]) {
    const open = createLocalNarrativeSchema(context) as any;
    assert.equal(open.properties.limitations.type, "array");
    assert.equal(open.properties.scenarios.items[0].properties.assumptions.type, "array");
  }
});

test("lowered Elvis writes retain numeric input/literal types and declaration state without evaluator facts", () => {
  const source = { snippetId: "root", startLine: 2, endLine: 2 };
  const guard = { kind: "condition" as const, code: "val adjusted = amount ?: 5", loweredPredicate: "amount != null", confidence: "exact" as const, source };
  for (const code of ["amount", "5"]) {
    const write = { kind: "mutation" as const, code, writeTargets: ["adjusted"], confidence: "exact" as const, source };
    const lowered: FunctionNarrativeContext = { ...context, language: "kotlin", returnTypeText: "Int", parameters: [{ name: "amount", type: "Int?" }],
      valueNames: ["amount", "adjusted", "condition", "result"], sourceFlow: { basis: "source-control-flow", limited: false,
        paths: [{ status: "source-terminal", confidence: "exact", steps: [guard, write] }] },
      nodeTask: { frame: { when: [], outcome: "return adjusted" }, example: { inputs: [{ name: "amount", json: code === "5" ? "null" : "10" }], result: "null" }, targets: [write] } };
    const spec = (createLocalNarrativeSchema(lowered, "ko") as any).properties.steps.items[0].properties.values.items[0].properties;
    assert.deepEqual(spec.before, { const: "선언 전" });
    if (code === "5") assert.deepEqual(spec.after, { const: 5 });
    else assert.deepEqual(spec.after.anyOf.map((choice: any) => choice.type), ["number", "null"]);
    assert.throws(() => normalizeLocalNarrativeResponse(JSON.stringify({ steps: [{ values: [{ name: "adjusted", before: "not declared", after: "adjusted becomes 5" }] }] }), lowered), /invalid-response/u);
    const normalized = JSON.parse(normalizeLocalNarrativeResponse(JSON.stringify({ steps: [{ values: [{ name: "adjusted", before: "not declared", after: code === "5" ? 5 : 10 }] }] }), lowered));
    assert.equal(normalized.steps[0].values[0].after, code === "5" ? "5" : "10");
  }
});

test("an immutable Elvis input decision chooses an operand without prematurely assigning its destination", () => {
  for (const outcome of ["true", "false"]) {
    const guard = { kind: "condition" as const, code: "val adjusted = amount ?: 5", loweredPredicate: "amount != null", confidence: "exact" as const,
      source: { snippetId: "root", startLine: 2, endLine: 2 }, branch: { outcome, confidence: "exact" as const } };
    const write = { kind: "mutation" as const, code: outcome === "true" ? "amount" : "5", writeTargets: ["adjusted"], confidence: "exact" as const, source: guard.source };
    const c: FunctionNarrativeContext = { ...context, language: "kotlin", scenarioBatch: { offset: 0 }, parameters: [{ name: "amount", type: "Int?" }],
      valueNames: ["amount", "adjusted", "condition", "result"], sourceFlow: { basis: "source-control-flow", limited: false,
        paths: [{ status: "source-terminal", confidence: "exact", steps: [guard, write] }] } };
    const properties = (createLocalNarrativeSchema(c, "ko") as any).properties.scenarios.items[0].properties.steps.items[0].properties;
    assert.deepEqual(properties.values.const, [{ name: "condition", before: "미평가", after: outcome }]);
    assert.match(properties.effect.const, /저장은 다음 대입 노드/u);
    assert.ok(!JSON.stringify(properties.values).includes("adjusted"));
    const assignment = (createLocalNarrativeSchema(c, "ko") as any).properties.scenarios.items[0].properties.steps.items[1].properties;
    assert.match(assignment.text.const, /adjusted에 저장/u);
    assert.match(assignment.effect.const, /저장됩니다/u);
    assert.ok(assignment.reason.const.includes(outcome === "true" ? "원래 입력값" : "오른쪽 기본값"));
  }
});

test("long source identifiers cannot force oversized constant prose into a valid local response", () => {
  const name = "input".repeat(24);
  const guard = { kind: "condition" as const, code: "!" + name, confidence: "exact" as const,
    source: { snippetId: "root", startLine: 1, endLine: 1 }, branch: { outcome: "false", confidence: "exact" as const, inputCondition: name + " = true" } };
  const c: FunctionNarrativeContext = { ...context, language: "kotlin", scenarioBatch: { offset: 0 }, parameters: [{ name, type: "Boolean" }],
    valueNames: [name, "condition", "result"], sourceFlow: { basis: "source-control-flow", limited: false,
      paths: [{ status: "source-terminal", confidence: "exact", steps: [guard] }] } };
  const properties = (createLocalNarrativeSchema(c, "ko") as any).properties.scenarios.items[0].properties.steps.items[0].properties;
  assert.equal(properties.code.const, guard.code);
  assert.equal(properties.values.const[0].after, "false");
  for (const [field, cap] of [["syntax", 160], ["text", 120], ["reason", 180], ["effect", 160]] as const) {
    assert.ok(properties[field].const === undefined || properties[field].const.length <= cap);
  }
});
