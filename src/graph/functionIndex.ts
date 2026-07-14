/**
 * Host-side Function Explorer index built from the normalized ProjectGraph.
 *
 * This module extracts callable records, preserves external and unresolved call
 * targets, and builds reusable graph-wide indexes. Request-local row projection
 * lives in functionIndexProjection so expansion never rebuilds this core.
 */

import type { AnalysisDiagnostic, GraphEdge, ProjectGraph, SymbolNode } from "../shared/types";
import {
  getFunctionHotspotScore
} from "./functionHotspotRanking";
import {
  projectFunctionIndexRows,
  type FunctionIndexProjectionCore
} from "./functionIndexProjection";
import type {
  CreateFunctionIndexOptions,
  FunctionIndex,
  FunctionIndexFlowModel,
  FunctionIndexFlowRecord,
  FunctionIndexIssueKind,
  FunctionIndexIssueRelation,
  FunctionIndexMetrics,
  FunctionIndexNode,
  FunctionIndexProjector,
  FunctionIndexRelation,
  FunctionIndexRole,
  FunctionIndexSummary,
  FunctionIndexTag
} from "./functionIndexTypes";

export { DEFAULT_FUNCTION_INDEX_INVENTORY_LIMIT } from "./functionIndexProjection";
export type {
  CreateFunctionIndexOptions,
  FunctionIndex,
  FunctionIndexFlowModel,
  FunctionIndexFlowRecord,
  FunctionIndexIssueKind,
  FunctionIndexIssueRelation,
  FunctionIndexMetrics,
  FunctionIndexNode,
  FunctionIndexNodeKind,
  FunctionIndexProjector,
  FunctionIndexRelation,
  FunctionIndexRole,
  FunctionIndexSummary,
  FunctionIndexTag,
  FunctionIndexTreeRow
} from "./functionIndexTypes";

type CallableSymbolNode = SymbolNode & { kind: "function" | "method" | "constructor" };
type MutableFunctionIndexNode = FunctionIndexNode;
type MutableFunctionRelationIndex = Map<string, Map<string, FunctionIndexRelation>>;

/**
 * Creates the host-side Function Index from a ProjectGraph without mutating the
 * graph. Construction uses direct edge iteration only; expanded rows never
 * recurse through downstream calls.
 */
export function createFunctionIndex(
  graph: ProjectGraph,
  options: CreateFunctionIndexOptions = {}
): FunctionIndex {
  return createFunctionIndexProjector(graph).project(options);
}

/**
 * Builds graph-wide nodes, maps, metrics, and flow ranking exactly once.
 * Callers may retain the returned projector across expansion requests.
 */
export function createFunctionIndexProjector(graph: ProjectGraph): FunctionIndexProjector {
  const graphNodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const callEdges = graph.edges.filter((edge) => edge.kind === "calls");
  const recordsById = createFunctionRecords(graph, graphNodesById, callEdges);
  const mutableCallersByNodeId: MutableFunctionRelationIndex = new Map();
  const mutableCalleesByNodeId: MutableFunctionRelationIndex = new Map();

  for (const edge of callEdges) {
    const source = recordsById.get(edge.sourceId);
    const target = getCallTargetRecord(edge, graphNodesById, recordsById);

    if (!source || !target) {
      continue;
    }

    addFunctionRelation(mutableCalleesByNodeId, source.id, target, edge);
    addFunctionRelation(mutableCallersByNodeId, target.id, source, edge);

    if (target.kind === "external") {
      source.metrics.externalCallCount += 1;
    } else if (target.kind === "unresolved") {
      source.metrics.unresolvedCallCount += 1;
    }
  }

  const callersByNodeId = finalizeFunctionRelationIndex(mutableCallersByNodeId);
  const calleesByNodeId = finalizeFunctionRelationIndex(mutableCalleesByNodeId);
  finalizeFunctionRecords(recordsById, callersByNodeId, calleesByNodeId);

  const nodes = Array.from(recordsById.values()).sort(compareFunctionIndexNodes);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const metricsByNodeId = new Map(nodes.map((node) => [node.id, node.metrics]));
  const summary = createFunctionIndexSummary(graph, callEdges, nodes);
  const flowModel = createFunctionIndexFlowModel(
    nodes,
    nodesById,
    graphNodesById,
    callersByNodeId,
    calleesByNodeId,
    callEdges
  );

  const core = {
    graphVersion: graph.version,
    nodes,
    nodesById,
    callersByNodeId,
    calleesByNodeId,
    metricsByNodeId,
    summary
  };
  const projectionCore: FunctionIndexProjectionCore = {
    graph,
    nodes,
    flowModel
  };

  return {
    graphVersion: graph.version,
    getNodes(): readonly FunctionIndexNode[] {
      return nodes;
    },
    project(projectOptions: CreateFunctionIndexOptions = {}): FunctionIndex {
      return {
        ...core,
        ...projectFunctionIndexRows(projectionCore, projectOptions)
      };
    }
  };
}

