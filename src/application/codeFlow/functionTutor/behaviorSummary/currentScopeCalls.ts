/** Current-scope invocation facts joined from lexical callsites and already-built Tutor effects. */
import type { FunctionLogicAnalysis, FunctionLogicBlock, FunctionLogicCallsite } from "../../../../analyzer/functionLogic";
import type { FunctionTutorCertainty, FunctionTutorDeclarationAnalysis } from "../../../../analyzer/functionTutor";
import type { SourceRange } from "../../../../shared/types";

export type FunctionBehaviorCallFact = {
  identity: string;
  sourcePreview: string;
  certainty: FunctionTutorCertainty;
  range: SourceRange;
};

/** Keeps each source invocation once, without requiring a resolved graph edge or entering another scope. */
export function collectCurrentScopeCalls(logic: FunctionLogicAnalysis, declaration: FunctionTutorDeclarationAnalysis,
  reachedBlockIds: ReadonlySet<string>): Map<string, FunctionBehaviorCallFact[]> {
  const blocks = new Map(logic.blocks.map((block) => [block.id, block]));
  const facts = new Map<string, FunctionBehaviorCallFact[]>();
  const visited = new Set<string>();
  for (const call of logic.callsites) {
    if (call.relation && call.relation !== "call") continue;
    const owner = call.blockId ? blocks.get(call.blockId) : findCallOwner(call, logic.blocks);
    if (!owner || !reachedBlockIds.has(owner.id) || owner.kind === "callable" || owner.kind === "embedded") continue;
    const identity = `${owner.id}:${rangeIdentity(call.range)}:${call.calleeText}`;
    if (visited.has(identity)) continue;
    visited.add(identity);
    const values = facts.get(owner.id) ?? [];
    values.push({ identity, sourcePreview: `${call.calleeText}()`, certainty: call.confidence ?? owner.confidence, range: call.range });
    facts.set(owner.id, values);
  }
  // The program has already pruned callable/lambda bodies. Effect facts also
  // cover return/initializer calls when the Logic adapter has no lexical list.
  // A lexical list owns occurrence identity; its matching effect metadata is
  // another description of those calls, not an additional invocation.
  for (const block of declaration.program.blocks) {
    if (!reachedBlockIds.has(block.blockId) || block.embeddedRelation === "defines" || block.embeddedRelation === "deferred") continue;
    const owner = blocks.get(block.blockId);
    if (!owner || facts.has(owner.id) || ["callable", "embedded", "render", "event"].includes(owner.kind)) continue;
    const calls = block.operations.filter((operation) => operation.kind === "effect" && operation.effectKind === "call");
    const values: FunctionBehaviorCallFact[] = [];
    for (const [index, call] of calls.entries()) {
      if (call.kind !== "effect") continue;
      values.push({ identity: `${owner.id}:effect:${index}`, sourcePreview: call.summary, certainty: call.certainty, range: owner.range });
    }
    if (values.length) facts.set(owner.id, values);
  }
  return facts;
}

/** Chooses among all lexical blocks so an excluded nested block cannot fall back to its reached parent. */
function findCallOwner(call: FunctionLogicCallsite, blocks: FunctionLogicBlock[]): FunctionLogicBlock | undefined {
  let owner: FunctionLogicBlock | undefined;
  for (const block of blocks) {
    if (block.filePath !== call.filePath || block.kind === "entry" || block.kind === "exit" || !contains(block.range, call.range)) continue;
    if (!owner || contains(owner.range, block.range) && (rangeIdentity(owner.range) !== rangeIdentity(block.range) || block.depth > owner.depth)) owner = block;
  }
  return owner;
}

/** Source coordinates remain Host-only; projection turns their evidence into opaque tokens. */
function contains(outer: SourceRange, inner: SourceRange): boolean {
  const startsBefore = outer.startLine < inner.startLine || outer.startLine === inner.startLine && outer.startCharacter <= inner.startCharacter;
  const endsAfter = outer.endLine > inner.endLine || outer.endLine === inner.endLine && outer.endCharacter >= inner.endCharacter;
  return startsBefore && endsAfter;
}
function rangeIdentity(range: SourceRange): string { return `${range.startLine}:${range.startCharacter}-${range.endLine}:${range.endCharacter}`; }
