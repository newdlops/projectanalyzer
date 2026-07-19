/**
 * Pure direct-callee projection for Function Logic. It joins graph callsites to
 * syntax blocks with bounded iterative scans and replaces node IDs with tokens.
 */

import type { FunctionLogicAnalysis, FunctionLogicBlock } from "../../analyzer/functionLogic";
import type { FunctionLogicDrillTargetPayload } from "../../protocol/functionLogic";
import type { SourceNodeToken } from "../../protocol/sourceNavigation";
import type {
  EdgeConfidence,
  GraphEdge,
  ProjectGraph,
  SourceRange,
  SymbolNode
} from "../../shared/types";
import { createSourceDisplayFormatter } from "../sourcePresentation";

/** Default bound keeps direct-call exploration useful on generated functions. */
export const FUNCTION_LOGIC_DEFAULT_CALLEE_LIMIT = 24;

/** Host callback replacing a callable graph identity with snapshot authority. */
export type FunctionLogicSourceTokenFactory = (
  nodeId: string
) => SourceNodeToken | undefined;

/** Direct callees plus their best matching function-local syntax blocks. */
export type FunctionLogicDrillProjection = {
  callees: FunctionLogicDrillTargetPayload[];
  omittedCalleeCount: number;
  targetsByBlockId: ReadonlyMap<string, FunctionLogicDrillTargetPayload[]>;
};

type CalleeGroup = {
  node: SymbolNode;
  edges: GraphEdge[];
  confidence: EdgeConfidence;
};

/** Projects only concrete, non-self direct callees; traversal happens on demand. */
export function createFunctionLogicDrillTargets(
  graph: ProjectGraph,
  functionNode: SymbolNode,
  analysis: FunctionLogicAnalysis,
  createSourceToken: FunctionLogicSourceTokenFactory,
  limit = FUNCTION_LOGIC_DEFAULT_CALLEE_LIMIT
): FunctionLogicDrillProjection {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const groupsByNodeId = new Map<string, CalleeGroup>();

  for (const edge of graph.edges) {
    if (edge.kind !== "calls"
      || edge.sourceId !== functionNode.id
      || edge.targetId === functionNode.id
      || edge.confidence === "unresolved") {
      continue;
    }
    const target = nodesById.get(edge.targetId);
    if (!target || !isConcreteCallable(target)) {
      continue;
    }
    const existing = groupsByNodeId.get(target.id);
    if (existing) {
      existing.edges.push(edge);
      existing.confidence = strongerConfidence(existing.confidence, edge.confidence);
    } else {
      groupsByNodeId.set(target.id, {
        node: target,
        edges: [edge],
        confidence: edge.confidence
      });
    }
  }

  const orderedGroups = [...groupsByNodeId.values()].sort(compareCalleeGroups);
  const boundedLimit = normalizeLimit(limit);
  const selectedGroups = orderedGroups.slice(0, boundedLimit);
  const omittedByLimit = Math.max(0, orderedGroups.length - selectedGroups.length);
  const sourceDisplay = createSourceDisplayFormatter(graph.workspaceRoot);
  const callees: FunctionLogicDrillTargetPayload[] = [];
  const targetsByBlockId = new Map<string, FunctionLogicDrillTargetPayload[]>();
  let omittedWithoutToken = 0;

  for (const group of selectedGroups) {
    const sourceToken = createSourceToken(group.node.id);
    if (!sourceToken) {
      omittedWithoutToken += 1;
      continue;
    }
    const target = createTarget(group, sourceToken, sourceDisplay.location(
      group.node.filePath,
      group.node.selectionRange
    ));
    callees.push(target);

    const callsiteCountByBlockId = new Map<string, number>();
    for (const edge of group.edges) {
      const block = edge.range
        ? findCallsiteBlock(analysis.blocks, edge.filePath, edge.range)
        : undefined;
      if (block) {
        callsiteCountByBlockId.set(
          block.id,
          (callsiteCountByBlockId.get(block.id) ?? 0) + 1
        );
      }
    }
    for (const [blockId, callsiteCount] of callsiteCountByBlockId) {
      const values = targetsByBlockId.get(blockId) ?? [];
      values.push({ ...target, callsiteCount });
      targetsByBlockId.set(blockId, values);
    }
  }

  return {
    callees,
    omittedCalleeCount: omittedByLimit + omittedWithoutToken,
    targetsByBlockId
  };
}

