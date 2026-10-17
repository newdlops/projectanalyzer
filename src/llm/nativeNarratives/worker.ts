/** One source-free stdio worker owns independent UIDs; accepted request failures and release await real process close. */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { performance } from "node:perf_hooks";
import { FunctionNarrativeError } from "../../shared/functionNarratives";
import { isNativeRecord, requireNative, serializeNativePacket, NATIVE_LINE_BYTES, NATIVE_MEMBER_BYTES, NATIVE_OUTPUT_CHARACTERS, NATIVE_PACKET_BYTES } from "./protocol";
import type { NativeNarrativeClose, NativeNarrativeEvent, NativeNarrativeReady, NativeNarrativeReply, NativeNarrativeRequest,
  NativeNarrativeTransport, NativeNarrativeWorkerObservation, NativeNarrativeWorkerOptions } from "./types";
import { combineNativeFailures } from "./failures";
import { NativeReadyClockExchange, type NativeReadyClockBounds } from "./readyClock";

type Pending = { uid: number; requestId: string; timer: ReturnType<typeof setTimeout>; resolve(reply: NativeNarrativeReply): void; reject(error: unknown): void };

/** Construction is inert. A new worker/action is required after release; source KV never crosses this boundary. */
export class NativeNarrativeWorker implements NativeNarrativeTransport {
  private readonly options: NativeNarrativeWorkerOptions;
  private state: NativeNarrativeWorkerObservation["state"] = "new";
  private child?: ChildProcessWithoutNullStreams;
  private parent?: AbortSignal;
  private preparation?: Promise<void>;
  private ready?: NativeNarrativeReady;
  private readyAt?: number;
  private readyReceiptNs?: bigint;
  private readyClock?: NativeReadyClockBounds;
  private clockExchange?: NativeReadyClockExchange;
  private clockTimer?: ReturnType<typeof setTimeout>;
  private preparationComplete = false;
  private readyResolve?: () => void;
  private readyReject?: (error: unknown) => void;
  private closed?: Promise<void>;
  private closedResolve?: () => void;
  private pending?: Pending;
  private buffer: Buffer = Buffer.alloc(0);
  private requests = 0;
  private stderrBytes = 0;
  private killTimer?: ReturnType<typeof setTimeout>;
  private expectedStop = false;
  private stdinEnded = false;
  private releaseRequested = false;
  private actualCloseObserved = false;
  private closedCode?: number | null;
  private closedSignal?: NodeJS.Signals | null;
  private closedReceipt?: Record<string, unknown>;
  private runtimeError?: FunctionNarrativeError;
  private cleanupError?: FunctionNarrativeError;
  private closeFailure: unknown;
  private readonly abort = () => this.stop(new FunctionNarrativeError("cancelled"));

  public constructor(options: NativeNarrativeWorkerOptions) {
    requireNative(["test-fixture", "neural-worker"].includes(options.kind) && typeof options.command === "string" && options.command.length > 0 && !/[\n\0]/u.test(options.command), "worker-options");
    requireNative(options.cwd === undefined || typeof options.cwd === "string" && !/[\n\0]/u.test(options.cwd), "worker-directory");
    requireNative(Array.isArray(options.args) && options.args.every(argument => typeof argument === "string" && !/[\n\0]/u.test(argument) && argument.length <= 4096), "worker-arguments");
    requireNative(typeof options.modelName === "string" && options.modelName.length > 0 && options.modelName.length <= 100, "worker-model-name");
    requireNative(Number.isInteger(options.requestTimeoutMs ?? 180000) && (options.requestTimeoutMs ?? 180000) > 0 && (options.requestTimeoutMs ?? 180000) <= 180000, "worker-timeout");
    requireNative(Number.isInteger(options.killGraceMs ?? 2000) && (options.killGraceMs ?? 2000) > 0 && (options.killGraceMs ?? 2000) <= 2000, "worker-kill-grace");
    requireNative(options.requireReadyClock === undefined || typeof options.requireReadyClock === "boolean", "worker-clock-option");
    if (options.kind === "neural-worker") {
      requireNative((options.killGraceMs ?? 2000) === 2000, "worker-neural-kill-grace");
      for (const key of ["admit", "validateReady", "validateReply", "validateClosed"] as const) requireNative(typeof options[key] === "function", "worker-neural-proof");
    }
    this.options = { ...options, args: [...options.args] };
  }

