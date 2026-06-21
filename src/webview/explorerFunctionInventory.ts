/**
 * Pure data helpers for the Function Explorer inventory.
 *
 * This module converts a flat ProjectGraph into a complete callable universe:
 * real function-like symbols, external call placeholders, synthetic unresolved
 * targets, direct caller/callee indexes, derived metrics, and inventory rows.
 * It intentionally avoids browser-injected source so the same data foundation
 * can be unit-tested and reused by later lazy Webview views.
 */

import type {
  AnalysisDiagnostic,
  EdgeConfidence,
  GraphEdge,
  ProjectGraph,
  SourceRange,
  SymbolNode
} from "../shared/types";
import type { FunctionCallTreeRow } from "./explorerFunctionCallTree";

/** Function-like node kinds shown in the Function Explorer inventory. */
export type FunctionNodeKind = "function" | "method" | "constructor" | "external" | "unresolved";

/** Phase-one role set inferred from only direct call graph completeness data. */
export type FunctionRole = "entrypoint" | "utility" | "external" | "unresolved" | "unknown";

/** Lightweight tags available before framework and side-effect classifiers exist. */
export type FunctionTag = "externalCall" | "unresolvedCall" | "leaf" | "sharedUtility";

/** Direct metrics required by the FunctionSpec Phase 1 completeness model. */
export type FunctionMetrics = {
  directCallerCount: number;
  directCalleeCount: number;
  reachableEntrypointCount: number;
  unresolvedCallCount: number;
  externalCallCount: number;
};

/** Derived view record for one real, external, or synthetic unresolved callable. */
export type FunctionNodeView = {
  id: string;
  symbolId: string;
  kind: FunctionNodeKind;
  name: string;
  qualifiedName: string;
  filePath: string;
  range?: SourceRange;
  role: FunctionRole;
  tags: FunctionTag[];
  metrics: FunctionMetrics;
  confidence: EdgeConfidence;
};

/** Collapsed direct caller/callee relation keyed by related callable id. */
export type FunctionCallRelation = {
  nodeId: string;
  symbolId: string;
  name: string;
  kind: FunctionNodeKind;
  edgeIds: string[];
  callCount: number;
  confidences: EdgeConfidence[];
};

/** Summary fields surfaced so hidden or unresolved data is explicit. */
export type FunctionUniverseSummary = {
  graphVersion: string;
  callableNodeCount: number;
  callEdgeCount: number;
  externalCallableCount: number;
  unresolvedCallableCount: number;
  parserFailureCount: number;
  excludedFileCount: number;
  hiddenByDefaultViewCount: number;
  visibleByDefaultViewCount: number;
  externalCallEdgeCount: number;
  unresolvedCallEdgeCount: number;
  inferredCallEdgeCount: number;
};

/** Complete callable inventory plus direct relation indexes. */
export type FunctionUniverse = {
  graphVersion: string;
  nodes: FunctionNodeView[];
  nodesById: Map<string, FunctionNodeView>;
  callersByNodeId: Map<string, FunctionCallRelation[]>;
  calleesByNodeId: Map<string, FunctionCallRelation[]>;
  metricsByNodeId: Map<string, FunctionMetrics>;
  summary: FunctionUniverseSummary;
};

/** Options for creating a callable universe from the project graph. */
export type CreateFunctionUniverseOptions = {
  defaultVisibleNodeIds?: Iterable<string>;
};

/** Sort modes supported by the All Functions inventory row helper. */
export type FunctionInventorySortKey = "relevance" | "path" | "name" | "fan-in" | "fan-out" | "unresolved";

/** Filter and presentation options for flat All Functions inventory rows. */
export type AllFunctionsInventoryOptions = {
  query?: string;
  filePath?: string;
  roles?: readonly FunctionRole[];
  includeExternal?: boolean;
  includeUnresolved?: boolean;
  sortBy?: FunctionInventorySortKey;
  depth?: number;
};

/** Internal mutable record used while edge metrics are accumulated. */
type MutableFunctionNodeView = FunctionNodeView;

/** Source graph node narrowed to the callable symbol kinds supported here. */
type CallableSymbolNode = SymbolNode & {
  kind: "function" | "method" | "constructor";
};

