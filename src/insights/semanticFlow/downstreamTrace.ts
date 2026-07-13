/**
 * Bounded handler-to-callee traversal for entrypoint-centered semantic flows.
 *
 * This internal module owns call-edge indexing, iterative breadth-first
 * traversal, conservative role classification, and limit diagnostics. It does
 * not interpret framework dependency edges as runtime execution order.
 */

import type { FunctionFrameworkSemantic } from "../../graph/functionFrameworkSemantics";
import type {
  EdgeConfidence,
  FrameworkUnit,
  GraphEdge,
  ProjectGraph,
  SymbolNode
} from "../../shared/types";
import type {
  CreateSemanticFlowIndexOptions,
  SemanticFlowCoverageGap,
  SemanticFlowStep,
  SemanticFlowStepRole
} from "./types";

/** Shared indexes and bounds required by one route's downstream traversal. */
export type CallTraversalContext = {
  nodesById: Map<string, SymbolNode>;
  outgoingCallsBySourceId: Map<string, GraphEdge[]>;
  semanticsByFunctionId: Map<string, FunctionFrameworkSemantic[]>;
  bounds: CallTraversalBounds;
};

type CallTraversalBounds = {
  maxDepth: number;
  maxSteps: number;
};

type CallTraversalItem = {
  functionId: string;
  callDepth: number;
};

type DownstreamTrace = {
  steps: SemanticFlowStep[];
  coverageGaps: SemanticFlowCoverageGap[];
};

/** Conservative defaults keep route flows readable on large call graphs. */
const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_MAX_STEPS = 25;

const CONFIDENCE_RANK: Record<EdgeConfidence, number> = {
  exact: 0,
  resolved: 1,
  inferred: 2,
  unresolved: 3
};

/** Builds reusable call indexes once for every route in the graph. */
export function createCallTraversalContext(
  graph: ProjectGraph,
  nodesById: Map<string, SymbolNode>,
  semanticsByFunctionId: Map<string, FunctionFrameworkSemantic[]>,
  options: CreateSemanticFlowIndexOptions
): CallTraversalContext {
  return {
    nodesById,
    outgoingCallsBySourceId: createOutgoingCallIndex(graph.edges, nodesById),
    semanticsByFunctionId,
    bounds: normalizeTraversalBounds(options)
  };
}

/**
 * Traces downstream call edges with an explicit breadth-first queue.
 *
 * A flow-wide visited set makes cycles and converging branches finite. Only
 * graph `calls` edges participate; semantic edges such as `injects` and
 * `usesModel` deliberately remain outside this execution trace.
 */
export function createDownstreamTrace(
  entrypoint: FrameworkUnit,
  handlerFunctionId: string,
  context: CallTraversalContext
): DownstreamTrace {
  const steps: SemanticFlowStep[] = [];
  const coverageGaps: SemanticFlowCoverageGap[] = [];
  const visitedFunctionIds = new Set<string>([handlerFunctionId]);
  const queue: CallTraversalItem[] = [{ functionId: handlerFunctionId, callDepth: 0 }];
  let queueIndex = 0;

  while (queueIndex < queue.length) {
    const current = queue[queueIndex];
    queueIndex += 1;
    const outgoing = getUnvisitedPreservedCalls(current.functionId, context, visitedFunctionIds);

    if (outgoing.length === 0) {
      continue;
    }

    if (current.callDepth >= context.bounds.maxDepth) {
      coverageGaps.push(createLimitGap(
        entrypoint,
        "depthLimit",
        `Downstream calls from ${current.functionId} exceed max depth ${context.bounds.maxDepth}`,
        current.functionId,
        uniqueSortedStrings(outgoing.map((edge) => edge.targetId)),
        context.bounds.maxDepth
      ));
      continue;
    }

    for (let edgeIndex = 0; edgeIndex < outgoing.length; edgeIndex += 1) {
      const edge = outgoing[edgeIndex];

      if (steps.length >= context.bounds.maxSteps) {
        const omittedFunctionIds = collectKnownOmittedFunctionIds(
          outgoing.slice(edgeIndex),
          queue.slice(queueIndex),
          context,
          visitedFunctionIds
        );
        coverageGaps.push(createLimitGap(
          entrypoint,
          "stepLimit",
          `Downstream flow exceeds max step count ${context.bounds.maxSteps}`,
          current.functionId,
          omittedFunctionIds,
          context.bounds.maxSteps
        ));

        return { steps, coverageGaps };
      }

      const targetNode = context.nodesById.get(edge.targetId);
      const step = createCallStep(edge, targetNode, current.callDepth + 1, context);
      steps.push(step);
      visitedFunctionIds.add(edge.targetId);

      if (step.resolution === "concrete" && isCallableNode(targetNode)) {
        queue.push({ functionId: edge.targetId, callDepth: current.callDepth + 1 });
      }
    }
  }

  return { steps, coverageGaps };
}

