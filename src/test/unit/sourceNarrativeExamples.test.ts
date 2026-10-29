/** Check source/example contradictions without response repair or source execution. */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { FunctionNarrativeContext, FunctionNarrativeExample, FunctionNarrativeFlowStep } from "../../shared/functionNarratives";
import { checkSourceExample, hasConsistentDecisionRows } from "../../llm/functionNarratives/operationValues";
import { normalizeLocalNarrativeResponse } from "../../llm/functionNarratives/localResponse";

/** A small exact source route tests length, local updates and a primitive result. */
function fixture(language: "kotlin" | "typescript", iterate: boolean): FunctionNarrativeContext {
  const source = { snippetId: "root", startLine: 2, endLine: 2 };
  const steps: FunctionNarrativeFlowStep[] = [
    { kind: "mutation", code: language === "kotlin" ? "var position = 0" : "let position = 0;", writeTargets: ["position"], source, confidence: "exact" },
    { kind: "loop", code: "position < items." + (language === "kotlin" ? "size" : "length"), source: { ...source, startLine: 3, endLine: 3 },
      branch: { outcome: iterate ? "iterate" : "exit", confidence: "exact" }, confidence: "exact" }
  ];
  if (iterate) steps.push({ kind: "mutation", code: "position += 1", writeTargets: ["position"], source: { ...source, startLine: 4, endLine: 4 }, confidence: "exact" });
  steps.push({ kind: "return", code: "return position", source: { ...source, startLine: iterate ? 5 : 7, endLine: iterate ? 5 : 7 }, confidence: "exact" });
  return { functionName: "inspectArrayBoundary", language, detailLevel: "rich", limited: false,
    parameters: [{ name: "items", type: language === "kotlin" ? "IntArray" : "readonly number[]" }],
    returnTypeText: language === "kotlin" ? "Int" : "number", valueNames: ["items", "position", "condition", "result"],
    snippets: [{ id: "root", role: "function", startLine: 1, endLine: 8, truncated: false,
      text: language === "kotlin" ? "fun inspectArrayBoundary(items: IntArray): Int {\n var position = 0\n while (position < items.size) {\n position += 1\n return position\n }\n return position\n}"
        : "function inspectArrayBoundary(items: readonly number[]): number {\n let position = 0;\n while (position < items.length) {\n position += 1;\n return position;\n }\n return position;\n}" }],
    sourceFlow: { basis: "source-control-flow", limited: false, paths: [{ status: "source-terminal", confidence: "exact", steps }] } };
}

const example = (items: unknown[], result: unknown): FunctionNarrativeExample => ({ inputs: [{ name: "items", json: JSON.stringify(items) }], result: JSON.stringify(result) });

test("empty arrays cannot enter the selected loop, and nonempty inputs/result retain their original values", () => {
  for (const language of ["kotlin", "typescript"] as const) {
    const entered = fixture(language, true), left = fixture(language, false), snapshot = JSON.stringify(entered);
    assert.equal(checkSourceExample(entered, 0, example([], 1)).reason, "predicate");
    assert.equal(checkSourceExample(entered, 0, example([4], 1)).status, "compatible");
    assert.equal(checkSourceExample(left, 0, example([], 0)).status, "compatible");
    assert.equal(checkSourceExample(left, 0, example([4], 0)).reason, "predicate");
    assert.equal(checkSourceExample(entered, 0, example([4], 0)).reason, "result");
    assert.equal(JSON.stringify(entered), snapshot);
  }
});

test("known loop decisions require the model condition row while optional input rows and all prose remain untouched", () => {
  const context = fixture("typescript", true), check = checkSourceExample(context, 0, example([4], 1));
  const target = context.sourceFlow!.paths[0].steps[1];
  const reading = { code: target.code, source: target.source, text: "The model explains the predicate.",
    values: [{ name: "condition", after: "true" }, { name: "items", after: "[4]" }] };
  const before = JSON.stringify(reading);
  const node = { ...context, nodeTask: { frame: { when: [], outcome: "return position" }, example: example([4], null),
    targets: [target], reading: { explanation: "Model explanation.", priorState: [] } } };
  assert.equal(hasConsistentDecisionRows(node, 0, check, [reading]), true);
  assert.equal(hasConsistentDecisionRows(node, 0, check, [{ ...reading, values: [{ name: "condition", after: "false" }] }]), false);
  assert.equal(hasConsistentDecisionRows(node, 0, check, [{ ...reading, values: [{ name: "items", after: "[4]" }] }]), false);
  assert.equal(JSON.stringify(reading), before);
  assert.equal(checkSourceExample(node, 0, node.nodeTask.example).status, "compatible");
});

