/** Real analyzer/interpreter fixtures exercise complete object/helper readings and conservative source-proof fallbacks. */
import assert from "node:assert/strict";
import test from "node:test";
import { buildInputModel } from "./helpers/neuralScenarioFixtures";
import { buildFunctionNarrativeContext, addFunctionNarrativeValueGrounding, bindFunctionNarrativeGraph,
  FunctionNarrativeScenarioRun, buildPrimitiveWorksheetResponse, parseFunctionNarrative, initializeFunctionNarrativeNodes,
  createFunctionNarrativeNodeTask, appendFunctionNarrativeNodes, createFunctionNarrativeSummaryTask,
  selectPrimitiveNarrativeAlternative, buildPrimitiveNarrativeSynthesis } from "../../application/functionNarratives";
import { numberFunctionNarrativeContext } from "../../application/functionNarratives/explanationGuidance";
import type { FunctionNarrativeContext } from "../../shared/functionNarratives";
import { evaluateFunctionTutorInputs } from "../../analyzer/functionTutor";

/** Production snapshot, graph identities and static domains are retained; supplied user code is never executed. */
async function fixture(source: string) {
  const model = await buildInputModel(source), node = model.declaration.functionNode;
  const context = addFunctionNarrativeValueGrounding({ ...buildFunctionNarrativeContext(node, source, [], model.functionLogic), detailLevel: "rich",
    parameters: model.declaration.parameters.map(parameter => ({ name: parameter.name, type: parameter.typeText })),
    valueNames: [...model.declaration.program.bindings.map(binding => binding.name), "condition", "result"] }, model);
  return { model, context: bindFunctionNarrativeGraph(context, model.functionLogic.blocks.map((_, index) => "node:" + index), []) };
}

/** Full node parsing, ordered append and final proof use the same boundaries as a live Host session. */
function complete(context: FunctionNarrativeContext, language: "ko" | "en") {
  const batch = new FunctionNarrativeScenarioRun(context).nextBatch()!, path = batch.sourceFlow!.paths[0];
  const preparation = { ...batch, nodePreparation: true }, text = buildPrimitiveWorksheetResponse(preparation, language);
  assert.ok(text);
  const scenario = parseFunctionNarrative(text, preparation, language).scenarios[0];
  initializeFunctionNarrativeNodes(path, scenario, "rich");
  let task;
  while ((task = createFunctionNarrativeNodeTask(batch, path, scenario))) {
    const response = buildPrimitiveWorksheetResponse(task, language); assert.ok(response);
    appendFunctionNarrativeNodes(task, scenario, parseFunctionNarrative(response, task, language).scenarios[0]);
  }
  const summary = createFunctionNarrativeSummaryTask(batch, path, scenario);
  summary.summaryTask!.sourceAlternative = selectPrimitiveNarrativeAlternative(context, path, summary.summaryTask!.inputs, language);
  return summary;
}

test("object-property inputs retain concrete predicate, all writes and full return with a verified alternate path", async () => {
  const source = 'export function inspect(payload: { enabled: boolean; amount: number }): number {\n if (!payload.enabled) return 0;\n let adjusted = payload.amount + 5;\n adjusted *= 2;\n return adjusted + 3;\n}';
  const { context } = await fixture(source);
  assert.ok(context.sourceWorksheet);
  for (const language of ["ko", "en"] as const) {
    const task = complete(context, language), reading = buildPrimitiveNarrativeSynthesis(task, language);
    assert.ok(reading); assert.equal(reading.scenarios[0].example!.result, "0");
    assert.match(reading.scenarios[0].explanation!, /payload=.*enabled.*false/u);
    assert.match(reading.scenarios[0].analysis!.alternative, /adjusted=/u);
    assert.match(reading.scenarios[0].analysis!.alternative, /return adjusted \+ 3/u);
    assert.ok(reading.scenarios[0].steps.every(step => step.syntax && step.text && step.reason && step.effect));
    assert.doesNotThrow(() => parseFunctionNarrative(JSON.stringify({ ...reading, summary: language === "ko" ? "enabled와 amount를 읽고 adjusted를 계산해 반환합니다." : "Read enabled and amount, calculate adjusted and return it." }), task, language));
  }
});