/** Creates real callable records plus external and unresolved call targets. */
function createFunctionRecords(
  graph: ProjectGraph,
  graphNodesById: Map<string, SymbolNode>,
  callEdges: GraphEdge[]
): Map<string, MutableFunctionIndexNode> {
  const recordsById = new Map<string, MutableFunctionIndexNode>();

  for (const node of graph.nodes) {
    if (isCallableSymbolNode(node)) {
      recordsById.set(node.id, createRecordFromSymbolNode(node));
    }
  }

  for (const edge of callEdges) {
    const target = graphNodesById.get(edge.targetId);

    if (isUnresolvedCallEdge(edge, target)) {
      const unresolvedId = getUnresolvedRecordId(edge);

      if (!recordsById.has(unresolvedId)) {
        recordsById.set(unresolvedId, createRecordFromMissingTarget(edge, target));
      }
    } else if (target?.kind === "external" && !recordsById.has(target.id)) {
      recordsById.set(target.id, createRecordFromExternalNode(target));
    }
  }

  return recordsById;
}

function createEmptyFunctionIndexMetrics(): FunctionIndexMetrics {
  return { directCallerCount: 0, directCalleeCount: 0, reachableEntrypointCount: 0, unresolvedCallCount: 0, externalCallCount: 0 };
}

function isCallableSymbolNode(node: SymbolNode): node is CallableSymbolNode {
  return node.kind === "function" || node.kind === "method" || node.kind === "constructor";
}

function createRecordFromSymbolNode(node: CallableSymbolNode): MutableFunctionIndexNode {
  return {
    id: node.id, symbolId: node.id, kind: node.kind, name: node.name,
    qualifiedName: node.qualifiedName || node.name, filePath: node.filePath, range: node.range,
    role: "unknown", tags: [], metrics: createEmptyFunctionIndexMetrics(),
    confidence: "exact"
  };
}

function createRecordFromExternalNode(node: SymbolNode): MutableFunctionIndexNode {
  return {
    id: node.id, symbolId: node.id, kind: "external", name: node.name || node.qualifiedName || "external",
    qualifiedName: node.qualifiedName || node.name || "external", filePath: node.filePath, range: node.range,
    role: "external", tags: [], metrics: createEmptyFunctionIndexMetrics(),
    confidence: "resolved"
  };
}

function createRecordFromMissingTarget(
  edge: GraphEdge,
  placeholder?: SymbolNode
): MutableFunctionIndexNode {
  const name = placeholder?.name || placeholder?.qualifiedName || getMissingTargetName(edge);

  return {
    id: getUnresolvedRecordId(edge), symbolId: edge.targetId, kind: "unresolved", name,
    qualifiedName: "unresolved:" + name, filePath: edge.filePath, range: edge.range,
    role: "unresolved", tags: [], metrics: createEmptyFunctionIndexMetrics(),
    confidence: "unresolved"
  };
}

function getCallTargetRecord(
  edge: GraphEdge,
  graphNodesById: Map<string, SymbolNode>,
  recordsById: Map<string, MutableFunctionIndexNode>
): MutableFunctionIndexNode | undefined {
  const target = graphNodesById.get(edge.targetId);
  return isUnresolvedCallEdge(edge, target)
    ? recordsById.get(getUnresolvedRecordId(edge))
    : target ? recordsById.get(target.id) : undefined;
}