/** Returns browser-injected source for Function Universe and inventory rows. */
export function getFunctionInventoryBrowserSource(): string {
  return [
    `const createFunctionUniverse = ${createFunctionUniverse.toString()};`,
    `const createAllFunctionsInventoryRows = ${createAllFunctionsInventoryRows.toString()};`,
    `const createEmptyFunctionMetrics = ${createEmptyFunctionMetrics.toString()};`,
    `const isCallableSymbolNode = ${isCallableSymbolNode.toString()};`,
    `const createRecordFromSymbolNode = ${createRecordFromSymbolNode.toString()};`,
    `const createRecordFromExternalNode = ${createRecordFromExternalNode.toString()};`,
    `const createRecordFromMissingTarget = ${createRecordFromMissingTarget.toString()};`,
    `const getCallTargetRecord = ${getCallTargetRecord.toString()};`,
    `const addFunctionRelation = ${addFunctionRelation.toString()};`,
    `const sortRelationIndex = ${sortRelationIndex.toString()};`,
    `const inferFunctionRole = ${inferFunctionRole.toString()};`,
    `const inferFunctionTags = ${inferFunctionTags.toString()};`,
    `const createFunctionUniverseSummary = ${createFunctionUniverseSummary.toString()};`,
    `const resolveDefaultVisibleNodeIds = ${resolveDefaultVisibleNodeIds.toString()};`,
    `const countDiagnostics = ${countDiagnostics.toString()};`,
    `const isParserFailureDiagnostic = ${isParserFailureDiagnostic.toString()};`,
    `const isExcludedFileDiagnostic = ${isExcludedFileDiagnostic.toString()};`,
    `const countExternalCallEdges = ${countExternalCallEdges.toString()};`,
    `const countMissingTargetCallEdges = ${countMissingTargetCallEdges.toString()};`,
    `const shouldIncludeInventoryNode = ${shouldIncludeInventoryNode.toString()};`,
    `const compareInventoryNodes = ${compareInventoryNodes.toString()};`,
    `const compareByRelevance = ${compareByRelevance.toString()};`,
    `const getFunctionRelevanceScore = ${getFunctionRelevanceScore.toString()};`,
    `const compareFunctionNodeViews = ${compareFunctionNodeViews.toString()};`,
    `const compareFunctionRelations = ${compareFunctionRelations.toString()};`,
    `const getUnresolvedRecordId = ${getUnresolvedRecordId.toString()};`,
    `const getMissingTargetName = ${getMissingTargetName.toString()};`,
    `const getFunctionDisplayName = ${getFunctionDisplayName.toString()};`,
    `const getFunctionInventoryDetail = ${getFunctionInventoryDetail.toString()};`,
    `const getFunctionInventoryRowKind = ${getFunctionInventoryRowKind.toString()};`
  ].join("\n");
}

/** Creates a zeroed metric object for a derived callable record. */
function createEmptyFunctionMetrics(): FunctionMetrics {
  return {
    directCallerCount: 0,
    directCalleeCount: 0,
    reachableEntrypointCount: 0,
    unresolvedCallCount: 0,
    externalCallCount: 0
  };
}

/**
 * Builds the complete callable universe from a ProjectGraph without mutating
 * the graph. The helper preserves unresolved targets as synthetic records so
 * summary counts, source metrics, and inventory rows can explain missing calls.
 */
export function createFunctionUniverse(
  graph: ProjectGraph,
  options: CreateFunctionUniverseOptions = {}
): FunctionUniverse {
  const graphNodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const callEdges = graph.edges.filter((edge) => edge.kind === "calls");
  const recordsById = new Map<string, MutableFunctionNodeView>();

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

  const callersByNodeId = new Map<string, FunctionCallRelation[]>();
  const calleesByNodeId = new Map<string, FunctionCallRelation[]>();

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

  for (const record of recordsById.values()) {
    record.metrics.directCallerCount = callersByNodeId.get(record.id)?.length ?? 0;
    record.metrics.directCalleeCount = calleesByNodeId.get(record.id)?.length ?? 0;
    record.role = inferFunctionRole(record);
    record.metrics.reachableEntrypointCount = record.role === "entrypoint" ? 1 : 0;
    record.tags = inferFunctionTags(record);
  }

  const nodes = Array.from(recordsById.values()).sort(compareFunctionNodeViews);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const metricsByNodeId = new Map(nodes.map((node) => [node.id, node.metrics]));
  const summary = createFunctionUniverseSummary(graph, callEdges, nodes, options);

  return {
    graphVersion: graph.version,
    nodes,
    nodesById,
    callersByNodeId,
    calleesByNodeId,
    metricsByNodeId,
    summary
  };
}

