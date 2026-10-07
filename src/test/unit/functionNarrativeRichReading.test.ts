/** Rich readings preserve source contracts, inherited model state and bounded resumable node work. */
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeFunctionLogic } from "../../analyzer/functionLogic";
import { bindFunctionNarrativeGraph, buildFunctionNarrativeContext, buildFunctionNarrativeScenarioFrames,
  createFunctionNarrativeNodeTask, createFunctionNarrativeScenarioIterator, initializeFunctionNarrativeNodes,
  appendFunctionNarrativeNodes, finalizeFunctionNarrativeNodes, parseFunctionNarrative, FunctionNarrativeScenarioRun,
  FunctionNarrativeError, getFunctionNarrativeExampleConstraints, buildFunctionNarrativePrompt } from "../../application/functionNarratives";
import { FunctionNarrativeScenarioSession } from "../../webview/codeFlow/functionNarrativeScenarioSession";
import { isFunctionNarrative, isFunctionNarrativeLanguage, type FunctionNarrative, type FunctionNarrativeContext } from "../../shared/functionNarratives";
import { buildLocalNarrativePrompt, buildLocalNarrativeUserMessages } from "../../llm/functionNarratives/localPrompt";
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

test("local phases share an untrusted source message without moving prior model state into the reusable prefix", () => {
  const batch = new FunctionNarrativeScenarioRun(contextFor()).nextBatch()!;
  const prep = { ...batch, nodePreparation: true };
  const narrative = parseFunctionNarrative(output(batch), batch, "en");
  const scenario = narrative.scenarios[0], path = batch.sourceFlow!.paths[0];
  initializeFunctionNarrativeNodes(path, scenario, "rich");
  const task = createFunctionNarrativeNodeTask(batch, path, scenario)!;
  assert.ok(task);
  task.nodeTask!.reading = { explanation: "Earlier private model prose", priorState: [{ name: "total", value: "987654" }] };
  for (const language of ["ko", "en"] as const) {
    const initial = buildLocalNarrativeUserMessages(prep, language);
    const focused = buildLocalNarrativeUserMessages(task, language);
    assert.equal(initial.length, 2); assert.equal(focused.length, 2);
    assert.equal(initial[0], focused[0]);
    assert.equal(initial.join("\n"), buildLocalNarrativePrompt(prep, language));
    assert.equal(focused.join("\n"), buildLocalNarrativePrompt(task, language));
    assert.ok(focused.every(message => !message.startsWith("\n")), "ChatML delimiters must remain exact token sequences");
    assert.match(initial[0], /fun inspect|var total = value \+ 5/u);
    assert.doesNotMatch(focused[0], /987654|Earlier private model prose|scenarioBatch|selectedRoute/u);
    assert.match(focused[1], /987654/u);
    assert.doesNotMatch(focused.join(""), /Earlier private model prose/u);
  }
});

test("step-less partial and implicit-end routes produce valid local schemas and retain only owned declaration evidence", () => {
  const batch = new FunctionNarrativeScenarioRun(contextFor()).nextBatch()!;
  for (const status of ["partial", "source-terminal"] as const) {
    const context: FunctionNarrativeContext = { ...batch, sourceFlow: { basis: "source-control-flow", limited: status === "partial",
      paths: [{ steps: [], status, confidence: "exact", ...(status === "partial" ? { reason: "control-gap" as const } : {}) }] } };
    const frame = buildFunctionNarrativeScenarioFrames(context)[0];
    assert.deepEqual(frame.sources, [{ snippetId: "root", startLine: 1, endLine: 1 }]);
    for (const language of ["ko", "en"] as const) {
      const schema = createLocalNarrativeSchema(context, language) as any;
      const properties = schema.properties.scenarios.items[0].properties.steps.items.properties;
      assert.equal(Object.hasOwn(properties, "code"), false);
      assert.deepEqual(properties.source.enum, frame.sources);
      const pending: unknown[] = [schema];
      while (pending.length) {
        const item = pending.pop(); if (!item || typeof item !== "object") continue;
        if ("enum" in item) assert.ok(Array.isArray(item.enum) && item.enum.length > 0, "llama.cpp rejects empty enums before model loading");
        pending.push(...Object.values(item));
      }
      assert.match(buildLocalNarrativePrompt(context, language), language === "ko" ? /code 필드를 넣지/u : /STEP-LESS SOURCE ROUTES/u);
    }
    assert.match(buildFunctionNarrativePrompt(context, "en")[0], /STEP-LESS SOURCE ROUTES/u);
    const narrative = JSON.parse(output(context)) as FunctionNarrative;
    if (status === "partial") narrative.scenarios[0].example!.result = "null";
    assert.doesNotThrow(() => parseFunctionNarrative(JSON.stringify(narrative), context, "en"));
    const invented = structuredClone(narrative); invented.scenarios[0].steps[0].code = "return 0";
    assert.throws(() => parseFunctionNarrative(JSON.stringify(invented), context, "en"), /invalid-response/u);
    const wrongSource = structuredClone(narrative); wrongSource.scenarios[0].steps[0].source.startLine = 2;
    assert.throws(() => parseFunctionNarrative(JSON.stringify(wrongSource), context, "en"), /invalid-response/u);
    assert.equal(context.sourceFlow!.paths[0].steps.length, 0, "schema construction must not manufacture ordered source operations");
  }
});

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

