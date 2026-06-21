/**
 * Browser-injected helpers for the Function Flows sidebar tree.
 *
 * This module prepares a relationship-first view over callable graph nodes:
 * entrypoint roots, fan-in/fan-out hotspots, unresolved/external summaries, and
 * a stable All Functions inventory entrypoint. It intentionally works from
 * direct `calls` edges only, so Webview rendering never needs recursive graph
 * traversal to expand a branch.
 */

import type { GraphEdge, ProjectGraph, SymbolNode } from "../shared/types";

/** Row consumed by the sidebar's generic tree renderer. */
export type FunctionFlowTreeRow = {
  id: string;
  label: string;
  name: string;
  detail: string;
  kind: string;
  nodeId?: string;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
};

/** Collapsed outgoing relation from one callable to one target. */
type FunctionFlowRelation = {
  targetId: string;
  targetNode?: SymbolNode;
  targetLabel: string;
  count: number;
  confidences: Set<string>;
};

/** Callable symbol plus the direct call metrics used for flow rows. */
type FunctionFlowRecord = {
  node: SymbolNode;
  outgoing: FunctionFlowRelation[];
  incomingCount: number;
  outgoingCount: number;
};

/** External or unresolved call grouped by source function and target label. */
type FunctionFlowIssueRelation = {
  kind: "external" | "unresolved";
  sourceNode?: SymbolNode;
  sourceLabel: string;
  targetId: string;
  targetNode?: SymbolNode;
  targetLabel: string;
  count: number;
  confidences: Set<string>;
};

/** Derived call graph index prepared once for a Function Flows render. */
type FunctionFlowIndex = {
  records: FunctionFlowRecord[];
  entrypoints: FunctionFlowRecord[];
  hotspots: FunctionFlowRecord[];
  hotspotCandidateCount: number;
  externalCalls: FunctionFlowIssueRelation[];
  unresolvedCalls: FunctionFlowIssueRelation[];
  externalCallCount: number;
  unresolvedCallCount: number;
};

/** Returns browser-injected source for the Function Flows tree helpers. */
export function getFunctionFlowsBrowserSource(): string {
  return [
    `const createFunctionFlowTreeRows = ${createFunctionFlowTreeRows.toString()};`,
    `const createFunctionFlowIndex = ${createFunctionFlowIndex.toString()};`,
    `const appendFunctionFlowSectionRow = ${appendFunctionFlowSectionRow.toString()};`,
    `const appendFunctionFlowEntrypointRow = ${appendFunctionFlowEntrypointRow.toString()};`,
    `const appendFunctionFlowCalleeRow = ${appendFunctionFlowCalleeRow.toString()};`,
    `const appendFunctionFlowHotspotRow = ${appendFunctionFlowHotspotRow.toString()};`,
    `const appendFunctionFlowIssueBucketRow = ${appendFunctionFlowIssueBucketRow.toString()};`,
    `const appendFunctionFlowIssueRow = ${appendFunctionFlowIssueRow.toString()};`,
    `const appendFunctionFlowAllFunctionsSummaryRow = ${appendFunctionFlowAllFunctionsSummaryRow.toString()};`,
    `const addFunctionFlowOutgoingRelation = ${addFunctionFlowOutgoingRelation.toString()};`,
    `const addFunctionFlowIssueRelation = ${addFunctionFlowIssueRelation.toString()};`,
    `const getFunctionFlowSectionId = ${getFunctionFlowSectionId.toString()};`,
    `const getFunctionFlowHotspotLimit = ${getFunctionFlowHotspotLimit.toString()};`,
    `const getFunctionFlowHotspotScore = ${getFunctionFlowHotspotScore.toString()};`,
    `const getFunctionFlowHotspotRole = ${getFunctionFlowHotspotRole.toString()};`,
    `const getFunctionFlowHotspotDetail = ${getFunctionFlowHotspotDetail.toString()};`,
    `const getFunctionFlowRelationDetail = ${getFunctionFlowRelationDetail.toString()};`,
    `const getFunctionFlowIssueDetail = ${getFunctionFlowIssueDetail.toString()};`,
    `const getFunctionFlowTargetLabel = ${getFunctionFlowTargetLabel.toString()};`,
    `const getFunctionFlowMissingTargetLabel = ${getFunctionFlowMissingTargetLabel.toString()};`,
    `const getFunctionFlowMetadataString = ${getFunctionFlowMetadataString.toString()};`,
    `const getFunctionFlowDisplayName = ${getFunctionFlowDisplayName.toString()};`,
    `const getFunctionFlowRelativePath = ${getFunctionFlowRelativePath.toString()};`,
    `const compareFunctionFlowRecordsByPosition = ${compareFunctionFlowRecordsByPosition.toString()};`,
    `const compareFunctionFlowRelations = ${compareFunctionFlowRelations.toString()};`,
    `const compareFunctionFlowIssueRelations = ${compareFunctionFlowIssueRelations.toString()};`,
    `const compareFunctionFlowHotspotRecords = ${compareFunctionFlowHotspotRecords.toString()};`,
    `const isFunctionFlowCallable = ${isFunctionFlowCallable.toString()};`,
    `const getFunctionFlowConfidenceText = ${getFunctionFlowConfidenceText.toString()};`
  ].join("\n");
}

