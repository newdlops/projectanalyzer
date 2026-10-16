/** Seal complete source/task records before an asynchronous model boundary, preserving aliases and every raw source character. */
import type { FunctionNarrativeContext } from "../../shared/functionNarratives";
import { FunctionNarrativeError } from "../../shared/functionNarratives";

/** Iterate with explicit depth/object admission; providers cannot rewrite source facts while authoring a response. */
export function sealNarrativeModelContext(context: FunctionNarrativeContext, maximumDepth = 1024, maximumObjects = 100000): void {
  if (!context.sourceEvidence) return;
  if (!Number.isSafeInteger(maximumDepth) || maximumDepth < 0 || !Number.isSafeInteger(maximumObjects) || maximumObjects < 1) throw new RangeError("Model context resource limits required");
  if (context.sourceWorksheet || context.sourceCallReadings || context.sourceCallFlowProof || context.checkedExamples?.length) throw new FunctionNarrativeError("invalid-response");
  const pending: Array<{ value: object; depth: number }> = [{ value: context, depth: 0 }], visited = new Set<object>();
  while (pending.length) {
    const { value, depth } = pending.pop()!;
    if (visited.has(value)) continue;
    if (depth > maximumDepth || visited.size >= maximumObjects) throw new FunctionNarrativeError("context-too-large");
    visited.add(value);
    for (const child of Object.values(value)) if (child !== null && typeof child === "object") pending.push({ value: child, depth: depth + 1 });
  }
  // Admission precedes mutation, so an over-budget task is rejected as a whole.
  for (const value of visited) Object.freeze(value);
}
