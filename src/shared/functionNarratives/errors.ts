/** Provider/parser failure identity shared by independent source-reading features. */
export type FunctionNarrativeFailure = "unavailable" | "download-failed" | "cancelled" | "denied" | "timeout" | "invalid-response" | "language-mismatch" | "context-too-large" | "failed";
export class FunctionNarrativeError extends Error {
  public constructor(public readonly code: FunctionNarrativeFailure) { super(code); this.name = "FunctionNarrativeError"; }
}
