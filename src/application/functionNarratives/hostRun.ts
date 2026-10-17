/** Source-free completion ports join a provider action to the settlement of the actual public Host request Promise. */
import type { FunctionNarrativeFailure } from "../../shared/functionNarratives";

export type FunctionNarrativeHostStatus = FunctionNarrativeFailure | "ready" | "stale" | "interrupted";
export type FunctionNarrativeHostSettlement = { promise: "fulfilled" | "rejected"; status: FunctionNarrativeHostStatus };
/** A provider-owned one-use capability measures its own clock; the Host cannot submit a duration or ready timestamp. */
export type FunctionNarrativeRunCompletion = { complete(settlement: FunctionNarrativeHostSettlement): void };
export type FunctionNarrativeRunLifecycle = { onSettled(completion: FunctionNarrativeRunCompletion): void };

/** One instance per public request, including failure/late cancellation. Cache-only work has no provider completion and emits no native timing. */
export class FunctionNarrativeHostRun {
  private completion?: FunctionNarrativeRunCompletion;
  private status: FunctionNarrativeHostStatus = "interrupted";
  public readonly lifecycle: FunctionNarrativeRunLifecycle = { onSettled: completion => { this.completion ??= completion; } };
  public outcome(status: FunctionNarrativeHostStatus): void { this.status = status; }
  /** Cancellation can arrive while the final transport is awaiting, after the native action itself has succeeded. */
  public interrupted(cancelled: boolean): void { if (cancelled && (this.status === "interrupted" || this.status === "ready")) this.status = "cancelled"; }

  /** Return this exact Promise. Its reaction runs only after its fulfilled/rejected state, following every awaited finally block. */
  public observe(operation: () => Promise<void>): Promise<void> {
    const promise = operation();
    void promise.then(() => this.finish("fulfilled"), () => this.finish("rejected"));
    return promise;
  }
  private finish(promise: FunctionNarrativeHostSettlement["promise"]): void {
    const status = promise === "rejected" && (this.status === "ready" || this.status === "interrupted") ? "failed" : this.status;
    try { this.completion?.complete({ promise, status }); } catch { /* Diagnostics never change public request settlement. */ }
  }
}