/** Builds visible Function Flows rows from the current graph and expansion state. */
export function createFunctionFlowTreeRows(
  graph: ProjectGraph,
  expandedTreeIds: Set<string>
): FunctionFlowTreeRow[] {
  const index = createFunctionFlowIndex(graph);
  const rows: FunctionFlowTreeRow[] = [];
  const entrypointsId = getFunctionFlowSectionId("entrypoints");
  const hotspotsId = getFunctionFlowSectionId("hotspots");
  const issuesId = getFunctionFlowSectionId("unresolved-external");
  const allFunctionsId = getFunctionFlowSectionId("all-functions");

  if (
    appendFunctionFlowSectionRow(
      rows,
      expandedTreeIds,
      entrypointsId,
      "Entrypoints",
      String(index.entrypoints.length) + " roots",
      index.entrypoints.length > 0
    )
  ) {
    for (const record of index.entrypoints) {
      appendFunctionFlowEntrypointRow(graph, expandedTreeIds, entrypointsId, record, rows);
    }
  }

  if (
    appendFunctionFlowSectionRow(
      rows,
      expandedTreeIds,
      hotspotsId,
      "Hotspots",
      String(index.hotspots.length) +
        " shown / " +
        String(index.hotspotCandidateCount) +
        " candidates",
      index.hotspots.length > 0
    )
  ) {
    for (const record of index.hotspots) {
      appendFunctionFlowHotspotRow(hotspotsId, record, rows);
    }
  }

  if (
    appendFunctionFlowSectionRow(
      rows,
      expandedTreeIds,
      issuesId,
      "Unresolved / External",
      String(index.unresolvedCallCount) +
        " unresolved / " +
        String(index.externalCallCount) +
        " external",
      index.unresolvedCalls.length > 0 || index.externalCalls.length > 0
    )
  ) {
    appendFunctionFlowIssueBucketRow(
      graph,
      expandedTreeIds,
      issuesId,
      "Unresolved calls",
      "unresolved",
      index.unresolvedCalls,
      rows
    );
    appendFunctionFlowIssueBucketRow(
      graph,
      expandedTreeIds,
      issuesId,
      "External dependencies",
      "external",
      index.externalCalls,
      rows
    );
  }

  if (
    appendFunctionFlowSectionRow(
      rows,
      expandedTreeIds,
      allFunctionsId,
      "All Functions",
      String(index.records.length) + " callable functions",
      true
    )
  ) {
    appendFunctionFlowAllFunctionsSummaryRow(allFunctionsId, index.records.length, rows);
  }

  return rows;
}

