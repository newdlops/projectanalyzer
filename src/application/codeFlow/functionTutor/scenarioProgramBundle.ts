/**
 * Bounded Host-side Scenario bundle limits. Resolution remains in the Host and
 * is deliberately kept out of browser code and display-text projection.
 */
export const SCENARIO_PROGRAM_BUNDLE_LIMITS = {
  maxCallDepth: 4,
  maxPrograms: 12,
  maxBlocks: 360,
  maxSerializedBytes: 96 * 1024
} as const;

/** Identifies an AST-backed direct call without exposing its source range. */
export type ScenarioProgramCallLink = {
  callerProgramId: string;
  calleeProgramId?: string;
  /** Parser location is Host-only and is used solely to join one IR call. */
  callStartLine: number;
  callStartCharacter: number;
  reason?: "unresolved" | "ambiguous" | "cycle" | "depth-budget" | "program-budget" | "block-budget" | "payload-budget" | "unsupported";
};

import { analyzeFunctionLogic } from "../../../analyzer/functionLogic";
import { analyzeFunctionTutorDeclaration } from "../../../analyzer/functionTutor";
import type { FunctionTutorDeclarationAnalysis, FunctionTutorExpression } from "../../../analyzer/functionTutor";
import type { ProjectGraph, SymbolNode } from "../../../shared/types";

/** Host-only bundle prior to opaque protocol projection. */
export type ScenarioProgramBundle = { rootNodeId: string; declarations: FunctionTutorDeclarationAnalysis[]; links: ScenarioProgramCallLink[]; omitted: ScenarioProgramCallLink[] };

/**
 * Resolves only exact graph call edges whose range overlaps a parser-backed
 * direct-call expression. The queue and visited identities bound cycles without
 * name selection; browser code never participates in this resolution.
 */
export async function buildScenarioProgramBundle(
  graph: ProjectGraph,
  root: FunctionTutorDeclarationAnalysis,
  readSourceText: (filePath: string) => Promise<string | undefined>
): Promise<ScenarioProgramBundle> {
  // Private AST records are merged before graph calls. Methods and constructors
  // therefore never select a graph target by their rendered name.
  const catalogPrograms = root.scenarioCatalog?.programs ?? [];
  const declarations = [root, ...catalogPrograms.map((program) => program.declaration)];
  const omitted: ScenarioProgramCallLink[] = [];
  const links: ScenarioProgramCallLink[] = [];
  const declarationByNodeId = new Map(declarations.map((declaration) => [declaration.functionNode.id, declaration]));
  for (const resolution of root.scenarioCatalog?.resolutions ?? []) {
    links.push({ callerProgramId: resolution.callerId, calleeProgramId: resolution.targetId, callStartLine: resolution.range.startLine, callStartCharacter: resolution.range.startCharacter });
  }
  const catalogCallKeys = new Set((root.scenarioCatalog?.resolutions ?? []).map((resolution) => `${resolution.callerId}:${resolution.range.startLine}:${resolution.range.startCharacter}`));
  // An ancestry set belongs to each queued call chain. A global visited set
  // would incorrectly classify two independent calls to the same helper as a cycle.
  const pending: Array<{ declaration: FunctionTutorDeclarationAnalysis; depth: number; ancestry: ReadonlySet<string> }> = [{ declaration: root, depth: 0, ancestry: new Set([root.functionNode.id]) }];
  let cursor = 0;
  let blockCount = root.program.blocks.length;
  while (cursor < pending.length) {
    const current = pending[cursor++];
    const calls = collectDirectCalls(current.declaration.program.blocks);
    for (const call of calls) {
      const callLocation = { callStartLine: call.callRange.startLine, callStartCharacter: call.callRange.startCharacter };
      if (catalogCallKeys.has(`${current.declaration.functionNode.id}:${callLocation.callStartLine}:${callLocation.callStartCharacter}`)) continue;
      if (current.depth >= SCENARIO_PROGRAM_BUNDLE_LIMITS.maxCallDepth) { omitted.push({ callerProgramId: current.declaration.functionNode.id, ...callLocation, reason: "depth-budget" }); continue; }
      const targets = graph.edges.filter((edge) => edge.kind === "calls" && edge.confidence === "exact" && edge.sourceId === current.declaration.functionNode.id && edge.range
        && edge.filePath === current.declaration.functionNode.filePath && overlaps(edge.range, call.callRange))
        .map((edge) => graph.nodes.find((node) => node.id === edge.targetId))
        .filter((node): node is SymbolNode => Boolean(node && node.kind === "function"));
      if (targets.length !== 1) { omitted.push({ callerProgramId: current.declaration.functionNode.id, ...callLocation, reason: targets.length ? "ambiguous" : "unresolved" }); continue; }
      const target = targets[0];
      if (current.ancestry.has(target.id)) { omitted.push({ callerProgramId: current.declaration.functionNode.id, ...callLocation, reason: "cycle" }); continue; }
      const cached = declarationByNodeId.get(target.id);
      if (cached) {
        links.push({ callerProgramId: current.declaration.functionNode.id, calleeProgramId: target.id, ...callLocation });
        continue;
      }
      if (declarations.length >= SCENARIO_PROGRAM_BUNDLE_LIMITS.maxPrograms) { omitted.push({ callerProgramId: current.declaration.functionNode.id, ...callLocation, reason: "program-budget" }); continue; }
      const source = await readSourceText(target.filePath);
      if (!source) { omitted.push({ callerProgramId: current.declaration.functionNode.id, ...callLocation, reason: "unsupported" }); continue; }
      const logic = analyzeFunctionLogic({ functionNode: target, sourceText: source });
      const declaration = analyzeFunctionTutorDeclaration({ functionNode: target, sourceText: source, functionLogic: logic });
      if (declaration.executionKind !== "sync" || (declaration.language !== "typescript" && declaration.language !== "javascript")) { omitted.push({ callerProgramId: current.declaration.functionNode.id, ...callLocation, reason: "unsupported" }); continue; }
      if (blockCount + declaration.program.blocks.length > SCENARIO_PROGRAM_BUNDLE_LIMITS.maxBlocks) { omitted.push({ callerProgramId: current.declaration.functionNode.id, ...callLocation, reason: "block-budget" }); continue; }
      declarationByNodeId.set(target.id, declaration); blockCount += declaration.program.blocks.length; declarations.push(declaration);
      pending.push({ declaration, depth: current.depth + 1, ancestry: new Set([...current.ancestry, target.id]) });
      links.push({ callerProgramId: current.declaration.functionNode.id, calleeProgramId: target.id, ...callLocation });
    }
  }
  return { rootNodeId: root.functionNode.id, declarations, links, omitted };
}

