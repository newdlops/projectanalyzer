/** Executes and validates a model operation, keeping unmanaged test/legacy adapters bounded too. */
import type { FunctionNarrativeContext } from "../../shared/functionNarratives";
import { parseFunctionCallNarrative } from "../functionCallNarratives";
import { parseFunctionNarrative } from "./structuredResponse";
import { FunctionNarrativeError, type FunctionNarrativeProvider, type FunctionNarrativeGenerationOptions, type FunctionNarrativeModelResponse, type FunctionNarrativeRootRequest } from "./provider";
import { sealNarrativeModelContext } from "../narrativeSources";

/** Managed providers time actual execution only; fallback timers protect adapters without a scheduler. */
export async function requestFunctionNarrative(provider: FunctionNarrativeProvider, context: FunctionNarrativeContext, language: "ko" | "en",
  signal: AbortSignal, fallbackTimeoutMs: number, options?: FunctionNarrativeGenerationOptions): Promise<FunctionNarrativeModelResponse> {
  if (signal.aborted) throw new FunctionNarrativeError("cancelled");
  sealNarrativeModelContext(context);
  const validate = (response: FunctionNarrativeModelResponse) => {
    if (context.callTask) parseFunctionCallNarrative(response.text, context, language);
    else parseFunctionNarrative(response.text, context, language);
  };
  return requestOperation(provider, Boolean(context.sourceEvidence), signal, fallbackTimeoutMs,
    (operationSignal, operationOptions) => provider.generate(context, language, operationSignal, operationOptions), validate, options);
}

/** Complete replies always wait for transport settlement on cancellation and are independently decoded by the Host. */
export function requestFunctionNarrativeRoot(provider: FunctionNarrativeProvider, request: FunctionNarrativeRootRequest, language: "ko" | "en",
  signal: AbortSignal, fallbackTimeoutMs: number, options?: FunctionNarrativeGenerationOptions): Promise<FunctionNarrativeModelResponse> {
  if (!provider.generateCompleteRoot || !options?.validate) throw new FunctionNarrativeError("invalid-response");
  return requestOperation(provider, true, signal, fallbackTimeoutMs,
    (operationSignal, operationOptions) => provider.generateCompleteRoot!(request, language, operationSignal, operationOptions), options.validate, options);
}

/** Native calls preserve the same owned abort/deadline/cleanup policy as complete roots and require an independent Host decoder. */
export function requestFunctionNarrativeCall(provider: FunctionNarrativeProvider, request: FunctionNarrativeRootRequest, language: "ko" | "en",
  signal: AbortSignal, fallbackTimeoutMs: number, options?: FunctionNarrativeGenerationOptions): Promise<FunctionNarrativeModelResponse> {
  if (!provider.generateCompleteCall || !options?.validate) throw new FunctionNarrativeError("invalid-response");
  return requestOperation(provider, true, signal, fallbackTimeoutMs,
    (operationSignal, operationOptions) => provider.generateCompleteCall!(request, language, operationSignal, operationOptions), options.validate, options);
}

/** One deadline/abort policy serves both formats; captured-source operations cannot outlive their cleanup boundary. */
async function requestOperation(provider: FunctionNarrativeProvider, awaitCleanup: boolean, signal: AbortSignal, fallbackTimeoutMs: number,
  generate: (signal: AbortSignal, options?: FunctionNarrativeGenerationOptions) => Promise<FunctionNarrativeModelResponse>,
  validate: (response: FunctionNarrativeModelResponse) => void, options?: FunctionNarrativeGenerationOptions): Promise<FunctionNarrativeModelResponse> {
  if (signal.aborted) throw new FunctionNarrativeError("cancelled");
  if (provider.managesDeadlines) {
    const response = await generate(signal, { ...options, validate });
    if (awaitCleanup) {
      if (signal.aborted) throw new FunctionNarrativeError("cancelled");
      validate(response);
    }
    return response;
  }
  const controller = new AbortController();
  const abort = () => controller.abort(); signal.addEventListener("abort", abort, { once: true });
  let timedOut = false, rejectCancelled: (error: unknown) => void = () => {};
  const cancelled = new Promise<never>((_resolve, reject) => { rejectCancelled = reject; });
  const cancel = () => rejectCancelled(new FunctionNarrativeError(timedOut ? "timeout" : "cancelled"));
  if (!awaitCleanup) controller.signal.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, fallbackTimeoutMs);
  try {
    const operation = generate(controller.signal, options);
    const response = awaitCleanup ? await operation : await Promise.race([operation, cancelled]);
    if (controller.signal.aborted) throw new FunctionNarrativeError(timedOut ? "timeout" : "cancelled");
    validate(response); return response;
  } finally { clearTimeout(timer); signal.removeEventListener("abort", abort); controller.signal.removeEventListener("abort", cancel); }
}
