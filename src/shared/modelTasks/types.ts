/** Portable model-work lifecycle; snapshots contain bounded metadata, never prompts or responses. */
export type ModelTaskKind = "prepare" | "inference";
export type ModelTaskPhase = "queued" | "preparing" | "running" | "cancelling";
export type ModelTaskOutcome = "completed" | "failed" | "cancelled" | "timeout";
export type ModelTaskProgress = Readonly<{
  id: string;
  kind: ModelTaskKind;
  phase: ModelTaskPhase;
  /** One-based waiting position; a task holding the execution slot has position zero. */
  position: number;
  waiting: number;
}>;
export type ModelTaskRecord = Readonly<{
  id: string; kind: ModelTaskKind; label: string;
  phase: ModelTaskPhase | ModelTaskOutcome;
  queuedAt: number; startedAt?: number; finishedAt?: number;
  /** A safe enum-like diagnostic category, without adapter exception text. */
  failure?: string;
  /** Safe adapter diagnostic such as exit-2; arbitrary error text is never retained. */
  detailCode?: string;
}>;
export type ModelTaskSnapshot = Readonly<{
  active?: ModelTaskRecord; waiting: readonly ModelTaskRecord[]; history: readonly ModelTaskRecord[];
  disposed: boolean;
}>;
export type ModelTaskRequest<T> = {
  kind: ModelTaskKind; label: string; signal: AbortSignal;
  /** Milliseconds of owned execution, excluding time in the queue. Preparation may be unbounded. */
  timeoutMs?: number;
  execute(signal: AbortSignal): Promise<T>;
  onProgress?(progress: ModelTaskProgress): void;
};
export type ModelTaskFailure = "cancelled" | "timeout" | "queue-full" | "disposed";
/** Scheduler failures stay independent of any particular model adapter. */
export class ModelTaskError extends Error {
  public constructor(public readonly code: ModelTaskFailure) { super(code); this.name = "ModelTaskError"; }
}
