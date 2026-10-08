/** Projects a parent's CFG and parser-owned call order into an opaque scenario drafting plan. */
import type { FunctionCallContext } from "../../analyzer/functionCalls";
import type { FunctionLogicAnalysis } from "../../analyzer/functionLogic";
import type { FunctionCallControlPlan, FunctionCallControlBlock } from "../../protocol/functionCalls";
import type { CodeFlowEvidenceToken } from "../../protocol/functionLogic";
import type { SourceRange } from "../../shared/types";
import { createContentHash } from "../../shared/hash";
import { createSourceDisplayFormatter } from "../sourcePresentation";

/** Projects at most 512 control blocks and 1,024 transfers; source text is only sliced, never evaluated. */
export function createFunctionCallControlPlan(analysis: FunctionLogicAnalysis, rootId: string, workspaceRoot: string,
  sites: Array<{ context: FunctionCallContext; connectionId: string }>, unorderedCallIds: string[],
  sourceText: string | undefined, evidenceToken: (file: string, range: SourceRange) => CodeFlowEvidenceToken | undefined): FunctionCallControlPlan {
  const blocks = analysis.blocks.slice(0, 512);
  const identity = (kind: string, value: string) => `call-control-${kind}:${createContentHash(rootId + "|" + value).slice(0, 32)}`;
  const ids = new Map(blocks.map(block => [block.id, identity("block", block.id)]));
  const byId = new Map(blocks.map(block => [block.id, block]));
  const ancestors = new Map<string, typeof blocks>();
  for (const block of blocks) {
    const chain = [block], visited = new Set([block.id]); let parent = block.parentBlockId;
    while (parent && !visited.has(parent) && visited.size < 64) {
      visited.add(parent); const owner = byId.get(parent); if (!owner) break;
      chain.push(owner); parent = owner.parentBlockId;
    }
    ancestors.set(block.id, chain);
  }
  const finallyEntry = new Map(blocks.filter(block => block.kind === "try").flatMap(owner => {
    const entry = blocks.find(block => block.parentBlockId === owner.id && block.branchPresentation?.key === "logic-edge-finally");
    return entry ? [[owner.id, entry.id] as const] : [];
  }));
  const catchOwners = new Set(blocks.filter(block => ["logic-edge-catch", "logic-edge-except"].includes(block.branchPresentation?.key ?? "")).map(block => block.parentBlockId));
  const display = createSourceDisplayFormatter(workspaceRoot);
  const lines = [0];
  for (let i = 0; i < (sourceText?.length ?? 0); i += 1) if (sourceText![i] === "\n") lines.push(i + 1);
  const offset = (line: number, character: number) => (lines[line] ?? 0) + character;
  const rangeKey = (range: SourceRange) => `${offset(range.startLine, range.startCharacter)}:${offset(range.endLine, range.endCharacter)}`;
  const cfgDecisions = new Set(blocks.filter(block => block.kind === "condition").map(block => rangeKey(block.range)));
  const edges = [...new Map(analysis.edges.filter(edge => ids.has(edge.sourceId) && ids.has(edge.targetId) && !["defines", "deferred"].includes(edge.kind))
    .map(edge => [[edge.sourceId, edge.targetId, edge.kind, edge.label].join("|"), edge])).values()];
  const byBlock = new Map<string, typeof sites>();
  const unordered = [...unorderedCallIds];
  let limited = blocks.length < analysis.blocks.length || edges.length > 1024 || sourceText === undefined;
  for (const site of sites) {
    const id = site.context.blockId;
    if (!id || !ids.has(id)) { unordered.push(site.connectionId); limited = true; continue; }
    const values = byBlock.get(id) ?? []; values.push(site); byBlock.set(id, values);
  }
  const projected: FunctionCallControlBlock[] = blocks.map(block => {
    const loopIds: string[] = []; const visited = new Set<string>(); let parent = block.parentBlockId;
    while (parent && !visited.has(parent) && visited.size < 64) {
      visited.add(parent); const owner = blocks.find(candidate => candidate.id === parent);
      if (!owner) { limited = true; break; }
      if (owner.kind === "loop") loopIds.unshift(ids.get(owner.id)!);
      parent = owner.parentBlockId;
    }
    if (parent && visited.size >= 64) limited = true;
    const calls = byBlock.get(block.id) ?? [];
    if (calls.some(site => !site.context.evaluationOrder || site.context.limited)) limited = true;
    calls.sort((a, b) => compareOrder(a.context, b.context));
    const loopKind = block.kind !== "loop" ? undefined : /^for (?:of|in)\b|^for .+ in /u.test(block.label) ? "iterator"
      : /^while\b/u.test(block.label) ? "condition" : "unknown";
    if (loopKind === "unknown") limited = true;
    return {
      id: ids.get(block.id)!, kind: block.kind, label: (block.condition?.expression ?? block.label).slice(0, 1200), loopKind, loopIds,
      finallyOwnerIds: (ancestors.get(block.id) ?? []).flatMap((owner, i, chain) => i > 0 && owner.kind === "try" && chain[i - 1].branchPresentation?.key === "logic-edge-finally" ? [ids.get(owner.id)!] : []),
      unresolvedException: block.kind === "throw" && (ancestors.get(block.id) ?? []).some((owner, i, chain) => i > 0 && catchOwners.has(owner.id) && chain[i - 1].branchPresentation?.key === "logic-edge-try"),
      sourceLocation: display.location(block.filePath, block.range), evidenceToken: evidenceToken(block.filePath, block.range),
      calls: calls.map(({ context, connectionId }) => ({ connectionId,
        expression: (sourceText?.slice(offset(context.site.range.startLine, context.site.range.startCharacter), offset(context.site.range.endLine, context.site.range.endCharacter)) || context.site.calleeText).slice(0, 1200),
        guards: (context.expressionGuards ?? []).filter(guard => !guard.representedByControl && !cfgDecisions.has(`${guard.from}:${guard.to}`)).map(guard => ({
          id: identity("decision", `${guard.from}:${guard.to}`), expression: guard.expression.slice(0, 1200), outcome: guard.outcome
        })) })),
      next: edges.slice(0, 1024).filter(edge => edge.sourceId === block.id).map(edge => ({
        id: identity("edge", edge.id), to: ids.get(edge.targetId)!, kind: edge.kind, label: edge.label?.slice(0, 512),
        // The shared CFG can send abrupt completions directly to their final
        // destination. Preserve finally cleanup as a completion continuation,
        // not as a user-selectable alternative to returning/breaking.
        cleanups: ["return", "throw", "break", "continue"].includes(block.kind)
          ? (ancestors.get(block.id) ?? []).flatMap((owner, i, chain) => {
            const entry = finallyEntry.get(owner.id);
            return i > 0 && entry && chain[i - 1].branchPresentation?.key !== "logic-edge-finally"
              && !(ancestors.get(edge.targetId) ?? []).some(targetOwner => targetOwner.id === owner.id)
              ? [{ ownerId: ids.get(owner.id)!, entryId: ids.get(entry)! }] : [];
          }) : undefined
      }))
    };
  });
  return { signature: analysis.signature.slice(0, 2400), entryId: projected.find(block => block.kind === "entry")?.id,
    blocks: projected, unorderedCallIds: [...new Set(unordered)], limited };
}

/** Uses parser postorder keys; fallback is visibly limited and never promoted to runtime evidence. */
function compareOrder(a: FunctionCallContext, b: FunctionCallContext): number {
  const left = a.evaluationOrder, right = b.evaluationOrder;
  if (left && right) {
    for (let i = 0; i < Math.min(left.length, right.length); i += 1) if (left[i] !== right[i]) return left[i] - right[i];
    return right.length - left.length;
  }
  return a.site.range.endLine - b.site.range.endLine || a.site.range.endCharacter - b.site.range.endCharacter;
}