/** Creates one browser-safe target while retaining aggregate edge confidence. */
function createTarget(
  group: CalleeGroup,
  sourceToken: SourceNodeToken,
  sourceLocation: string | undefined
): FunctionLogicDrillTargetPayload {
  return {
    sourceToken,
    name: group.node.name || "Anonymous callable",
    qualifiedName: group.node.qualifiedName || group.node.name || "Anonymous callable",
    sourceLocation,
    confidence: group.confidence,
    callsiteCount: group.edges.length
  };
}

/** Finds the narrowest non-synthetic block containing a call expression. */
function findCallsiteBlock(
  blocks: FunctionLogicBlock[],
  filePath: string,
  callsite: SourceRange
): FunctionLogicBlock | undefined {
  const candidates = blocks.filter((block) =>
    block.filePath === filePath
    && block.kind !== "entry"
    && block.kind !== "exit"
    && containsRange(block.range, callsite)
  );
  if (candidates.length > 0) {
    return candidates.sort(compareBlockSpecificity)[0];
  }

  // Lightweight analyzers may retain only line precision. This conservative
  // fallback never crosses a line and still prefers the narrowest statement.
  return blocks
    .filter((block) =>
      block.filePath === filePath
      && block.kind !== "entry"
      && block.kind !== "exit"
      && block.range.startLine <= callsite.startLine
      && block.range.endLine >= callsite.startLine
    )
    .sort(compareBlockSpecificity)[0];
}

/** Compares source spans without converting line/column pairs to byte offsets. */
function compareBlockSpecificity(left: FunctionLogicBlock, right: FunctionLogicBlock): number {
  const lineDelta = spanLines(left.range) - spanLines(right.range);
  if (lineDelta !== 0) {
    return lineDelta;
  }
  return spanCharacters(left.range) - spanCharacters(right.range);
}

/** Orders callees by first source callsite, then stable qualified identity. */
function compareCalleeGroups(left: CalleeGroup, right: CalleeGroup): number {
  const leftEdge = [...left.edges].sort(compareEdges)[0];
  const rightEdge = [...right.edges].sort(compareEdges)[0];
  const edgeOrder = compareEdges(leftEdge, rightEdge);
  return edgeOrder || left.node.qualifiedName.localeCompare(right.node.qualifiedName)
    || left.node.id.localeCompare(right.node.id);
}

/** Orders graph edges by callsite and stable edge identity. */
function compareEdges(left: GraphEdge, right: GraphEdge): number {
  const leftRange = left.range;
  const rightRange = right.range;
  if (leftRange && rightRange) {
    return comparePositions(leftRange.startLine, leftRange.startCharacter, rightRange.startLine, rightRange.startCharacter)
      || left.id.localeCompare(right.id);
  }
  if (leftRange) return -1;
  if (rightRange) return 1;
  return left.id.localeCompare(right.id);
}

/** Returns true when the outer source range fully contains the inner range. */
function containsRange(outer: SourceRange, inner: SourceRange): boolean {
  return comparePositions(
    outer.startLine,
    outer.startCharacter,
    inner.startLine,
    inner.startCharacter
  ) <= 0 && comparePositions(
    outer.endLine,
    outer.endCharacter,
    inner.endLine,
    inner.endCharacter
  ) >= 0;
}

/** Lexicographically compares two zero-based editor positions. */
function comparePositions(
  leftLine: number,
  leftCharacter: number,
  rightLine: number,
  rightCharacter: number
): number {
  return leftLine - rightLine || leftCharacter - rightCharacter;
}

/** Approximate line span used only to rank already-containing blocks. */
function spanLines(range: SourceRange): number {
  return Math.max(0, range.endLine - range.startLine);
}

/** Character span breaks ties between same-line blocks. */
function spanCharacters(range: SourceRange): number {
  return range.startLine === range.endLine
    ? Math.max(0, range.endCharacter - range.startCharacter)
    : range.startCharacter + range.endCharacter;
}

/** Preserves the strongest static evidence when one callee has many callsites. */
function strongerConfidence(left: EdgeConfidence, right: EdgeConfidence): EdgeConfidence {
  const rank: Record<EdgeConfidence, number> = {
    exact: 0,
    resolved: 1,
    inferred: 2,
    unresolved: 3
  };
  return rank[left] <= rank[right] ? left : right;
}

/** Allows drill-through only to source-backed callable definitions. */
function isConcreteCallable(node: SymbolNode): boolean {
  return node.kind === "function" || node.kind === "method" || node.kind === "constructor";
}

/** Bounds caller-provided limits and treats non-finite values as the default. */
function normalizeLimit(value: number): number {
  return Number.isFinite(value)
    ? Math.min(100, Math.max(0, Math.floor(value)))
    : FUNCTION_LOGIC_DEFAULT_CALLEE_LIMIT;
}
