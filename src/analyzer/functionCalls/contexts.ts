/** Bounded CFG prerequisites and lexical loop context for parser-owned callsites. */
import type { FunctionLogicAnalysis, FunctionLogicBlock, FunctionLogicCallsite } from "../functionLogic";
import { createPythonCallGuardReader } from "./languages/python";
import { createTypeScriptCallGuardReader } from "./languages/typescript";
import { createKotlinCallGuardReader } from "./languages/kotlin";

export type FunctionCallContext = {
  site: FunctionLogicCallsite;
  blockId?: string;
  guards: Array<{ expression: string; outcome: string }>;
  loops: string[];
  deferred: boolean;
  limited: boolean;
  /** Source offsets identify expression choices; these never become browser source authority. */
  expressionGuards?: Array<{ expression: string; outcome: string; from: number; to: number;
    /** Same parser-owned predicate is already represented by the parent's retained CFG. */
    representedByControl?: boolean }>;
  evaluationOrder?: number[];
};

/** Joins each call to its narrowest source block, retaining only dominating branch prerequisites. */
export function createFunctionCallContexts(analysis: FunctionLogicAnalysis, options: { sourceText?: string; maxDepth?: number } = {}): FunctionCallContext[] {
  const maxDepth = Math.max(1, Math.min(512, options.maxDepth ?? 512));
  const syntaxGuards = options.sourceText === undefined ? undefined : analysis.language === "python"
    ? createPythonCallGuardReader(options.sourceText, maxDepth)
    : ["typescript", "javascript"].includes(analysis.language)
      ? createTypeScriptCallGuardReader(options.sourceText, analysis.functionNode.filePath, maxDepth)
      : analysis.language === "kotlin" ? createKotlinCallGuardReader(options.sourceText, analysis.functionNode.filePath, maxDepth,
        new Set(analysis.blocks.filter(block => block.kind === "condition" && block.confidence === "exact")
          .flatMap(block => block.condition ? [block.condition.groupId] : []))) : undefined;
  const blocks = analysis.blocks.slice(0, 512); const byId = new Map(blocks.map((block) => [block.id, block]));
  const ownedEdges = analysis.edges.filter(edge => byId.has(edge.sourceId) && byId.has(edge.targetId));
  const isLoopBackedge = (from: string, to: string): boolean => {
    if (byId.get(to)?.kind !== "loop") return false;
    const visited = new Set<string>(); let parent = byId.get(from)?.parentBlockId;
    while (parent && visited.size < maxDepth && !visited.has(parent)) {
      if (parent === to) return true;
      visited.add(parent); parent = byId.get(parent)?.parentBlockId;
    }
    return false;
  };
  // A loop's final condition can return to its header on a false edge, not just
  // a repeat edge. Such edges belong to the next iteration's prerequisites.
  const edges = ownedEdges.filter((edge) => !["defines", "deferred", "repeat", "continue"].includes(edge.kind)
    && !isLoopBackedge(edge.sourceId, edge.targetId));
  const forwardIds = new Set(edges.map(edge => edge.id));
  const branchChoices = new Map<string, typeof edges>();
  for (const edge of ownedEdges) {
    const choices = branchChoices.get(edge.sourceId) ?? []; choices.push(edge); branchChoices.set(edge.sourceId, choices);
  }
  const outgoing = new Map<string, typeof edges>(); const incoming = new Map<string, string[]>();
  for (const edge of edges) {
    const next = outgoing.get(edge.sourceId) ?? []; next.push(edge); outgoing.set(edge.sourceId, next);
    const previous = incoming.get(edge.targetId) ?? []; previous.push(edge.sourceId); incoming.set(edge.targetId, previous);
  }
  const entry = blocks.find((block) => block.kind === "entry");
  let reachLimited = false;
  const reachable = (start: string): Set<string> => {
    const visited = new Set<string>([start]); const queue = [{ id: start, depth: 0 }];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const { id, depth } = queue[cursor];
      for (const edge of outgoing.get(id) ?? []) {
        if (visited.has(edge.targetId)) continue;
        if (depth >= maxDepth) { reachLimited = true; continue; }
        visited.add(edge.targetId); queue.push({ id: edge.targetId, depth: depth + 1 });
      }
    }
    return visited;
  };
  const live = entry ? reachable(entry.id) : new Set<string>();
  const dominators = new Map([...live].map((id) => [id, new Set(id === entry?.id ? [id] : live)]));
  let changed = false;
  for (let pass = 0; pass < blocks.length; pass += 1) {
    changed = false;
    for (const id of live) {
      if (id === entry?.id) continue;
      const parents = (incoming.get(id) ?? []).filter((parent) => live.has(parent));
      const next = new Set(parents.length ? [...dominators.get(parents[0])!].filter((value) => parents.every((parent) => dominators.get(parent)!.has(value))) : []);
      next.add(id); const previous = dominators.get(id)!;
      if (next.size !== previous.size || [...next].some((value) => !previous.has(value))) { dominators.set(id, next); changed = true; }
    }
    if (!changed) break;
  }
  const reachByTarget = new Map<string, Set<string>>();
  return analysis.callsites.slice(0, 96).map((site) => {
    const block = site.blockId ? byId.get(site.blockId) : blocks.filter((candidate) => !["entry", "exit"].includes(candidate.kind)
      && candidate.filePath === site.filePath && contains(candidate, site)).sort((a, b) => span(a) - span(b))[0];
    const result: FunctionCallContext = { site, blockId: block?.id, guards: [], loops: [], deferred: site.relation === "event",
      limited: !block || !live.has(block.id) || analysis.blocks.length > blocks.length || changed };
    if (!block) return result;
    const ancestors = new Set<string>(); let parent = block.parentBlockId;
    while (parent && ancestors.size < Math.min(32, maxDepth) && !ancestors.has(parent)) {
      ancestors.add(parent); const owner = byId.get(parent); if (!owner) { result.limited = true; break; }
      if (owner.kind === "callable") { result.deferred = true; break; }
      if (owner.kind === "loop") result.loops.unshift(owner.label);
      parent = owner.parentBlockId;
    }
    if (parent && ancestors.size >= Math.min(32, maxDepth)) result.limited = true;
    // A guard must occur on every route to this call. Branches that rejoin before
    // the call are not prerequisites; a call evaluating the predicate excludes itself.
    for (const owner of blocks) {
      if (owner.id === block.id || !dominators.get(block.id)?.has(owner.id) || !["condition", "switch", "try"].includes(owner.kind)) continue;
      const choices = branchChoices.get(owner.id) ?? [];
      if (choices.length < 2) continue;
      const reaching = choices.filter((edge) => {
        if (!forwardIds.has(edge.id)) return false;
        if (!reachByTarget.has(edge.targetId)) reachByTarget.set(edge.targetId, reachable(edge.targetId));
        return reachByTarget.get(edge.targetId)!.has(block.id);
      });
      if (reaching.length === 1 && ["true", "false", "case", "exception", "finally"].includes(reaching[0].kind)) {
        result.guards.push({ expression: owner.condition?.expression ?? owner.label, outcome: reaching[0].kind === "case" ? reaching[0].label ?? "case" : reaching[0].kind });
      }
    }
    const expressionContext = syntaxGuards?.(site);
    if (expressionContext) {
      result.expressionGuards = expressionContext.guards;
      result.evaluationOrder = expressionContext.order;
      for (const guard of expressionContext.guards) if (!result.guards.some(existing => existing.expression === guard.expression && existing.outcome === guard.outcome)) result.guards.push({ expression: guard.expression, outcome: guard.outcome });
      result.deferred ||= expressionContext.deferred;
      result.limited ||= expressionContext.limited;
    } else if (analysis.language === "python" && /\b(?:and|or|else)\b/u.test(block.label)) result.limited = true;
    result.limited ||= reachLimited;
    if (result.guards.length > 12) { result.guards.length = 12; result.limited = true; }
    return result;
  });
}

/** Compares source positions without treating a full enclosing statement as a call target. */
function contains(block: FunctionLogicBlock, site: FunctionLogicCallsite): boolean {
  const a = block.range; const b = site.range;
  return (a.startLine < b.startLine || a.startLine === b.startLine && a.startCharacter <= b.startCharacter)
    && (a.endLine > b.endLine || a.endLine === b.endLine && a.endCharacter >= b.endCharacter);
}
function span(block: FunctionLogicBlock): number {
  return (block.range.endLine - block.range.startLine) * 100000 + block.range.endCharacter - block.range.startCharacter;
}
