/** Executes and validates a model operation, keeping unmanaged test/legacy adapters bounded too. */
import type { FunctionNarrativeContext } from "../../shared/functionNarratives";
import { parseFunctionCallNarrative } from "../functionCallNarratives";
import { parseFunctionNarrative } from "./structuredResponse";
import { FunctionNarrativeError, type FunctionNarrativeProvider, type FunctionNarrativeGenerationOptions, type FunctionNarrativeModelResponse } from "./provider";
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
  if (provider.managesDeadlines) {
    const response = await provider.generate(context, language, signal, { ...options, validate });
    if (context.sourceEvidence) {
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
  if (!context.sourceEvidence) controller.signal.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, fallbackTimeoutMs);
  try {
    const operation = provider.generate(context, language, controller.signal, options);
    const response = context.sourceEvidence ? await operation : await Promise.race([operation, cancelled]);
    if (controller.signal.aborted) throw new FunctionNarrativeError(timedOut ? "timeout" : "cancelled");
    validate(response); return response;
  } finally { clearTimeout(timer); signal.removeEventListener("abort", abort); controller.signal.removeEventListener("abort", cancel); }
}
