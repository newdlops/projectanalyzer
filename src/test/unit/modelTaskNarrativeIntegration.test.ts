/** Mixed Guide/call Host operations share a real scheduler, source registries and validation boundary. */
import assert from "node:assert/strict";
import test from "node:test";
import { ModelTaskManager } from "../../shared/modelTasks";
import { scheduleFunctionNarrativeRequest, type FunctionNarrativeProvider } from "../../application/functionNarratives";
import type { FunctionNarrativeContext } from "../../shared/functionNarratives";
import { FunctionNarrativesHostDelivery } from "../../webview/codeFlow/functionNarrativesHostDelivery";
import { FunctionCallsHostDelivery } from "../../webview/functionCalls";
import { WebviewGraphDelivery } from "../../webview/sidebarGraphDelivery";
import { SourceNodeTokenRegistry } from "../../webview/sourceNavigation";
import { CodeFlowEvidenceTokenRegistry } from "../../webview/codeFlow";
import type { FunctionCallsResponse } from "../../protocol/functionCalls";
import type { FunctionCallNarrativesResponse } from "../../protocol/functionCallNarratives";
import type { FunctionNarrativesResponse } from "../../protocol/functionNarratives";
import { loadFunctionCallReadingFixture, functionCallReadingReply } from "./helpers/functionCallReadingFixture";

test("Guide and call batches serialize fairly, preserve queued work beyond legacy deadlines and keep cache reads inert", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const fixture = await loadFunctionCallReadingFixture("typescript"), graphs = new WebviewGraphDelivery();
  const graphVersion = graphs.activate(fixture.graph).snapshot.version;
  const sources = new SourceNodeTokenRegistry(), evidence = new CodeFlowEvidenceTokenRegistry();
  sources.activate(graphVersion, fixture.graph); evidence.activate(graphVersion, fixture.graph);
  const manager = new ModelTaskManager();
  let release!: () => void, started!: () => void, maximum = 0, active = 0;
  const hold = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { started = resolve; });
  const order: string[] = [], callReplies: FunctionCallNarrativesResponse[] = [], guideReplies: FunctionNarrativesResponse[] = [], slices: FunctionCallsResponse[] = [];
  const provider: FunctionNarrativeProvider = { managesDeadlines: true, generate(context, language, signal, options) {
    return scheduleFunctionNarrativeRequest(manager, context.functionName, signal, async () => {
      maximum = Math.max(maximum, ++active); order.push(context.callTask ? "calls" : "guide");
      if (order.length === 1) { started(); await hold; }
      active--;
      if (context.callTask) return functionCallReadingReply(context, language);
      return { modelName: "Fixture", text: JSON.stringify({ summary: "The function checks its input and returns a value.", scenarios: [{ title: "Source reading", when: [],
        steps: [{ text: "Read the source.", source: { snippetId: "root", startLine: fixture.root.range.startLine + 1, endLine: fixture.root.range.startLine + 1 } }],
        outcome: "The source determines the result.", assumptions: [] }], limitations: [] }) };
    }, options);
  } };
  const calls = new FunctionCallsHostDelivery({ graphDelivery: graphs, sourceNodeTokens: sources, evidenceTokens: evidence, provider,
    getLanguage: () => "en", readSourceText: async file => fixture.files.find(item => item.path === file)?.content,
    postMessage: async response => { slices.push(response); }, postNarratives: async response => { callReplies.push(response); } });
  const guide = new FunctionNarrativesHostDelivery({ provider, getLanguage: () => "en", isActive: version => graphs.matches(version),
    createEvidence: (file, range) => evidence.createToken(file, range), async postMessage(message) {
      if (message.type === "codeFlow/functionNarrativesLoaded") guideReplies.push(message.payload);
    } });
  const rootRequest = { graphVersion, sourceToken: sources.createToken(fixture.root.id)!, requestId: 1 };
  const guideRequest = { graphVersion, flowId: ("code-flow:" + "a".repeat(32)) as `code-flow:${string}`, requestId: 1 };
  const context: FunctionNarrativeContext = { functionName: fixture.root.name, language: "typescript", limited: false,
    snippets: [{ id: "root", role: "function", startLine: fixture.root.range.startLine + 1, endLine: fixture.root.range.endLine + 1,
      text: fixture.source.split("\n").slice(fixture.root.range.startLine, fixture.root.range.endLine + 1).join("\n"), truncated: false }] };
  try {
    await calls.load(rootRequest); guide.register(guideRequest.flowId, graphVersion, context, fixture.root.filePath);
    const callRequest = { ...rootRequest, requestId: 2, contextId: slices[0].narratives!.contextId!, scope: "overview" as const };
    const first = calls.explain(callRequest); await entered;
    const second = guide.request(guideRequest); await new Promise<void>(resolve => setImmediate(resolve));
    assert.ok(guideReplies.some(reply => reply.status === "working" && reply.task?.phase === "queued"));
    t.mock.timers.tick(90000); await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(guideReplies.some(reply => ["timeout", "failed", "cancelled"].includes(reply.status)), false);
    release(); await Promise.all([first, second]);
    assert.equal(maximum, 1); assert.deepEqual(order, ["calls", "guide", "calls", "calls"]);
    assert.equal(callReplies.at(-1)?.status, "ready"); assert.equal(guideReplies.at(-1)?.status, "ready");
    const count = manager.snapshot().history.length;
    await calls.explain({ ...callRequest, requestId: 3, pageIndex: 0, pageLanguage: "en" });
    await guide.request({ ...guideRequest, requestId: 2 });
    assert.equal(manager.snapshot().history.length, count); assert.equal(order.length, 4);
    assert.ok(manager.snapshot().history.every(record => record.phase === "completed"));
  } finally { release(); calls.reset(); guide.clear(); await manager.dispose(); }
});
