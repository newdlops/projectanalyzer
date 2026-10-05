/** Rich readings preserve source contracts, inherited model state and bounded resumable node work. */
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeFunctionLogic } from "../../analyzer/functionLogic";
import { bindFunctionNarrativeGraph, buildFunctionNarrativeContext, buildFunctionNarrativeScenarioFrames,
  createFunctionNarrativeNodeTask, createFunctionNarrativeScenarioIterator, initializeFunctionNarrativeNodes,
  appendFunctionNarrativeNodes, finalizeFunctionNarrativeNodes, parseFunctionNarrative, FunctionNarrativeScenarioRun,
  FunctionNarrativeError, getFunctionNarrativeExampleConstraints } from "../../application/functionNarratives";
import { FunctionNarrativeScenarioSession } from "../../webview/codeFlow/functionNarrativeScenarioSession";
import { isFunctionNarrative, isFunctionNarrativeLanguage, type FunctionNarrative, type FunctionNarrativeContext } from "../../shared/functionNarratives";
import { buildLocalNarrativePrompt } from "../../llm/functionNarratives/localPrompt";
import { createLocalNarrativeSchema } from "../../llm/functionNarratives/responseSchema";
import type { SymbolNode } from "../../shared/types";

function contextFor(): FunctionNarrativeContext {
  const source = 'fun inspect(value: Int): Int {\n var total = value + 5\n if (total >= 10) return total\n return 0\n}';
  const node: SymbolNode = { id: "private:inspect", name: "inspect", qualifiedName: "inspect", kind: "function", language: "kotlin", filePath: "/fixture/Inspect.kt",
    range: { startLine: 0, startCharacter: 0, endLine: 4, endCharacter: 1 }, selectionRange: { startLine: 0, startCharacter: 4, endLine: 0, endCharacter: 11 } };
  const analysis = analyzeFunctionLogic({ functionNode: node, sourceText: source });
  const nodeIds = analysis.blocks.map((_, index) => "function-logic-block:" + index.toString(16).padStart(32, "0"));
  return bindFunctionNarrativeGraph({ ...buildFunctionNarrativeContext(node, source, [], analysis), detailLevel: "rich",
    parameters: [{ name: "value", type: "Int" }], valueNames: ["value", "total", "condition", "result"] }, nodeIds, []);
}

/** A fixture replaces only generation; parsing, graph binding, batching and storage remain production logic. */
function output(context: FunctionNarrativeContext): string {
  const frames = buildFunctionNarrativeScenarioFrames(context);
  const steps = (sources: typeof frames[number]["sources"]) => sources.map((source) => ({ source, text: "Read the source operation.",
    syntax: "A var declaration creates a mutable local; the comparison includes its boundary.", reason: "Substituting value 5 gives total 10.",
    effect: "Continue with total 10 along the selected branch.", values: [{ name: "total", before: "unknown", after: "10" }] }));
  if (context.nodeTask) return JSON.stringify({ steps: steps(context.nodeTask.targets.map((target) => target.source)).map((step, index) => ({ ...step, code: context.nodeTask!.targets[index].code })) });
  return JSON.stringify({ summary: "Calculate a total and return it above the inclusive threshold.", scenarios: frames.map((frame) => ({
    title: "Source path", when: frame.when, outcome: frame.outcome, assumptions: [], explanation: "Adding five gives ten, which meets the inclusive threshold and returns total.",
    analysis: { pathReason: "Value 5 gives total 10, so total >= 10 is true.", stateChange: "The local total becomes 10 and is returned; the later zero return is skipped.", alternative: "Value 4 gives total 9, so the later return 0 is reached." },
    example: { inputs: [{ name: "value", json: "5" }], result: "10" }, steps: steps([frame.sources[0]])
  })), limitations: [] });
}