/** Creates direct-call indexes and summary buckets used by Function Flows rows. */
export function createFunctionFlowIndex(graph: ProjectGraph): FunctionFlowIndex {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const callableNodes = graph.nodes.filter(isFunctionFlowCallable).sort(compareFunctionFlowRecordsByPosition);
  const records = callableNodes.map((node) => ({
    node,
    outgoing: [],
    incomingCount: 0,
    outgoingCount: 0
  }));
  const recordsById = new Map(records.map((record) => [record.node.id, record]));
  const externalCallsByKey = new Map<string, FunctionFlowIssueRelation>();
  const unresolvedCallsByKey = new Map<string, FunctionFlowIssueRelation>();
  let externalCallCount = 0;
  let unresolvedCallCount = 0;

  for (const edge of graph.edges) {
    if (edge.kind !== "calls") {
      continue;
    }

    const sourceRecord = recordsById.get(edge.sourceId);
    const sourceNode = sourceRecord?.node ?? nodesById.get(edge.sourceId);
    const targetNode = nodesById.get(edge.targetId);
    const targetRecord = targetNode ? recordsById.get(targetNode.id) : undefined;

    if (sourceRecord) {
      addFunctionFlowOutgoingRelation(sourceRecord, edge, targetNode);
      sourceRecord.outgoingCount += 1;
    }

    if (sourceRecord && targetRecord) {
      targetRecord.incomingCount += 1;
    }

    if (!targetNode) {
      unresolvedCallCount += 1;
      addFunctionFlowIssueRelation(unresolvedCallsByKey, "unresolved", edge, sourceNode, undefined);
    } else if (targetNode.kind === "external") {
      externalCallCount += 1;
      addFunctionFlowIssueRelation(externalCallsByKey, "external", edge, sourceNode, targetNode);
    }
  }

  for (const record of records) {
    record.outgoing.sort(compareFunctionFlowRelations);
  }

  const entrypoints = records
    .filter((record) => record.incomingCount === 0 && record.outgoingCount > 0)
    .sort(compareFunctionFlowRecordsByPosition);
  const hotspotCandidates = records
    .filter((record) => getFunctionFlowHotspotScore(record) > 1)
    .sort(compareFunctionFlowHotspotRecords);
  const hotspots = hotspotCandidates.slice(0, getFunctionFlowHotspotLimit());
  const externalCalls = Array.from(externalCallsByKey.values()).sort(compareFunctionFlowIssueRelations);
  const unresolvedCalls = Array.from(unresolvedCallsByKey.values()).sort(compareFunctionFlowIssueRelations);

  return {
    records,
    entrypoints,
    hotspots,
    hotspotCandidateCount: hotspotCandidates.length,
    externalCalls,
    unresolvedCalls,
    externalCallCount,
    unresolvedCallCount
  };
}

/** Appends a top-level Function Flows section and returns its expansion state. */
function appendFunctionFlowSectionRow(
  rows: FunctionFlowTreeRow[],
  expandedTreeIds: Set<string>,
  sectionId: string,
  label: string,
  detail: string,
  hasChildren: boolean
): boolean {
  const expanded = hasChildren && expandedTreeIds.has(sectionId);

  rows.push({
    id: sectionId,
    label,
    name: label,
    detail,
    kind: "semantic",
    depth: 0,
    hasChildren,
    expanded
  });

  return expanded;
}

/** Appends one entrypoint root and its direct callees when the root is expanded. */
function appendFunctionFlowEntrypointRow(
  graph: ProjectGraph,
  expandedTreeIds: Set<string>,
  parentTreeId: string,
  record: FunctionFlowRecord,
  rows: FunctionFlowTreeRow[]
): void {
  const name = getFunctionFlowDisplayName(record.node);
  const rowId = parentTreeId + ":entrypoint:" + record.node.id;
  const hasChildren = record.outgoing.length > 0;
  const expanded = hasChildren && expandedTreeIds.has(rowId);

  rows.push({
    id: rowId,
    label: name,
    name,
    detail: record.node.kind + " / " + String(record.outgoingCount) + " direct calls",
    kind: "semantic",
    nodeId: record.node.id,
    depth: 1,
    hasChildren,
    expanded
  });

  if (!expanded) {
    return;
  }

  for (const relation of record.outgoing) {
    appendFunctionFlowCalleeRow(graph, rowId, relation, rows);
  }
}

