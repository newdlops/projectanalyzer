/** Real call Host fixture and complete same-reading provider test replies; no neural model is used. */
import assert from "node:assert/strict";
import { FunctionCallsHostDelivery } from "../../webview/functionCalls";
import type { FunctionCallsResponse } from "../../protocol/functionCalls";
import type { FunctionCallNarrativesResponse } from "../../protocol/functionCallNarratives";
import type { FunctionNarrativeContext } from "../../shared/functionNarratives";
import type { FunctionCallReading } from "../../shared/functionCallNarratives";
import type { FunctionNarrativeProvider } from "../../application/functionNarratives";
import { wholeNarrativeHostFixture } from "./wholeNarrativeHost";
import { functionCallReadingReply } from "../unit/helpers/functionCallReadingFixture";

/** Keep real registries/projections; injecting a provider never bypasses source acquisition or strict response validation. */
export async function createWholeNarrativeCallHost(providerFactory?: (fixture: Awaited<ReturnType<typeof wholeNarrativeHostFixture>>) => FunctionNarrativeProvider,
  limits?: Parameters<typeof wholeNarrativeHostFixture>[1]) {
  const f = await wholeNarrativeHostFixture(12, limits), contexts: FunctionNarrativeContext[] = [], actualReplies: FunctionCallReading[] = [];
  const messages: FunctionCallNarrativesResponse[] = [], slices: FunctionCallsResponse[] = [];
  const provider = providerFactory?.(f) ?? { async prepare() { f.events.push('prepare'); }, async generate(context: FunctionNarrativeContext) {
    f.events.push('generate'); contexts.push(context);
    assert.deepEqual(context.callTask!.earlierModelReadings, actualReplies);
    const response = functionCallReadingReply(context), value = JSON.parse(response.text);
    for (const call of value.calls) {
      call.role = 'The supplied callee owns this complete source responsibility, including the original expression and its declared source context.';
      call.reason = 'The selected source route reaches this call using every original guard and loop annotation, without assuming an observed execution result.';
      actualReplies.push({ ...call });
    }
    return { ...response, text: JSON.stringify(value) };
  }, async withRun<T>(_language: 'ko' | 'en', _signal: AbortSignal, operation: () => Promise<T>) {
    try { return await operation(); } finally { f.events.push('provider-released'); }
  } };
  const host = new FunctionCallsHostDelivery({ ...f, narrativeSources: f.access, provider, getLanguage: () => 'en',
    async readSourceText(filePath) { return f.files.find(file => file.path === filePath)?.content; },
    async postMessage(message) { slices.push(message); }, async postNarratives(message) {
      if (message.status === 'ready' && !message.cacheHit) assert.ok(f.events.includes('provider-released'));
      messages.push(message);
    } });
  const load = { graphVersion: f.graphVersion, sourceToken: f.sourceNodeTokens.createToken(f.root.id)!, requestId: 1 };
  await host.load(load);
  const slice = slices.at(-1)!; assert.equal(slice.status, 'ready'); assert.ok(slice.narratives?.contextId);
  const request = { ...load, scope: 'overview' as const, contextId: slice.narratives.contextId };
  return { ...f, host, contexts, actualReplies, messages, slice, request };
}