test("aliases, calls, property effects, inferred source and unsupported arithmetic keep the unknown fallback", () => {
  for (const change of [
    (context: FunctionNarrativeContext) => { context.parameters![0].type = "ItemsAlias"; },
    (context: FunctionNarrativeContext) => { context.sourceFlow!.paths[0].steps[0].code = "position = external()"; },
    (context: FunctionNarrativeContext) => { context.sourceFlow!.paths[0].steps[0].writeTargets = []; },
    (context: FunctionNarrativeContext) => { context.sourceFlow!.paths[0].steps[1].confidence = "inferred"; },
    (context: FunctionNarrativeContext) => { context.sourceFlow!.paths[0].steps[2].code = "position = position * 2"; },
    (context: FunctionNarrativeContext) => { context.sourceFlow!.paths[0].steps[0].code = "var position: PositionAlias = 0"; },
    (context: FunctionNarrativeContext) => { context.sourceFlow!.paths[0].steps[1].source.snippetId = "foreign"; }
  ]) {
    const context = fixture("kotlin", true); change(context);
    assert.equal(checkSourceExample(context, 0, example([4], 1)).status, "unknown");
  }
});

test("step bounds, duplicate occurrences, truncated/preparation states and finally continuations never assert a final value", () => {
  const context = fixture("typescript", true);
  assert.equal(checkSourceExample(context, 0, example([4], 1), 1).reason, "step-limit");
  const repeated = structuredClone(context);
  for (const step of repeated.sourceFlow!.paths[0].steps) { step.graphNodeId = "same"; step.graphOccurrence = 0; }
  assert.equal(checkSourceExample(repeated, 0, example([4], 1)).status, "unknown");
  const truncated = structuredClone(context); truncated.snippets[0].truncated = true;
  assert.equal(checkSourceExample(truncated, 0, example([4], 1)).status, "unknown");
  assert.equal(checkSourceExample({ ...context, nodePreparation: true }, 0, example([4], null)).status, "unknown");
  const deferred = structuredClone(context);
  deferred.sourceFlow!.paths[0].steps.push({ kind: "call", code: "cleanup()", confidence: "exact", source: { snippetId: "root", startLine: 6, endLine: 6 } });
  assert.equal(checkSourceExample(deferred, 0, example([4], null)).status, "unknown");
});

test("a real source binding named condition is preserved instead of reclassified as a synthetic decision", () => {
  const context = fixture("typescript", true), target = context.sourceFlow!.paths[0].steps[1];
  context.parameters!.push({ name: "condition", type: "number" });
  const check = checkSourceExample(context, 0, example([4], 1));
  const node = { ...context, nodeTask: { frame: { when: [], outcome: "return position" }, example: example([4], null), targets: [target], reading: { explanation: "Model.", priorState: [] } } };
  assert.equal(hasConsistentDecisionRows(node, 0, check, [{ code: target.code, values: [{ name: "condition", after: "7" }] }]), true);
});

test("normalization rejects an incompatible source example before encoding, without repairing source or prose", () => {
  const context = fixture("typescript", true);
  const response = { summary: "Model summary.", scenarios: [{ exampleInputs: [{ name: "items", value: [] }], exampleResult: 1,
    title: "Model title.", when: [], outcome: "return position", explanation: "Model explanation.",
    analysis: { pathReason: "Model reason.", stateChange: "Model state.", alternative: "Model alternative." }, assumptions: [], steps: [] }], limitations: [] };
  const raw = JSON.stringify(response);
  assert.throws(() => normalizeLocalNarrativeResponse(raw, context), /invalid-response/u);
  assert.equal(JSON.stringify(response), raw);
});

