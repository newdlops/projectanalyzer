/** Stable acquisition errors for cancellation, freshness and bounded ownership. */
export type SourceCaptureErrorCode = "cancelled" | "source-changed" | "context-too-large" | "invalid-range" | "disposed";

/** A failed source contract must never become a plausible partial model context. */
export class SourceCaptureError extends Error {
  public constructor(public readonly code: SourceCaptureErrorCode, message: string) {
    super(message); this.name = "SourceCaptureError";
  }
}

/** Check on both sides of every asynchronous boundary. */
export function requireSourceActive(signal: AbortSignal): void {
  if (signal.aborted) throw new SourceCaptureError("cancelled", "Source capture was cancelled");
}
