/** Complete-run regressions cover all paths, bounded pages, cancellation/resume, language and source ownership. */
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeFunctionLogic } from "../../analyzer/functionLogic";
import { buildFunctionNarrativeContext, buildFunctionNarrativeScenarioFrames, FunctionNarrativeError, type FunctionNarrativeProvider } from "../../application/functionNarratives";
import { FunctionNarrativesHostDelivery } from "../../webview/codeFlow/functionNarrativesHostDelivery";
import { buildFunctionNarrativeSourceAnnotations, type FunctionNarrative, type FunctionNarrativeContext } from "../../shared/functionNarratives";
import type { FunctionNarrativesResponse } from "../../protocol/functionNarratives";
import type { SymbolNode } from "../../shared/types";

const request = { flowId: `code-flow:${"a".repeat(32)}` as const, graphVersion: "fixture", requestId: 1 };

/** Valid provider output obeys fixed slots; tests independently assert the total eight-path source combination. */
function reply(context: FunctionNarrativeContext) {
  const frames = buildFunctionNarrativeScenarioFrames(context);
  const narrative: FunctionNarrative = { summary: "The function accumulates values according to three independent Boolean decisions.", scenarios: frames.map((frame) => ({
    title: "Source scenario", when: frame.when, outcome: frame.outcome, assumptions: [], explanation: "The selected source decisions lead to the supplied return statement.",
    steps: [{ text: "Return the accumulated result.", reason: "The source conditions select this route.", effect: "The function returns to its caller.", source: frame.sources.at(-1)! }]
  })), limitations: [] };
  return { modelName: "Fixture", text: JSON.stringify(narrative) };
}

/** A storage port double retains prose outside the delivery object's cache, exactly like the file adapter. */
function fixture(provider: FunctionNarrativeProvider, onMessage?: (response: FunctionNarrativesResponse) => void,
  configure?: (context: FunctionNarrativeContext) => FunctionNarrativeContext) {
  const source = 'function inspect(a: boolean, b: boolean, c: boolean) {\n let total = 0;\n if (a) total += 1;\n if (b) total += 2;\n if (c) total += 4;\n return total;\n}';
  const node: SymbolNode = { id: "private:inspect", name: "inspect", qualifiedName: "inspect", kind: "function", language: "typescript", filePath: "/private/inspect.ts",
    range: { startLine: 0, startCharacter: 0, endLine: 6, endCharacter: 1 }, selectionRange: { startLine: 0, startCharacter: 9, endLine: 0, endCharacter: 16 } };
  const initial = buildFunctionNarrativeContext(node, source, [], analyzeFunctionLogic({ functionNode: node, sourceText: source }));
  const context = configure ? configure(initial) : initial;
  const messages: FunctionNarrativesResponse[] = [];
  const presentations: Array<{ scenarioOffset?: number }> = [];
  const state = { language: "en" as "en" | "ko", active: true, disposed: 0, readPageGate: undefined as ((index: number) => Promise<void>) | undefined };
  const delivery = new FunctionNarrativesHostDelivery({ provider, getLanguage: () => state.language, isActive: () => state.active,
    createPageStore() { const pages = new Map<number, FunctionNarrative>(); return { async write(index, narrative) { pages.set(index, narrative); },
      async read(index) { await state.readPageGate?.(index); return pages.get(index); }, async dispose() { pages.clear(); state.disposed++; } }; },
    sourcePresenter: { show(value) { presentations.push(value); }, clear() {} }, createEvidence: () => `code-evidence:${"b".repeat(64)}`,
    async postMessage(message) { if (message.type === "codeFlow/functionNarrativesLoaded") { messages.push(message.payload); onMessage?.(message.payload); } } });
  const contextId = delivery.register(request.flowId, request.graphVersion, context, node.filePath, "c".repeat(64))!;
  return { delivery, messages, state, contextId, presentations, context };
}