test("exact owned write/result names reject foreign rows in both locales without changing valid declaration text", () => {
  const context = fixture("typescript", true), target = context.sourceFlow!.paths[0].steps[0];
  const node = { ...context, nodeTask: { frame: { when: [], outcome: "return position" }, example: example([4], null), targets: [target], reading: { explanation: "Model.", priorState: [] } } };
  for (const before of ["not declared", "선언 전"]) {
    const step = { code: target.code, source: target.source, syntax: "Model syntax.", text: "Model text.", reason: "Model reason.", effect: "Model effect.", values: [{ name: "position", before, after: 0 }] };
    const valid = JSON.parse(normalizeLocalNarrativeResponse(JSON.stringify({ steps: [step] }), node));
    assert.equal(valid.steps[0].values[0].before, before);
    assert.throws(() => normalizeLocalNarrativeResponse(JSON.stringify({ steps: [{ ...step, values: [{ name: "items", before, after: 0 }] }] }), node), /invalid-response/u);
  }
});

test("Kotlin copies retain Float domains and unsupported narrow overflow cannot create a false source proof", () => {
  const context = fixture("kotlin", true), route = context.sourceFlow!.paths[0];
  context.parameters!.push({ name: "amount", type: "Float" });
  context.returnTypeText = "Float";
  route.steps[0].code = "var position = amount";
  route.steps[1].code = "position > 0";
  route.steps[2].code = "position += 16777216";
  context.snippets[0].text = context.snippets[0].text.replace("var position = 0", "var position = amount")
    .replace("items: IntArray): Int", "items: IntArray, amount: Float): Float")
    .replace("position < items.size", "position > 0").replace("position += 1", "position += 16777216");
  const input = example([4], 16777216); input.inputs.push({ name: "amount", json: "1" });
  assert.equal(checkSourceExample(context, 0, input).status, "unknown");
  const narrow = fixture("kotlin", true);
  narrow.sourceFlow!.paths[0].steps[0].code = "var position: Byte = 127";
  narrow.sourceFlow!.paths[0].steps[1].code = "position > 0";
  narrow.returnTypeText = "Byte";
  narrow.snippets[0].text = narrow.snippets[0].text.replace("items: IntArray): Int", "items: IntArray): Byte")
    .replace("var position = 0", "var position: Byte = 127").replace("position < items.size", "position > 0");
  assert.equal(checkSourceExample(narrow, 0, example([4], -128)).status, "unknown");
});

test("Kotlin Float array elements do not inherit Double precision when the concrete value needs rounding", () => {
  const context = fixture("kotlin", true);
  context.parameters![0].type = "FloatArray"; context.parameters!.push({ name: "amount", type: "Float" });
  context.sourceFlow!.paths[0].steps[1].code = "items[position] == amount";
  context.snippets[0].text = context.snippets[0].text.replace("items: IntArray): Int", "items: FloatArray, amount: Float): Int")
    .replace("position < items.size", "items[position] == amount");
  const input = example([16777217], 1); input.inputs.push({ name: "amount", json: "16777216" });
  assert.equal(checkSourceExample(context, 0, input).status, "unknown");
});

test("fixed literal-return display rows enforce source names and after values while preserving localized before text", () => {
  const context = fixture("typescript", false), target = context.sourceFlow!.paths[0].steps.at(-1)!;
  target.code = "return 0";
  const node = { ...context, nodeTask: { frame: { when: [], outcome: "return 0" }, example: example([], null), targets: [target], reading: { explanation: "Model.", priorState: [] } } };
  for (const before of ["not returned", "반환 전"]) {
    const response = (name: string, after: string) => JSON.stringify({ steps: [{ code: target.code, source: target.source,
      syntax: "Model syntax.", text: "Model action.", reason: "Model reason.", effect: "Model effect.", values: [{ name, before, after }] }] });
    assert.equal(JSON.parse(normalizeLocalNarrativeResponse(response("result", "0"), node)).steps[0].values[0].before, before);
    assert.throws(() => normalizeLocalNarrativeResponse(response("position", "0"), node), /invalid-response/u);
    assert.throws(() => normalizeLocalNarrativeResponse(response("result", "false"), node), /invalid-response/u);
  }
});
