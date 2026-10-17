/** Real root Host fixtures with model replies and page I/O exposed only as explicit test ports. */
import type { FunctionNarrativePage } from "../../shared/functionNarratives";
import assert from "node:assert/strict";
import { CodeFlowInsightCache } from "../../application/codeFlow";
import { CodeFlowHostDelivery } from "../../webview/codeFlow/codeFlowHostDelivery";
import type { FunctionNarrativeContext } from "../../shared/functionNarratives";
import type { ExtensionResponse } from "../../protocol/messages";
import type { FunctionNarrativeProvider, FunctionNarrativeRootRequest, FunctionNarrativeModelResponse, FunctionNarrativeGenerationOptions } from "../../application/functionNarratives";
import { wholeNarrativeHostFixture, wholeRootReply } from "./wholeNarrativeHost";

/** Exercise published function registration and page generation rather than constructing a model context in the test. */
export async function createWholeNarrativeRootHost(options: { callCount?: number; inspectContext?(context: FunctionNarrativeContext): void | Promise<void>;
  provider?: FunctionNarrativeProvider;
  completeRoot?(request: FunctionNarrativeRootRequest, signal: AbortSignal, options?: FunctionNarrativeGenerationOptions): Promise<FunctionNarrativeModelResponse>;
  mutateDuringWrite?: boolean; release?: (signal: AbortSignal) => Promise<void>; read?(index: number): Promise<void>; dispose?(hasPages: boolean): Promise<void> } = {}) {
  const f = await wholeNarrativeHostFixture(options.callCount ?? 0), messages: ExtensionResponse[] = [], contexts: FunctionNarrativeContext[] = [];
  let writes = 0, stores = 0; const allPages: Array<Map<number, FunctionNarrativePage>> = [], opened: unknown[] = [];
  const provider: FunctionNarrativeProvider = options.provider ?? {
    async prepare() { f.events.push('prepare'); },
    async generate(context) {
      f.events.push('generate'); contexts.push(context);
      assert.ok(context.sourceEvidence); assert.equal(context.sourceWorksheet, undefined); assert.equal(context.checkedExamples, undefined);
      assert.equal(context.snippets.find(snippet => snippet.role === 'function')?.text, f.rootText);
      assert.ok(context.snippets.some(snippet => snippet.text === f.callerText));
      assert.ok(context.snippets.every(snippet => !snippet.truncated));
      // A source-only constructor may inspect the actual captured request before the explicit external-model fixture responds.
      await options.inspectContext?.(context);
      return wholeRootReply(context);
    },
    async withRun<T>(_language: 'ko' | 'en', signal: AbortSignal, operation: () => Promise<T>) {
      f.events.push('provider-ready');
      try { return await operation(); } finally { await options.release?.(signal); f.events.push('provider-released'); }
    },
    ...(options.completeRoot ? { async generateCompleteRoot(request: FunctionNarrativeRootRequest, _language: 'ko' | 'en', signal: AbortSignal, generationOptions?: FunctionNarrativeGenerationOptions) {
      f.events.push('generate-complete-root'); return options.completeRoot!(request, signal, generationOptions);
    } } : {})
  };
  const delivery = new CodeFlowHostDelivery({ ...f, narrativeSources: f.access, functionNarrativeProvider: provider,
    insightCache: new CodeFlowInsightCache(), getUiLanguage: () => 'en',
    async readSourceText(filePath) { return f.files.find(file => file.path === filePath)?.content; },
    async openEvidenceLocation(location) { opened.push(location); }, logger: { debug() {}, info() {}, warn() {}, error() {} },
    createFunctionNarrativePageStore() {
      stores++; const pages = new Map<number, FunctionNarrativePage>(); allPages.push(pages);
      return { async write(index, narrative) {
        writes++; pages.set(index, structuredClone(narrative));
        if (options.mutateDuringWrite) { f.files[0].content += '// changed during storage'; f.state.revision++; }
      }, async read(index) { await options.read?.(index); return pages.get(index); }, async dispose() { await options.dispose?.(pages.size > 0); pages.clear(); } };
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
  return { ...f, delivery, request, messages, contexts, replies, writes: () => writes, stores: () => stores, storedPages: () => allPages.reduce((sum, pages) => sum + pages.size, 0), opened, contextId: detail.payload.logic!.tutor!.narratives!.contextId! };
}