/** Creates one source-local diagnostic for a bounded traversal omission. */
function createLimitGap(
  entrypoint: FrameworkUnit,
  reason: "depthLimit" | "stepLimit",
  message: string,
  sourceFunctionId: string,
  omittedFunctionIds: string[],
  limit: number
): SemanticFlowCoverageGap {
  return {
    entrypointUnitId: entrypoint.id,
    routeUnitId: entrypoint.kind === "route" ? entrypoint.id : undefined,
    reason,
    message,
    candidateFunctionIds: [],
    targetFrameworkUnitIds: [],
    sourceFunctionId,
    omittedFunctionIds,
    limit
  };
}

/** Returns deterministic, eligible outgoing calls not already represented. */
function getUnvisitedPreservedCalls(
  sourceFunctionId: string,
  context: CallTraversalContext,
  visitedFunctionIds: Set<string>
): GraphEdge[] {
  return (context.outgoingCallsBySourceId.get(sourceFunctionId) ?? []).filter((edge) =>
    !visitedFunctionIds.has(edge.targetId)
      && isPreservedCallTarget(edge, context.nodesById.get(edge.targetId))
  );
}

/** Collects direct targets known to be omitted when the global step budget ends. */
function collectKnownOmittedFunctionIds(
  remainingOutgoing: GraphEdge[],
  queuedItems: CallTraversalItem[],
  context: CallTraversalContext,
  visitedFunctionIds: Set<string>
): string[] {
  const omittedFunctionIds = remainingOutgoing.map((edge) => edge.targetId);

  for (const item of queuedItems) {
    const outgoing = getUnvisitedPreservedCalls(item.functionId, context, visitedFunctionIds);
    omittedFunctionIds.push(...outgoing.map((edge) => edge.targetId));
  }

  return uniqueSortedStrings(omittedFunctionIds);
}

/** Creates a traceable call step and preserves edge-local unresolved locations. */
function createCallStep(
  edge: GraphEdge,
  targetNode: SymbolNode | undefined,
  callDepth: number,
  context: CallTraversalContext
): SemanticFlowStep {
  const resolution = getCallResolution(edge, targetNode);
  const semantic = resolution === "concrete"
    ? getUniqueFrameworkSemantic(context.semanticsByFunctionId.get(edge.targetId) ?? [])
    : undefined;
  const role = getCallStepRole(resolution, semantic);
  const usesTargetLocation = resolution === "concrete" && targetNode !== undefined;

  return {
    kind: "call",
    depth: callDepth + 1,
    role,
    resolution,
    relation: "calls",
    parentFunctionId: edge.sourceId,
    callEdgeId: edge.id,
    confidence: getCallStepConfidence(edge.confidence, semantic, role),
    frameworkUnitId: semantic?.frameworkUnitId,
    functionId: edge.targetId,
    framework: semantic?.framework,
    unitKind: semantic?.unitKind,
    name: targetNode?.name ?? readCallTargetLabel(edge) ?? edge.targetId,
    qualifiedName: targetNode?.qualifiedName,
    functionName: targetNode?.name,
    functionQualifiedName: targetNode?.qualifiedName,
    filePath: usesTargetLocation ? targetNode.filePath : edge.filePath,
    range: usesTargetLocation ? targetNode.range : edge.range
  };
}

