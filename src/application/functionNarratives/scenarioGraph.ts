/** Projects a complete source-owned CFG once; paths remain lazy and no model invocation or source read occurs here. */
import type { FunctionLogicAnalysis } from "../../analyzer/functionLogic";
import type { FunctionNarrativeContext, FunctionNarrativeScenarioGraph } from "../../shared/functionNarratives";
import { createFunctionNarrativeSourceStep } from "./sourceStep";

/** Keeps every runtime transfer and its confidence, including loop/exception alternatives omitted by the old preview. */
export function buildFunctionNarrativeScenarioGraph(analysis: FunctionLogicAnalysis, source: string,
  context: FunctionNarrativeContext): FunctionNarrativeScenarioGraph {
  const indices = new Map(analysis.blocks.map((block, index) => [block.id, index]));
  const sourceStep = createFunctionNarrativeSourceStep(analysis, source, context);
  const graph: FunctionNarrativeScenarioGraph = { entry: analysis.blocks.findIndex((block) => block.kind === "entry"),
    limited: analysis.gaps.length > 0 || context.limited,
    nodes: analysis.blocks.map((block) => ({ kind: block.kind, confidence: block.confidence,
      ...(block.kind !== "entry" && block.kind !== "exit" ? { step: sourceStep(block) } : {}), next: [] })) };
  const seen = new Set<string>();
  for (const edge of analysis.edges) {
    if (edge.kind === "defines" || edge.kind === "deferred") continue;
    const sourceIndex = indices.get(edge.sourceId);
    if (sourceIndex === undefined) { graph.limited = true; continue; }
    const target = indices.get(edge.targetId) ?? -1;
    const key = `${sourceIndex}:${target}:${edge.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    graph.nodes[sourceIndex].next.push({ target, outcome: edge.kind, confidence: edge.confidence });
  }
  return graph;
}
