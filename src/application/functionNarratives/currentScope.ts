/** Bounded current-callable ownership for syntax facts; nested/deferred programs remain separate. */
import type { FunctionLogicAnalysis } from "../../analyzer/functionLogic";

/** Shares scope rules with route grounding without enumerating another set of paths. */
export function collectFunctionNarrativeScope(analysis: FunctionLogicAnalysis, maxDepth = 48): Set<string> {
  const visited = new Set<string>();
  const blocks = new Map(analysis.blocks.map((block) => [block.id, block]));
  const outgoing = new Map<string, Set<string>>();
  for (const edge of analysis.edges) {
    if (edge.kind === "defines" || edge.kind === "deferred") continue;
    const targets = outgoing.get(edge.sourceId) ?? new Set<string>();
    targets.add(edge.targetId); outgoing.set(edge.sourceId, targets);
  }
  const entry = analysis.blocks.find((block) => block.kind === "entry");
  const queue = entry ? [{ id: entry.id, depth: 0 }] : [];
  const depthLimit = Number.isFinite(maxDepth) ? Math.max(1, Math.min(48, Math.floor(maxDepth))) : 48;
  for (let cursor = 0; cursor < queue.length && cursor < 300; cursor += 1) {
    const { id, depth } = queue[cursor];
    if (visited.has(id) || depth > depthLimit) continue;
    const block = blocks.get(id);
    if (!block || ["embedded", "callable", "unknown", "try"].includes(block.kind)) continue;
    visited.add(id);
    if (["return", "throw", "exit"].includes(block.kind)) continue;
    for (const target of outgoing.get(id) ?? []) if (!visited.has(target)) queue.push({ id: target, depth: depth + 1 });
  }
  return visited;
}