test("resolved branching pure helper calls explain the actual result from the same source and default argument", async () => {
  const source = 'function adjust(x: number, offset = 2) {\n let value = x + offset;\n if (value > 10) return value * 2;\n return value - 3;\n}\nexport function inspect(x: number): number {\n const score = adjust(x);\n return score + 1;\n}';
  const { context } = await fixture(source), path = new FunctionNarrativeScenarioRun(context).nextBatch()!.sourceFlow!.paths[0];
  for (const [x, expected] of [[3, 3], [20, 45]]) {
    const trace = context.sourceWorksheet!.trace(path, [{ name: "x", json: String(x) }], "en");
    assert.ok(trace); assert.equal(trace.result, String(expected));
    assert.match(trace.steps[0].syntax!, /function call/u); assert.match(trace.steps[0].reason!, new RegExp("x=" + x));
    assert.equal(trace.steps[0].values![0].after, String(expected - 1));
  }
  const task = complete(context, "en"), reading = buildPrimitiveNarrativeSynthesis(task, "en");
  assert.ok(reading); assert.match(reading.scenarios[0].explanation!, /adjust\(x\)/u);
});

test("native declaration-only helper ranges cannot certify an omitted body", async () => {
  const source = 'function adjust(x: number): number {\n return x * 2;\n}\nexport function inspect(x: number): number {\n return adjust(x) + 1;\n}';
  const { model, context } = await fixture(source);
  const declarations = model.scenarioBundle!.declarations.map(helper => helper.functionNode.id === model.declaration.functionNode.id ? helper
    : { ...helper, functionNode: { ...helper.functionNode, range: { ...helper.functionNode.range!, endLine: 0, endCharacter: source.split("\n")[0].length } } });
  const declarationOnly = { ...context, snippets: context.snippets.map(snippet => snippet.role !== "nearby" ? snippet
    : { ...snippet, text: source.split("\n")[0], endLine: 1, truncated: false }) };
  const grounded = addFunctionNarrativeValueGrounding(declarationOnly, { ...model, scenarioBundle: { ...model.scenarioBundle!, declarations } });
  assert.equal(grounded.sourceWorksheet, undefined);
});

test("member assignments retain the full before and after object instead of projecting an unchanged scalar", async () => {
  const { context } = await fixture('export function inspect(payload: { amount: number }): number {\n payload.amount += 3;\n return payload.amount * 2;\n}');
  const path = new FunctionNarrativeScenarioRun(context).nextBatch()!.sourceFlow!.paths[0];
  const trace = context.sourceWorksheet!.trace(path, [{ name: "payload", json: '{"amount":10}' }], "en");
  assert.ok(trace); assert.equal(trace.result, "26");
  assert.deepEqual(trace.steps[0].values, [{ name: "payload", before: '{"amount":10}', after: '{"amount":13}' }]);
  assert.ok(buildPrimitiveNarrativeSynthesis(complete(context, "en"), "en"));
});

test("truthy numeric predicates expose Boolean decisions and const/object string syntax remains accurate", async () => {
  const { context } = await fixture('export function inspect(payload: { amount: number; label: string }): string {\n if (payload.amount) return payload.label + "!";\n const text = payload.label + "?";\n return text;\n}');
  const batch = new FunctionNarrativeScenarioRun(context).nextBatch()!, path = batch.sourceFlow!.paths[0];
  const trace = context.sourceWorksheet!.trace(path, [{ name: "payload", json: '{"amount":10,"label":"ready"}' }], "en");
  assert.ok(trace); assert.equal(trace.steps[0].values![0].after, "true"); assert.equal(trace.result, '"ready!"');
  assert.match(trace.steps[1].syntax!, /concatenates strings/u);
  const next = new FunctionNarrativeScenarioRun(context), first = next.nextBatch(); assert.ok(first); next.commitBatch();
  const other = next.nextBatch()!.sourceFlow!.paths[0];
  const constant = context.sourceWorksheet!.trace(other, [{ name: "payload", json: '{"amount":0,"label":"ready"}' }], "en");
  assert.ok(constant); assert.match(constant.steps[1].syntax!, /non-reassignable/u);
});