/**
 * Creates flat All Functions rows that match the existing sidebar tree row
 * shape. Rows are deterministic and remain leaf rows; later virtual-list code
 * can chunk this array without recomputing graph completeness data.
 */
export function createAllFunctionsInventoryRows(
  universe: FunctionUniverse,
  options: AllFunctionsInventoryOptions = {}
): FunctionCallTreeRow[] {
  const depth = options.depth ?? 0;

  return universe.nodes
    .filter((node) => shouldIncludeInventoryNode(node, options))
    .sort((left, right) => compareInventoryNodes(left, right, options.sortBy ?? "path"))
    .map((node) => ({
      id: "function-inventory:" + node.id,
      label: getFunctionDisplayName(node),
      name: node.name || getFunctionDisplayName(node),
      detail: getFunctionInventoryDetail(node),
      kind: getFunctionInventoryRowKind(node),
      nodeId: node.kind === "external" || node.kind === "unresolved" ? undefined : node.symbolId,
      depth,
      hasChildren: false,
      expanded: false
    }));
}

/** Returns whether a source graph node is a real callable symbol. */
function isCallableSymbolNode(node: SymbolNode): node is CallableSymbolNode {
  return node.kind === "function" || node.kind === "method" || node.kind === "constructor";
}

/** Converts a real callable symbol into the inventory view record. */
function createRecordFromSymbolNode(node: CallableSymbolNode): MutableFunctionNodeView {
  return {
    id: node.id,
    symbolId: node.id,
    kind: node.kind,
    name: node.name,
    qualifiedName: node.qualifiedName || node.name,
    filePath: node.filePath,
    range: node.range,
    role: "unknown",
    tags: [],
    metrics: createEmptyFunctionMetrics(),
    confidence: "exact"
  };
}

/** Converts an external graph node only when it is a call target. */
function createRecordFromExternalNode(node: SymbolNode): MutableFunctionNodeView {
  return {
    id: node.id,
    symbolId: node.id,
    kind: "external",
    name: node.name || node.qualifiedName || "external",
    qualifiedName: node.qualifiedName || node.name || "external",
    filePath: node.filePath,
    range: node.range,
    role: "external",
    tags: [],
    metrics: createEmptyFunctionMetrics(),
    confidence: "resolved"
  };
}

/** Creates a synthetic unresolved record for a call edge whose target is absent. */
function createRecordFromMissingTarget(edge: GraphEdge): MutableFunctionNodeView {
  const name = getMissingTargetName(edge);

  return {
    id: getUnresolvedRecordId(edge),
    symbolId: edge.targetId,
    kind: "unresolved",
    name,
    qualifiedName: "unresolved:" + name,
    filePath: edge.filePath,
    range: edge.range,
    role: "unresolved",
    tags: [],
    metrics: createEmptyFunctionMetrics(),
    confidence: "unresolved"
  };
}

/** Resolves the target inventory record for one calls edge. */
function getCallTargetRecord(
  edge: GraphEdge,
  graphNodesById: Map<string, SymbolNode>,
  recordsById: Map<string, MutableFunctionNodeView>
): MutableFunctionNodeView | undefined {
  const target = graphNodesById.get(edge.targetId);

  if (!target) {
    return recordsById.get(getUnresolvedRecordId(edge));
  }

  return recordsById.get(target.id);
}

/** Adds or merges one direct call relation into a relation index. */
function addFunctionRelation(
  relationsByOwnerId: Map<string, FunctionCallRelation[]>,
  ownerId: string,
  relatedNode: FunctionNodeView,
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
      name: getFunctionDisplayName(relatedNode),
      kind: relatedNode.kind,
      edgeIds: [edge.id],
      callCount: 1,
      confidences: [edge.confidence]
    });
  }

  relationsByOwnerId.set(ownerId, relations);
}

/** Sorts relation arrays for stable direct caller/callee rendering. */
function sortRelationIndex(relationsByOwnerId: Map<string, FunctionCallRelation[]>): void {
  for (const relations of relationsByOwnerId.values()) {
    for (const relation of relations) {
      relation.edgeIds.sort();
      relation.confidences.sort();
    }

    relations.sort(compareFunctionRelations);
  }
}

