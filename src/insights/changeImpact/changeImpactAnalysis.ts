/**
 * Pure, bounded change-impact analysis over reverse function call edges.
 *
 * The implementation uses an explicit breadth-first queue and visited set so
 * cycles and converging paths remain finite. Only graph `calls` edges are
 * executable evidence; framework semantic edges never enter the traversal.
 */

import type { SemanticFlow, SemanticFlowIndex } from "../semanticFlow";
import type {
  EdgeConfidence,
  GraphEdge,
  ProjectGraph,
  SourceRange,
  SymbolNode
} from "../../shared/types";
import type {
  AffectedSemanticFlow,
  AnalyzeChangeImpactOptions,
  ChangeImpactAnalysis,
  ChangeImpactCaller,
  ChangeImpactDiagnostic
} from "./types";

type TraversalBounds = {
  maxDepth: number;
  maxSteps: number;
};

type TraversalItem = {
  functionId: string;
  depth: number;
  /** Current function-first path ending at the target. */
  pathFunctionIds: string[];
  pathConfidence?: EdgeConfidence;
};

type ReverseTraversal = {
  callers: ChangeImpactCaller[];
  callersByFunctionId: Map<string, ChangeImpactCaller>;
  diagnostics: ChangeImpactDiagnostic[];
};

/** Defaults favor useful multi-layer impact while bounding large workspaces. */
const DEFAULT_MAX_DEPTH = 4;
const DEFAULT_MAX_STEPS = 100;

const CONFIDENCE_RANK: Record<EdgeConfidence, number> = {
  exact: 0,
  resolved: 1,
  inferred: 2,
  unresolved: 3
};

/**
 * Finds concrete callers and route flows affected by one changed function.
 *
 * Unresolved calls remain eligible when their source is a concrete callable:
 * the unresolved confidence is preserved rather than silently discarding a
 * potential reverse impact. Results are ordered independently of graph input.
 */
export function analyzeChangeImpact(
  graph: ProjectGraph,
  semanticFlowIndex: SemanticFlowIndex,
  targetFunctionId: string,
  options: AnalyzeChangeImpactOptions = {}
): ChangeImpactAnalysis {
  const nodesById = createNodeIndex(graph.nodes);
  const incomingCallsByTargetId = createIncomingCallIndex(graph.edges, nodesById);
  const bounds = normalizeBounds(options);
  const traversal = traverseIncomingCalls(
    targetFunctionId,
    nodesById,
    incomingCallsByTargetId,
    bounds
  );
  const directCallers = traversal.callers.filter((caller) => caller.depth === 1);
  const indirectCallers = traversal.callers.filter((caller) => caller.depth > 1);
  const affectedFlows = createAffectedFlows(
    semanticFlowIndex.flows,
    targetFunctionId,
    traversal.callersByFunctionId
  );

  return {
    graphVersion: graph.version,
    targetFunctionId,
    targetFound: nodesById.has(targetFunctionId),
    callers: traversal.callers,
    directCallers,
    indirectCallers,
    affectedFlows,
    diagnostics: traversal.diagnostics,
    summary: {
      callerCount: traversal.callers.length,
      directCallerCount: directCallers.length,
      indirectCallerCount: indirectCallers.length,
      affectedFlowCount: affectedFlows.length,
      truncated: traversal.diagnostics.length > 0
    }
  };
}