test("external effects, alias writes, loops, unsupported helper defaults and truncated source cannot acquire complete proof", async () => {
  for (const source of [
    'export function inspect(payload: { amount: number }): number {\n external(payload);\n return payload.amount;\n}',
    'export function inspect(payload: { amount: number }): number {\n const alias = payload;\n payload.amount += 3;\n return alias.amount;\n}',
    'export function inspect(payload: { amount: number }): number {\n while (payload.amount < 3) { payload.amount += 1; }\n return payload.amount;\n}',
    'function helper(x = external()) {\n return x;\n}\nexport function inspect(amount: number): number {\n return helper();\n}'
  ]) {
    const { context } = await fixture(source), batch = new FunctionNarrativeScenarioRun(context).nextBatch()!;
    assert.equal(buildPrimitiveWorksheetResponse({ ...batch, nodePreparation: true }, "en"), undefined, source);
  }
  const { context } = await fixture('export function inspect(payload: { amount: number }): number {\n return payload.amount + 3;\n}');
  const batch = new FunctionNarrativeScenarioRun(context).nextBatch()!;
  assert.equal(buildPrimitiveWorksheetResponse({ ...batch, snippets: batch.snippets.map(snippet => ({ ...snippet, truncated: true })), nodePreparation: true }, "en"), undefined);
  for (const source of [
    'export function inspect(payload: { amount: number }): number {\n const adjusted = payload.amount;\n adjusted = 3;\n return adjusted;\n}',
    'let shared = 0;\nexport function inspect(payload: { amount: number }): number {\n shared = payload.amount;\n return shared;\n}',
    'export function inspect(payload: { amount: number }): number {\n let adjusted = payload.amount;\n if (payload.amount > 0) { let adjusted = 3; }\n return adjusted;\n}'
  ]) {
    const value = await fixture(source), selected = new FunctionNarrativeScenarioRun(value.context).nextBatch()!;
    assert.equal(buildPrimitiveWorksheetResponse({ ...selected, nodePreparation: true }, "en"), undefined, source);
  }
});

test("private evaluator ports never enter prompts; changed source, contradictory completed values and unsafe JSON retain model synthesis", async () => {
  const { context } = await fixture('export function inspect(payload: { amount: number }): number {\n let adjusted = payload.amount + 3;\n return adjusted * 2;\n}');
  const task = complete(context, "en"), path = task.sourceFlow!.paths[0];
  assert.equal(numberFunctionNarrativeContext(task).sourceWorksheet, undefined);
  assert.equal(numberFunctionNarrativeContext(task).summaryTask!.sourceAlternative, undefined);
  const changed = { ...task, snippets: task.snippets.map(snippet => ({ ...snippet, text: snippet.text.replace("+ 3", "+ 5") })) };
  assert.equal(buildPrimitiveNarrativeSynthesis(changed, "en"), undefined);
  const contradictory = { ...task, summaryTask: { ...task.summaryTask!, completed: task.summaryTask!.completed.map((step, index) => index ? step
    : { ...step, values: step.values!.map(value => ({ ...value, after: "999" })) }) } };
  assert.equal(buildPrimitiveNarrativeSynthesis(contradictory, "en"), undefined);
  for (const json of ['{"amount":-0}', '{"amount":1e400}', '{"amount":1,"__proto__":{"amount":10}}', '{"amount":[]}']) {
    assert.equal(context.sourceWorksheet!.trace(path, [{ name: "payload", json }], "en"), undefined, json);
  }
});

test("opt-in interpreter observations preserve repeated-write snapshots without changing evaluation or leaking mutable maps", async () => {
  const { model } = await fixture('export function inspect(amount: number): number {\n let adjusted = amount + 5;\n adjusted *= 2;\n return adjusted;\n}');
  const inputs = [{ parameterId: model.declaration.parameters[0].id, value: { kind: "number" as const, value: 10 } }], visits: Array<ReadonlyMap<string, import("../../analyzer/functionTutor").FunctionTutorStaticValue>> = [];
  const original = evaluateFunctionTutorInputs(model.declaration, inputs), observed = evaluateFunctionTutorInputs(model.declaration, inputs, {
    observeBlock(visit) { visits.push(visit.after); }
  });
  assert.deepEqual(observed, original);
  const id = model.declaration.program.bindings.find(binding => binding.name === "adjusted")!.bindingId;
  assert.deepEqual(visits[1].get(id), { kind: "number", value: 15 });
  assert.deepEqual(visits[2].get(id), { kind: "number", value: 30 });
});
