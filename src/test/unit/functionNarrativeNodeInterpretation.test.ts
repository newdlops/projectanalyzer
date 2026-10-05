/** Node/example regressions verify complete scenario coverage, source binding, loop visits and resumable model work. */
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeFunctionLogic } from "../../analyzer/functionLogic";
import { bindFunctionNarrativeGraph, buildFunctionNarrativeContext, buildFunctionNarrativeScenarioFrames,
  FunctionNarrativeError, numberFunctionNarrativeContext, parseFunctionNarrative, createFunctionNarrativeScenarioIterator,
  initializeFunctionNarrativeNodes, createFunctionNarrativeNodeTask, appendFunctionNarrativeNodes, finalizeFunctionNarrativeNodes,
  type FunctionNarrativeProvider } from "../../application/functionNarratives";
import { isFunctionNarrative, isFunctionNarrativeExample, type FunctionNarrative, type FunctionNarrativeContext } from "../../shared/functionNarratives";
import { FunctionNarrativesHostDelivery } from "../../webview/codeFlow/functionNarrativesHostDelivery";
import type { FunctionNarrativesResponse } from "../../protocol/functionNarratives";
import type { SymbolNode } from "../../shared/types";

const source = 'fun inspect(value: Int): String {\n if (value < 0) return "negative"\n if (value == 0) return "zero"\n if (value < 10) return "small"\n if (value < 100) return "medium"\n return "large"\n}';
const request = { flowId: `code-flow:${"a".repeat(32)}` as const, graphVersion: "fixture", requestId: 1 };

/** Projected IDs are distinct from private analyzer IDs, just as at the real Host composition boundary. */
function contextFor(text = source, language = "kotlin"): FunctionNarrativeContext {
  const node: SymbolNode = { id: "private:inspect", name: "inspect", qualifiedName: "inspect", kind: "function", language, filePath: "/private/Inspect.kt",
    range: { startLine: 0, startCharacter: 0, endLine: text.split("\n").length - 1, endCharacter: 1 }, selectionRange: { startLine: 0, startCharacter: 4, endLine: 0, endCharacter: 11 } };
  const analysis = analyzeFunctionLogic({ functionNode: node, sourceText: text });
  const nodeIds = analysis.blocks.map((_, index) => "function-logic-block:" + index.toString(16).padStart(32, "0"));
  const ids = new Map(analysis.blocks.map((block, index) => [block.id, nodeIds[index]]));
  return bindFunctionNarrativeGraph({ ...buildFunctionNarrativeContext(node, text, [], analysis), parameters: [{ name: "value", type: "Int" }], valueNames: ["value", "condition", "result"] }, nodeIds,
    analysis.edges.map((edge, index) => ({ id: "function-logic-edge:" + index.toString(16).padStart(32, "0"), sourceId: ids.get(edge.sourceId)!, targetId: ids.get(edge.targetId)!, kind: edge.kind })));
}

/** The double models JSON output only; source/graph joins, deadlines and page storage remain production code. */
function reply(context: FunctionNarrativeContext): { modelName: string; text: string } {
  const frames = buildFunctionNarrativeScenarioFrames(context);
  const narrative: FunctionNarrative = { summary: "The function classifies its input and returns the corresponding source result.", scenarios: frames.map((frame, index) => {
    const terminal = context.sourceFlow!.paths[index]?.steps.at(-1)?.code ?? "";
    const result = terminal.match(/"([^"\n]+)"/u)?.[1] ?? "large";
    const value = ({ negative: -1, zero: 0, small: 5, medium: 50, large: 150 } as Record<string, number>)[result] ?? 1;
    const example = context.nodeTask?.example ?? { inputs: [{ name: "value", json: String(value) }], result: JSON.stringify(result) };
    const targets = context.nodeTask?.targets ?? [{ source: frame.sources.at(-1)! }];
    return { title: "Source scenario", when: frame.when, outcome: frame.outcome, assumptions: [], example,
      explanation: "The example input follows the selected source conditions and reaches this result.",
      steps: targets.map((target) => ({ text: "Read this source operation.", reason: "The same example inputs select this source route.", effect: "Continue to the next statement or return the source result.", source: target.source,
        values: [{ name: "value", before: example.inputs[0].json, after: example.inputs[0].json }] })) };
  }), limitations: [] };
  return { modelName: "Fixture", text: JSON.stringify(narrative) };
}