/** Performs iterative reverse traversal with cycle, depth, and step guards. */
function traverseIncomingCalls(
  targetFunctionId: string,
  nodesById: Map<string, SymbolNode>,
  incomingCallsByTargetId: Map<string, GraphEdge[]>,
  bounds: TraversalBounds
): ReverseTraversal {
  const callers: ChangeImpactCaller[] = [];
  const callersByFunctionId = new Map<string, ChangeImpactCaller>();
  const diagnostics: ChangeImpactDiagnostic[] = [];
  const visitedFunctionIds = new Set<string>([targetFunctionId]);
  const queue: TraversalItem[] = [{
    functionId: targetFunctionId,
    depth: 0,
    pathFunctionIds: [targetFunctionId]
  }];
  let queueIndex = 0;

  while (queueIndex < queue.length) {
    const current = queue[queueIndex];
    queueIndex += 1;
    const incoming = getUnvisitedConcreteIncoming(
      current.functionId,
      incomingCallsByTargetId,
      nodesById,
      visitedFunctionIds
    );

    if (incoming.length === 0) {
      continue;
    }

    if (current.depth >= bounds.maxDepth) {
      diagnostics.push(createLimitDiagnostic(
        "depthLimit",
        `Callers of ${current.functionId} exceed max depth ${bounds.maxDepth}`,
        current.functionId,
        incoming.map((edge) => edge.sourceId),
        bounds.maxDepth
      ));
      continue;
    }

    for (let edgeIndex = 0; edgeIndex < incoming.length; edgeIndex += 1) {
      const edge = incoming[edgeIndex];

      if (callers.length >= bounds.maxSteps) {
        const omittedFunctionIds = collectKnownOmittedFunctionIds(
          incoming.slice(edgeIndex),
          queue.slice(queueIndex),
          incomingCallsByTargetId,
          nodesById,
          visitedFunctionIds
        );
        diagnostics.push(createLimitDiagnostic(
          "stepLimit",
          `Reverse call impact exceeds max step count ${bounds.maxSteps}`,
          current.functionId,
          omittedFunctionIds,
          bounds.maxSteps
        ));

        return { callers, callersByFunctionId, diagnostics };
      }

      const callerNode = nodesById.get(edge.sourceId);

      // The incoming index retains only concrete callable sources. This guard
      // keeps the invariant explicit if index construction changes later.
      if (!isConcreteCallable(callerNode)) {
        continue;
      }

      const confidence = getWeakestConfidence(current.pathConfidence, edge.confidence);
      const pathFunctionIds = [edge.sourceId, ...current.pathFunctionIds];
      const caller: ChangeImpactCaller = {
        functionId: edge.sourceId,
        depth: current.depth + 1,
        callsFunctionId: current.functionId,
        callEdgeId: edge.id,
        edgeConfidence: edge.confidence,
        confidence,
        pathFunctionIds,
        name: callerNode.name,
        qualifiedName: callerNode.qualifiedName,
        filePath: callerNode.filePath,
        range: callerNode.range
      };

      callers.push(caller);
      callersByFunctionId.set(caller.functionId, caller);
      visitedFunctionIds.add(caller.functionId);
      queue.push({
        functionId: caller.functionId,
        depth: caller.depth,
        pathFunctionIds,
        pathConfidence: confidence
      });
    }
  }

  return { callers, callersByFunctionId, diagnostics };
}

/** Builds route impacts from selected handler identity, never display labels. */
function createAffectedFlows(
  flows: SemanticFlow[],
  targetFunctionId: string,
  callersByFunctionId: Map<string, ChangeImpactCaller>
): AffectedSemanticFlow[] {
  const affectedFlows: AffectedSemanticFlow[] = [];

  for (const flow of flows) {
    const handler = flow.steps.find((step) =>
      step.kind === "handler"
        && step.resolution === "concrete"
        && step.functionId !== undefined
    );
    const handlerFunctionId = handler?.functionId;

    if (!handlerFunctionId) {
      continue;
    }

    if (handlerFunctionId === targetFunctionId) {
      affectedFlows.push({
        flowId: flow.id,
        entrypointKind: flow.entrypointKind,
        entrypointUnitId: flow.entrypointUnitId,
        routeUnitId: flow.routeUnitId,
        framework: flow.framework,
        name: flow.name,
        handlerFunctionId,
        impactDepth: 0,
        pathFunctionIds: [targetFunctionId],
        confidence: flow.confidence
      });
      continue;
    }

    const caller = callersByFunctionId.get(handlerFunctionId);

    if (!caller) {
      continue;
    }

    affectedFlows.push({
      flowId: flow.id,
      entrypointKind: flow.entrypointKind,
      entrypointUnitId: flow.entrypointUnitId,
      routeUnitId: flow.routeUnitId,
      framework: flow.framework,
      name: flow.name,
      handlerFunctionId,
      impactDepth: caller.depth,
      pathFunctionIds: [...caller.pathFunctionIds],
      confidence: getOptionalWeakestConfidence(flow.confidence, caller.confidence)
    });
  }

  return affectedFlows.sort(compareAffectedFlows);
}

