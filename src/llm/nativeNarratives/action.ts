/** One native action owns the existing global FIFO across preparation, source I/O, packets, storage and real close. */
import { performance } from "node:perf_hooks";
import { getGlobalModelTaskManager, type ModelTaskManager, type ModelTaskProgress } from "../../shared/modelTasks";
import { FunctionNarrativeError } from "../../shared/functionNarratives";
import { NativeNarrativeWorker } from "./worker";
import { combineNativeFailures } from "./failures";
import { measureNativeReadyDuration, type NativeReadyDuration } from "./readyClock";
import type { NativeNarrativeTransport, NativeNarrativeWorkerObservation, NativeNarrativeWorkerOptions } from "./types";

export type NativeNarrativeActionOptions<T> = {
  worker: NativeNarrativeWorkerOptions; signal: AbortSignal; manager?: ModelTaskManager;
  label: string; onProgress?(progress: ModelTaskProgress): void;
  /** Emitted after the actual manager.run Promise settles, including rejection before readiness; arbitrary worker receipt contents are omitted. */
  onSettled?(receipt: NativeNarrativeActionSettlement): void;
  /** Runs only after source-free ready. Source capture, decoding and every requested page belong inside this callback. */
  execute(input: { transport: NativeNarrativeTransport; signal: AbortSignal }): Promise<T>;
};
export type NativeNarrativeActionResult<T> = {
  value: T; wholeHostMs: number; actualWorker: NativeNarrativeWorkerObservation;
  outerManagerSettlementObserved: true; neuralAuthorshipProven: false;
};
export type NativeNarrativeActionSettlement = {
  succeeded: boolean; duration: NativeReadyDuration;
  worker?: Omit<NativeNarrativeWorkerObservation, "closedReceipt">;
  outerManagerSettlementObserved: true; neuralAuthorshipProven: false;
};

/** Measure after ready through actual child close and the outer manager.run settlement; queue time is excluded. */
export async function runNativeNarrativeAction<T>(options: NativeNarrativeActionOptions<T>): Promise<NativeNarrativeActionResult<T>> {
  const manager = options.manager ?? getGlobalModelTaskManager();
  let client: NativeNarrativeWorker | undefined, readyAt: number | undefined, executionFailure: unknown;
  const resource = { async release() { await client?.release(); } };
  let value: T, succeeded = false;
  try {
    value = await manager.run({ kind: "inference", label: options.label, signal: options.signal, resource, onProgress: options.onProgress,
      async execute(signal) {
        let primary: unknown, cleanup: unknown, result: T | undefined;
        try {
          // Construction and admission happen after this one global owner is granted; no queued model can preload.
          client = new NativeNarrativeWorker(options.worker); await client.prepare(signal); readyAt = client.observation.sourceFreeReadyAtMonotonicMs;
          if (signal.aborted) throw new FunctionNarrativeError("cancelled");
          if (client.observation.state !== "ready") throw new FunctionNarrativeError("failed", "worker-action-not-ready");
          result = await options.execute({ transport: client, signal });
        } catch (error) { primary = error; }
        finally { try { await resource.release(); } catch (error) { cleanup = error; } }
        executionFailure = combineNativeFailures([primary, cleanup]); if (executionFailure !== undefined) throw executionFailure;
        return result as T;
      }
    });
    if (readyAt === undefined || !client?.observation.actualCloseObserved) throw new FunctionNarrativeError("failed", "worker-action-incomplete");
    succeeded = true;
    return { value, wholeHostMs: performance.now() - readyAt, actualWorker: client.observation,
      outerManagerSettlementObserved: true, neuralAuthorshipProven: false };
  } catch (error) { throw combineNativeFailures([executionFailure, error]); }
  finally {
    const observation = client?.observation;
    const { closedReceipt: _closedReceipt, ...worker } = observation ?? {};
    const receipt: NativeNarrativeActionSettlement = { succeeded, duration: measureNativeReadyDuration(observation),
      ...(observation ? { worker: worker as Omit<NativeNarrativeWorkerObservation, "closedReceipt"> } : {}),
      outerManagerSettlementObserved: true, neuralAuthorshipProven: false };
    try { options.onSettled?.(receipt); } catch { /* Observers cannot replace primary/cleanup failures or a successful value. */ }
  }
}
