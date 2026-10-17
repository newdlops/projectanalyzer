/** Portable native-worker ports. Packet contents remain model input/output, never evaluator capabilities. */
import type { NativeReadyClockBounds } from "./readyClock";
export type NativeNarrativePacket = {
  schema: Record<string, unknown>;
  messages: ReadonlyArray<{ role: "system" | "user" | "assistant"; content: string }>;
};
export type NativeNarrativeRequest = { requestId: string; payload: NativeNarrativePacket };
export type NativeNarrativeReply = { requestId: string; text: string; modelName: string };
export type NativeNarrativeReady = Record<string, unknown> & {
  ready: true; sourceFree: true; sampledTokens: 0; sourceTokensProvided: 0; sourceKvReused: false;
};
export type NativeNarrativeClose = {
  pid?: number; code: number | null; signal: NodeJS.Signals | null;
  ready?: NativeNarrativeReady; receipt?: Record<string, unknown>; expectedStop: boolean;
};
export type NativeNarrativeEvent = Readonly<{ event: string; pid?: number; uid?: number; code?: number | null; signal?: NodeJS.Signals | null }>;
type WorkerOptions = {
  command: string; args: readonly string[]; modelName: string; cwd?: string;
  requestTimeoutMs?: number; killGraceMs?: number;
  /** Require the source-free monotonic exchange before any source work; legacy ready-receipt timing cannot qualify worker-ready latency. */
  requireReadyClock?: boolean;
  validateReady?(ready: NativeNarrativeReady): void;
  validateReply?(reply: Record<string, unknown>, ready: NativeNarrativeReady): void;
  validateClosed?(close: NativeNarrativeClose): void;
  onEvent?(event: NativeNarrativeEvent): void;
  /** Explicit audit owner only; the default path never logs packets or model text. */
  journal?(event: { direction: "input" | "output"; pid?: number; raw: string }): void;
};
/** A neural label proves nothing: admission and all three runtime proof validators are mandatory. */
export type NativeNarrativeWorkerOptions = WorkerOptions & (
  { kind: "test-fixture"; admit?(signal: AbortSignal): Promise<void> } |
  { kind: "neural-worker"; admit(signal: AbortSignal): Promise<void>;
    validateReady(ready: NativeNarrativeReady): void;
    validateReply(reply: Record<string, unknown>, ready: NativeNarrativeReady): void;
    validateClosed(close: NativeNarrativeClose): void }
);
/** A receipt and declared worker kind cannot establish neural authorship or allocator cleanup. */
export type NativeNarrativeWorkerObservation = {
  pid?: number; state: "new" | "admitting" | "starting" | "ready" | "closing" | "closed";
  kind: NativeNarrativeWorkerOptions["kind"]; requests: number; actualCloseObserved: boolean;
  /** Host monotonic receipt time of the complete source-free ready line, before proof/observer work. */
  sourceFreeReadyAtMonotonicMs?: number;
  sourceFreeReadyReceiptNs?: string;
  readyClock?: NativeReadyClockBounds;
  closedCode?: number | null; closedSignal?: NodeJS.Signals | null;
  closedReceipt?: Record<string, unknown>; runtimeErrorCode?: string; cleanupErrorCode?: string;
  stderrBytes: number; neuralAuthorshipProven: false;
};
/** Shared by root/call actions; prepare accepts no source and release waits for actual child close. */
export interface NativeNarrativeTransport {
  readonly observation: NativeNarrativeWorkerObservation;
  prepare(signal: AbortSignal): Promise<void>;
  generate(request: NativeNarrativeRequest, signal: AbortSignal): Promise<NativeNarrativeReply>;
  release(): Promise<void>;
}
