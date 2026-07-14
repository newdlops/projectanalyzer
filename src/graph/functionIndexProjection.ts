/**
 * Row-only projection for an already-built Function Index core.
 *
 * Expanded tree identities and inventory limits are request state. This module
 * turns that state into fresh row arrays without rebuilding graph-wide nodes,
 * relation maps, metrics, hotspot ranking, or issue grouping.
 */

import type { EdgeConfidence, ProjectGraph } from "../shared/types";
import { getFunctionHotspotDetail } from "./functionHotspotRanking";
import type {
  CreateFunctionIndexOptions,
  FunctionIndexFlowModel,
  FunctionIndexIssueKind,
  FunctionIndexIssueRelation,
  FunctionIndexNode,
  FunctionIndexRelation,
  FunctionIndexTreeRow
} from "./functionIndexTypes";

/** Default inventory payload cap used when callers do not request a limit. */
export const DEFAULT_FUNCTION_INDEX_INVENTORY_LIMIT = 250;

/** Immutable graph-wide inputs reused by every row projection. */
export type FunctionIndexProjectionCore = {
  graph: ProjectGraph;
  nodes: FunctionIndexNode[];
  flowModel: FunctionIndexFlowModel;
};

/** Fresh row arrays produced for one expansion and inventory request. */
export type FunctionIndexRowProjection = {
  flowsRows: FunctionIndexTreeRow[];
  inventoryRows: FunctionIndexTreeRow[];
};

/** Projects independent row arrays from one reusable Function Index core. */
export function projectFunctionIndexRows(
  core: FunctionIndexProjectionCore,
  options: CreateFunctionIndexOptions = {}
): FunctionIndexRowProjection {
  const inventoryLimit = normalizeInventoryLimit(options.inventoryLimit);

  return {
    flowsRows: createFunctionIndexFlowRows(
      core.graph,
      core.nodes,
      core.flowModel,
      new Set(options.expandedTreeIds ?? []),
      inventoryLimit
    ),
    inventoryRows: options.includeInventoryRows === false
      ? []
      : createAllFunctionsInventoryRows(
        core.nodes,
        0,
        "function-inventory:",
        inventoryLimit
      )
  };
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

  if (appendSection(
    rows,
    expandedTreeIds,
    entrypointsId,
    "Entrypoints",
    `${flowModel.entrypoints.length} roots`,
    flowModel.entrypoints.length > 0
  )) {
    for (const record of flowModel.entrypoints) {
      appendEntrypointRow(graph, expandedTreeIds, entrypointsId, record, rows);
    }
  }

  if (appendSection(
    rows,
    expandedTreeIds,
    hotspotsId,
    "Hotspots",
    `${flowModel.hotspots.length} shown / ${flowModel.hotspotCandidateCount} candidates`,
    flowModel.hotspots.length > 0
  )) {
    for (const record of flowModel.hotspots) {
      rows.push({
        id: `${hotspotsId}:hotspot:${record.node.id}`,
        label: getFunctionDisplayName(record.node),
        name: getFunctionDisplayName(record.node),
        detail: getFunctionHotspotDetail(record.node),
        kind: "semantic",
        nodeId: record.node.id,
        depth: 1,
        hasChildren: false,
        expanded: false
      });
    }
  }

  if (appendSection(
    rows,
    expandedTreeIds,
    issuesId,
    "Unresolved / External",
    `${flowModel.unresolvedCallCount} unresolved / ${flowModel.externalCallCount} external`,
    flowModel.unresolvedCalls.length > 0 || flowModel.externalCalls.length > 0
  )) {
    appendIssueBucket(
      graph,
      expandedTreeIds,
      issuesId,
      "Unresolved calls",
      "unresolved",
      flowModel.unresolvedCalls,
      rows
    );
    appendIssueBucket(
      graph,
      expandedTreeIds,
      issuesId,
      "External dependencies",
      "external",
      flowModel.externalCalls,
      rows
    );
  }

  if (appendSection(
    rows,
    expandedTreeIds,
    allFunctionsId,
    "All Functions",
    `${nodes.length} callable functions`,
    true
  )) {
    rows.push(...createAllFunctionsInventoryRows(
      nodes,
      1,
      `${allFunctionsId}:function:`,
      inventoryLimit
    ));
  }

  return rows;
}