/** Resolves concrete, external, and unresolved call targets without guessing. */
function getCallResolution(
  edge: GraphEdge,
  targetNode: SymbolNode | undefined
): SemanticFlowStep["resolution"] {
  if (edge.confidence === "unresolved" || !targetNode) {
    return "unresolved";
  }

  return targetNode.kind === "external" ? "external" : "concrete";
}

/** Assigns a semantic role only from explicit target identity or one clear binding. */
function getCallStepRole(
  resolution: SemanticFlowStep["resolution"],
  semantic: FunctionFrameworkSemantic | undefined
): SemanticFlowStepRole {
  if (resolution === "unresolved") {
    return "unknown";
  }

  if (resolution === "external") {
    return "external";
  }

  return semantic ? mapFrameworkSemanticToStepRole(semantic) : "unknown";
}

/** Preserves the weakest evidence when a semantic role contributes to a step. */
function getCallStepConfidence(
  edgeConfidence: EdgeConfidence,
  semantic: FunctionFrameworkSemantic | undefined,
  role: SemanticFlowStepRole
): EdgeConfidence {
  if (!semantic || role === "unknown") {
    return edgeConfidence;
  }

  const semanticConfidence = semantic.confidence ?? "unresolved";
  return CONFIDENCE_RANK[semanticConfidence] > CONFIDENCE_RANK[edgeConfidence]
    ? semanticConfidence
    : edgeConfidence;
}

/** Returns one framework binding only when all linker output names one identity. */
function getUniqueFrameworkSemantic(
  semantics: FunctionFrameworkSemantic[]
): FunctionFrameworkSemantic | undefined {
  const semanticsByIdentity = new Map<string, FunctionFrameworkSemantic>();

  for (const semantic of semantics) {
    const identity = `${semantic.frameworkUnitId}\u0000${semantic.role}`;
    semanticsByIdentity.set(identity, semantic);
  }

  return semanticsByIdentity.size === 1 ? semanticsByIdentity.values().next().value : undefined;
}

/** Maps the existing framework linker vocabulary into flow-specific roles. */
function mapFrameworkSemanticToStepRole(
  semantic: FunctionFrameworkSemantic
): SemanticFlowStepRole {
  switch (semantic.role) {
    case "resolver":
      return "resolver";
    case "routeHandler":
      return "routeHandler";
    case "controller":
      return "controller";
    case "service":
      return hasSemanticNameAnchor(semantic) ? "service" : "unknown";
    case "repository":
      return hasSemanticNameAnchor(semantic) ? "repository" : "unknown";
    case "modelOperation":
      return hasSemanticNameAnchor(semantic) ? "model" : "unknown";
    default:
      return "unknown";
  }
}

/** Requires an identifier anchor before assigning broad persistence roles. */
function hasSemanticNameAnchor(semantic: FunctionFrameworkSemantic): boolean {
  return semantic.evidence.some((evidence) =>
    evidence.kind === "nameMatch" || evidence.kind === "qualifiedNameMatch"
  );
}