test("rich source readings require complete causal fields and syntax; legacy readings remain valid", () => {
  const run = new FunctionNarrativeScenarioRun(contextFor()), context = run.nextBatch()!;
  assert.equal(context.sourceFlow!.paths.length, 1);
  const narrative = JSON.parse(output(context)) as FunctionNarrative;
  assert.equal(isFunctionNarrative(narrative, context.snippets), true);
  assert.doesNotThrow(() => parseFunctionNarrative(JSON.stringify(narrative), context, "en"));
  const deferredValues = structuredClone(narrative);
  delete deferredValues.scenarios[0].steps[0].values;
  assert.doesNotThrow(() => parseFunctionNarrative(JSON.stringify(deferredValues), context, "en"));
  for (const mutate of [(n: FunctionNarrative) => { delete n.scenarios[0].analysis; },
    (n: FunctionNarrative) => { n.scenarios[0].analysis!.alternative = ""; },
    (n: FunctionNarrative) => { n.scenarios[0].analysis!.pathReason = "x".repeat(601); },
    (n: FunctionNarrative) => { delete n.scenarios[0].steps[0].syntax; },
    (n: FunctionNarrative) => { n.scenarios[0].steps[0].syntax = "x".repeat(601); }]) {
    const invalid = structuredClone(narrative); mutate(invalid);
    assert.throws(() => parseFunctionNarrative(JSON.stringify(invalid), context, "en"), FunctionNarrativeError);
  }
  const legacy = structuredClone(narrative); delete legacy.scenarios[0].analysis; delete legacy.scenarios[0].steps[0].syntax;
  assert.doesNotThrow(() => parseFunctionNarrative(JSON.stringify(legacy), { ...context, detailLevel: undefined }, "en"));
  const split = structuredClone(narrative) as any;
  split.scenarios[0].exampleInputs = split.scenarios[0].example.inputs;
  split.scenarios[0].exampleResult = split.scenarios[0].example.result;
  delete split.scenarios[0].example;
  assert.deepEqual(parseFunctionNarrative(JSON.stringify(split), context, "en").scenarios[0].example, narrative.scenarios[0].example);
  split.scenarios[0].example = narrative.scenarios[0].example;
  assert.throws(() => parseFunctionNarrative(JSON.stringify(split), context, "en"), /invalid-response/u);
});

test("rich language checks include syntax and every causal description", () => {
  const run = new FunctionNarrativeScenarioRun(contextFor()), context = run.nextBatch()!;
  const narrative = JSON.parse(output(context)) as FunctionNarrative;
  assert.equal(isFunctionNarrativeLanguage(narrative, "en"), true);
  for (const mutate of [(n: FunctionNarrative) => { n.scenarios[0].analysis!.alternative = "다른 경로를 선택합니다."; },
    (n: FunctionNarrative) => { n.scenarios[0].steps[0].syntax = "변수를 선언합니다."; }]) {
    const invalid = structuredClone(narrative); mutate(invalid);
    assert.throws(() => parseFunctionNarrative(JSON.stringify(invalid), context, "en"), /language-mismatch/u);
  }
});

test("compact node replies inherit the original example and cannot override metadata or citation order", () => {
  const context = new FunctionNarrativeScenarioRun(contextFor()).nextBatch()!, path = context.sourceFlow!.paths[0];
  const scenario = parseFunctionNarrative(output(context), context, "en").scenarios[0];
  initializeFunctionNarrativeNodes(path, scenario);
  const task = createFunctionNarrativeNodeTask(context, path, scenario)!;
  const parsed = parseFunctionNarrative(output(task), task, "en");
  assert.deepEqual(parsed.scenarios[0].example, scenario.example);
  assert.deepEqual(parsed.scenarios[0].steps.map((step) => step.source), task.nodeTask!.targets.map((step) => step.source));
  assert.ok(task.nodeTask!.targets.length <= 2);
  const compact = JSON.parse(output(task));
  for (const invalid of [{ ...compact, example: scenario.example }, { ...compact, summary: "Overwrite" },
    { steps: [] }, { steps: compact.steps.map((step: object) => ({ ...step, values: undefined })) },
    { steps: [{ ...compact.steps[0], code: "return unrelated;" }] }, { steps: [{ ...compact.steps[0], source: { snippetId: "root", startLine: 99, endLine: 99 } }] }])
    assert.throws(() => parseFunctionNarrative(JSON.stringify(invalid), task, "en"), FunctionNarrativeError);
  assert.deepEqual(Object.keys((createLocalNarrativeSchema(task).properties as object)), ["steps"]);
  assert.match(buildLocalNarrativePrompt(task, "en"), /priorState|earlier model state/u);
});