  public get observation(): NativeNarrativeWorkerObservation {
    return { pid: this.child?.pid, state: this.state, kind: this.options.kind, requests: this.requests,
      actualCloseObserved: this.actualCloseObserved, sourceFreeReadyAtMonotonicMs: this.readyAt, closedCode: this.closedCode, closedSignal: this.closedSignal,
      sourceFreeReadyReceiptNs: this.readyReceiptNs?.toString(), readyClock: this.readyClock && { ...this.readyClock },
      closedReceipt: this.closedReceipt && structuredClone(this.closedReceipt), runtimeErrorCode: this.runtimeError?.code,
      cleanupErrorCode: this.cleanupError?.code, stderrBytes: this.stderrBytes, neuralAuthorshipProven: false };
  }

  /** Admission and source-free preparation receive only cancellation; all source work belongs after this await. */
  public async prepare(signal: AbortSignal): Promise<void> {
    if (this.parent && this.parent !== signal) throw new FunctionNarrativeError("failed", "worker-action-mismatch");
    if (signal.aborted) { if (this.child) { this.abort(); await this.closed; } throw new FunctionNarrativeError("cancelled"); }
    if (this.state === "closing" || this.state === "closed") { await this.closed; throw this.runtimeError ?? new FunctionNarrativeError("failed", "worker-already-closed"); }
    this.parent ??= signal;
    await (this.preparation ??= this.start(signal));
  }