function collectDirectCalls(blocks: FunctionTutorDeclarationAnalysis["program"]["blocks"]): Array<Extract<FunctionTutorExpression, { kind: "direct-call" }>> {
  const calls: Array<Extract<FunctionTutorExpression, { kind: "direct-call" }>> = [];
  const pending: FunctionTutorExpression[] = [];
  for (const block of blocks) { for (const operation of block.operations) { if (operation.kind === "define" || operation.kind === "assign") pending.push(operation.value); } if (block.decision) pending.push(block.decision.expression); if (block.terminal && "value" in block.terminal && block.terminal.value) pending.push(block.terminal.value); }
  while (pending.length) { const expression = pending.pop()!; if (expression.kind === "direct-call") { calls.push(expression); pending.push(...expression.arguments); if (expression.receiver) pending.push(expression.receiver); } else if (expression.kind === "await") pending.push(expression.operand); else if (expression.kind === "construct") pending.push(...expression.arguments); else if (expression.kind === "binary") pending.push(expression.left, expression.right); else if (expression.kind === "unary") pending.push(expression.operand); else if (expression.kind === "conditional") pending.push(expression.condition, expression.whenTrue, expression.whenFalse); else if (expression.kind === "logical") pending.push(...expression.members); else if (expression.kind === "array") pending.push(...expression.items); else if (expression.kind === "object") for (const entry of expression.entries) pending.push(entry.value); else if (expression.kind === "member") pending.push(expression.object); }
  return calls;
}
function overlaps(left: { startLine: number; startCharacter: number; endLine: number; endCharacter: number }, right: { startLine: number; startCharacter: number; endLine: number; endCharacter: number }): boolean {
  const startsBeforeOtherEnds = left.startLine < right.endLine || (left.startLine === right.endLine && left.startCharacter <= right.endCharacter);
  const otherStartsBeforeEnds = right.startLine < left.endLine || (right.startLine === left.endLine && right.startCharacter <= left.endCharacter);
  return startsBeforeOtherEnds && otherStartsBeforeEnds;
}
