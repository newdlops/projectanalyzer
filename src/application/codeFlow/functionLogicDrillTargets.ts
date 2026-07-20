/**
 * Pure direct-callee projection for Function Logic. It joins graph callsites to
 * syntax blocks with bounded iterative scans and replaces node IDs with tokens.
 */

import type {
  FunctionLogicAnalysis,
  FunctionLogicBlock,
  FunctionLogicCallsite
} from "../../analyzer/functionLogic";
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

/** Called/rendered targets plus their best matching function-local syntax blocks. */
export type FunctionLogicDrillProjection = {
  callees: FunctionLogicDrillTargetPayload[];
  omittedCalleeCount: number;
  targetsByBlockId: ReadonlyMap<string, FunctionLogicDrillTargetPayload[]>;
};

type CalleeGroup = {
  node: SymbolNode;
  callsites: MatchedCallsite[];
  confidence: EdgeConfidence;
};

/** One graph- or syntax-backed direct call retained for block attachment. */
type MatchedCallsite = {
  key: string;
  filePath: string;
  range?: SourceRange;
  confidence: EdgeConfidence;
  relation: "call" | "render";
};

/** Concrete target resolution synthesized only when no graph edge covers the callsite. */
type SyntaxTargetResolution = {
  node: SymbolNode;
  confidence: EdgeConfidence;
};