test("one explicit generation analyzes all eight paths and exposes bounded cache-only pages with global source numbers", async () => {
  const batches: FunctionNarrativeContext[] = [];
  const f = fixture({ async generate(context) { batches.push(context); return reply(context); } });
  try {
    await f.delivery.request(request);
    assert.equal(batches.length, 4); assert.deepEqual(batches.map((batch) => batch.scenarioBatch!.offset), [0, 2, 4, 6]);
    assert.ok(batches.every((batch) => batch.scenarioGraph === undefined));
    assert.deepEqual(f.messages.map((message) => message.status), ["progress", "progress", "progress", "ready"]);
    const completed = f.messages.at(-1)!;
    assert.deepEqual(completed.coverage, { completed: 8, discovered: 8, total: 8, complete: true, sourceLimited: false });
    assert.equal(completed.narrative!.scenarios.length, 2); assert.equal(completed.page!.count, 4);
    await f.delivery.request({ ...request, requestId: 2, pageIndex: 3, pageLanguage: "en" });
    const page = f.messages.at(-1)!;
    assert.equal(batches.length, 4); assert.deepEqual(page.page, { index: 3, count: 4, offset: 6 });
    const annotations = buildFunctionNarrativeSourceAnnotations(page.narrative!, f.context.snippets, page.page!.offset);
    assert.deepEqual(annotations.flatMap((annotation) => annotation.references.map((ref) => ref.label)), ["7.1", "8.1"]);
    assert.equal(f.presentations.at(-1)!.scenarioOffset, 6);
    f.state.language = "ko";
    await f.delivery.request({ ...request, requestId: 3, pageIndex: 2, pageLanguage: "en" });
    assert.equal(f.messages.at(-1)!.language, "en"); assert.equal(batches.length, 4);
    const target = await f.delivery.loadSource({ ...request, contextId: f.contextId, language: "en", pageIndex: 3, scenarioIndex: 1, stepIndex: 0 });
    assert.ok(target); target.present(); assert.equal(f.presentations.at(-1)!.scenarioOffset, 6);
    await f.delivery.request({ ...request, requestId: 4, pageIndex: 99, pageLanguage: "en" });
    assert.equal(f.messages.at(-1)!.status, "stale"); assert.equal(batches.length, 4);
    f.state.language = "en"; await f.delivery.request({ ...request, requestId: 5 });
    assert.equal(f.messages.at(-1)!.cacheHit, true); assert.equal(batches.length, 4);
  } finally { f.delivery.clear(); }
  assert.equal(f.state.disposed, 1);
});

test("the native deadline adapter preserves page scope and final-summary capabilities through delivery and cache reads", async () => {
  let active = false, scopes = 0, releases = 0;
  let scopeFailure: unknown;
  const phases: string[] = [];
  const provider: FunctionNarrativeProvider = { supportsFinalSummary: () => true,
    async withRun(_language, _signal, operation) {
      try {
        assert.equal(this, provider); assert.equal(active, false); active = true; scopes++;
        return await operation();
      } catch (error) { scopeFailure = error; throw error; }
      finally { active = false; releases++; }
    }, async generate(context) {
      assert.equal(active, true, "native requests retain the real provider scope");
      assert.ok(context.nodePreparation || context.nodeTask || context.summaryTask, "provisional and final phases survive the adapter");
      phases.push(context.summaryTask ? "summary" : context.nodeTask ? "reading" : "nodes");
      const frame = buildFunctionNarrativeScenarioFrames(context)[0], terminal = context.sourceFlow!.paths[0].steps.at(-1)!;
      const read = (target: typeof terminal) => ({ code: target.code, source: target.source,
        syntax: "Return ends this function.", text: "Return the source total.", reason: "The chosen decisions reach this return.",
        effect: "The total is returned.", values: [{ name: "result", before: "not returned", after: "0" }] });
      const steps = context.summaryTask?.steps ?? context.nodeTask?.targets.map(read) ?? [read(terminal)];
      if (context.nodeTask) return { modelName: "Capability fixture", text: JSON.stringify({ steps }) };
      return { modelName: "Capability fixture", text: JSON.stringify({ summary: context.summaryTask ? "Final source synthesis." : "Private preparation.", limitations: [],
        scenarios: [{ title: "Source route", when: frame.when, outcome: frame.outcome, assumptions: [], steps,
          explanation: "The selected source decisions reach the final return.",
          analysis: { pathReason: "This source route is selected.", stateChange: "The total is returned.", alternative: "A different source choice selects another route." },
          example: { inputs: [], result: "0" } }] }) };
    } };
  const f = fixture(provider, undefined, context => ({ ...context, detailLevel: "rich", parameters: [] }));
  try {
    await f.delivery.request(request);
    assert.equal(f.messages.at(-1)!.status, "ready", scopeFailure instanceof Error ? scopeFailure.stack : phases.join(","));
    assert.equal(phases[0], "nodes"); assert.equal(phases.at(-1), "summary"); assert.equal(scopes, 8); assert.equal(releases, 8);
    assert.equal(phases.filter(phase => phase === "summary").length, 8);
    assert.equal(f.messages.at(-1)!.narrative!.summary, "Final source synthesis.");
    const count = phases.length;
    await f.delivery.request({ ...request, requestId: 2, pageIndex: 0, pageLanguage: "en" });
    assert.equal(f.messages.at(-1)!.cacheHit, true); assert.equal(scopes, 8); assert.equal(phases.length, count);
  } finally { f.delivery.clear(); }
});

