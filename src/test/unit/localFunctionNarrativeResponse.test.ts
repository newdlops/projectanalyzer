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
  exampleInputs: [{ name: "company", value: { registered: false, number: null, label: 'quoted "회사"' } }, { name: "items", value: ["A", 0, true, null] }], exampleResult: "null"
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
  const payload = (inputs: unknown) => JSON.stringify({ scenarios: [{ exampleInputs: inputs, exampleResult: "null" }] });
  const input = (value: unknown) => [{ name: "company", value }];
  for (const text of [
    payload(input(JSON.parse('{"__proto__":{}}'))), payload(input("x".repeat(1201))),
    payload(input([[[[[[[[0]]]]]]]])), payload([{ name: "company", value: 1 }, { name: "company", value: 2 }]),
    '{"scenarios":[{"exampleInputs":[{"name":"company","value":1e999}],"exampleResult":"null"}]}',
    payload([{ name: "company", value: {}, json: "{}" }]), payload([{ name: "company", json: "{'enabled': True}" }])
  ]) assert.throws(() => normalizeLocalNarrativeResponse(text, context), /invalid-response/u);
  assert.equal(normalizeLocalNarrativeResponse('{"steps":[]}', { ...context, detailLevel: undefined }), '{"steps":[]}');
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
