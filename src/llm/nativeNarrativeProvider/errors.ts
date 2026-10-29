/** Translate scheduler/native aggregate codes to the existing provider failure contract while retaining original execution and cleanup causes. */
import { ModelTaskError } from "../../shared/modelTasks";
import { FunctionNarrativeError, type FunctionNarrativeFailure } from "../../shared/functionNarratives";

const failures = new Set<string>(["unavailable", "download-failed", "queue-full", "cancelled", "denied", "timeout", "invalid-response", "language-mismatch", "context-too-large", "parameter-limit", "memory-pressure", "failed"]);

/** Native action aggregates are real failures, not response JSON. Keep their full cause graph private for Host source-revocation handling. */
export function asNativeProviderFailure(error: unknown): unknown {
  if (error instanceof FunctionNarrativeError) return error;
  const code: unknown = error instanceof ModelTaskError ? error.code
    : error instanceof AggregateError ? Object.getOwnPropertyDescriptor(error, "code")?.value : undefined;
  const mapped = code === "disposed" ? "cancelled" : code;
  if (typeof mapped !== "string" || !failures.has(mapped)) return error;
  return Object.assign(new FunctionNarrativeError(mapped as FunctionNarrativeFailure, "native-provider-action"), { cause: error });
}