/** Infers the first-pass role from direct metrics and placeholder kind. */
function inferFunctionRole(node: FunctionNodeView): FunctionRole {
  if (node.kind === "external") {
    return "external";
  }

  if (node.kind === "unresolved") {
    return "unresolved";
  }

  if (node.metrics.directCallerCount === 0 && node.metrics.directCalleeCount > 0) {
    return "entrypoint";
  }

  if (node.metrics.directCallerCount > 1) {
    return "utility";
  }

  return "unknown";
}

/** Infers inventory tags that are available without semantic framework data. */
function inferFunctionTags(node: FunctionNodeView): FunctionTag[] {
  const tags: FunctionTag[] = [];

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

/** Builds the FunctionSpec Phase 1 completeness summary. */
function createFunctionUniverseSummary(
  graph: ProjectGraph,
  callEdges: GraphEdge[],
  nodes: FunctionNodeView[],
  options: CreateFunctionUniverseOptions
): FunctionUniverseSummary {
  const defaultVisibleNodeIds = resolveDefaultVisibleNodeIds(nodes, options);
  const visibleByDefaultViewCount = defaultVisibleNodeIds.size;

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
    externalCallEdgeCount: countExternalCallEdges(graph, callEdges),
    unresolvedCallEdgeCount: countMissingTargetCallEdges(graph, callEdges),
    inferredCallEdgeCount: callEdges.filter((edge) => edge.confidence === "inferred").length
  };
}

/** Resolves which callable ids are considered visible by the default view. */
function resolveDefaultVisibleNodeIds(
  nodes: FunctionNodeView[],
  options: CreateFunctionUniverseOptions
): Set<string> {
  if (options.defaultVisibleNodeIds) {
    const nodeIds = new Set(nodes.map((node) => node.id));
    return new Set(Array.from(options.defaultVisibleNodeIds).filter((nodeId) => nodeIds.has(nodeId)));
  }

  return new Set(nodes.filter((node) => node.role === "entrypoint").map((node) => node.id));
}

/** Counts diagnostics matching a caller-provided predicate. */
function countDiagnostics(
  diagnostics: AnalysisDiagnostic[],
  predicate: (diagnostic: AnalysisDiagnostic) => boolean
): number {
  return diagnostics.reduce((count, diagnostic) => count + (predicate(diagnostic) ? 1 : 0), 0);
}

/** Detects parser failures without depending on an analyzer-specific code enum. */
function isParserFailureDiagnostic(diagnostic: AnalysisDiagnostic): boolean {
  const code = diagnostic.code.toLowerCase();
  const message = diagnostic.message.toLowerCase();

  return code.includes("parse") || code.includes("syntax") || message.includes("parse");
}

/** Detects skipped or excluded files without depending on an analyzer-specific code enum. */
function isExcludedFileDiagnostic(diagnostic: AnalysisDiagnostic): boolean {
  const code = diagnostic.code.toLowerCase();
  const message = diagnostic.message.toLowerCase();

  return code.includes("exclude") || code.includes("skip") || message.includes("excluded");
}

/** Counts call edges whose target is an external placeholder node. */
function countExternalCallEdges(graph: ProjectGraph, callEdges: GraphEdge[]): number {
  const graphNodesById = new Map(graph.nodes.map((node) => [node.id, node]));

  return callEdges.filter((edge) => graphNodesById.get(edge.targetId)?.kind === "external").length;
}

/** Counts call edges whose target id does not exist in the graph. */
function countMissingTargetCallEdges(graph: ProjectGraph, callEdges: GraphEdge[]): number {
  const graphNodeIds = new Set(graph.nodes.map((node) => node.id));

  return callEdges.filter((edge) => !graphNodeIds.has(edge.targetId)).length;
}

/** Applies the All Functions query and basic completeness filters. */
function shouldIncludeInventoryNode(node: FunctionNodeView, options: AllFunctionsInventoryOptions): boolean {
  if (node.kind === "external" && options.includeExternal === false) {
    return false;
  }

  if (node.kind === "unresolved" && options.includeUnresolved === false) {
    return false;
  }

  if (options.filePath && !node.filePath.includes(options.filePath)) {
    return false;
  }

  if (options.roles && !options.roles.includes(node.role)) {
    return false;
  }

  if (!options.query) {
    return true;
  }

  const normalizedQuery = options.query.toLowerCase();
  const haystack = [
    node.name,
    node.qualifiedName,
    node.filePath,
    node.role,
    node.kind,
    ...node.tags
  ].join("\n").toLowerCase();

  return haystack.includes(normalizedQuery);
}

