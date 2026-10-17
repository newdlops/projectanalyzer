/** Translate source acquisition failures into existing Host statuses without exposing file paths or exception text. */
import { SourceCaptureError } from "../../shared/narrativeSources";
import { FunctionNarrativeError } from "../../shared/functionNarratives";

/** Missing source authority is stale; exceeding a whole-source budget never becomes an abbreviated request. */
export function getNarrativeSourceFailureStatus(error: unknown, maxDepth = 32): "context-too-large" | "stale" | "cancelled" | undefined {
  const depthLimit = Math.min(256, Math.max(0, Number.isSafeInteger(maxDepth) ? maxDepth : 32));
  const work = [{ error, depth: 0 }], visited = new Set<object>(); let cancelled = false, tooLarge = false;
  // Cleanup can wrap the original source failure several times. Revocation must survive that wrapping; descriptor reads avoid invoking cause/error accessors.
  while (work.length && visited.size < 256) {
    const current = work.pop()!, item = current.error;
    if (!item || typeof item !== "object" || visited.has(item)) continue; visited.add(item);
    if (item instanceof SourceCaptureError) {
      if (item.code === "context-too-large") tooLarge = true;
      else if (item.code === "cancelled" || item.code === "disposed") cancelled = true;
      else return "stale";
    }
    if (current.depth >= depthLimit) continue;
    const cause = Object.getOwnPropertyDescriptor(item, "cause"), errors = Object.getOwnPropertyDescriptor(item, "errors");
    if (cause && Object.hasOwn(cause, "value") && work.length + visited.size < 256) work.push({ error: cause.value, depth: current.depth + 1 });
    if (Array.isArray(errors?.value)) for (let index = Math.min(errors.value.length, 256 - work.length - visited.size) - 1; index >= 0; index--) {
      const entry = Object.getOwnPropertyDescriptor(errors.value, String(index));
      if (entry && Object.hasOwn(entry, "value")) work.push({ error: entry.value, depth: current.depth + 1 });
    }
  }
  if (tooLarge) return "context-too-large";
  // A precise outer timeout/validation category must not become cancellation merely because cleanup cancelled a source reader.
  if (cancelled && (!(error instanceof FunctionNarrativeError) || error.code === "failed" || error.code === "cancelled")) return "cancelled";
  return undefined;
}