/** Indexes the strongest deterministic call edge for each caller/callee pair. */
function createIncomingCallIndex(
  edges: GraphEdge[],
  nodesById: Map<string, SymbolNode>
): Map<string, GraphEdge[]> {
  const bestEdgesByTargetId = new Map<string, Map<string, GraphEdge>>();

  for (const edge of edges) {
    if (edge.kind !== "calls" || !isConcreteCallable(nodesById.get(edge.sourceId))) {
      continue;
    }

    const edgesBySourceId = bestEdgesByTargetId.get(edge.targetId) ?? new Map<string, GraphEdge>();
    const current = edgesBySourceId.get(edge.sourceId);

    if (!current || compareDuplicateCallEdges(edge, current) < 0) {
      edgesBySourceId.set(edge.sourceId, edge);
    }

    bestEdgesByTargetId.set(edge.targetId, edgesBySourceId);
  }

  const incomingCallsByTargetId = new Map<string, GraphEdge[]>();

  for (const [targetId, edgesBySourceId] of bestEdgesByTargetId) {
    incomingCallsByTargetId.set(
      targetId,
      [...edgesBySourceId.values()].sort((left, right) =>
        compareIncomingCallEdges(left, right, nodesById)
      )
    );
  }

  return incomingCallsByTargetId;
}

/** Filters already represented identities while retaining unresolved edges. */
function getUnvisitedConcreteIncoming(
  targetFunctionId: string,
  incomingCallsByTargetId: Map<string, GraphEdge[]>,
  nodesById: Map<string, SymbolNode>,
  visitedFunctionIds: Set<string>
): GraphEdge[] {
  return (incomingCallsByTargetId.get(targetFunctionId) ?? []).filter((edge) =>
    !visitedFunctionIds.has(edge.sourceId) && isConcreteCallable(nodesById.get(edge.sourceId))
  );
}

/** Collects known frontier IDs when the global caller budget is exhausted. */
function collectKnownOmittedFunctionIds(
  remainingIncoming: GraphEdge[],
  queuedItems: TraversalItem[],
  incomingCallsByTargetId: Map<string, GraphEdge[]>,
  nodesById: Map<string, SymbolNode>,
  visitedFunctionIds: Set<string>
): string[] {
  const omittedFunctionIds = remainingIncoming.map((edge) => edge.sourceId);

  for (const item of queuedItems) {
    const incoming = getUnvisitedConcreteIncoming(
      item.functionId,
      incomingCallsByTargetId,
      nodesById,
      visitedFunctionIds
    );
    omittedFunctionIds.push(...incoming.map((edge) => edge.sourceId));
  }

  return uniqueSortedStrings(omittedFunctionIds);
}

/** Creates one normalized traversal-limit diagnostic. */
function createLimitDiagnostic(
  reason: ChangeImpactDiagnostic["reason"],
  message: string,
  sourceFunctionId: string,
  omittedFunctionIds: string[],
  limit: number
): ChangeImpactDiagnostic {
  return {
    reason,
    message,
    sourceFunctionId,
    omittedFunctionIds: uniqueSortedStrings(omittedFunctionIds),
    limit
  };
}

/** Selects one deterministic record for duplicate graph node identities. */
function createNodeIndex(nodes: SymbolNode[]): Map<string, SymbolNode> {
  const nodesById = new Map<string, SymbolNode>();

  for (const node of nodes) {
    const current = nodesById.get(node.id);

    if (!current || compareSymbolNodes(node, current) < 0) {
      nodesById.set(node.id, node);
    }
  }

  return nodesById;
}

/** Only concrete function-like symbols can be callers in reverse impact. */
function isConcreteCallable(node: SymbolNode | undefined): node is SymbolNode {
  return node?.kind === "function" || node?.kind === "method" || node?.kind === "constructor";
}

/** Normalizes public bounds to finite non-negative integer values. */
function normalizeBounds(options: AnalyzeChangeImpactOptions): TraversalBounds {
  return {
    maxDepth: normalizeLimit(options.maxDepth, DEFAULT_MAX_DEPTH),
    maxSteps: normalizeLimit(options.maxSteps, DEFAULT_MAX_STEPS)
  };
}

