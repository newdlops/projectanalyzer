/** Translate source acquisition failures into existing Host statuses without exposing file paths or exception text. */
import { SourceCaptureError } from "../../shared/narrativeSources";

/** Missing source authority is stale; exceeding a whole-source budget never becomes an abbreviated request. */
export function getNarrativeSourceFailureStatus(error: unknown): "context-too-large" | "stale" | "cancelled" | undefined {
  if (!(error instanceof SourceCaptureError)) return undefined;
  if (error.code === "context-too-large") return "context-too-large";
  if (error.code === "cancelled" || error.code === "disposed") return "cancelled";
  return "stale";
}
