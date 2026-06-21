/**
 * Host-side Function Explorer index built from the normalized ProjectGraph.
 *
 * This module extracts callable records, preserves external and unresolved call
 * targets, builds direct caller/callee indexes, and projects sidebar-compatible
 * rows without depending on Webview modules.
 */

import type { AnalysisDiagnostic, EdgeConfidence, GraphEdge, ProjectGraph, SourceRange, SymbolNode } from "../shared/types";

/** Default inventory payload cap used when callers do not request a limit. */
export const DEFAULT_FUNCTION_INDEX_INVENTORY_LIMIT = 250;

export type FunctionIndexNodeKind = "function" | "method" | "constructor" | "external" | "unresolved";
export type FunctionIndexRole = "entrypoint" | "utility" | "external" | "unresolved" | "unknown";
export type FunctionIndexTag = "externalCall" | "unresolvedCall" | "leaf" | "sharedUtility";

/** Direct-call metrics stored for each real, external, or unresolved callable. */
export type FunctionIndexMetrics = {
  directCallerCount: number; directCalleeCount: number; reachableEntrypointCount: number;
  unresolvedCallCount: number; externalCallCount: number;
};

/** Derived callable record used by host-side function views and direct indexes. */
export type FunctionIndexNode = {
  id: string; symbolId: string; kind: FunctionIndexNodeKind; name: string; qualifiedName: string;
  filePath: string; range?: SourceRange; role: FunctionIndexRole; tags: FunctionIndexTag[];
  metrics: FunctionIndexMetrics; confidence: EdgeConfidence;
};

/** Collapsed direct caller/callee relation keyed by the related callable id. */
export type FunctionIndexRelation = {
  nodeId: string; symbolId: string; name: string; kind: FunctionIndexNodeKind; filePath: string;
  edgeIds: string[]; callCount: number; confidences: EdgeConfidence[];
};

/** Completeness and coverage counters surfaced by the Function Explorer. */
export type FunctionIndexSummary = {
  graphVersion: string; callableNodeCount: number; callEdgeCount: number; externalCallableCount: number;
  unresolvedCallableCount: number; parserFailureCount: number; excludedFileCount: number;
  hiddenByDefaultViewCount: number; visibleByDefaultViewCount: number; externalCallEdgeCount: number;
  unresolvedCallEdgeCount: number; inferredCallEdgeCount: number;
};

/** Generic tree row shape consumed by the existing sidebar renderer. */
export type FunctionIndexTreeRow = {
  id: string; label: string; name: string; detail: string; kind: string; nodeId?: string;
  depth: number; hasChildren: boolean; expanded: boolean;
};

export type CreateFunctionIndexOptions = {
  expandedTreeIds?: Iterable<string>; includeInventoryRows?: boolean; inventoryLimit?: number;
};

/** Host-side callable index plus row projections for Function Explorer views. */
export type FunctionIndex = {
  graphVersion: string; nodes: FunctionIndexNode[]; nodesById: Map<string, FunctionIndexNode>;
  callersByNodeId: Map<string, FunctionIndexRelation[]>; calleesByNodeId: Map<string, FunctionIndexRelation[]>;
  metricsByNodeId: Map<string, FunctionIndexMetrics>; summary: FunctionIndexSummary;
  flowsRows: FunctionIndexTreeRow[]; inventoryRows: FunctionIndexTreeRow[];
};

type CallableSymbolNode = SymbolNode & { kind: "function" | "method" | "constructor" };
type MutableFunctionIndexNode = FunctionIndexNode;
type FunctionIndexIssueKind = "external" | "unresolved";

type FunctionIndexIssueRelation = {
  kind: FunctionIndexIssueKind; sourceNode?: FunctionIndexNode; sourceLabel: string; targetId: string;
  targetNode?: FunctionIndexNode; targetLabel: string; count: number; confidences: Set<EdgeConfidence>;
};

