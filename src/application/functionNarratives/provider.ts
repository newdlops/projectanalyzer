/** Replaceable LLM boundary; application code supplies excerpts and never owns a model process. */
import type { FunctionNarrativeContext } from "../../shared/functionNarratives";

export type FunctionNarrativeFailure = "unavailable" | "cancelled" | "denied" | "timeout" | "invalid-response" | "context-too-large" | "failed";
export class FunctionNarrativeError extends Error {
  public constructor(public readonly code: FunctionNarrativeFailure) { super(code); this.name = "FunctionNarrativeError"; }
}
export interface FunctionNarrativeProvider {
  /** Invoked only by an explicit user action; text still needs independent structured validation. */
  generate(context: FunctionNarrativeContext, language: "ko" | "en", signal: AbortSignal, options?: { reselectModel: boolean }): Promise<{ modelName: string; text: string }>;
}