/** Appends one collapsible top-level flow section and returns its visibility. */
function appendSection(
  rows: FunctionIndexTreeRow[],
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

/** Appends one generic graph-root entrypoint and its requested direct callees. */
function appendEntrypointRow(
  graph: ProjectGraph,
  expandedTreeIds: Set<string>,
  parentTreeId: string,
  record: FunctionIndexFlowModel["entrypoints"][number],
  rows: FunctionIndexTreeRow[]
): void {
  const name = getFunctionDisplayName(record.node);
  const rowId = `${parentTreeId}:entrypoint:${record.node.id}`;
  const hasChildren = record.outgoing.length > 0;
  const expanded = hasChildren && expandedTreeIds.has(rowId);

  rows.push({
    id: rowId,
    label: name,
    name,
    detail: `${record.node.kind} / ${record.outgoingCallCount} direct calls`,
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

/** Appends one direct callee row from precomputed relation evidence. */
function appendCalleeRow(
  graph: ProjectGraph,
  parentTreeId: string,
  relation: FunctionIndexRelation,
  rows: FunctionIndexTreeRow[]
): void {
  const kind = getRelationRowKind(relation);
  rows.push({
    id: `${parentTreeId}:callee:${relation.nodeId}`,
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

/** Appends one unresolved or external issue bucket when evidence is available. */
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

  const rowId = `${parentTreeId}:${kind}`;
  const expanded = expandedTreeIds.has(rowId);
  const callCount = issues.reduce((total, issue) => total + issue.count, 0);
  rows.push({
    id: rowId,
    label,
    name: label,
    detail: `${callCount} calls / ${issues.length} targets`,
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

/** Appends one source-to-target issue relation from the cached flow model. */
function appendIssueRow(
  graph: ProjectGraph,
  parentTreeId: string,
  issue: FunctionIndexIssueRelation,
  rows: FunctionIndexTreeRow[]
): void {
  rows.push({
    id: `${parentTreeId}:call:${String(issue.sourceNode?.id ?? "unknown")}:${issue.targetId}`,
    label: `${issue.sourceLabel} -> ${issue.targetLabel}`,
    name: issue.targetLabel,
    detail: getFunctionFlowIssueDetail(graph, issue),
    kind: issue.kind,
    nodeId: issue.targetNode && isRealFunctionIndexNode(issue.targetNode)
      ? issue.targetNode.symbolId
      : undefined,
    depth: 2,
    hasChildren: false,
    expanded: false
  });
}

/** Creates flat All Functions rows from the already sorted core node array. */
function createAllFunctionsInventoryRows(
  nodes: FunctionIndexNode[],
  depth: number,
  idPrefix: string,
  limit: number
): FunctionIndexTreeRow[] {
  return nodes.slice(0, limit).map((node) => ({
    id: idPrefix + node.id,
    label: getFunctionDisplayName(node),
    name: node.name || getFunctionDisplayName(node),
    detail: getFunctionInventoryDetail(node),
    kind: getInventoryRowKind(node),
    nodeId: node.kind === "external" || node.kind === "unresolved"
      ? undefined
      : node.symbolId,
    depth,
    hasChildren: false,
    expanded: false
  }));
}

/** Normalizes one request-local inventory cap. */
function normalizeInventoryLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_FUNCTION_INDEX_INVENTORY_LIMIT;
  }

  return Math.max(0, Math.floor(limit));
}

/** Narrows cached index nodes to source-backed callables. */
function isRealFunctionIndexNode(node: FunctionIndexNode): boolean {
  return node.kind === "function" || node.kind === "method" || node.kind === "constructor";
}

/** Returns one stable callable display label. */
function getFunctionDisplayName(node: FunctionIndexNode): string {
  return node.qualifiedName || node.name || node.id;
}

/** Formats inventory metrics already computed by the graph-wide core. */
function getFunctionInventoryDetail(node: FunctionIndexNode): string {
  const tags = node.tags.length > 0 ? ` / ${node.tags.join(",")}` : "";

  return `${node.role} / callers ${node.metrics.directCallerCount} / `
    + `callees ${node.metrics.directCalleeCount} / `
    + `unresolved ${node.metrics.unresolvedCallCount} / `
    + `external ${node.metrics.externalCallCount}${tags}`;
}

/** Maps an inventory node into the existing legacy row kind vocabulary. */
function getInventoryRowKind(node: FunctionIndexNode): string {
  return node.kind === "external" || node.kind === "unresolved" ? node.kind : "semantic";
}

/** Maps one direct relation into the existing legacy row kind vocabulary. */
function getRelationRowKind(relation: FunctionIndexRelation): string {
  return relation.kind === "external" || relation.kind === "unresolved"
    ? relation.kind
    : "semantic";
}

/** Creates the stable legacy section identity used by the sidebar. */
function getFunctionFlowSectionId(sectionName: string): string {
  return `function-flows:${sectionName}`;
}

/** Formats one direct relation with source scope and confidence. */
function getFunctionFlowRelationDetail(
  graph: ProjectGraph,
  relation: FunctionIndexRelation
): string {
  const location = relation.kind === "external"
    ? "external"
    : relation.kind === "unresolved"
      ? "missing target"
      : getFunctionFlowRelativePath(graph, relation.filePath);
  const count = relation.callCount > 1 ? ` x${relation.callCount}` : "";
  return `${location}${count} / ${getFunctionFlowConfidenceText(relation.confidences)}`;
}

/** Formats one unresolved or external call group from cached evidence. */
function getFunctionFlowIssueDetail(
  graph: ProjectGraph,
  issue: FunctionIndexIssueRelation
): string {
  const location = issue.sourceNode
    ? getFunctionFlowRelativePath(graph, issue.sourceNode.filePath)
    : "unknown source";
  const count = issue.count > 1 ? ` x${issue.count}` : "";
  return `${location}${count} / ${getFunctionFlowConfidenceText([...issue.confidences])}`;
}

/** Produces a workspace-relative path without requiring filesystem access. */
function getFunctionFlowRelativePath(graph: ProjectGraph, filePath: string): string {
  if (!filePath) {
    return "external";
  }

  const workspaceRoot = graph.workspaceRoot.replace(/\\/g, "/");
  const normalized = filePath.replace(/\\/g, "/");

  if (normalized.startsWith(`${workspaceRoot}/`)) {
    return normalized.slice(workspaceRoot.length + 1);
  }

  return normalized.split("/").slice(-3).join("/");
}

/** Formats confidence evidence in stable order. */
function getFunctionFlowConfidenceText(confidences: EdgeConfidence[]): string {
  return [...confidences].sort().join(",");
}