function fixture(provider: FunctionNarrativeProvider, context = contextFor()) {
  const messages: FunctionNarrativesResponse[] = [];
  const delivery = new FunctionNarrativesHostDelivery({ provider, getLanguage: () => "en", isActive: () => true,
    createPageStore() { const pages = new Map<number, FunctionNarrative>(); return { async write(index, narrative) { assert.equal(isFunctionNarrative(narrative), true); pages.set(index, narrative); }, async read(index) { return pages.get(index); }, async dispose() { pages.clear(); } }; },
    createEvidence: () => `code-evidence:${"b".repeat(64)}`, async postMessage(message) { if (message.type === "codeFlow/functionNarrativesLoaded") messages.push(message.payload); } });
  const contextId = delivery.register(request.flowId, request.graphVersion, context, "/private/Inspect.kt")!;
  return { delivery, messages, contextId };
}

test("model examples accept bounded JSON and reject executable syntax, unsafe keys, non-finite and oversized values", () => {
  const valid = { inputs: [{ name: "value", json: '{"enabled":true,"items":[1,2]}' }], result: '"small"' };
  assert.equal(isFunctionNarrativeExample(valid), true);
  for (const json of ['value()', '{"__proto__":{}}', '1e999', '[0,'.repeat(100) + '0' + ']'.repeat(100), '"' + 'x'.repeat(1300) + '"']) {
    assert.equal(isFunctionNarrativeExample({ ...valid, inputs: [{ name: "value", json }] }), false);
  }
  assert.equal(isFunctionNarrativeExample({ ...valid, inputs: [...valid.inputs, ...valid.inputs] }), false);
});

test("an oversized parameter list reports its bound before preparing or running a model", async () => {
  let prepared = 0; let generated = 0;
  const context = { ...contextFor(), parameters: Array.from({ length: 33 }, (_, index) => ({ name: "value" + index, type: "Int" })) };
  const f = fixture({ async prepare() { prepared++; }, async generate(input) { generated++; return reply(input); } }, context);
  try {
    await f.delivery.request(request);
    assert.equal(f.messages.at(-1)!.status, "context-too-large");
    assert.equal(prepared, 0); assert.equal(generated, 0);
  } finally { f.delivery.clear(); }
});

test("all Kotlin scenarios receive populated model inputs and every reached graph node; paging/source reads do no inference", async () => {
  const tasks: FunctionNarrativeContext[] = [];
  const f = fixture({ async generate(context) { tasks.push(context); return reply(context); } });
  try {
    await f.delivery.request(request);
    assert.equal(f.messages.at(-1)!.status, "ready"); assert.equal(f.messages.at(-1)!.coverage!.completed, 5);
    const examples: string[] = [];
    for (let pageIndex = 0; pageIndex < f.messages.at(-1)!.page!.count; pageIndex++) {
      await f.delivery.request({ ...request, requestId: pageIndex + 2, pageIndex, pageLanguage: "en" });
      for (const scenario of f.messages.at(-1)!.narrative!.scenarios) {
        examples.push(scenario.example!.inputs[0].json);
        assert.deepEqual(scenario.nodeDetails!.map((detail) => detail.nodeId), scenario.graph!.nodeIds);
        assert.ok(scenario.nodeDetails!.every((detail) => detail.text && detail.reason && detail.effect));
      }
    }
    assert.deepEqual(examples, ["-1", "0", "5", "50", "150"]);
    const count = tasks.length;
    assert.ok(count > 3); assert.ok(tasks.filter((task) => task.nodeTask).every((task) => task.nodeTask!.targets.length <= 3));
    const source = await f.delivery.loadSource({ ...request, contextId: f.contextId, language: "en", scenarioIndex: 0, stepIndex: 0, nodeIndex: 0, pageIndex: 2 });
    assert.ok(source); assert.equal(tasks.length, count);
  } finally { f.delivery.clear(); }
});

test("each node inference gets its own deadline even when one scenario takes more than 90 seconds", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture({ async generate(context) { t.mock.timers.tick(60000); return reply(context); } });
  try { await f.delivery.request(request); assert.equal(f.messages.at(-1)!.status, "ready"); }
  finally { f.delivery.clear(); t.mock.timers.reset(); }
});

test("cancelling node work preserves validated scenario inputs and completed chunks for retry", async () => {
  let primaryCalls = 0; let nodeCalls = 0; let started!: () => void;
  const gate = new Promise<void>((resolve) => { started = resolve; });
  const f = fixture({ async generate(context, _language, signal) {
    if (!context.nodeTask) primaryCalls++;
    else if (++nodeCalls === 2) { started(); await new Promise<never>((_resolve, reject) => signal.addEventListener("abort", () => reject(new FunctionNarrativeError("cancelled")), { once: true })); }
    return reply(context);
  } });
  try {
    const work = f.delivery.request(request); await gate; f.delivery.cancel(request); await work;
    const primaryBeforeRetry = primaryCalls;
    await f.delivery.request({ ...request, requestId: 2 });
    assert.equal(f.messages.at(-1)!.status, "ready");
    assert.equal(primaryBeforeRetry, 1); assert.equal(primaryCalls, 3, "retry reuses the first validated scenario page");
  } finally { f.delivery.clear(); }
});

