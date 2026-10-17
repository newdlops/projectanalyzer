/** Real Host/native CPU-child fixtures share public generation/cache actions and preserve every attempted transport envelope. */
import assert from "node:assert/strict";
import { createNativeFunctionNarrativeProvider, type NativeFunctionNarrativeHostReceipt } from "../../llm/nativeNarrativeProvider";
import type { NativeNarrativeEvent } from "../../llm/nativeNarratives";
import { unpackNativeInputMessages } from "../../llm/nativeNarrativeCodec";
import { ModelTaskManager } from "../../shared/modelTasks";
import { createNativeRootCallHost } from "./nativeRootCallHost";
import { createWholeNarrativeCallHost } from "./wholeNarrativeCallHost";
import type { withCompleteNativeNarrativeWorker } from "./completeNativeNarrativeWorker";

type Fixture = Parameters<Parameters<typeof withCompleteNativeNarrativeWorker>[0]>[0];
export type NativePublicationMessage = { requestId: number; status: string; cacheHit?: boolean; narrative?: unknown;
  language?: "ko" | "en"; publicationId?: string; publicationRevoked?: true };
type Hooks = { post?(message: NativePublicationMessage): Promise<void>; read?(): Promise<void>; disposePages?(hasPages: boolean): Promise<void>; badClose?: boolean };
type Route = { scope: "call"; connectionId: string };

/** The reusable fixture does not execute analyzed programs or import model libraries; every native child authors explicit test data. */
export async function publicationHost(fixture: Fixture, surface: "root" | "call", hooks: Hooks = {}) {
  const attempts: NativePublicationMessage[] = [];
  const post = async (message: NativePublicationMessage) => { attempts.push(structuredClone(message)); await hooks.post?.(message); };
  if (surface === "root") {
    const h = await createNativeRootCallHost(fixture, { callCount: 0, clock: {}, mode: hooks.badClose ? "bad-close" : "complete", io: {
      read: hooks.read, dispose: hooks.disposePages, async postMessage(message) { if (message.type === "codeFlow/functionNarrativesLoaded") await post(message.payload); }
    } });
    return { access: h.access, files: h.files, state: h.state, events: h.events, receipts: h.hostReceipts, attempts, modelInputs: () => h.inputs,
      firstConnectionId: undefined as string | undefined, isReleased: () => h.receipts.length > 0,
      request: (requestId: number, pageIndex?: number, _route?: Route) => h.delivery.requestFunctionNarratives({ ...h.request, requestId, ...(pageIndex === undefined ? {} : { pageIndex, pageLanguage: "en" as const }) }),
      cancel: (requestId: number) => h.delivery.cancelFunctionNarratives({ ...h.request, requestId }), replies: (): NativePublicationMessage[] => h.replies(), storedPages: h.storedPages,
      setComplete() { h.setMode("complete"); }, close: h.close };
  }
  const manager = new ModelTaskManager(), events: NativeNarrativeEvent[] = [], receipts: NativeFunctionNarrativeHostReceipt[] = [], inputs: unknown[] = [];
  let released = false;
  const h = await createWholeNarrativeCallHost(f => createNativeFunctionNarrativeProvider({ manager, worker: { ...fixture.options("call", {}),
    onEvent: event => events.push(event), journal(event) {
      const line = JSON.parse(event.raw); if (event.direction !== "input" || !line.requests) return;
      const content = unpackNativeInputMessages(line.requests[0].payload.messages)[1].content, marker = "SOURCE DATA:\n";
      const source = JSON.parse(content.slice(content.lastIndexOf(marker) + marker.length)); inputs.push(source);
      if (line.requests[0].uid === 0) assert.deepEqual(source.callTask.earlierModelReadings, []);
    } }, onRunComplete() { released = true; f.events.push("provider-released"); }, onHostRunComplete(receipt) { receipts.push(receipt); }
  }), undefined, post);
  return { access: h.access, files: h.files, state: h.state, events, receipts, attempts, modelInputs: () => inputs,
    firstConnectionId: h.slice.connections?.find(connection => connection.from === h.slice.sourceToken)?.id, isReleased: () => released,
    request: (requestId: number, pageIndex?: number, route?: Route) => h.host.explain({ ...h.request, ...route, requestId, ...(pageIndex === undefined ? {} : { pageIndex, pageLanguage: "en" as const }) }),
    cancel: (requestId: number) => h.host.cancelExplanation({ ...h.request, requestId }), replies: (): NativePublicationMessage[] => h.messages,
    storedPages: () => 0, setComplete() {}, async close() { h.host.reset(); await manager.dispose(); } };
}