test("cancel preserves completed pages and explicit resume retries only the pending batch", async () => {
  let started!: () => void;
  const secondStarted = new Promise<void>((resolve) => { started = resolve; });
  const batches: FunctionNarrativeContext[] = [];
  const f = fixture({ async generate(context, _language, signal) {
    batches.push(context);
    if (batches.length === 2) { started(); await new Promise<never>((_resolve, reject) => signal.addEventListener("abort", () => reject(new FunctionNarrativeError("cancelled")), { once: true })); }
    return reply(context);
  } });
  try {
    const pending = f.delivery.request(request); await secondStarted; f.delivery.cancel(request); await pending;
    assert.equal(f.messages.at(-1)!.status, "cancelled"); assert.equal(f.messages.at(-1)!.coverage!.completed, 2);
    await f.delivery.request({ ...request, requestId: 2 });
    assert.equal(batches.length, 5); assert.equal(batches[1], batches[2]);
    assert.equal(f.messages.at(-1)!.coverage!.completed, 8); assert.equal(f.messages.at(-1)!.coverage!.complete, true);
  } finally { f.delivery.clear(); }
});

test("reading a completed function does not cancel another function's pending batch", async () => {
  let calls = 0, started!: () => void, release!: () => void, runningSignal: AbortSignal | undefined;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const hold = new Promise<void>(resolve => { release = resolve; });
  const f = fixture({ async generate(context, _language, signal) {
    if (++calls === 5) { runningSignal = signal; started(); await hold; }
    return reply(context);
  } });
  try {
    await f.delivery.request(request);
    const other = { ...request, flowId: `code-flow:${"d".repeat(32)}` as const };
    f.delivery.register(other.flowId, other.graphVersion, f.context, "/private/inspect.ts");
    const pending = f.delivery.request(other); await entered;
    await f.delivery.request({ ...request, requestId: 2 });
    assert.equal(runningSignal?.aborted, false); assert.equal(calls, 5);
    assert.ok(f.messages.some(message => message.flowId === request.flowId && message.requestId === 2 && message.cacheHit));
    release(); await pending;
    assert.equal(calls, 8); assert.equal(f.messages.at(-1)?.status, "ready");
  } finally { release(); f.delivery.clear(); }
});

test("a slow older page cannot replace a later page's source annotations", async () => {
  const f = fixture({ async generate(context) { return reply(context); } });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  try {
    await f.delivery.request(request);
    f.state.readPageGate = async (index) => { if (index === 1) await gate; };
    const older = f.delivery.request({ ...request, requestId: 2, pageIndex: 1, pageLanguage: "en" });
    await f.delivery.request({ ...request, requestId: 3, pageIndex: 3, pageLanguage: "en" });
    release(); await older;
    assert.equal(f.messages.at(-1)!.requestId, 3); assert.equal(f.presentations.at(-1)!.scenarioOffset, 6);
    f.state.active = false;
    assert.equal(await f.delivery.loadSource({ ...request, contextId: f.contextId, language: "en", pageIndex: 3, scenarioIndex: 0, stepIndex: 0 }), undefined);
  } finally { release(); f.delivery.clear(); }
});

test("a model returning one scenario for a two-path slot is rejected and cannot claim complete coverage", async () => {
  let calls = 0;
  const f = fixture({ async generate(context) { calls++; const response = reply(context); const narrative = JSON.parse(response.text); narrative.scenarios.pop(); return { ...response, text: JSON.stringify(narrative) }; } });
  try {
    await f.delivery.request(request);
    assert.equal(calls, 1); assert.equal(f.messages.at(-1)!.status, "invalid-response");
    assert.equal(f.messages.at(-1)!.coverage!.completed, 0); assert.equal(f.messages.at(-1)!.coverage!.complete, false);
    assert.equal(f.messages.at(-1)!.narrative, undefined);
  } finally { f.delivery.clear(); }
});