/** Reads a display label only from explicit edge metadata string fields. */
function readCallTargetLabel(edge: GraphEdge): string | undefined {
  const metadata = edge.metadata;

  if (!metadata) {
    return undefined;
  }

  for (const key of ["targetName", "calleeName", "qualifiedName", "name"]) {
    const value = metadata[key];

    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  return undefined;
}

/** Keeps concrete callables plus external or unresolved targets. */
function isPreservedCallTarget(edge: GraphEdge, targetNode: SymbolNode | undefined): boolean {
  return edge.confidence === "unresolved"
    || !targetNode
    || targetNode.kind === "external"
    || isCallableNode(targetNode);
}

/** Narrows a graph node to the concrete callable kinds traversed downstream. */
function isCallableNode(node: SymbolNode | undefined): boolean {
  return node?.kind === "function" || node?.kind === "method" || node?.kind === "constructor";
}

/** Builds a deterministic, source-indexed call edge view with target dedupe. */
function createOutgoingCallIndex(
  edges: GraphEdge[],
  nodesById: Map<string, SymbolNode>
): Map<string, GraphEdge[]> {
  const bestEdgesBySourceId = new Map<string, Map<string, GraphEdge>>();

  for (const edge of edges) {
    if (edge.kind !== "calls") {
      continue;
    }

    const bestEdgesByTargetId = bestEdgesBySourceId.get(edge.sourceId) ?? new Map<string, GraphEdge>();
    const current = bestEdgesByTargetId.get(edge.targetId);

    if (!current || compareCallEdges(edge, current, nodesById) < 0) {
      bestEdgesByTargetId.set(edge.targetId, edge);
    }

    bestEdgesBySourceId.set(edge.sourceId, bestEdgesByTargetId);
  }

  const outgoingCallsBySourceId = new Map<string, GraphEdge[]>();

  for (const [sourceId, bestEdgesByTargetId] of bestEdgesBySourceId) {
    outgoingCallsBySourceId.set(
      sourceId,
      [...bestEdgesByTargetId.values()].sort((left, right) =>
        compareCallEdges(left, right, nodesById)
      )
    );
  }

  return outgoingCallsBySourceId;
}

/** Normalizes user-provided traversal limits to finite non-negative integers. */
function normalizeTraversalBounds(
  options: CreateSemanticFlowIndexOptions
): CallTraversalBounds {
  return {
    maxDepth: normalizeLimit(options.maxDepth, DEFAULT_MAX_DEPTH),
    maxSteps: normalizeLimit(options.maxSteps, DEFAULT_MAX_STEPS)
  };
}

/** Falls back for non-finite limits and clamps negative values to zero. */
function normalizeLimit(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.floor(value));
}

/** Orders deduplicated call targets by source location and stable identity. */
function compareCallEdges(
  left: GraphEdge,
  right: GraphEdge,
  nodesById: Map<string, SymbolNode>
): number {
  const leftNode = nodesById.get(left.targetId);
  const rightNode = nodesById.get(right.targetId);

  return compareOptionalSymbolNodes(leftNode, rightNode)
    || compareText(left.targetId, right.targetId)
    || compareConfidence(left.confidence, right.confidence)
    || compareText(left.filePath, right.filePath)
    || compareOptionalSourceRanges(left.range, right.range)
    || compareText(left.id, right.id);
}

/** Orders known target nodes before missing targets using source coordinates. */
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

  return compareText(left.filePath, right.filePath)
    || compareOptionalSourceRanges(left.range, right.range)
    || compareText(left.qualifiedName, right.qualifiedName)
    || compareText(left.id, right.id);
}

/** Orders optional source ranges by their four source coordinates. */
function compareOptionalSourceRanges(
  left: GraphEdge["range"],
  right: GraphEdge["range"]
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

  return left.startLine - right.startLine
    || left.startCharacter - right.startCharacter
    || left.endLine - right.endLine
    || left.endCharacter - right.endCharacter;
}

/** Orders confidence from strongest to weakest. */
function compareConfidence(left: EdgeConfidence, right: EdgeConfidence): number {
  return CONFIDENCE_RANK[left] - CONFIDENCE_RANK[right];
}

/** Creates a sorted distinct string array for stable public diagnostics. */
function uniqueSortedStrings(values: string[]): string[] {
  return [...new Set(values)].sort(compareText);
}

/** Locale-independent string ordering used for deterministic domain output. */
function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}
