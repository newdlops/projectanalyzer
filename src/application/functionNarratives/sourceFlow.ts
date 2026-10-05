/** Projects existing language-neutral control facts into small source-cited LLM routes; never evaluates code. */
import type { FunctionLogicAnalysis, FunctionLogicEdge } from "../../analyzer/functionLogic";
import type { FunctionNarrativeContext, FunctionNarrativeFlowPath, FunctionNarrativeFlowStep, FunctionNarrativeSourceFlow } from "../../shared/functionNarratives";
import { createFunctionNarrativeSourceStep } from "./sourceStep";

export type FunctionNarrativeFlowOptions = { maxDepth?: number; maxPaths?: number; maxCharacters?: number };

/**
 * Adds no source reads or parsing. Each route has its own visited set so shared
 * suffixes survive while loops stop; work and serialized output are bounded.
 */
export function buildFunctionNarrativeSourceFlow(analysis: FunctionLogicAnalysis, source: string,
  context: FunctionNarrativeContext, options: FunctionNarrativeFlowOptions = {}): FunctionNarrativeSourceFlow {
  const bound = (value: number | undefined, fallback: number, maximum: number) => Number.isFinite(value)
    ? Math.max(1, Math.min(maximum, Math.floor(value!))) : fallback;
  const maxDepth = bound(options.maxDepth, 24, 48);
  const maxPaths = bound(options.maxPaths, 3, 3);
  const maxCharacters = bound(options.maxCharacters, 4000, 6000);
  const result: FunctionNarrativeSourceFlow = { basis: "source-control-flow", paths: [], limited: analysis.gaps.length > 0 };
  const sourceStep = createFunctionNarrativeSourceStep(analysis, source, context);
  const blocks = new Map(analysis.blocks.map((block) => [block.id, block]));
  const outgoing = new Map<string, FunctionLogicEdge[]>();
  const seenEdges = new Set<string>();
  for (const edge of analysis.edges) {
    // Declarations and deferred callbacks do not run on their owner's route.
    if (edge.kind === "defines" || edge.kind === "deferred") continue;
    const key = `${edge.sourceId}\0${edge.targetId}\0${edge.kind}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    const group = outgoing.get(edge.sourceId) ?? [];
    group.push(edge); outgoing.set(edge.sourceId, group);
  }
  const entry = analysis.blocks.find((block) => block.kind === "entry");
  if (!entry) return { ...result, limited: true };
  type Frame = { id: string; steps: FunctionNarrativeFlowStep[]; visited: Set<string>; depth: number; confidence: "exact" | "inferred" };
  const pending: Frame[] = [{ id: entry.id, steps: [], visited: new Set(), depth: 0, confidence: entry.confidence }];
  // The fixed exploration cap bounds branching even when large routes cannot
  // fit the output budget. IDs stay inside the projection, never in its result.
  let work = 0;
  const append = (steps: FunctionNarrativeFlowStep[], confidence: Frame["confidence"], status: FunctionNarrativeFlowPath["status"], reason?: FunctionNarrativeFlowPath["reason"]) => {
    result.limited ||= status === "partial";
    if (!steps.length) return;
    const path: FunctionNarrativeFlowPath = { status, confidence, steps, ...(reason ? { reason } : {}) };
    const length = JSON.stringify({ ...result, paths: [...result.paths, path] }).length;
    if (length <= maxCharacters) result.paths.push(path);
    else result.limited = true;
  };
  while (pending.length && result.paths.length < maxPaths && work++ < 128) {
    const frame = pending.pop()!;
    if (frame.visited.has(frame.id)) { append(frame.steps, frame.confidence, "partial", "cycle"); continue; }
    if (frame.depth >= maxDepth) { append(frame.steps, frame.confidence, "partial", "depth-limit"); continue; }
    const block = blocks.get(frame.id);
    if (!block) { append(frame.steps, frame.confidence, "partial", "missing-block"); continue; }
    const confidence = frame.confidence === "inferred" || block.confidence === "inferred" ? "inferred" : "exact";
    if (["embedded", "callable", "unknown", "try"].includes(block.kind)) {
      append(frame.steps, confidence, "partial", "control-gap"); continue;
    }
    const step = block.kind === "entry" ? undefined : sourceStep(block);
    if (block.kind !== "entry" && !step) { append(frame.steps, confidence, "partial", "missing-source"); continue; }
    const steps = step ? [...frame.steps, step] : frame.steps;
    const choices = outgoing.get(block.id) ?? [];
    if (["return", "throw", "exit"].includes(block.kind)) {
      // A finally/continuation relation cannot be represented as a plain early
      // return. Stop honestly rather than claim its later effects are skipped.
      const continuation = choices.some((edge) => edge.kind !== block.kind
        || blocks.get(edge.targetId)?.kind !== "exit");
      append(steps, confidence, continuation ? "partial" : "source-terminal", continuation ? "control-gap" : undefined);
      continue;
    }
    if (!choices.length || choices.some((edge) => ["exception", "finally"].includes(edge.kind))) {
      append(steps, confidence, "partial", "control-gap"); continue;
    }
    const visited = new Set(frame.visited); visited.add(block.id);
    // Stack insertion preserves analyzer source branch order (true before false).
    // Each branch owns a step copy; predicates are never evaluated by the LLM adapter.
    for (const edge of [...choices].reverse()) {
      const branch = step && (choices.length > 1 || ["true", "false", "case", "iterate"].includes(edge.kind))
        ? { outcome: edge.kind, confidence: edge.confidence } : undefined;
      const nextSteps = branch ? [...frame.steps, { ...step!, branch }] : steps;
      pending.push({ id: edge.targetId, steps: nextSteps, visited, depth: frame.depth + 1,
        confidence: confidence === "inferred" || edge.confidence === "inferred" ? "inferred" : "exact" });
    }
  }
  result.limited ||= pending.length > 0;
  return result;

}