test("90-second deadlines apply separately to batches, allowing an entire function to take longer", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture({ async generate(context) { t.mock.timers.tick(60000); return reply(context); } });
  try { await f.delivery.request(request); assert.equal(f.messages.at(-1)!.status, "ready"); assert.equal(f.messages.at(-1)!.coverage!.completed, 8); }
  finally { f.delivery.clear(); t.mock.timers.reset(); }
});

test("a batch exceeding 90 seconds times out while preserving earlier pages for explicit resume", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const f = fixture({ async generate(context) { if (++calls === 2) t.mock.timers.tick(90001); return reply(context); } });
  try {
    await f.delivery.request(request); assert.equal(f.messages.at(-1)!.status, "timeout");
    assert.equal(f.messages.at(-1)!.coverage!.completed, 2); assert.equal(f.messages.at(-1)!.coverage!.complete, false);
    await f.delivery.request({ ...request, requestId: 2 });
    assert.equal(f.messages.at(-1)!.coverage!.completed, 8); assert.equal(calls, 5);
  } finally { f.delivery.clear(); t.mock.timers.reset(); }
});

test("inferred and partial paths get individual fixed slots and visible source coverage limits", async () => {
  const f = fixture({ async generate(context) { return reply(context); } });
  const graph = f.context.scenarioGraph!;
  graph.nodes[graph.entry].next[0].confidence = "inferred";
  graph.nodes.find((node) => node.kind === "condition")!.next[0].target = -1;
  try {
    await f.delivery.request(request);
    assert.equal(f.messages.at(-1)!.status, "ready");
    assert.equal(f.messages.at(-1)!.coverage!.complete, true);
    assert.equal(f.messages.at(-1)!.coverage!.sourceLimited, true);
    assert.equal(f.messages.at(-1)!.coverage!.completed, 5);
  } finally { f.delivery.clear(); }
});

test("model preparation can exceed the inference deadline and occurs once, never during cached paging", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] }); let preparations = 0;
  const f = fixture({ async prepare(_language, signal) { preparations++; t.mock.timers.tick(180000); assert.equal(signal.aborted, false); }, async generate(context) { return reply(context); } });
  try {
    await f.delivery.request(request); assert.equal(f.messages.at(-1)!.status, "ready"); assert.equal(preparations, 1);
    await f.delivery.request({ ...request, requestId: 2, pageIndex: 1, pageLanguage: "en" });
    await f.delivery.request({ ...request, requestId: 3 }); assert.equal(preparations, 1);
  } finally { f.delivery.clear(); t.mock.timers.reset(); }
});

test("Guide cancellation ends an uncooperative preparation and no inference runs afterward", async () => {
  let started!: () => void; const gate = new Promise<void>((resolve) => { started = resolve; });
  let inferences = 0;
  const f = fixture({ async prepare() { started(); await new Promise(() => {}); }, async generate(context) { inferences++; return reply(context); } });
  try {
    const pending = f.delivery.request(request); await gate; f.delivery.cancel(request); await pending;
    assert.equal(f.messages.at(-1)!.status, "cancelled"); assert.equal(inferences, 0); assert.equal(f.messages.at(-1)!.coverage!.completed, 0);
  } finally { f.delivery.clear(); }
});

test("preparation failure preserves a retryable session; a later explicit action prepares and analyzes", async () => {
  let attempts = 0; let inferences = 0;
  const f = fixture({ async prepare() { if (++attempts === 1) throw new FunctionNarrativeError("download-failed"); }, async generate(context) { inferences++; return reply(context); } });
  try {
    await f.delivery.request(request); assert.equal(f.messages.at(-1)!.status, "download-failed"); assert.equal(inferences, 0);
    await f.delivery.request({ ...request, requestId: 2 }); assert.equal(attempts, 2); assert.equal(inferences, 4); assert.equal(f.messages.at(-1)!.coverage!.completed, 8);
  } finally { f.delivery.clear(); }
});