/** Appends one direct callee row without recursively expanding downstream calls. */
function appendFunctionFlowCalleeRow(
  graph: ProjectGraph,
  parentTreeId: string,
  relation: FunctionFlowRelation,
  rows: FunctionFlowTreeRow[]
): void {
  const kind = relation.targetNode?.kind === "external"
    ? "external"
    : relation.targetNode
      ? "semantic"
      : "unresolved";

  rows.push({
    id: parentTreeId + ":callee:" + relation.targetId,
    label: relation.targetLabel,
    name: relation.targetLabel,
    detail: getFunctionFlowRelationDetail(graph, relation),
    kind,
    nodeId: relation.targetNode && relation.targetNode.kind !== "external" ? relation.targetNode.id : undefined,
    depth: 2,
    hasChildren: false,
    expanded: false
  });
}

/** Appends one high fan-in/fan-out hotspot shortcut row. */
function appendFunctionFlowHotspotRow(
  parentTreeId: string,
  record: FunctionFlowRecord,
  rows: FunctionFlowTreeRow[]
): void {
  const name = getFunctionFlowDisplayName(record.node);

  rows.push({
    id: parentTreeId + ":hotspot:" + record.node.id,
    label: name,
    name,
    detail: getFunctionFlowHotspotDetail(record),
    kind: "semantic",
    nodeId: record.node.id,
    depth: 1,
    hasChildren: false,
    expanded: false
  });
}

/** Appends an unresolved/external bucket and its detailed source rows when expanded. */
function appendFunctionFlowIssueBucketRow(
  graph: ProjectGraph,
  expandedTreeIds: Set<string>,
  parentTreeId: string,
  label: string,
  kind: "external" | "unresolved",
  issues: FunctionFlowIssueRelation[],
  rows: FunctionFlowTreeRow[]
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
    detail: String(callCount) + " calls / " + String(issues.length) + " targets",
    kind,
    depth: 1,
    hasChildren: issues.length > 0,
    expanded
  });

  if (!expanded) {
    return;
  }

  for (const issue of issues) {
    appendFunctionFlowIssueRow(graph, rowId, issue, rows);
  }
}

/** Appends one external or unresolved call summary row grouped by source. */
function appendFunctionFlowIssueRow(
  graph: ProjectGraph,
  parentTreeId: string,
  issue: FunctionFlowIssueRelation,
  rows: FunctionFlowTreeRow[]
): void {
  const label = issue.sourceLabel + " -> " + issue.targetLabel;

  rows.push({
    id: parentTreeId + ":call:" + String(issue.sourceNode?.id ?? "unknown") + ":" + issue.targetId,
    label,
    name: issue.targetLabel,
    detail: getFunctionFlowIssueDetail(graph, issue),
    kind: issue.kind,
    nodeId: issue.targetNode && issue.targetNode.kind !== "external" ? issue.targetNode.id : undefined,
    depth: 2,
    hasChildren: false,
    expanded: false
  });
}

/** Appends the placeholder row that future inventory search/filtering can replace. */
function appendFunctionFlowAllFunctionsSummaryRow(
  parentTreeId: string,
  callableCount: number,
  rows: FunctionFlowTreeRow[]
): void {
  rows.push({
    id: parentTreeId + ":summary",
    label: "Inventory summary",
    name: "Inventory summary",
    detail: String(callableCount) + " callable functions / inventory rows deferred",
    kind: "semantic",
    depth: 1,
    hasChildren: false,
    expanded: false
  });
}