type FunctionIndexFlowRecord = {
  node: FunctionIndexNode; outgoing: FunctionIndexRelation[]; incomingCallCount: number; outgoingCallCount: number;
};

type FunctionIndexFlowModel = {
  entrypoints: FunctionIndexFlowRecord[]; hotspots: FunctionIndexFlowRecord[]; hotspotCandidateCount: number;
  externalCalls: FunctionIndexIssueRelation[]; unresolvedCalls: FunctionIndexIssueRelation[];
  externalCallCount: number; unresolvedCallCount: number;
};

/**
 * Creates the host-side Function Index from a ProjectGraph without mutating the
 * graph. Construction uses direct edge iteration only; expanded rows never
 * recurse through downstream calls.
 */
export function createFunctionIndex(
  graph: ProjectGraph,
  options: CreateFunctionIndexOptions = {}
): FunctionIndex {
  const graphNodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const callEdges = graph.edges.filter((edge) => edge.kind === "calls");
  const recordsById = createFunctionRecords(graph, graphNodesById, callEdges);
  const callersByNodeId = new Map<string, FunctionIndexRelation[]>();
  const calleesByNodeId = new Map<string, FunctionIndexRelation[]>();

  for (const edge of callEdges) {
    const source = recordsById.get(edge.sourceId);
    const target = getCallTargetRecord(edge, graphNodesById, recordsById);

    if (!source || !target) {
      continue;
    }

    addFunctionRelation(calleesByNodeId, source.id, target, edge);
    addFunctionRelation(callersByNodeId, target.id, source, edge);

    if (target.kind === "external") {
      source.metrics.externalCallCount += 1;
    } else if (target.kind === "unresolved") {
      source.metrics.unresolvedCallCount += 1;
    }
  }

  sortRelationIndex(callersByNodeId);
  sortRelationIndex(calleesByNodeId);
  finalizeFunctionRecords(recordsById, callersByNodeId, calleesByNodeId);

  const nodes = Array.from(recordsById.values()).sort(compareFunctionIndexNodes);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const metricsByNodeId = new Map(nodes.map((node) => [node.id, node.metrics]));
  const summary = createFunctionIndexSummary(graph, callEdges, nodes);
  const inventoryLimit = normalizeInventoryLimit(options.inventoryLimit);
  const flowModel = createFunctionIndexFlowModel(
    nodes,
    nodesById,
    graphNodesById,
    callersByNodeId,
    calleesByNodeId,
    callEdges
  );

  return {
    graphVersion: graph.version,
    nodes,
    nodesById,
    callersByNodeId,
    calleesByNodeId,
    metricsByNodeId,
    summary,
    flowsRows: createFunctionIndexFlowRows(
      graph,
      nodes,
      flowModel,
      new Set(options.expandedTreeIds ?? []),
      inventoryLimit
    ),
    inventoryRows: options.includeInventoryRows === false
      ? []
      : createAllFunctionsInventoryRows(nodes, 0, "function-inventory:", inventoryLimit)
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

    if (target?.kind === "external" && !recordsById.has(target.id)) {
      recordsById.set(target.id, createRecordFromExternalNode(target));
    } else if (!target) {
      const unresolvedId = getUnresolvedRecordId(edge);

      if (!recordsById.has(unresolvedId)) {
        recordsById.set(unresolvedId, createRecordFromMissingTarget(edge));
      }
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

function createRecordFromMissingTarget(edge: GraphEdge): MutableFunctionIndexNode {
  const name = getMissingTargetName(edge);

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
  return target ? recordsById.get(target.id) : recordsById.get(getUnresolvedRecordId(edge));
}

function addFunctionRelation(
  relationsByOwnerId: Map<string, FunctionIndexRelation[]>,
  ownerId: string,
  relatedNode: FunctionIndexNode,
  edge: GraphEdge
): void {
  const relations = relationsByOwnerId.get(ownerId) ?? [];
  const existing = relations.find((relation) => relation.nodeId === relatedNode.id);

  if (existing) {
    existing.edgeIds.push(edge.id);
    existing.callCount += 1;

    if (!existing.confidences.includes(edge.confidence)) {
      existing.confidences.push(edge.confidence);
    }
  } else {
    relations.push({
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

function sortRelationIndex(relationsByOwnerId: Map<string, FunctionIndexRelation[]>): void {
  for (const relations of relationsByOwnerId.values()) {
    for (const relation of relations) {
      relation.edgeIds.sort();
      relation.confidences.sort();
    }

    relations.sort(compareFunctionRelations);
  }
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
  const graphNodeIds = new Set(graph.nodes.map((node) => node.id));
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
    externalCallEdgeCount: callEdges.filter((edge) => graphNodesById.get(edge.targetId)?.kind === "external").length,
    unresolvedCallEdgeCount: callEdges.filter((edge) => !graphNodeIds.has(edge.targetId)).length,
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

    if (targetNode?.kind === "external") {
      externalCallCount += 1;
      addFunctionIssueRelation(externalCallsByKey, "external", edge, nodesById);
    } else if (!graphTargetNode) {
      unresolvedCallCount += 1;
      addFunctionIssueRelation(unresolvedCallsByKey, "unresolved", edge, nodesById);
    }
  }

  const entrypoints = records
    .filter((record) => record.incomingCallCount === 0 && record.outgoingCallCount > 0)
    .sort(compareFunctionFlowRecordsByPosition);
  const hotspotCandidates = records
    .filter((record) => getFunctionFlowHotspotScore(record) > 1)
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

/** Builds Function Flows rows from top-level sections and expanded branch ids. */
function createFunctionIndexFlowRows(
  graph: ProjectGraph,
  nodes: FunctionIndexNode[],
  flowModel: FunctionIndexFlowModel,
  expandedTreeIds: Set<string>,
  inventoryLimit: number
): FunctionIndexTreeRow[] {
  const rows: FunctionIndexTreeRow[] = [];
  const entrypointsId = getFunctionFlowSectionId("entrypoints");
  const hotspotsId = getFunctionFlowSectionId("hotspots");
  const issuesId = getFunctionFlowSectionId("unresolved-external");
  const allFunctionsId = getFunctionFlowSectionId("all-functions");

  if (appendSection(rows, expandedTreeIds, entrypointsId, "Entrypoints", flowModel.entrypoints.length + " roots", flowModel.entrypoints.length > 0)) {
    for (const record of flowModel.entrypoints) {
      appendEntrypointRow(graph, expandedTreeIds, entrypointsId, record, rows);
    }
  }

  if (appendSection(rows, expandedTreeIds, hotspotsId, "Hotspots", flowModel.hotspots.length + " shown / " + flowModel.hotspotCandidateCount + " candidates", flowModel.hotspots.length > 0)) {
    for (const record of flowModel.hotspots) {
      rows.push({
        id: hotspotsId + ":hotspot:" + record.node.id,
        label: getFunctionDisplayName(record.node),
        name: getFunctionDisplayName(record.node),
        detail: getFunctionFlowHotspotDetail(record),
        kind: "semantic",
        nodeId: record.node.id,
        depth: 1,
        hasChildren: false,
        expanded: false
      });
    }
  }

  if (appendSection(rows, expandedTreeIds, issuesId, "Unresolved / External", flowModel.unresolvedCallCount + " unresolved / " + flowModel.externalCallCount + " external", flowModel.unresolvedCalls.length > 0 || flowModel.externalCalls.length > 0)) {
    appendIssueBucket(graph, expandedTreeIds, issuesId, "Unresolved calls", "unresolved", flowModel.unresolvedCalls, rows);
    appendIssueBucket(graph, expandedTreeIds, issuesId, "External dependencies", "external", flowModel.externalCalls, rows);
  }

  if (appendSection(rows, expandedTreeIds, allFunctionsId, "All Functions", nodes.length + " callable functions", true)) {
    rows.push(...createAllFunctionsInventoryRows(nodes, 1, allFunctionsId + ":function:", inventoryLimit));
  }

  return rows;
}

function appendSection(
  rows: FunctionIndexTreeRow[],
  expandedTreeIds: Set<string>,
  sectionId: string,
  label: string,
  detail: string,
  hasChildren: boolean
): boolean {
  const expanded = hasChildren && expandedTreeIds.has(sectionId);
  rows.push({ id: sectionId, label, name: label, detail, kind: "semantic", depth: 0, hasChildren, expanded });
  return expanded;
}

function appendEntrypointRow(
  graph: ProjectGraph,
  expandedTreeIds: Set<string>,
  parentTreeId: string,
  record: FunctionIndexFlowRecord,
  rows: FunctionIndexTreeRow[]
): void {
  const name = getFunctionDisplayName(record.node);
  const rowId = parentTreeId + ":entrypoint:" + record.node.id;
  const hasChildren = record.outgoing.length > 0;
  const expanded = hasChildren && expandedTreeIds.has(rowId);

  rows.push({
    id: rowId,
    label: name,
    name,
    detail: record.node.kind + " / " + record.outgoingCallCount + " direct calls",
    kind: "semantic",
    nodeId: record.node.id,
    depth: 1,
    hasChildren,
    expanded
  });

  if (expanded) {
    for (const relation of record.outgoing) {
      appendCalleeRow(graph, rowId, relation, rows);
    }
  }
}

function appendCalleeRow(
  graph: ProjectGraph,
  parentTreeId: string,
  relation: FunctionIndexRelation,
  rows: FunctionIndexTreeRow[]
): void {
  const kind = getRelationRowKind(relation);
  rows.push({
    id: parentTreeId + ":callee:" + relation.nodeId,
    label: relation.name,
    name: relation.name,
    detail: getFunctionFlowRelationDetail(graph, relation),
    kind,
    nodeId: kind === "semantic" ? relation.symbolId : undefined,
    depth: 2,
    hasChildren: false,
    expanded: false
  });
}

function appendIssueBucket(
  graph: ProjectGraph,
  expandedTreeIds: Set<string>,
  parentTreeId: string,
  label: string,
  kind: FunctionIndexIssueKind,
  issues: FunctionIndexIssueRelation[],
  rows: FunctionIndexTreeRow[]
): void {
  if (issues.length === 0) {
    return;
  }

  const rowId = parentTreeId + ":" + kind;
  const expanded = expandedTreeIds.has(rowId);
  const callCount = issues.reduce((total, issue) => total + issue.count, 0);
  rows.push({
    id: rowId,
    label,
    name: label,
    detail: callCount + " calls / " + issues.length + " targets",
    kind,
    depth: 1,
    hasChildren: true,
    expanded
  });

  if (expanded) {
    for (const issue of issues) {
      appendIssueRow(graph, rowId, issue, rows);
    }
  }
}

function appendIssueRow(
  graph: ProjectGraph,
  parentTreeId: string,
  issue: FunctionIndexIssueRelation,
  rows: FunctionIndexTreeRow[]
): void {
  rows.push({
    id: parentTreeId + ":call:" + String(issue.sourceNode?.id ?? "unknown") + ":" + issue.targetId,
    label: issue.sourceLabel + " -> " + issue.targetLabel,
    name: issue.targetLabel,
    detail: getFunctionFlowIssueDetail(graph, issue),
    kind: issue.kind,
    nodeId: issue.targetNode && isRealFunctionIndexNode(issue.targetNode) ? issue.targetNode.symbolId : undefined,
    depth: 2,
    hasChildren: false,
    expanded: false
  });
}

/** Creates flat All Functions rows with the same field names as sidebar rows. */
function createAllFunctionsInventoryRows(
  nodes: FunctionIndexNode[],
  depth: number,
  idPrefix: string,
  limit: number
): FunctionIndexTreeRow[] {
  return [...nodes]
    .sort(compareFunctionIndexNodes)
    .slice(0, limit)
    .map((node) => ({
      id: idPrefix + node.id,
      label: getFunctionDisplayName(node),
      name: node.name || getFunctionDisplayName(node),
      detail: getFunctionInventoryDetail(node),
      kind: getInventoryRowKind(node),
      nodeId: node.kind === "external" || node.kind === "unresolved" ? undefined : node.symbolId,
      depth,
      hasChildren: false,
      expanded: false
    }));
}

function normalizeInventoryLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_FUNCTION_INDEX_INVENTORY_LIMIT;
  }

  return Math.max(0, Math.floor(limit));
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
  return getFunctionFlowHotspotScore(right) - getFunctionFlowHotspotScore(left) ||
    right.incomingCallCount + right.outgoingCallCount - (left.incomingCallCount + left.outgoingCallCount) ||
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

function getFunctionInventoryDetail(node: FunctionIndexNode): string {
  const tags = node.tags.length > 0 ? " / " + node.tags.join(",") : "";

  return node.role +
    " / callers " +
    node.metrics.directCallerCount +
    " / callees " +
    node.metrics.directCalleeCount +
    " / unresolved " +
    node.metrics.unresolvedCallCount +
    " / external " +
    node.metrics.externalCallCount +
    tags;
}

function getInventoryRowKind(node: FunctionIndexNode): string {
  return node.kind === "external" || node.kind === "unresolved" ? node.kind : "semantic";
}

function getRelationRowKind(relation: FunctionIndexRelation): string {
  return relation.kind === "external" || relation.kind === "unresolved" ? relation.kind : "semantic";
}

function getFunctionFlowSectionId(sectionName: string): string {
  return "function-flows:" + sectionName;
}

function getFunctionFlowHotspotLimit(): number {
  return 8;
}

function getFunctionFlowHotspotScore(record: FunctionIndexFlowRecord): number {
  return Math.max(record.incomingCallCount, record.outgoingCallCount);
}

function getFunctionFlowHotspotDetail(record: FunctionIndexFlowRecord): string {
  const role = record.incomingCallCount === record.outgoingCallCount
    ? "high fan-in/out"
    : record.incomingCallCount > record.outgoingCallCount ? "high fan-in" : "high fan-out";
  return role + " / fan-in " + record.incomingCallCount + " / fan-out " + record.outgoingCallCount;
}

function getFunctionFlowRelationDetail(graph: ProjectGraph, relation: FunctionIndexRelation): string {
  const location = relation.kind === "external"
    ? "external"
    : relation.kind === "unresolved" ? "missing target" : getFunctionFlowRelativePath(graph, relation.filePath);
  const count = relation.callCount > 1 ? " x" + relation.callCount : "";
  return location + count + " / " + getFunctionFlowConfidenceText(relation.confidences);
}

function getFunctionFlowIssueDetail(graph: ProjectGraph, issue: FunctionIndexIssueRelation): string {
  const location = issue.sourceNode ? getFunctionFlowRelativePath(graph, issue.sourceNode.filePath) : "unknown source";
  const count = issue.count > 1 ? " x" + issue.count : "";
  return location + count + " / " + getFunctionFlowConfidenceText(Array.from(issue.confidences));
}

function getFunctionFlowRelativePath(graph: ProjectGraph, filePath: string): string {
  if (!filePath) {
    return "external";
  }

  const workspaceRoot = graph.workspaceRoot.replace(/\\/g, "/");
  const normalized = filePath.replace(/\\/g, "/");

  if (normalized.startsWith(workspaceRoot + "/")) {
    return normalized.slice(workspaceRoot.length + 1);
  }

  return normalized.split("/").slice(-3).join("/");
}

function getFunctionFlowConfidenceText(confidences: EdgeConfidence[]): string {
  return [...confidences].sort().join(",");
}