/** Compares inventory nodes by the selected sort mode, then stable source order. */
function compareInventoryNodes(
  left: FunctionNodeView,
  right: FunctionNodeView,
  sortBy: FunctionInventorySortKey
): number {
  if (sortBy === "relevance") {
    return compareByRelevance(left, right) || compareFunctionNodeViews(left, right);
  }

  if (sortBy === "fan-in") {
    return right.metrics.directCallerCount - left.metrics.directCallerCount || compareFunctionNodeViews(left, right);
  }

  if (sortBy === "fan-out") {
    return right.metrics.directCalleeCount - left.metrics.directCalleeCount || compareFunctionNodeViews(left, right);
  }

  if (sortBy === "unresolved") {
    return right.metrics.unresolvedCallCount - left.metrics.unresolvedCallCount || compareFunctionNodeViews(left, right);
  }

  if (sortBy === "name") {
    return getFunctionDisplayName(left).localeCompare(getFunctionDisplayName(right)) ||
      compareFunctionNodeViews(left, right);
  }

  return compareFunctionNodeViews(left, right);
}

/** Ranks entrypoints and high-signal completeness issues before ordinary rows. */
function compareByRelevance(left: FunctionNodeView, right: FunctionNodeView): number {
  return getFunctionRelevanceScore(right) - getFunctionRelevanceScore(left);
}

/** Computes a deterministic relevance score from Phase 1 direct metrics. */
function getFunctionRelevanceScore(node: FunctionNodeView): number {
  const roleScore = node.role === "entrypoint" ? 100 : node.role === "utility" ? 25 : 0;
  const placeholderScore = node.kind === "unresolved" ? 40 : node.kind === "external" ? 20 : 0;

  return roleScore +
    placeholderScore +
    node.metrics.directCallerCount * 4 +
    node.metrics.directCalleeCount * 3 +
    node.metrics.unresolvedCallCount * 8 +
    node.metrics.externalCallCount * 4;
}

/** Sorts callable records by path, source line, qualified name, then id. */
function compareFunctionNodeViews(left: FunctionNodeView, right: FunctionNodeView): number {
  return String(left.filePath).localeCompare(String(right.filePath)) ||
    Number(left.range?.startLine ?? 0) - Number(right.range?.startLine ?? 0) ||
    getFunctionDisplayName(left).localeCompare(getFunctionDisplayName(right)) ||
    left.id.localeCompare(right.id);
}

/** Sorts direct relations by kind and display name. */
function compareFunctionRelations(left: FunctionCallRelation, right: FunctionCallRelation): number {
  return left.kind.localeCompare(right.kind) ||
    left.name.localeCompare(right.name) ||
    left.nodeId.localeCompare(right.nodeId);
}

/** Returns a stable unresolved record id for a missing call target. */
function getUnresolvedRecordId(edge: GraphEdge): string {
  return "unresolved:" + (edge.targetId || edge.id);
}

/** Extracts the best available display name for a missing call target. */
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

/** Returns the user-facing function name shown in labels and relation rows. */
function getFunctionDisplayName(node: FunctionNodeView): string {
  return node.qualifiedName || node.name || node.id;
}

/** Builds compact detail text for one inventory row. */
function getFunctionInventoryDetail(node: FunctionNodeView): string {
  const tags = node.tags.length > 0 ? " / " + node.tags.join(",") : "";

  return node.role +
    " / callers " +
    String(node.metrics.directCallerCount) +
    " / callees " +
    String(node.metrics.directCalleeCount) +
    " / unresolved " +
    String(node.metrics.unresolvedCallCount) +
    " / external " +
    String(node.metrics.externalCallCount) +
    tags;
}

/** Maps a callable record to the sidebar tree row kind vocabulary. */
function getFunctionInventoryRowKind(node: FunctionNodeView): string {
  if (node.kind === "external") {
    return "external";
  }

  if (node.kind === "unresolved") {
    return "unresolved";
  }

  return "semantic";
}