/** Treats analyzer placeholder nodes as unresolved when the edge says so. */
function isUnresolvedCallEdge(edge: GraphEdge, target: SymbolNode | undefined): boolean {
  return edge.confidence === "unresolved" || target === undefined;
}

function addFunctionRelation(
  relationsByOwnerId: MutableFunctionRelationIndex,
  ownerId: string,
  relatedNode: FunctionIndexNode,
  edge: GraphEdge
): void {
  const relations = relationsByOwnerId.get(ownerId) ?? new Map<string, FunctionIndexRelation>();
  const existing = relations.get(relatedNode.id);

  if (existing) {
    existing.edgeIds.push(edge.id);
    existing.callCount += 1;

    if (!existing.confidences.includes(edge.confidence)) {
      existing.confidences.push(edge.confidence);
    }
  } else {
    relations.set(relatedNode.id, {
      nodeId: relatedNode.id,
      symbolId: relatedNode.symbolId,
      name: getFunctionRelationDisplayName(relatedNode),
      kind: relatedNode.kind,
      filePath: relatedNode.filePath,
      edgeIds: [edge.id],
      callCount: 1,
      confidences: [edge.confidence]
    });
  }

  relationsByOwnerId.set(ownerId, relations);
}

/** Freezes O(1)-update relation maps into the public sorted array contract. */
function finalizeFunctionRelationIndex(
  mutableIndex: MutableFunctionRelationIndex
): Map<string, FunctionIndexRelation[]> {
  const finalized = new Map<string, FunctionIndexRelation[]>();

  for (const [ownerId, relationsByTargetId] of mutableIndex) {
    const relations = [...relationsByTargetId.values()];

    for (const relation of relations) {
      relation.edgeIds.sort();
      relation.confidences.sort();
    }

    relations.sort(compareFunctionRelations);
    finalized.set(ownerId, relations);
  }

  return finalized;
}

function finalizeFunctionRecords(
  recordsById: Map<string, MutableFunctionIndexNode>,
  callersByNodeId: Map<string, FunctionIndexRelation[]>,
  calleesByNodeId: Map<string, FunctionIndexRelation[]>
): void {
  for (const record of recordsById.values()) {
    record.metrics.directCallerCount = callersByNodeId.get(record.id)?.length ?? 0;
    record.metrics.directCalleeCount = calleesByNodeId.get(record.id)?.length ?? 0;
    record.role = inferFunctionRole(record);
    record.metrics.reachableEntrypointCount = record.role === "entrypoint" ? 1 : 0;
    record.tags = inferFunctionTags(record);
  }
}

function inferFunctionRole(node: FunctionIndexNode): FunctionIndexRole {
  if (node.kind === "external") {
    return "external";
  }

  if (node.kind === "unresolved") {
    return "unresolved";
  }

  if (node.metrics.directCallerCount === 0 && node.metrics.directCalleeCount > 0) {
    return "entrypoint";
  }

  return node.metrics.directCallerCount > 1 ? "utility" : "unknown";
}

function inferFunctionTags(node: FunctionIndexNode): FunctionIndexTag[] {
  const tags: FunctionIndexTag[] = [];

  if (node.metrics.externalCallCount > 0) {
    tags.push("externalCall");
  }

  if (node.metrics.unresolvedCallCount > 0) {
    tags.push("unresolvedCall");
  }

  if (node.metrics.directCalleeCount === 0) {
    tags.push("leaf");
  }

  if (node.role === "utility") {
    tags.push("sharedUtility");
  }

  return tags;
}

