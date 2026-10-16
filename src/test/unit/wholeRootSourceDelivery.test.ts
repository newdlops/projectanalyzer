/** Real root Host/source wiring, storage freshness and teardown ordering; model responses remain explicit test doubles. */
import assert from "node:assert/strict";
import test from "node:test";
import { CodeFlowInsightCache } from "../../application/codeFlow";
import { CodeFlowHostDelivery } from "../../webview/codeFlow/codeFlowHostDelivery";
import type { FunctionNarrativeContext, FunctionNarrative } from "../../shared/functionNarratives";
import type { ExtensionResponse } from "../../protocol/messages";
import type { FunctionNarrativeProvider } from "../../application/functionNarratives";
import { wholeNarrativeHostFixture, wholeRootReply } from "../helpers/wholeNarrativeHost";

/** Exercise published function registration and page generation rather than constructing a model context in the test. */
async function rootHost(options: { mutateDuringWrite?: boolean; release?: (signal: AbortSignal) => Promise<void> } = {}) {
  const f = await wholeNarrativeHostFixture(0), messages: ExtensionResponse[] = [], contexts: FunctionNarrativeContext[] = [];
  let writes = 0, stores = 0;
  const provider: FunctionNarrativeProvider = {
    async prepare() { f.events.push('prepare'); },
    async generate(context) {
      f.events.push('generate'); contexts.push(context);
      assert.ok(context.sourceEvidence); assert.equal(context.sourceWorksheet, undefined); assert.equal(context.checkedExamples, undefined);
      assert.equal(context.snippets.find(snippet => snippet.role === 'function')?.text, f.rootText);
      assert.ok(context.snippets.some(snippet => snippet.text === f.callerText));
      assert.ok(context.snippets.every(snippet => !snippet.truncated));
      return wholeRootReply(context);
    },
    async withRun<T>(_language: 'ko' | 'en', signal: AbortSignal, operation: () => Promise<T>) {
      try { return await operation(); } finally { await options.release?.(signal); f.events.push('provider-released'); }
    }
  };
  const delivery = new CodeFlowHostDelivery({ ...f, narrativeSources: f.access, functionNarrativeProvider: provider,
    insightCache: new CodeFlowInsightCache(), getUiLanguage: () => 'en',
    async readSourceText(filePath) { return f.files.find(file => file.path === filePath)?.content; },
    async openEvidenceLocation() {}, logger: { debug() {}, info() {}, warn() {}, error() {} },
    createFunctionNarrativePageStore() {
      stores++; const pages = new Map<number, FunctionNarrative>();
      return { async write(index, narrative) {
        writes++; pages.set(index, structuredClone(narrative));
        if (options.mutateDuringWrite) { f.files[0].content += '// changed during storage'; f.state.revision++; }
      }, async read(index) { return pages.get(index); }, async dispose() { pages.clear(); } };
    },
    async postMessage(message) {
      if (message.type === 'codeFlow/functionNarrativesLoaded' && message.payload.status === 'ready' && !message.payload.cacheHit) {
        assert.ok(f.events.includes('provider-released'), 'ready must follow provider-scope cleanup');
      }
      messages.push(message);
    }
  });
  await delivery.publishFunctionNode(f.graphVersion, f.root.id, f.files[0].content);
  const detail = messages.find(message => message.type === 'codeFlow/detailLoaded'); assert.ok(detail?.type === 'codeFlow/detailLoaded');
  assert.equal(detail.payload.logic?.tutor?.narratives?.available, true);
  const request = { graphVersion: f.graphVersion, flowId: detail.payload.id, requestId: 1 };
  const replies = () => messages.filter((message): message is Extract<ExtensionResponse, { type: 'codeFlow/functionNarrativesLoaded' }> => message.type === 'codeFlow/functionNarrativesLoaded').map(message => message.payload);
  return { ...f, delivery, request, messages, contexts, replies, writes: () => writes, stores: () => stores };
}

test('actual root Host reacquires complete long source and callers after preparation, then serves every stored page after teardown', async () => {
  const h = await rootHost();
  try {
    assert.equal(h.state.captures, 0); assert.equal(h.contexts.length, 0);
    await h.delivery.requestFunctionNarratives(h.request);
    assert.equal(h.replies().at(-1)?.status, 'ready'); assert.ok(h.contexts.length > 2);
    assert.equal(h.state.captures, 1); assert.equal(h.state.disposed, 1);
    assert.ok(h.events.indexOf('prepare') < h.events.indexOf('capture'));
    const done = h.replies().at(-1)!;
    assert.equal(done.coverage?.complete, true); assert.equal(done.coverage?.total, 2); assert.equal(done.page?.count, 2);
    assert.equal(h.writes(), 2);
    const calls = h.contexts.length;
    await h.delivery.requestFunctionNarratives({ ...h.request, requestId: 2, pageIndex: 1, pageLanguage: 'en' });
    assert.equal(h.contexts.length, calls); assert.equal(h.state.captures, 1); assert.equal(h.replies().at(-1)?.cacheHit, true);
    assert.equal(h.replies().at(-1)?.page?.index, 1);
    assert.ok(h.leases[0].capture.rootIds.includes(h.graph.nodes.find(node => node.name === 'outsideCaller')!.id));
  } finally { h.delivery.clearScenarioInputs(); }
});

test('root source change during page storage cannot commit a page or publish ready', async () => {
  const h = await rootHost({ mutateDuringWrite: true });
  try {
    await h.delivery.requestFunctionNarratives(h.request);
    assert.equal(h.writes(), 1); assert.equal(h.state.disposed, 1);
    assert.ok(!h.replies().some(reply => reply.status === 'ready'));
    assert.equal(h.replies().at(-1)?.status, 'stale'); assert.equal(h.replies().at(-1)?.coverage?.completed, 0);
    await h.delivery.requestFunctionNarratives({ ...h.request, requestId: 2, pageIndex: 0, pageLanguage: 'en' });
    assert.equal(h.replies().at(-1)?.status, 'stale');
  } finally { h.delivery.clearScenarioInputs(); }
});

test('root cancellation during provider release suppresses ready and still disposes the whole source lease', async () => {
  let beginRelease!: () => void, finishRelease!: () => void;
  const entered = new Promise<void>(resolve => { beginRelease = resolve; });
  const gate = new Promise<void>(resolve => { finishRelease = resolve; });
  const h = await rootHost({ async release() { beginRelease(); await gate; } });
  try {
    const pending = h.delivery.requestFunctionNarratives(h.request);
    await entered;
    assert.equal(h.writes(), 2); assert.ok(h.contexts.length > 2);
    assert.ok(!h.replies().some(reply => reply.status === 'ready'));
    h.delivery.cancelFunctionNarratives(h.request); finishRelease(); await pending;
    assert.equal(h.state.disposed, 1); assert.ok(!h.replies().some(reply => reply.status === 'ready'));
  } finally { finishRelease(); h.delivery.clearScenarioInputs(); }
});
