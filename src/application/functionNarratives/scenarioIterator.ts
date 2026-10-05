/** Lazy iterative scenario enumeration: batch sizes never impose a total-path limit. */
import type { FunctionNarrativeContext, FunctionNarrativeFlowPath, FunctionNarrativeFlowStep } from "../../shared/functionNarratives";

type Frame = { index: number; steps: FunctionNarrativeFlowStep[]; visited: Set<number>; exitedLoops: Set<number>;
  depth: number; confidence: "exact" | "inferred" };

/**
 * Enumerates every acyclic decision combination. A revisited loop exits after a
 * symbolic body pass; its skipped/body/break/continue choices remain separate.
 * Iteration counts and feasibility are not asserted. Unknown cycles retain a
 * partial prefix. Work can be consumed one path at a time without materializing
 * the function's Cartesian product at activation.
 */
export function createFunctionNarrativeScenarioIterator(context: FunctionNarrativeContext,
  options: { maxDepth?: number } = {}): IterableIterator<FunctionNarrativeFlowPath> | undefined {
  const graph = context.scenarioGraph;
  if (!graph) return undefined;
  const maxDepth = Number.isSafeInteger(options.maxDepth) && options.maxDepth! > 0
    ? options.maxDepth! : Math.max(48, graph.nodes.length * 3);
  const pending: Frame[] = [{ index: graph.entry, steps: [], visited: new Set(), exitedLoops: new Set(), depth: 0, confidence: "exact" }];
  const path = (frame: Frame, status: FunctionNarrativeFlowPath["status"], reason?: FunctionNarrativeFlowPath["reason"]): FunctionNarrativeFlowPath =>
    ({ steps: frame.steps, confidence: frame.confidence, status, ...(reason ? { reason } : {}) });
  return {
    [Symbol.iterator]() { return this; },
    next(): IteratorResult<FunctionNarrativeFlowPath> {
      while (pending.length) {
        const frame = pending.pop()!;
        const node = graph.nodes[frame.index];
        if (!node) return { done: false, value: path(frame, "partial", "missing-block") };
        if (frame.depth >= maxDepth) return { done: false, value: path(frame, "partial", "depth-limit") };
        const repeated = frame.visited.has(frame.index);
        if (repeated && (node.kind !== "loop" || frame.exitedLoops.has(frame.index))) {
          return { done: false, value: path(frame, "partial", "cycle") };
        }
        const confidence = frame.confidence === "inferred" || node.confidence === "inferred" ? "inferred" : "exact";
        if (["embedded", "callable", "unknown"].includes(node.kind)) return { done: false, value: path({ ...frame, confidence }, "partial", "control-gap") };
        if (node.kind !== "entry" && node.kind !== "exit" && !node.step) return { done: false, value: path({ ...frame, confidence }, "partial", "missing-source") };
        const steps = node.step ? [...frame.steps, node.step] : frame.steps;
        const exitsOnly = repeated ? node.next.filter((edge) => edge.outcome === "exit" || edge.outcome === "false") : node.next;
        const terminal = node.kind === "exit" || ["return", "throw"].includes(node.kind)
          && (!exitsOnly.length || exitsOnly.every((edge) => edge.outcome === node.kind && graph.nodes[edge.target]?.kind === "exit"));
        if (terminal) return { done: false, value: path({ ...frame, confidence, steps }, "source-terminal") };
        if (!exitsOnly.length) return { done: false, value: path({ ...frame, confidence, steps }, "partial", "control-gap") };
        const visited = new Set(frame.visited); visited.add(frame.index);
        const exitedLoops = new Set(frame.exitedLoops); if (repeated) exitedLoops.add(frame.index);
        for (const edge of [...exitsOnly].reverse()) {
          const branch = node.step && (exitsOnly.length > 1 || ["true", "false", "case", "iterate", "exception", "exit"].includes(edge.outcome))
            ? { outcome: repeated ? "repeat-exit" : edge.outcome, confidence: edge.confidence } : undefined;
          const nextSteps = branch ? [...frame.steps, { ...node.step!, branch }] : steps;
          pending.push({ index: edge.target, steps: nextSteps, visited, exitedLoops, depth: frame.depth + 1,
            confidence: confidence === "inferred" || edge.confidence === "inferred" ? "inferred" : "exact" });
        }
      }
      return { done: true, value: undefined };
    }
  };
}