/** Projects concrete non-self child targets; traversal still happens on demand. */
export function createFunctionLogicDrillTargets(
  graph: ProjectGraph,
  functionNode: SymbolNode,
  analysis: FunctionLogicAnalysis,
  createSourceToken: FunctionLogicSourceTokenFactory,
  limit = FUNCTION_LOGIC_DEFAULT_CALLEE_LIMIT
): FunctionLogicDrillProjection {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const groupsByNodeId = new Map<string, CalleeGroup>();
  const directEdges = graph.edges.filter((edge) =>
    edge.kind === "calls"
    && edge.sourceId === functionNode.id
    && edge.targetId !== functionNode.id
  );
  const usedEdgeIds = new Set<string>();

  // Syntax callsites attach calls inside condition/loop/switch expressions and
  // also recover conservative targets when a lightweight graph missed a
  // multiline function body. An explicit unresolved edge normally prevents
  // syntax fallback; parser-proven receiver-chain stages get the narrow,
  // inferred recovery path documented below.
  for (const callsite of analysis.callsites) {
    const matchingEdge = findMatchingDirectEdge(
      callsite,
      directEdges,
      nodesById,
      usedEdgeIds
    );
    if (matchingEdge) {
      usedEdgeIds.add(matchingEdge.id);
      const target = nodesById.get(matchingEdge.targetId);
      if (matchingEdge.confidence === "unresolved") {
        // Primary lightweight analyzers often preserve fluent receiver calls as
        // unresolved. A parser-proven chain stage may still recover one unique
        // callable conservatively so its function flow remains expandable.
        const chainResolution = callsite.callChain
          ? resolveSyntaxTarget(
              graph,
              functionNode,
              callsite,
              analysis.lexicalOwnerQualifiedName
            )
          : undefined;
        if (chainResolution) {
          addMatchedCallsite(groupsByNodeId, chainResolution.node, {
            key: createSyntaxCallsiteKey(callsite),
            filePath: callsite.filePath,
            range: callsite.range,
            confidence: constrainCallsiteConfidence(chainResolution.confidence, callsite),
            relation: callsite.relation ?? "call"
          });
        }
      } else if (target && isConcreteCallable(target)) {
        addMatchedCallsite(groupsByNodeId, target, {
          key: createSyntaxCallsiteKey(callsite),
          filePath: callsite.filePath,
          range: callsite.range,
          confidence: constrainCallsiteConfidence(matchingEdge.confidence, callsite),
          relation: callsite.relation ?? "call"
        });
      }
      continue;
    }

    const syntaxResolution = resolveSyntaxTarget(
      graph,
      functionNode,
      callsite,
      analysis.lexicalOwnerQualifiedName
    );
    if (syntaxResolution) {
      addMatchedCallsite(groupsByNodeId, syntaxResolution.node, {
        key: createSyntaxCallsiteKey(callsite),
        filePath: callsite.filePath,
        range: callsite.range,
        confidence: constrainCallsiteConfidence(syntaxResolution.confidence, callsite),
        relation: callsite.relation ?? "call"
      });
    }
  }

  // Graph edges without AST coverage still remain available for languages or
  // analyzer versions that provide only call-edge ranges.
  for (const edge of directEdges) {
    if (usedEdgeIds.has(edge.id) || edge.confidence === "unresolved") {
      continue;
    }
    const target = nodesById.get(edge.targetId);
    if (!target || !isConcreteCallable(target)) {
      continue;
    }
    addMatchedCallsite(groupsByNodeId, target, {
      key: `edge:${edge.id}`,
      filePath: edge.filePath,
      range: edge.range,
      confidence: edge.confidence,
      relation: "call"
    });
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
    for (const callsite of group.callsites) {
      const block = callsite.range
        ? findCallsiteBlock(analysis.blocks, callsite.filePath, callsite.range)
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
    callsiteCount: group.callsites.length,
    ...(group.callsites.every((callsite) => callsite.relation === "render")
      ? { relation: "render" as const }
      : {})
  };
}

/** Matches an AST call to the nearest same-name graph edge at that source range. */
function findMatchingDirectEdge(
  callsite: FunctionLogicCallsite,
  edges: GraphEdge[],
  nodesById: ReadonlyMap<string, SymbolNode>,
  usedEdgeIds: ReadonlySet<string>
): GraphEdge | undefined {
  return edges
    .filter((edge) => {
      if (usedEdgeIds.has(edge.id)
        || !edge.range
        || !sameFilePath(edge.filePath, callsite.filePath)
        || !rangesOverlap(edge.range, callsite.range)) {
        return false;
      }
      const target = nodesById.get(edge.targetId);
      return Boolean(target && (
        target.name === callsite.calleeName
        || target.qualifiedName.split(".").at(-1) === callsite.calleeName
      ));
    })
    .sort((left, right) =>
      callsiteDistance(left.range, callsite.range)
      - callsiteDistance(right.range, callsite.range)
      || compareEdges(left, right)
    )[0];
}

/** Resolves AST names only when graph candidates make one target unambiguous. */
function resolveSyntaxTarget(
  graph: ProjectGraph,
  functionNode: SymbolNode,
  callsite: FunctionLogicCallsite,
  lexicalOwnerQualifiedName?: string
): SyntaxTargetResolution | undefined {
  const candidates = graph.nodes.filter((node) =>
    node.id !== functionNode.id && isConcreteCallable(node)
  );
  const normalizedText = callsite.calleeText
    .replace(/\?\./gu, ".")
    .replace(/\s+/gu, "");
  const ownerQualifiedName = lexicalOwnerQualifiedName
    || functionNode.qualifiedName.split(".").slice(0, -1).join(".");

  const usesCurrentInstance = normalizedText.startsWith("this.")
    || normalizedText.startsWith("self.");
  const directCurrentInstanceCall = usesCurrentInstance
    && callsite.callChain !== "continuation";
  if (directCurrentInstanceCall && ownerQualifiedName) {
    const ownedName = `${ownerQualifiedName}.${callsite.calleeName}`;
    const owned = candidates.filter((node) => node.qualifiedName === ownedName);
    if (owned.length === 1) {
      return { node: owned[0], confidence: "resolved" };
    }
  }

  if (callsite.callChain === "start") {
    const constructors = candidates.filter((node) =>
      node.kind === "constructor"
      && node.qualifiedName.split(".").slice(-2, -1)[0] === callsite.calleeName
    );
    if (constructors.length === 1) {
      return { node: constructors[0], confidence: "inferred" };
    }
  }

  if (normalizedText.includes(".") && !usesCurrentInstance) {
    const qualified = candidates.filter((node) => node.qualifiedName === normalizedText);
    if (qualified.length === 1) {
      return { node: qualified[0], confidence: "resolved" };
    }
  }

  const fluentOwner = resolveFluentOwnerTarget(candidates, callsite, normalizedText);
  if (fluentOwner) {
    return { node: fluentOwner, confidence: "inferred" };
  }

  const sameFile = candidates.filter((node) =>
    sameFilePath(node.filePath, callsite.filePath)
    && node.name === callsite.calleeName
  );
  if (sameFile.length === 1) {
    return { node: sameFile[0], confidence: "inferred" };
  }

  const workspaceMatches = candidates.filter((node) => node.name === callsite.calleeName);
  return workspaceMatches.length === 1
    ? { node: workspaceMatches[0], confidence: "inferred" }
    : undefined;
}

/** Uses an explicit class constructor at the start of a chain as owner evidence. */
function resolveFluentOwnerTarget(
  candidates: readonly SymbolNode[],
  callsite: FunctionLogicCallsite,
  normalizedText: string
): SymbolNode | undefined {
  if (callsite.callChain !== "continuation") {
    return undefined;
  }
  const firstCall = normalizedText.slice(0, normalizedText.indexOf("("));
  const ownerName = firstCall.split(".").at(-1);
  if (!ownerName || !/^[A-Z][\p{L}\p{N}_]*$/u.test(ownerName)) {
    return undefined;
  }
  const suffix = `${ownerName}.${callsite.calleeName}`;
  const matches = candidates.filter((node) =>
    node.qualifiedName === suffix || node.qualifiedName.endsWith(`.${suffix}`)
  );
  return matches.length === 1 ? matches[0] : undefined;
}

/** Adds one de-duplicated callsite while retaining the strongest target evidence. */
function addMatchedCallsite(
  groupsByNodeId: Map<string, CalleeGroup>,
  node: SymbolNode,
  callsite: MatchedCallsite
): void {
  const existing = groupsByNodeId.get(node.id);
  if (!existing) {
    groupsByNodeId.set(node.id, {
      node,
      callsites: [callsite],
      confidence: callsite.confidence
    });
    return;
  }
  const prior = existing.callsites.find((candidate) => candidate.key === callsite.key);
  if (prior) {
    prior.confidence = strongerConfidence(prior.confidence, callsite.confidence);
  } else {
    existing.callsites.push(callsite);
  }
  existing.confidence = strongerConfidence(existing.confidence, callsite.confidence);
}

/** Creates a stable key for one exact AST call expression. */
function createSyntaxCallsiteKey(callsite: FunctionLogicCallsite): string {
  return [
    "syntax",
    callsite.filePath,
    callsite.range.startLine,
    callsite.range.startCharacter,
    callsite.range.endLine,
    callsite.range.endCharacter,
    callsite.calleeText,
    callsite.relation ?? "call"
  ].join(":");
}

/** Inferred callback traversal caps otherwise stronger graph resolution. */
function constrainCallsiteConfidence(
  confidence: EdgeConfidence,
  callsite: FunctionLogicCallsite
): EdgeConfidence {
  return callsite.confidence === "inferred" && confidence !== "unresolved"
    ? "inferred"
    : confidence;
}

/** Scores graph edges by start position against a containing AST call range. */
function callsiteDistance(
  edgeRange: SourceRange | undefined,
  callsiteRange: SourceRange
): number {
  if (!edgeRange) {
    return Number.MAX_SAFE_INTEGER;
  }
  return (Math.abs(edgeRange.startLine - callsiteRange.startLine) * 1_000_000)
    + Math.abs(edgeRange.startCharacter - callsiteRange.startCharacter);
}

/** Accepts the usual callee-only edge range nested inside a full AST call range. */
function rangesOverlap(left: SourceRange, right: SourceRange): boolean {
  return comparePositions(
    left.startLine,
    left.startCharacter,
    right.endLine,
    right.endCharacter
  ) <= 0 && comparePositions(
    right.startLine,
    right.startCharacter,
    left.endLine,
    left.endCharacter
  ) <= 0;
}

/** Compares analyzer paths without depending on the extension-host platform. */
function sameFilePath(left: string, right: string): boolean {
  return left.replace(/\\/gu, "/") === right.replace(/\\/gu, "/");
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
  const leftCallsite = [...left.callsites].sort(compareMatchedCallsites)[0];
  const rightCallsite = [...right.callsites].sort(compareMatchedCallsites)[0];
  const callsiteOrder = compareMatchedCallsites(leftCallsite, rightCallsite);
  return callsiteOrder || left.node.qualifiedName.localeCompare(right.node.qualifiedName)
    || left.node.id.localeCompare(right.node.id);
}

/** Orders matched syntax/edge evidence by source position and stable key. */
function compareMatchedCallsites(left: MatchedCallsite, right: MatchedCallsite): number {
  if (left.range && right.range) {
    return comparePositions(
      left.range.startLine,
      left.range.startCharacter,
      right.range.startLine,
      right.range.startCharacter
    ) || left.key.localeCompare(right.key);
  }
  if (left.range) return -1;
  if (right.range) return 1;
  return left.key.localeCompare(right.key);
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