test("node tasks reject changed example inputs, missing target steps and model-supplied graph identities", () => {
  const context = contextFor(); const root = context.snippets[0];
  const task: FunctionNarrativeContext = { ...context, nodeTask: { frame: { when: [], outcome: "return" }, example: { inputs: [{ name: "value", json: "1" }], result: "1" },
    targets: [{ kind: "return", code: "return", confidence: "exact", source: { snippetId: root.id, startLine: 6, endLine: 6 } }] } };
  const valid = JSON.parse(reply(task).text);
  assert.doesNotThrow(() => parseFunctionNarrative(JSON.stringify(valid), task, "en"));
  for (const mutate of [(value: FunctionNarrative) => { value.scenarios[0].example!.inputs[0].json = "2"; },
    (value: FunctionNarrative) => { value.scenarios[0].steps = []; },
    (value: FunctionNarrative) => { value.scenarios[0].graph = { nodeIds: [], edgeIds: [] }; }]) {
    const changed = structuredClone(valid); mutate(changed);
    assert.throws(() => parseFunctionNarrative(JSON.stringify(changed), task, "en"), FunctionNarrativeError);
  }
  assert.doesNotMatch(JSON.stringify(numberFunctionNarrativeContext(context)), /function-logic-block|function-logic-edge|private:inspect/);
});

test("revisited loop nodes retain a separate explanation for each occurrence and partial frontiers never become returned results", () => {
  const context = contextFor('fun inspect(value: Int): Int {\n var total = 0\n var index = 0\n while (index < value) {\n  total += index\n  index++\n }\n return total\n}');
  const paths = [...createFunctionNarrativeScenarioIterator(context)!];
  const repeated = paths.find((path) => new Set(path.graph!.nodeIds).size < path.graph!.nodeIds.length); assert.ok(repeated);
  const scenario = reply({ ...context, sourceFlow: { basis: "source-control-flow", paths: [repeated], limited: false } });
  const interpreted: FunctionNarrative = JSON.parse(scenario.text);
  const item = interpreted.scenarios[0]; initializeFunctionNarrativeNodes(repeated, item);
  let task;
  while ((task = createFunctionNarrativeNodeTask(context, repeated, item))) appendFunctionNarrativeNodes(task, item, JSON.parse(reply(task).text).scenarios[0]);
  finalizeFunctionNarrativeNodes(context, repeated, item, interpreted.summary);
  assert.deepEqual(item.nodeDetails!.map((detail) => detail.nodeId), repeated.graph!.nodeIds);
  assert.equal(new Set(item.nodeDetails!.map((detail) => detail.nodeId + ":" + detail.occurrence)).size, repeated.graph!.nodeIds.length);
  const partial = { ...repeated, steps: [], status: "partial" as const, reason: "missing-source" as const,
    graph: { nodeIds: repeated.graph!.nodeIds.slice(0, 2), edgeIds: [] } };
  initializeFunctionNarrativeNodes(partial, item); finalizeFunctionNarrativeNodes(context, partial, item, interpreted.summary);
  assert.deepEqual(item.nodeDetails!.map((detail) => detail.nodeId), [partial.graph.nodeIds[0]], "unsupported frontier has no invented return explanation");
});

test("quiet node reads cannot supersede generation or paging and missing nodes never authorize inference", async () => {
  let calls = 0; const context = contextFor();
  const f = fixture({ async generate(context) { calls++; return reply(context); } }, context);
  try {
    const nodeId = context.scenarioGraph!.nodes.find((node) => node.step?.code === 'return "large"')!.graphNodeId!;
    await f.delivery.request({ ...request, requestId: 100, nodeId, pageLanguage: "en" });
    assert.equal(f.messages.at(-1)!.status, "unavailable"); assert.equal(calls, 0);
    await f.delivery.request(request); assert.equal(f.messages.at(-1)!.status, "ready");
    const count = calls;
    await f.delivery.request({ ...request, requestId: 101, nodeId, pageLanguage: "en" });
    assert.equal(f.messages.at(-1)!.status, "ready"); assert.equal(f.messages.at(-1)!.page!.index, 2);
    await f.delivery.request({ ...request, requestId: 2, pageIndex: 0, pageLanguage: "en" });
    assert.equal(f.messages.at(-1)!.requestId, 2); assert.equal(f.messages.at(-1)!.page!.index, 0);
    assert.equal(calls, count);
  } finally { f.delivery.clear(); }
});