test("rich primary prefix readings are reused in order and remaining nodes retain carried state", () => {
  const batch = new FunctionNarrativeScenarioRun(contextFor()).nextBatch()!, path = batch.sourceFlow!.paths[0];
  const scenario = parseFunctionNarrative(output(batch), batch, "en").scenarios[0];
  scenario.steps = path.steps.slice(0, 2).map(target => ({ ...scenario.steps[0], code: target.code, source: target.source, text: "Read " + target.code + "." }));
  initializeFunctionNarrativeNodes(path, scenario, "rich");
  assert.deepEqual(scenario.nodeDetails!.map(detail => detail.nodeId), path.steps.slice(0, 2).map(target => target.graphNodeId));
  const task = createFunctionNarrativeNodeTask(batch, path, scenario)!;
  assert.equal(task.nodeTask!.targets[0].code, path.steps[2].code);
  assert.equal(task.nodeTask!.reading!.priorState.find(value => value.name === "total")!.value, "10");
  const duplicated = structuredClone(scenario);
  duplicated.steps[1].text = duplicated.steps[0].text;
  initializeFunctionNarrativeNodes(path, duplicated, "rich");
  assert.equal(duplicated.nodeDetails!.length, 1, "copied guard prose is regenerated rather than reused for a different operation");
  assert.equal(createFunctionNarrativeNodeTask(batch, path, duplicated)!.nodeTask!.targets[0].code, path.steps[1].code);
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

test("final synthesis follows completed node values, rejects rewritten inputs/evidence and resumes only the unfinished synthesis", async () => {
  const pages = new Map<number, FunctionNarrative>(), context = contextFor();
  let writes = 0, nodeCalls = 0, summaries = 0;
  const session = new FunctionNarrativeScenarioSession(context, { async write(index, value) { writes++; pages.set(index, value); },
    async read(index) { return pages.get(index); }, async dispose() { pages.clear(); } });
  const provider = { supportsFinalSummary: () => true, async generate(batch: FunctionNarrativeContext) {
    if (batch.summaryTask) {
      summaries++;
      assert.equal(batch.summaryTask.resultJson, "10", "terminal model state replaces the earlier guessed result 999");
      assert.ok(!JSON.stringify(batch.summaryTask).includes("999"));
      if (summaries === 1) throw new FunctionNarrativeError("cancelled");
      const completed = JSON.parse(output(batch)) as FunctionNarrative;
      completed.summary = "Final source reading from the completed node trace.";
      completed.scenarios[0].steps = structuredClone(batch.summaryTask.steps);
      completed.scenarios[0].example = { inputs: batch.summaryTask.inputs, result: batch.summaryTask.resultJson! };
      const rewritten = structuredClone(completed); rewritten.scenarios[0].example!.inputs[0].json = "99";
      assert.throws(() => parseFunctionNarrative(JSON.stringify(rewritten), batch, "en"), /invalid-response/);
      const wrongResult = structuredClone(completed); wrongResult.scenarios[0].example!.result = "999";
      assert.throws(() => parseFunctionNarrative(JSON.stringify(wrongResult), batch, "en"), /invalid-response/);
      const wrongEvidence = structuredClone(completed); wrongEvidence.scenarios[0].steps[0].text = "Overwrite completed evidence.";
      assert.throws(() => parseFunctionNarrative(JSON.stringify(wrongEvidence), batch, "en"), /invalid-response/);
      batch.summaryTask.knownFunctionSummary = completed.summary;
      const wrongPurpose = structuredClone(completed); wrongPurpose.summary = "A different function purpose.";
      assert.throws(() => parseFunctionNarrative(JSON.stringify(wrongPurpose), batch, "en"), /invalid-response/);
      assert.doesNotThrow(() => parseFunctionNarrative(JSON.stringify(completed), batch, "en"));
      return { modelName: "Final fixture", text: JSON.stringify(completed) };
    }
    if (batch.nodeTask) { nodeCalls++; return { modelName: "Node fixture", text: output(batch) }; }
    const initial = JSON.parse(output(batch)) as FunctionNarrative;
    initial.scenarios[0].example!.result = "999";
    return { modelName: "Initial fixture", text: JSON.stringify(initial) };
  } };
  try {
    await assert.rejects(session.analyzeNext(provider, "en", new AbortController().signal, { reselectModel: false }), /cancelled/);
    const completedNodes = nodeCalls;
    assert.equal(writes, 0); assert.equal(session.pageCount, 0); assert.equal(session.coverage.completed, 0);
    const page = await session.analyzeNext(provider, "en", new AbortController().signal, { reselectModel: false });
    assert.equal(nodeCalls, completedNodes); assert.equal(summaries, 2); assert.equal(writes, 1);
    assert.equal(page!.narrative.scenarios[0].example!.result, "10");
    assert.equal(page!.narrative.summary, "Final source reading from the completed node trace.");
    assert.equal(page!.narrative.scenarios[0].nodeDetails![0].text, page!.narrative.summary);
    const count = nodeCalls + summaries; await session.readPage(0); assert.equal(nodeCalls + summaries, count);
  } finally { await session.dispose(); }
});

test("source bindings named result and condition survive node carry state without borrowing synthetic predicate values", () => {
  const context = contextFor(), source = { snippetId: "root", startLine: 2, endLine: 2 };
  const steps = [
    { kind: "mutation" as const, code: "var result = 15", writeTargets: ["result"], graphNodeId: "result-write", graphOccurrence: 1, confidence: "exact" as const, source },
    { kind: "mutation" as const, code: "var condition = 30", writeTargets: ["condition"], graphNodeId: "condition-write", graphOccurrence: 2, confidence: "exact" as const, source },
    { kind: "condition" as const, code: "condition > 20", graphNodeId: "predicate", graphOccurrence: 3, confidence: "exact" as const, source },
    { kind: "return" as const, code: "return result", graphNodeId: "return", graphOccurrence: 4, confidence: "exact" as const, source }
  ];
  const path = { status: "source-terminal" as const, confidence: "exact" as const, steps, graph: { nodeIds: steps.map(step => step.graphNodeId), edgeIds: [] } };
  const scenario = JSON.parse(output(new FunctionNarrativeScenarioRun(context).nextBatch()!)).scenarios[0];
  scenario.nodeDetails = steps.slice(0, 3).map((step, index) => ({ nodeId: step.graphNodeId, occurrence: step.graphOccurrence,
    source, text: "Saved source reading.", reason: "Saved value.", values: [{ name: index === 0 ? "result" : "condition", before: "unknown", after: index === 0 ? "15" : index === 1 ? "30" : "true" }] }));
  const task = createFunctionNarrativeNodeTask(context, path, scenario)!;
  assert.deepEqual(task.nodeTask!.reading!.priorState, [{ name: "result", value: "15" }, { name: "condition", value: "30" }]);
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
    while (!session.complete) await session.analyzeNext(provider, "en", new AbortController().signal, { reselectModel: false });
    const untouched = await session.analyzeNext({ ...provider, async withRun() { throw new Error("completed sessions must not prepare a model"); } },
      "en", new AbortController().signal, { reselectModel: false });
    assert.equal(untouched, undefined);
  } finally { await session.dispose(); }
});