/** Builds completeness counters for the Function Index summary. */
function createFunctionIndexSummary(
  graph: ProjectGraph,
  callEdges: GraphEdge[],
  nodes: FunctionIndexNode[]
): FunctionIndexSummary {
  const graphNodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const visibleByDefaultViewCount = nodes.filter((node) => node.role === "entrypoint").length;

  return {
    graphVersion: graph.version,
    callableNodeCount: nodes.length,
    callEdgeCount: callEdges.length,
    externalCallableCount: nodes.filter((node) => node.kind === "external").length,
    unresolvedCallableCount: nodes.filter((node) => node.kind === "unresolved").length,
    parserFailureCount: countDiagnostics(graph.diagnostics, isParserFailureDiagnostic),
    excludedFileCount: countDiagnostics(graph.diagnostics, isExcludedFileDiagnostic),
    hiddenByDefaultViewCount: Math.max(0, nodes.length - visibleByDefaultViewCount),
    visibleByDefaultViewCount,
    externalCallEdgeCount: callEdges.filter((edge) => {
      const target = graphNodesById.get(edge.targetId);
      return !isUnresolvedCallEdge(edge, target) && target?.kind === "external";
    }).length,
    unresolvedCallEdgeCount: callEdges.filter((edge) =>
      isUnresolvedCallEdge(edge, graphNodesById.get(edge.targetId))
    ).length,
    inferredCallEdgeCount: callEdges.filter((edge) => edge.confidence === "inferred").length
  };
}

function countDiagnostics(
  diagnostics: AnalysisDiagnostic[],
  predicate: (diagnostic: AnalysisDiagnostic) => boolean
): number {
  return diagnostics.reduce((count, diagnostic) => count + (predicate(diagnostic) ? 1 : 0), 0);
}

function isParserFailureDiagnostic(diagnostic: AnalysisDiagnostic): boolean {
  const code = diagnostic.code.toLowerCase();
  const message = diagnostic.message.toLowerCase();
  return code.includes("parse") || code.includes("syntax") || message.includes("parse");
}

function isExcludedFileDiagnostic(diagnostic: AnalysisDiagnostic): boolean {
  const code = diagnostic.code.toLowerCase();
  const message = diagnostic.message.toLowerCase();
  return code.includes("exclude") || code.includes("skip") || message.includes("excluded");
}

/** Creates the direct relationship model that backs Function Flows rows. */
function createFunctionIndexFlowModel(
  nodes: FunctionIndexNode[],
  nodesById: Map<string, FunctionIndexNode>,
  graphNodesById: Map<string, SymbolNode>,
  callersByNodeId: Map<string, FunctionIndexRelation[]>,
  calleesByNodeId: Map<string, FunctionIndexRelation[]>,
  callEdges: GraphEdge[]
): FunctionIndexFlowModel {
  const records = nodes
    .filter(isRealFunctionIndexNode)
    .map((node) => ({
      node,
      outgoing: [...(calleesByNodeId.get(node.id) ?? [])].sort(compareFunctionRelations),
      incomingCallCount: countRelationEdges(callersByNodeId.get(node.id)),
      outgoingCallCount: countRelationEdges(calleesByNodeId.get(node.id))
    }))
    .sort(compareFunctionFlowRecordsByPosition);
  const externalCallsByKey = new Map<string, FunctionIndexIssueRelation>();
  const unresolvedCallsByKey = new Map<string, FunctionIndexIssueRelation>();
  let externalCallCount = 0;
  let unresolvedCallCount = 0;

  for (const edge of callEdges) {
    const graphTargetNode = graphNodesById.get(edge.targetId);
    const targetNode = graphTargetNode ? nodesById.get(graphTargetNode.id) : undefined;

    if (isUnresolvedCallEdge(edge, graphTargetNode)) {
      unresolvedCallCount += 1;
      addFunctionIssueRelation(unresolvedCallsByKey, "unresolved", edge, nodesById);
    } else if (targetNode?.kind === "external") {
      externalCallCount += 1;
      addFunctionIssueRelation(externalCallsByKey, "external", edge, nodesById);
    }
  }

  const entrypoints = records
    .filter((record) => record.incomingCallCount === 0 && record.outgoingCallCount > 0)
    .sort(compareFunctionFlowRecordsByPosition);
  const hotspotCandidates = records
    .filter((record) => getFunctionHotspotScore(record.node) > 1)
    .sort(compareFunctionFlowHotspotRecords);

  return {
    entrypoints,
    hotspots: hotspotCandidates.slice(0, getFunctionFlowHotspotLimit()),
    hotspotCandidateCount: hotspotCandidates.length,
    externalCalls: Array.from(externalCallsByKey.values()).sort(compareFunctionIssueRelations),
    unresolvedCalls: Array.from(unresolvedCallsByKey.values()).sort(compareFunctionIssueRelations),
    externalCallCount,
    unresolvedCallCount
  };
}

