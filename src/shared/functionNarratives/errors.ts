/** Provider/parser failure identity shared by independent source-reading features. */
export type FunctionNarrativeFailure = "unavailable" | "download-failed" | "queue-full" | "cancelled" | "denied" | "timeout" | "invalid-response" | "language-mismatch" | "context-too-large" | "failed";
export class FunctionNarrativeError extends Error {
  /** detailCode is a controlled diagnostic tag, never stderr, source or a private path. */
  public constructor(public readonly code: FunctionNarrativeFailure, public readonly detailCode?: string) { super(code); this.name = "FunctionNarrativeError"; }
}
