/** Replaceable LLM boundary; application code supplies excerpts and never owns a model process. */
import type { FunctionNarrativeContext } from "../../shared/functionNarratives";

export type FunctionNarrativeFailure = "unavailable" | "download-failed" | "cancelled" | "denied" | "timeout" | "invalid-response" | "language-mismatch" | "context-too-large" | "failed";
export class FunctionNarrativeError extends Error {
  public constructor(public readonly code: FunctionNarrativeFailure) { super(code); this.name = "FunctionNarrativeError"; }
}
export interface FunctionNarrativeProvider {
  /** Optional cancellable setup runs once per explicit action, before inference deadlines; it receives no source. */
  prepare?(language: "ko" | "en", signal: AbortSignal): Promise<void>;
  /** Invoked only by an explicit user action; text still needs independent structured validation. */
  generate(context: FunctionNarrativeContext, language: "ko" | "en", signal: AbortSignal, options?: { reselectModel: boolean }): Promise<{ modelName: string; text: string }>;
}