/** Adds or merges an outgoing relation for one callable source. */
function addFunctionFlowOutgoingRelation(
  record: FunctionFlowRecord,
  edge: GraphEdge,
  targetNode: SymbolNode | undefined
): void {
  const targetId = targetNode?.id ?? edge.targetId;
  const existing = record.outgoing.find((relation) => relation.targetId === targetId);

  if (existing) {
    existing.count += 1;
    existing.confidences.add(edge.confidence);
    return;
  }

  record.outgoing.push({
    targetId,
    targetNode,
    targetLabel: getFunctionFlowTargetLabel(edge, targetNode),
    count: 1,
    confidences: new Set([edge.confidence])
  });
}

/** Adds or merges an external/unresolved issue relation by source and target. */
function addFunctionFlowIssueRelation(
  issuesByKey: Map<string, FunctionFlowIssueRelation>,
  kind: "external" | "unresolved",
  edge: GraphEdge,
  sourceNode: SymbolNode | undefined,
  targetNode: SymbolNode | undefined
): void {
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
    sourceLabel: sourceNode ? getFunctionFlowDisplayName(sourceNode) : edge.sourceId,
    targetId,
    targetNode,
    targetLabel: getFunctionFlowTargetLabel(edge, targetNode),
    count: 1,
    confidences: new Set([edge.confidence])
  });
}

/** Returns a stable top-level section id used by cached virtual tree rows. */
function getFunctionFlowSectionId(sectionName: string): string {
  return "function-flows:" + sectionName;
}

/** Caps the shortcut-only hotspot section without limiting the full inventory. */
function getFunctionFlowHotspotLimit(): number {
  return 8;
}

/** Returns the fan metric used to rank hotspot candidates. */
function getFunctionFlowHotspotScore(record: FunctionFlowRecord): number {
  return Math.max(record.incomingCount, record.outgoingCount);
}

/** Labels whether the hotspot is primarily fan-in, fan-out, or both. */
function getFunctionFlowHotspotRole(record: FunctionFlowRecord): string {
  if (record.incomingCount === record.outgoingCount) {
    return "high fan-in/out";
  }

  return record.incomingCount > record.outgoingCount ? "high fan-in" : "high fan-out";
}

/** Returns a compact hotspot detail with raw fan-in and fan-out counts. */
function getFunctionFlowHotspotDetail(record: FunctionFlowRecord): string {
  return (
    getFunctionFlowHotspotRole(record) +
    " / fan-in " +
    String(record.incomingCount) +
    " / fan-out " +
    String(record.outgoingCount)
  );
}

/** Returns source location and confidence metadata for one callee relation. */
function getFunctionFlowRelationDetail(graph: ProjectGraph, relation: FunctionFlowRelation): string {
  const location = relation.targetNode
    ? relation.targetNode.kind === "external"
      ? "external"
      : getFunctionFlowRelativePath(graph, relation.targetNode.filePath)
    : "missing target";
  const count = relation.count > 1 ? " x" + String(relation.count) : "";

  return location + count + " / " + getFunctionFlowConfidenceText(relation.confidences);
}

/** Returns source location and confidence metadata for one issue relation. */
function getFunctionFlowIssueDetail(graph: ProjectGraph, issue: FunctionFlowIssueRelation): string {
  const location = issue.sourceNode ? getFunctionFlowRelativePath(graph, issue.sourceNode.filePath) : "unknown source";
  const count = issue.count > 1 ? " x" + String(issue.count) : "";

  return location + count + " / " + getFunctionFlowConfidenceText(issue.confidences);
}

/** Returns a display label for a relation target, including missing call targets. */
function getFunctionFlowTargetLabel(edge: GraphEdge, targetNode: SymbolNode | undefined): string {
  if (targetNode) {
    return getFunctionFlowDisplayName(targetNode);
  }

  return getFunctionFlowMissingTargetLabel(edge);
}

/** Extracts the best available unresolved call name from edge metadata. */
function getFunctionFlowMissingTargetLabel(edge: GraphEdge): string {
  const metadataLabel = getFunctionFlowMetadataString(edge.metadata, [
    "callName",
    "symbolName",
    "targetName",
    "qualifiedName",
    "name"
  ]);

  return metadataLabel ?? edge.targetId ?? "unresolved target";
}

