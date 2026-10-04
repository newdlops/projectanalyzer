/** Bounded iterative current-scope traversal and common source prerequisites at CFG joins. */
import type { FunctionLogicAnalysis, FunctionLogicEdge } from "../../../../analyzer/functionLogic";
import type { FunctionTutorDeclarationAnalysis } from "../../../../analyzer/functionTutor";

const GUARDED_TRANSFERS = new Set(["true", "false", "case", "exception"]);
export type FunctionBehaviorReachableScope = {
  blockIds: Set<string>;
  edgeIds: Set<string>;
  /** Guards common to all reached predecessors; merged alternatives are never treated as conjunctions. */
  guardsByBlockId: Map<string, Set<string>>;
  outgoing: Map<string, FunctionLogicEdge[]>;
  excludedBoundaryIds: string[];
  limited: boolean;
};

/** Follows the active entry with a visited set and a finite monotone guard intersection. */
export function collectFunctionBehaviorScope(
  analysis: FunctionLogicAnalysis,
  declaration: FunctionTutorDeclarationAnalysis,
  maxDepth = 300
): FunctionBehaviorReachableScope {
  const depthLimit = Math.max(0, Math.min(300, maxDepth));
  const blocks = new Map(analysis.blocks.map((block) => [block.id, block]));
  const excluded = new Set(declaration.program.blocks.filter((block) => block.embeddedRelation === "defines" || block.embeddedRelation === "deferred").map((block) => block.blockId));
  const outgoing = new Map<string, FunctionLogicEdge[]>(); const excludedBoundaryIds = new Set<string>();
  for (const edge of analysis.edges) {
    if (edge.kind === "defines" || edge.kind === "deferred" || excluded.has(edge.targetId)) {
      excludedBoundaryIds.add(edge.sourceId); continue;
    }
    if (!blocks.has(edge.sourceId) || !blocks.has(edge.targetId)) continue;
    const values = outgoing.get(edge.sourceId) ?? []; values.push(edge); outgoing.set(edge.sourceId, values);
  }
  const blockIds = new Set<string>(); const edgeIds = new Set<string>();
  const guardsByBlockId = new Map<string, Set<string>>();
  const queue = [{ id: declaration.program.entryBlockId, depth: 0, guards: new Set<string>() }];
  let cursor = 0; let work = 0; let limited = false;
  // Intersections only remove guards after a join. The work budget protects
  // recovered/malformed cyclic CFGs while the depth bound protects long routes.
  while (cursor < queue.length && work++ < 1200) {
    const state = queue[cursor++];
    if (!blocks.has(state.id) || excluded.has(state.id)) continue;
    if (state.depth > depthLimit) { limited = true; continue; }
    const previous = guardsByBlockId.get(state.id);
    const guards = previous ? new Set([...previous].filter((id) => state.guards.has(id))) : state.guards;
    if (blockIds.has(state.id) && previous?.size === guards.size) continue;
    blockIds.add(state.id); guardsByBlockId.set(state.id, guards);
    for (const edge of outgoing.get(state.id) ?? []) {
      edgeIds.add(edge.id);
      // A return/throw already supplies its source outcome. Do not merge that
      // guard into the shared synthetic exit and erase a different fallthrough.
      if ((edge.kind === "return" || edge.kind === "throw") && blocks.get(edge.targetId)?.kind === "exit") continue;
      const nextGuards = new Set(guards);
      if (GUARDED_TRANSFERS.has(edge.kind)) {
        // A repeated visit replaces its earlier source choice; iterations do
        // not require both true and false for the same controlling statement.
        for (const id of nextGuards) if ((outgoing.get(state.id) ?? []).some((candidate) => candidate.id === id)) nextGuards.delete(id);
        nextGuards.add(edge.id);
      }
      queue.push({ id: edge.targetId, depth: state.depth + 1, guards: nextGuards });
    }
  }
  if (cursor < queue.length) limited = true;
  return { blockIds, edgeIds, guardsByBlockId, outgoing, excludedBoundaryIds: [...excludedBoundaryIds].filter((id) => blockIds.has(id)), limited };
}