test("Kotlin Elvis lowering keeps its original source and separate null/non-null paths", () => {
  const source = 'fun inspect(enabled: Boolean, amount: Int?): Int {\n if (!enabled) return 0\n val base = amount ?: 10\n val total = base + 5\n return total\n}';
  const node: SymbolNode = { id: "private:elvis", name: "inspect", qualifiedName: "inspect", kind: "function", language: "kotlin", filePath: "/fixture/Inspect.kt",
    range: { startLine: 0, startCharacter: 0, endLine: 5, endCharacter: 1 }, selectionRange: { startLine: 0, startCharacter: 4, endLine: 0, endCharacter: 11 } };
  const analysis = analyzeFunctionLogic({ functionNode: node, sourceText: source });
  const context = { ...buildFunctionNarrativeContext(node, source, [], analysis), parameters: [{ name: "enabled", type: "Boolean" }, { name: "amount", type: "Int?" }] };
  const paths = [...createFunctionNarrativeScenarioIterator(context)!];
  assert.equal(paths.length, 3); assert.ok(paths.every((path) => path.status === "source-terminal"));
  const lowered = paths.flatMap((path) => path.steps).filter((step) => step.loweredPredicate);
  assert.ok(lowered.length); assert.ok(lowered.every((step) => source.includes(step.code)));
  assert.ok(lowered.every((step) => step.loweredPredicate === "amount != null"));
  const batch = { ...context, sourceFlow: { basis: "source-control-flow" as const, paths, limited: false } };
  assert.deepEqual(getFunctionNarrativeExampleConstraints(batch, 1).nonNullInputs, ["amount"]);
  assert.deepEqual(getFunctionNarrativeExampleConstraints(batch, 2).nullInputs, ["amount"]);
});

test("rich examples reject contradictory fixed Boolean/null choices and completed results for partial routes", () => {
  const context = new FunctionNarrativeScenarioRun(contextFor()).nextBatch()!;
  const valid = JSON.parse(output(context)) as FunctionNarrative;
  const boolean = { ...context, sourceFlow: { ...context.sourceFlow!, paths: [{ ...context.sourceFlow!.paths[0], steps: [
    { ...context.sourceFlow!.paths[0].steps[0], branch: { outcome: "true", confidence: "exact" as const, inputCondition: "value = true" } },
    ...context.sourceFlow!.paths[0].steps.slice(1)
  ] }] } };
  const frame = buildFunctionNarrativeScenarioFrames(boolean)[0]; valid.scenarios[0].when = frame.when;
  assert.throws(() => parseFunctionNarrative(JSON.stringify(valid), boolean, "en"), /invalid-response/u);
  valid.scenarios[0].example!.inputs[0].json = "true";
  assert.doesNotThrow(() => parseFunctionNarrative(JSON.stringify(valid), boolean, "en"));
  const partial = { ...context, sourceFlow: { ...context.sourceFlow!, paths: [{ ...context.sourceFlow!.paths[0], status: "partial" as const, reason: "control-gap" as const }] } };
  const incomplete = JSON.parse(output(partial)) as FunctionNarrative;
  assert.throws(() => parseFunctionNarrative(JSON.stringify(incomplete), partial, "en"), /invalid-response/u);
  incomplete.scenarios[0].example!.result = "null";
  assert.doesNotThrow(() => parseFunctionNarrative(JSON.stringify(incomplete), partial, "en"));
});