  /** Accepted requests carry exactly one UID; no response value is synthesized or normalized here. */
  public async generate(request: NativeNarrativeRequest, signal: AbortSignal): Promise<NativeNarrativeReply> {
    await this.prepare(signal);
    requireNative(!this.pending && this.state === "ready", "worker-overlapping-request");
    requireNative(typeof request.requestId === "string" && request.requestId.length > 0, "worker-request-identity");
    const payload = serializeNativePacket(request.payload), uid = this.requests++;
    const raw = '{"requests":[{"uid":' + uid + ',"payload":' + payload + '}]}\n';
    requireNative(Buffer.byteLength(raw) <= NATIVE_PACKET_BYTES, "worker-envelope-limit");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.stop(new FunctionNarrativeError("timeout")), this.options.requestTimeoutMs ?? 180000); timer.unref();
      this.pending = { uid, requestId: request.requestId, timer, resolve, reject };
      try {
        this.options.journal?.({ direction: "input", pid: this.child?.pid, raw: raw.slice(0, -1) }); this.event("request", { uid });
        this.child!.stdin.write(raw, error => { if (error) this.stop(new FunctionNarrativeError("failed", "worker-write")); });
      } catch { this.stop(new FunctionNarrativeError("failed", "worker-write")); }
      if (signal.aborted) this.abort();
    });
  }

  /** Idempotent release cannot mistake a close receipt or a sent signal for process termination. */
  public async release(): Promise<void> {
    this.releaseRequested = true;
    if (this.preparation && !this.child) { try { await this.preparation; } catch { /* Admission created no process. */ } }
    if (!this.child) { this.state = "closed"; return; }
    if (this.state !== "closed") {
      this.state = "closing"; this.startKillTimer();
      if (!this.stdinEnded) { this.stdinEnded = true; if (!this.child.stdin.destroyed) this.child.stdin.end(); }
    }
    await this.closed;
    if (this.closeFailure !== undefined) throw this.closeFailure;
  }

  private async start(signal: AbortSignal): Promise<void> {
    this.state = "admitting";
    try { await this.options.admit?.(signal); }
    catch (error) { this.state = "closed"; throw error; }
    if (signal.aborted || this.releaseRequested) { this.state = "closed"; throw new FunctionNarrativeError("cancelled"); }
    const ready = new Promise<void>((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject; });
    this.closed = new Promise<void>(resolve => { this.closedResolve = resolve; }); this.state = "starting";
    signal.addEventListener("abort", this.abort, { once: true });
    const child = this.child = spawn(this.options.command, [...this.options.args], { cwd: this.options.cwd, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    child.once("spawn", () => this.event("spawn"));
    child.once("error", () => this.stop(new FunctionNarrativeError("unavailable", "worker-spawn")));
    child.once("close", (code, terminationSignal) => this.onClose(code, terminationSignal));
    child.stdout.on("data", (chunk: Buffer) => this.consume(chunk));
    child.stderr.on("data", (chunk: Buffer) => { this.stderrBytes += chunk.length; });
    child.stdin.on("error", () => { if (this.state !== "closing" && this.state !== "closed") this.stop(new FunctionNarrativeError("failed", "worker-write")); });
    if (signal.aborted) this.abort();
    await ready;
  }

  /** Keep an incremental byte bound while accepting split UTF-8 code points without replacement characters. */
  private consume(chunk: Buffer): void {
    let cursor = 0;
    while (cursor < chunk.length) {
      const newline = chunk.indexOf(10, cursor), end = newline < 0 ? chunk.length : newline, part = chunk.subarray(cursor, end);
      if (this.buffer.length + part.length > NATIVE_LINE_BYTES) { this.stop(new FunctionNarrativeError("invalid-response", "worker-line-limit")); return; }
      this.buffer = Buffer.concat([this.buffer, part]); cursor = end + (newline < 0 ? 0 : 1);
      if (newline < 0) break;
      try {
        const receivedAt = performance.now(), receivedNs = process.hrtime.bigint();
        const raw = new TextDecoder("utf-8", { fatal: true }).decode(this.buffer); this.buffer = Buffer.alloc(0);
        this.options.journal?.({ direction: "output", pid: this.child?.pid, raw }); this.onLine(JSON.parse(raw), receivedAt, receivedNs);
      } catch (error) { this.stop(error instanceof FunctionNarrativeError ? error : new FunctionNarrativeError("invalid-response", "worker-reply")); return; }
    }
  }

  /** Every ready/response/receipt belongs to the same live process and pending UID. */
  private onLine(reply: unknown, receivedAt: number, receivedNs: bigint): void {
    requireNative(isNativeRecord(reply), "worker-reply-shape");
    if (reply.nativeClock) {
      requireNative(this.state === "starting" && this.clockExchange, "worker-unowned-clock");
      this.readyClock = this.clockExchange!.complete(reply.nativeClock, receivedNs, this.child?.pid);
      clearTimeout(this.clockTimer); this.clockExchange = undefined; this.event("clock-response"); this.finishPreparation(); return;
    }
    if (reply.ready) {
      requireNative(this.state === "starting" && reply.ready === true && reply.sourceFree === true && Object.is(reply.sampledTokens, 0)
        && Object.is(reply.sourceTokensProvided, 0) && reply.sourceKvReused === false, "worker-ready-proof");
      if (this.options.kind === "test-fixture") requireNative(reply.fixture === true && Object.is(reply.modelLoads, 0) && reply.workerPid === this.child?.pid, "worker-fixture-proof");
      else requireNative(reply.fixture !== true && reply.modelLoads === 1, "worker-neural-ready");
      const ready = reply as NativeNarrativeReady;
      requireNative(!this.ready, "worker-duplicate-ready");
      this.options.validateReady?.(ready); this.ready = ready; this.readyAt = receivedAt; this.readyReceiptNs = receivedNs;
      if (this.options.requireReadyClock) {
        this.clockExchange = new NativeReadyClockExchange(reply.readyClock, receivedNs);
        const raw = this.clockExchange.packet();
        this.clockTimer = setTimeout(() => this.stop(new FunctionNarrativeError("timeout", "worker-clock-timeout")), this.options.requestTimeoutMs ?? 180000); this.clockTimer.unref();
        this.options.journal?.({ direction: "input", pid: this.child?.pid, raw: raw.slice(0, -1) }); this.event("clock-request");
        this.clockExchange.sent(process.hrtime.bigint());
        this.child!.stdin.write(raw, error => { if (error) this.stop(new FunctionNarrativeError("failed", "worker-clock-write")); });
      } else this.finishPreparation();
      return;
    }
    if (reply.closed) { requireNative(this.state === "closing" && !this.closedReceipt && reply.closed === true, "worker-close-receipt"); this.closedReceipt = reply; this.event("close-receipt"); return; }
    requireNative(this.state === "ready" && this.pending && this.ready, "worker-unowned-response");
    requireNative(!reply.error && Array.isArray(reply.replies) && reply.replies.length === 1, "worker-response-shape");
    const member: unknown = reply.replies[0];
    requireNative(isNativeRecord(member) && Object.is(member.uid, this.pending.uid) && Buffer.byteLength(JSON.stringify(member)) <= NATIVE_MEMBER_BYTES
      && typeof member.content === "string" && member.content.length <= NATIVE_OUTPUT_CHARACTERS, "worker-response-member");
    requireNative(this.options.kind === "test-fixture" ? reply.fixture === true : reply.fixture !== true, "worker-response-kind");
    this.options.validateReply?.(reply, this.ready);
    const pending = this.pending; this.pending = undefined; clearTimeout(pending.timer); this.event("response", { uid: member.uid as number });
    pending.resolve({ requestId: pending.requestId, text: member.content, modelName: this.options.modelName });
  }

  private finishPreparation(): void {
    this.state = "ready"; this.preparationComplete = true; this.event("ready"); this.readyResolve!();
  }

  /** Stop requests remain pending until close; the grace timer escalates only this owned process. */
  private stop(error: FunctionNarrativeError): void {
    this.runtimeError ??= error; if (this.state === "closed") return;
    this.expectedStop = true; this.state = "closing"; if (this.child?.pid) this.child.kill("SIGTERM"); this.startKillTimer();
  }
  private startKillTimer(): void {
    if (this.killTimer || this.actualCloseObserved) return;
    this.killTimer = setTimeout(() => { this.event("force-kill"); this.child?.kill("SIGKILL"); }, this.options.killGraceMs ?? 2000); this.killTimer.unref();
  }

  /** Resolve cleanup after the actual OS close and independent close validation; partial lines are never accepted. */
  private onClose(code: number | null, signal: NodeJS.Signals | null): void {
    clearTimeout(this.killTimer); clearTimeout(this.clockTimer); this.closedCode = code; this.closedSignal = signal; this.actualCloseObserved = true;
    if (this.buffer.length || this.state !== "closing" || this.pending && !this.runtimeError) this.runtimeError ??= new FunctionNarrativeError("failed", "worker-exit");
    const proof: NativeNarrativeClose = { pid: this.child?.pid, code, signal, ready: this.ready, receipt: this.closedReceipt, expectedStop: this.expectedStop };
    try {
      if (this.options.kind === "test-fixture") {
        if (this.closedReceipt) requireNative(this.closedReceipt.fixture === true && Object.is(this.closedReceipt.modelLoads, 0) && this.closedReceipt.workerPid === this.child?.pid, "worker-fixture-close");
        if (!this.expectedStop) requireNative(code === 0 && this.closedReceipt?.fixture === true, "worker-close-missing");
      }
      this.options.validateClosed?.(proof);
    } catch (cause) { this.cleanupError = Object.assign(new FunctionNarrativeError("failed", "worker-close-proof"), { cause }); }
    this.closeFailure = combineNativeFailures([this.runtimeError, this.cleanupError]);
    this.buffer = Buffer.alloc(0); this.state = "closed"; this.parent?.removeEventListener("abort", this.abort); this.event("actual-close", { code, signal });
    const error = this.runtimeError ?? this.cleanupError ?? new FunctionNarrativeError("failed", "worker-exit");
    if (!this.preparationComplete) this.readyReject?.(error);
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = undefined; }
    this.closedResolve!();
  }

  private event(event: string, extra: Partial<NativeNarrativeEvent> = {}): void {
    try { this.options.onEvent?.({ event, pid: this.child?.pid, ...extra }); } catch { /* Observers do not own lifecycle. */ }
  }
}
