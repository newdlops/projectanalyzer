/** Shared scheduling boundary for native, configured and directly consumed narrative adapters. */
import { ModelTaskError, type ModelTaskManager, type ModelTaskResource } from "../../shared/modelTasks";
import { FunctionNarrativeError, type FunctionNarrativeGenerationOptions, type FunctionNarrativeModelResponse, type FunctionNarrativeOperationOptions } from "./provider";

/** Slow local hardware receives three minutes of actual inference, without extending context/output memory. */
export const MODEL_INFERENCE_TIMEOUT_MS = 180000;

/** Source-free preparation shares the same resource owner as generation; downloads remain cancellable. */
export async function scheduleFunctionNarrativePreparation<T>(manager: ModelTaskManager, signal: AbortSignal,
  execute: (signal: AbortSignal) => Promise<T>, options?: FunctionNarrativeOperationOptions, resource?: ModelTaskResource): Promise<T> {
  try { return await manager.run({ kind: "prepare", label: options?.label ?? "Model preparation", signal, execute, resource,
    ...(resource ? { timeoutMs: MODEL_INFERENCE_TIMEOUT_MS } : {}), onProgress: options?.onProgress }); }
  catch (error) { throw narrativeError(error); }
}

/** Nested configured/local adapters reuse the active lease, never enqueue behind their own operation. */
export async function scheduleFunctionNarrativeRequest(manager: ModelTaskManager, label: string, signal: AbortSignal,
  execute: (signal: AbortSignal) => Promise<FunctionNarrativeModelResponse>, options?: FunctionNarrativeGenerationOptions): Promise<FunctionNarrativeModelResponse> {
  if (signal.aborted) throw new FunctionNarrativeError("cancelled");
  if (manager.isExecuting(signal)) return execute(signal);
  try {
    return await manager.run({ kind: "inference", label: options?.label ?? label, signal,
      timeoutMs: options?.timeoutMs ?? MODEL_INFERENCE_TIMEOUT_MS, onProgress: options?.onProgress, resource: options?.resource,
      async execute(signal) { const response = await execute(signal); options?.validate?.(response); return response; } });
  } catch (error) { throw narrativeError(error); }
}

/** Domain adapters retain their failure categories; scheduler shutdown is a cancellation. */
function narrativeError(error: unknown): unknown {
  return error instanceof ModelTaskError ? new FunctionNarrativeError(error.code === "disposed" ? "cancelled" : error.code) : error;
}