function isRealFunctionIndexNode(node: FunctionIndexNode): boolean {
  return node.kind === "function" || node.kind === "method" || node.kind === "constructor";
}

function countRelationEdges(relations: FunctionIndexRelation[] | undefined): number {
  return relations?.reduce((total, relation) => total + relation.callCount, 0) ?? 0;
}

function addFunctionIssueRelation(
  issuesByKey: Map<string, FunctionIndexIssueRelation>,
  kind: FunctionIndexIssueKind,
  edge: GraphEdge,
  nodesById: Map<string, FunctionIndexNode>
): void {
  const sourceNode = nodesById.get(edge.sourceId);
  const targetNode = kind === "unresolved" ? nodesById.get(getUnresolvedRecordId(edge)) : nodesById.get(edge.targetId);
  const sourceId = sourceNode?.id ?? edge.sourceId;
  const targetId = targetNode?.id ?? edge.targetId;
  const key = kind + ":" + sourceId + ":" + targetId;
  const existing = issuesByKey.get(key);

  if (existing) {
    existing.count += 1;
    existing.confidences.add(edge.confidence);
    return;
  }

  issuesByKey.set(key, {
    kind,
    sourceNode,
    sourceLabel: sourceNode ? getFunctionDisplayName(sourceNode) : edge.sourceId,
    targetId,
    targetNode,
    targetLabel: targetNode ? getFunctionRelationDisplayName(targetNode) : getMissingTargetName(edge),
    count: 1,
    confidences: new Set([edge.confidence])
  });
}

function compareFunctionIndexNodes(left: FunctionIndexNode, right: FunctionIndexNode): number {
  return String(left.filePath).localeCompare(String(right.filePath)) ||
    Number(left.range?.startLine ?? 0) - Number(right.range?.startLine ?? 0) ||
    getFunctionDisplayName(left).localeCompare(getFunctionDisplayName(right)) ||
    left.id.localeCompare(right.id);
}

function compareFunctionRelations(left: FunctionIndexRelation, right: FunctionIndexRelation): number {
  return left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name) || left.nodeId.localeCompare(right.nodeId);
}

function compareFunctionFlowRecordsByPosition(
  left: FunctionIndexFlowRecord,
  right: FunctionIndexFlowRecord
): number {
  return compareFunctionIndexNodes(left.node, right.node);
}

function compareFunctionIssueRelations(
  left: FunctionIndexIssueRelation,
  right: FunctionIndexIssueRelation
): number {
  return left.sourceLabel.localeCompare(right.sourceLabel) ||
    left.targetLabel.localeCompare(right.targetLabel) ||
    left.kind.localeCompare(right.kind);
}

function compareFunctionFlowHotspotRecords(
  left: FunctionIndexFlowRecord,
  right: FunctionIndexFlowRecord
): number {
  return getFunctionHotspotScore(right.node) - getFunctionHotspotScore(left.node) ||
    right.node.metrics.directCallerCount + right.node.metrics.directCalleeCount
      - (left.node.metrics.directCallerCount + left.node.metrics.directCalleeCount) ||
    compareFunctionFlowRecordsByPosition(left, right);
}

function getUnresolvedRecordId(edge: GraphEdge): string {
  return "unresolved:" + (edge.targetId || edge.id);
}

function getMissingTargetName(edge: GraphEdge): string {
  const metadata = edge.metadata ?? {};
  const callName = metadata.callName;
  const callExpression = metadata.callExpression;

  if (typeof callName === "string" && callName.trim()) {
    return callName.trim();
  }

  if (typeof callExpression === "string" && callExpression.trim()) {
    return callExpression.trim();
  }

  return edge.targetId || "unresolved call";
}

function getFunctionDisplayName(node: FunctionIndexNode): string {
  return node.qualifiedName || node.name || node.id;
}

function getFunctionRelationDisplayName(node: FunctionIndexNode): string {
  return node.kind === "unresolved" ? node.name || node.symbolId || node.id : getFunctionDisplayName(node);
}

function getFunctionFlowHotspotLimit(): number {
  return 8;
}