/** Reads one string metadata field without coupling to analyzer-specific keys. */
function getFunctionFlowMetadataString(
  metadata: Record<string, unknown> | undefined,
  keys: string[]
): string | undefined {
  if (!metadata) {
    return undefined;
  }

  for (const key of keys) {
    const value = metadata[key];

    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return undefined;
}

/** Returns a concise symbol label for callable and external nodes. */
function getFunctionFlowDisplayName(node: SymbolNode): string {
  return node.qualifiedName || node.name || node.id || "anonymous";
}

/** Returns a workspace-relative path with a compact fallback for external nodes. */
function getFunctionFlowRelativePath(graph: ProjectGraph, filePath: string): string {
  if (!filePath) {
    return "external";
  }

  const workspaceRoot = graph.workspaceRoot.replace(/\\/g, "/");
  const normalized = String(filePath).replace(/\\/g, "/");

  if (normalized.startsWith(workspaceRoot + "/")) {
    return normalized.slice(workspaceRoot.length + 1);
  }

  return normalized.split("/").slice(-3).join("/");
}

/** Sorts callable records by file path, source line, then display name. */
function compareFunctionFlowRecordsByPosition(left: FunctionFlowRecord, right: FunctionFlowRecord): number;
function compareFunctionFlowRecordsByPosition(left: SymbolNode, right: SymbolNode): number;
function compareFunctionFlowRecordsByPosition(
  left: FunctionFlowRecord | SymbolNode,
  right: FunctionFlowRecord | SymbolNode
): number {
  const leftNode = "node" in left ? left.node : left;
  const rightNode = "node" in right ? right.node : right;

  return (
    String(leftNode.filePath).localeCompare(String(rightNode.filePath)) ||
    Number(leftNode.range?.startLine ?? 0) - Number(rightNode.range?.startLine ?? 0) ||
    getFunctionFlowDisplayName(leftNode).localeCompare(getFunctionFlowDisplayName(rightNode))
  );
}

/** Sorts outgoing relation rows by classification, location, and label. */
function compareFunctionFlowRelations(left: FunctionFlowRelation, right: FunctionFlowRelation): number {
  const leftKind = left.targetNode?.kind ?? "unresolved";
  const rightKind = right.targetNode?.kind ?? "unresolved";

  return (
    leftKind.localeCompare(rightKind) ||
    String(left.targetNode?.filePath ?? "").localeCompare(String(right.targetNode?.filePath ?? "")) ||
    left.targetLabel.localeCompare(right.targetLabel)
  );
}

/** Sorts issue details by source function and target label. */
function compareFunctionFlowIssueRelations(
  left: FunctionFlowIssueRelation,
  right: FunctionFlowIssueRelation
): number {
  return (
    left.sourceLabel.localeCompare(right.sourceLabel) ||
    left.targetLabel.localeCompare(right.targetLabel) ||
    left.kind.localeCompare(right.kind)
  );
}

/** Sorts hotspot candidates by impact count, total calls, then source position. */
function compareFunctionFlowHotspotRecords(left: FunctionFlowRecord, right: FunctionFlowRecord): number {
  return (
    getFunctionFlowHotspotScore(right) - getFunctionFlowHotspotScore(left) ||
    right.incomingCount + right.outgoingCount - (left.incomingCount + left.outgoingCount) ||
    compareFunctionFlowRecordsByPosition(left, right)
  );
}

/** Returns whether a graph node represents a callable function-like symbol. */
function isFunctionFlowCallable(node: SymbolNode): boolean {
  return node.kind === "function" || node.kind === "method" || node.kind === "constructor";
}

/** Formats a stable confidence summary while preserving inferred/unresolved markers. */
function getFunctionFlowConfidenceText(confidences: Set<string>): string {
  return Array.from(confidences).sort().join(",");
}