test("carried model state excludes future nodes and keeps at most eight latest named values", () => {
  const context = contextFor(), path = [...createFunctionNarrativeScenarioIterator(context)!][0];
  const batch = { ...context, scenarioBatch: { offset: 0 }, sourceFlow: { basis: "source-control-flow" as const, paths: [path], limited: false } };
  const scenario = parseFunctionNarrative(output(batch), batch, "en").scenarios[0];
  initializeFunctionNarrativeNodes(path, scenario);
  const first = scenario.nodeDetails![0];
  first.values = Array.from({ length: 10 }, (_, index) => ({ name: "local" + index, before: "0", after: String(index) }));
  scenario.nodeDetails!.push({ ...first, nodeId: path.steps.at(-1)!.graphNodeId!, occurrence: path.steps.at(-1)!.graphOccurrence,
    values: [{ name: "future", before: "unknown", after: "999" }] });
  const task = createFunctionNarrativeNodeTask(batch, path, scenario)!;
  assert.equal(task.nodeTask!.reading!.priorState.length, 8);
  assert.equal(task.nodeTask!.reading!.priorState[0].name, "local2");
  assert.equal(task.nodeTask!.reading!.priorState.some((value) => value.name === "future"), false);
});

test("rich terminal readings use preceding node state and replace early primary evidence", () => {
  const batch = new FunctionNarrativeScenarioRun(contextFor()).nextBatch()!, path = batch.sourceFlow!.paths[0];
  const scenario = parseFunctionNarrative(output(batch), batch, "en").scenarios[0], terminal = path.steps.at(-1)!;
  scenario.steps = [{ ...scenario.steps[0], code: terminal.code, source: terminal.source,
    values: [{ name: "total", before: "5", after: "5" }] }];
  initializeFunctionNarrativeNodes(path, scenario, batch.detailLevel);
  assert.equal(scenario.nodeDetails!.length, 0, "primary terminal guesses do not skip ordered node work");
  let task, sawTerminal = false;
  while ((task = createFunctionNarrativeNodeTask(batch, path, scenario))) {
    if (task.nodeTask!.targets.some((target) => target.code === terminal.code)) {
      sawTerminal = true;
      assert.ok(task.nodeTask!.reading!.priorState.some((value) => value.name === "total" && value.value === "10"));
    }
    appendFunctionNarrativeNodes(task, scenario, parseFunctionNarrative(output(task), task, "en").scenarios[0]);
  }
  assert.equal(sawTerminal, true);
  finalizeFunctionNarrativeNodes(batch, path, scenario, "Calculate a total.");
  assert.equal(scenario.steps[0].values![0].after, "10");
  assert.equal(scenario.nodeDetails![0].effect, undefined, "entry does not borrow a later return effect");
  assert.deepEqual(scenario.nodeDetails!.map((detail) => detail.nodeId), path.graph!.nodeIds);
});

test("an interrupted rich page reuses primary prose and saved pages/nodes never generate again", async () => {
  const pages = new Map<number, FunctionNarrative>(), context = contextFor();
  const session = new FunctionNarrativeScenarioSession(context, { async write(index, value) { pages.set(index, value); }, async read(index) { return pages.get(index); }, async dispose() { pages.clear(); } });
  let primaries = 0, nodes = 0, fail = true;
  const provider = { async generate(context: FunctionNarrativeContext) {
    if (context.nodeTask) { nodes++; if (fail) { fail = false; throw new FunctionNarrativeError("cancelled"); } }
    else primaries++;
    return { modelName: "Fixture", text: output(context) };
  } };
  try {
    await assert.rejects(session.analyzeNext(provider, "en", new AbortController().signal, { reselectModel: false }), /cancelled/u);
    const page = await session.analyzeNext(provider, "en", new AbortController().signal, { reselectModel: false });
    assert.equal(primaries, 1); assert.ok(nodes >= 2); assert.equal(page!.narrative.scenarios.length, 1);
    const count = primaries + nodes;
    assert.deepEqual(await session.readPage(0), page);
    assert.deepEqual(await session.readNodePage(page!.narrative.scenarios[0].nodeDetails![1].nodeId), page);
    assert.equal(primaries + nodes, count);
  } finally { await session.dispose(); }
});
