/** Single-slot FIFO model scheduler with cancellation, execution-only deadlines and bounded diagnostic history. */
import { ModelTaskError, type ModelTaskFailure, type ModelTaskProgress, type ModelTaskRecord, type ModelTaskRequest, type ModelTaskSnapshot } from "./types";

type Job = {
  record: ModelTaskRecord;
  parent: AbortSignal;
  controller: AbortController;
  execute(signal: AbortSignal): Promise<unknown>;
  progress?: (progress: ModelTaskProgress) => void;
  timeoutMs?: number;
  abortParent(): void;
  resolve(value: unknown): void;
  reject(error: unknown): void;
  finished: Promise<void>;
  finish(): void;
  reason?: ModelTaskFailure;
};

/**
 * One manager owns every model surface in an Extension Host. New work never
 * preempts running work. Cancellation does not free the slot until the adapter
 * settles after cleanup, so another model cannot load beside a stopping process.
 */
export class ModelTaskManager {
  private sequence = 0;
  private readonly waiting: Job[] = [];
  private readonly history: ModelTaskRecord[] = [];
  private readonly listeners = new Set<(snapshot: ModelTaskSnapshot) => void>();
  private active?: Job;
  private closed = false;
  private publishing = false;
  private publishAgain = false;
  public constructor(private readonly options: { maxWaiting?: number; historyLimit?: number; now?: () => number;
    onTransition?: (record: ModelTaskRecord) => void } = {}) {
    for (const limit of [options.maxWaiting ?? 32, options.historyLimit ?? 32]) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 32) throw new RangeError("Model task limits must be between 1 and 32.");
    }
  }
  public get disposed(): boolean { return this.closed; }
  public get idle(): boolean { return !this.active && !this.waiting.length; }

  /** Adapters may reuse an already owned inference slot instead of nesting the same global queue. */
  public isExecuting(signal: AbortSignal): boolean { return this.active?.controller.signal === signal && this.active.record.kind === "inference"; }

  /** Enqueues a bounded operation; queue waiting never starts its execution deadline. */
  public run<T>(request: ModelTaskRequest<T>): Promise<T> {
    if (this.closed) return Promise.reject(new ModelTaskError("disposed"));
    if (request.signal.aborted) return Promise.reject(new ModelTaskError("cancelled"));
    if (this.waiting.length >= (this.options.maxWaiting ?? 32)) return Promise.reject(new ModelTaskError("queue-full"));
    let resolve!: (value: T | PromiseLike<T>) => void, reject!: (error: unknown) => void, finish!: () => void;
    const result = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
    const job: Job = {
      record: { id: "model-task:" + (++this.sequence), kind: request.kind, label: request.label.replace(/\s+/gu, " ").trim().slice(0, 96), phase: "queued", queuedAt: this.now() },
      parent: request.signal, controller: new AbortController(), execute: request.execute, progress: request.onProgress,
      timeoutMs: request.timeoutMs, abortParent: () => this.stop(job, "cancelled"),
      resolve: value => resolve(value as T), reject,
      finished: new Promise<void>(accept => { finish = accept; }), finish: () => finish()
    };
    this.waiting.push(job); request.signal.addEventListener("abort", job.abortParent, { once: true });
    this.transition(job); this.publish(); this.pump();
    return result;
  }

  /** Cancels exactly one active or waiting operation; other request owners are unaffected. */
  public cancel(id: string): boolean {
    const job = this.active?.record.id === id ? this.active : this.waiting.find(item => item.record.id === id);
    if (!job) return false;
    this.stop(job, "cancelled"); return true;
  }
  /** Explicit native action cancels the work currently owned by the manager, without touching saved results. */
  public cancelAll(): void {
    for (const job of [...this.waiting]) this.stop(job, "cancelled");
    if (this.active) this.stop(this.active, "cancelled");
  }

  /** Immutable metadata copies let native UI observe work without retaining model source or results. */
  public snapshot(): ModelTaskSnapshot {
    return Object.freeze({ active: this.active && Object.freeze({ ...this.active.record }),
      waiting: Object.freeze(this.waiting.map(job => Object.freeze({ ...job.record }))),
      history: Object.freeze(this.history.map(record => Object.freeze({ ...record }))), disposed: this.closed });
  }
  public subscribe(listener: (snapshot: ModelTaskSnapshot) => void): { dispose(): void } {
    this.listeners.add(listener); this.safe(() => listener(this.snapshot()));
    return { dispose: () => { this.listeners.delete(listener); } };
  }

  /** Extension shutdown revokes queued work immediately and awaits running adapter/process cleanup. */
  public async dispose(): Promise<void> {
    this.closed = true;
    const active = this.active;
    for (const job of [...this.waiting]) this.stop(job, "cancelled");
    if (active) { this.stop(active, "cancelled"); await active.finished; }
    this.publish(); this.listeners.clear();
  }

  private now(): number { return (this.options.now ?? Date.now)(); }
  private safe(action: () => void): void { try { action(); } catch { /* Observer failure cannot kill model work. */ } }
  private transition(job: Job): void { this.safe(() => this.options.onTransition?.({ ...job.record })); }
  private publish(): void {
    if (this.publishing) { this.publishAgain = true; return; }
    this.publishing = true;
    try {
      do {
        this.publishAgain = false;
        const jobs = [...(this.active ? [this.active] : []), ...this.waiting];
        for (const job of jobs) {
          const position = job === this.active ? 0 : this.waiting.indexOf(job) + 1;
          if (job !== this.active && position === 0) continue;
          const progress: ModelTaskProgress = { id: job.record.id, kind: job.record.kind, phase: job.record.phase as ModelTaskProgress["phase"],
            position, waiting: this.waiting.length };
          this.safe(() => job.progress?.(progress));
        }
        const snapshot = this.snapshot(); for (const listener of this.listeners) this.safe(() => listener(snapshot));
      } while (this.publishAgain);
    } finally { this.publishing = false; }
  }
  private stop(job: Job, reason: ModelTaskFailure): void {
    if (job.reason || ["completed", "failed", "cancelled", "timeout"].includes(job.record.phase)) return;
    job.reason = reason;
    const index = this.waiting.indexOf(job);
    if (index >= 0) {
      this.waiting.splice(index, 1); this.settle(job, undefined, true, new ModelTaskError(reason)); this.publish();
    } else if (this.active === job) {
      job.record = { ...job.record, phase: "cancelling" }; job.controller.abort(); this.transition(job); this.publish();
    }
  }
  private pump(): void {
    if (this.active || this.closed) return;
    const job = this.waiting.shift(); if (!job) return;
    this.active = job;
    job.record = { ...job.record, phase: job.record.kind === "prepare" ? "preparing" : "running", startedAt: this.now() };
    this.transition(job); this.publish();
    void this.execute(job);
  }
  private async execute(job: Job): Promise<void> {
    const timer = job.timeoutMs === undefined ? undefined : setTimeout(() => this.stop(job, "timeout"), Math.max(1, job.timeoutMs));
    let value: unknown, failure: unknown, failed = false;
    try {
      value = await Promise.resolve().then(() => {
        if (job.controller.signal.aborted) throw new ModelTaskError(job.reason ?? "cancelled");
        return job.execute(job.controller.signal);
      });
    } catch (error) { failed = true; failure = error; }
    finally {
      clearTimeout(timer);
      // Awaiting execute includes its process/temp-file cleanup; only now may
      // another task take ownership of local model memory.
      this.settle(job, value, failed || Boolean(job.reason), job.reason ? new ModelTaskError(job.reason) : failure);
      this.active = undefined; this.publish(); this.pump();
    }
  }
  private settle(job: Job, value: unknown, failed: boolean, failure: unknown): void {
    job.parent.removeEventListener("abort", job.abortParent);
    const code = failure instanceof ModelTaskError ? failure.code : failure && typeof failure === "object" && "code" in failure ? String(failure.code) : failed ? "failed" : undefined;
    const detail = failure && typeof failure === "object" && "detailCode" in failure && typeof failure.detailCode === "string" ? failure.detailCode : undefined;
    job.record = { ...job.record, phase: code === "cancelled" || code === "timeout" ? code : failed ? "failed" : "completed",
      finishedAt: this.now(), ...(code ? { failure: /^[a-z-]{1,40}$/u.test(code) ? code : "failed" } : {}),
      ...(detail && /^[a-z0-9-]{1,40}$/u.test(detail) ? { detailCode: detail } : {}) };
    this.history.push(job.record); while (this.history.length > (this.options.historyLimit ?? 32)) this.history.shift();
    this.transition(job); job.finish();
    if (failed) job.reject(failure); else job.resolve(value);
  }
}

let globalManager: ModelTaskManager | undefined;
/** Inert process-wide default also protects direct adapter consumers and separate configured-provider instances. */
export function getGlobalModelTaskManager(options?: ConstructorParameters<typeof ModelTaskManager>[0]): ModelTaskManager {
  if (!globalManager || globalManager.disposed && globalManager.idle) globalManager = new ModelTaskManager(options);
  return globalManager;
}