/** Falls back for non-finite values and clamps negative limits to zero. */
function normalizeLimit(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.floor(value));
}

/** Keeps the stronger edge when the same caller/callee pair is duplicated. */
function compareDuplicateCallEdges(left: GraphEdge, right: GraphEdge): number {
  return compareConfidence(left.confidence, right.confidence)
    || compareText(left.filePath, right.filePath)
    || compareOptionalRanges(left.range, right.range)
    || compareText(left.id, right.id);
}

/** Orders callers by concrete source position and stable edge identity. */
function compareIncomingCallEdges(
  left: GraphEdge,
  right: GraphEdge,
  nodesById: Map<string, SymbolNode>
): number {
  const leftNode = nodesById.get(left.sourceId);
  const rightNode = nodesById.get(right.sourceId);

  return compareOptionalSymbolNodes(leftNode, rightNode)
    || compareText(left.sourceId, right.sourceId)
    || compareConfidence(left.confidence, right.confidence)
    || compareText(left.filePath, right.filePath)
    || compareOptionalRanges(left.range, right.range)
    || compareText(left.id, right.id);
}

/** Orders affected entrypoints by impact distance, then stable source identity. */
function compareAffectedFlows(left: AffectedSemanticFlow, right: AffectedSemanticFlow): number {
  return left.impactDepth - right.impactDepth
    || compareText(left.framework, right.framework)
    || compareText(left.name, right.name)
    || compareText(left.entrypointUnitId, right.entrypointUnitId)
    || compareText(left.flowId, right.flowId);
}

/** Orders known symbol records by source position and declared identity. */
function compareSymbolNodes(left: SymbolNode, right: SymbolNode): number {
  return compareText(left.filePath, right.filePath)
    || compareRanges(left.range, right.range)
    || compareText(left.qualifiedName, right.qualifiedName)
    || compareText(left.name, right.name)
    || compareText(left.id, right.id);
}

/** Places known source nodes before absent records. */
function compareOptionalSymbolNodes(
  left: SymbolNode | undefined,
  right: SymbolNode | undefined
): number {
  if (!left && !right) {
    return 0;
  }

  if (!left) {
    return 1;
  }

  if (!right) {
    return -1;
  }

  return compareSymbolNodes(left, right);
}

/** Orders required source ranges by all four coordinates. */
function compareRanges(left: SourceRange, right: SourceRange): number {
  return left.startLine - right.startLine
    || left.startCharacter - right.startCharacter
    || left.endLine - right.endLine
    || left.endCharacter - right.endCharacter;
}

/** Orders optional graph-edge ranges after present locations. */
function compareOptionalRanges(
  left: SourceRange | undefined,
  right: SourceRange | undefined
): number {
  if (!left && !right) {
    return 0;
  }

  if (!left) {
    return 1;
  }

  if (!right) {
    return -1;
  }

  return compareRanges(left, right);
}

/** Returns the weaker confidence from an existing path and one added edge. */
function getWeakestConfidence(
  pathConfidence: EdgeConfidence | undefined,
  edgeConfidence: EdgeConfidence
): EdgeConfidence {
  if (!pathConfidence) {
    return edgeConfidence;
  }

  return CONFIDENCE_RANK[pathConfidence] >= CONFIDENCE_RANK[edgeConfidence]
    ? pathConfidence
    : edgeConfidence;
}

/** Combines optional route confidence with a known reverse-call confidence. */
function getOptionalWeakestConfidence(
  routeConfidence: EdgeConfidence | undefined,
  pathConfidence: EdgeConfidence
): EdgeConfidence {
  return routeConfidence
    ? getWeakestConfidence(routeConfidence, pathConfidence)
    : pathConfidence;
}

/** Orders confidence from strongest to weakest. */
function compareConfidence(left: EdgeConfidence, right: EdgeConfidence): number {
  return CONFIDENCE_RANK[left] - CONFIDENCE_RANK[right];
}

/** Creates a sorted distinct string array for stable diagnostics. */
function uniqueSortedStrings(values: string[]): string[] {
  return [...new Set(values)].sort(compareText);
}

/** Locale-independent ordering used for deterministic domain output. */
function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}
