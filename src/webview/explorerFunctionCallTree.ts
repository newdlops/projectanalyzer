/**
 * Browser-injected helpers for the sidebar function call explorer.
 *
 * The generated helpers transform flat `calls` edges into a VS Code Explorer
 * style tree: file -> function -> Calls / Called by -> related function. The
 * tree deliberately shows direct relationships only, so cycles never require
 * recursive traversal in the Webview.
 */

import type { GraphEdge, ProjectGraph, SymbolNode } from "../shared/types";

/** Row consumed by the sidebar's generic tree renderer. */
export type FunctionCallTreeRow = {
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

/** Per-target relation summary used to collapse repeated call sites. */
type FunctionCallRelation = {
  node: SymbolNode;
  count: number;
  confidences: Set<string>;
};

/** Callable symbol plus incoming and outgoing call relation summaries. */
type FunctionCallRecord = {
  node: SymbolNode;
  outgoing: FunctionCallRelation[];
  incoming: FunctionCallRelation[];
};

/** File group shown as the first level of the function call tree. */
type FunctionCallFileGroup = {
  filePath: string;
  fileNode?: SymbolNode;
  functions: FunctionCallRecord[];
};

/** Indexed call graph data prepared once per sidebar render. */
type FunctionCallTreeIndex = {
  files: FunctionCallFileGroup[];
};

/** Returns browser-injected source for the function call tree helpers. */
export function getFunctionCallTreeBrowserSource(): string {
  return [
    `const createFunctionCallTreeRows = ${createFunctionCallTreeRows.toString()};`,
    `const createFunctionCallTreeIndex = ${createFunctionCallTreeIndex.toString()};`,
    `const appendFunctionCallFileRow = ${appendFunctionCallFileRow.toString()};`,
    `const appendFunctionCallFunctionRow = ${appendFunctionCallFunctionRow.toString()};`,
    `const appendFunctionCallBucketRow = ${appendFunctionCallBucketRow.toString()};`,
    `const appendFunctionCallRelationRow = ${appendFunctionCallRelationRow.toString()};`,
    `const addFunctionCallRelation = ${addFunctionCallRelation.toString()};`,
    `const sortFunctionCallRelationMap = ${sortFunctionCallRelationMap.toString()};`,
    `const compareFunctionCallNodes = ${compareFunctionCallNodes.toString()};`,
    `const compareFunctionCallRelations = ${compareFunctionCallRelations.toString()};`,
    `const isFunctionCallNode = ${isFunctionCallNode.toString()};`,
    `const getFunctionCallCounts = ${getFunctionCallCounts.toString()};`,
    `const getFunctionCallDisplayName = ${getFunctionCallDisplayName.toString()};`,
    `const getFunctionCallRelationDetail = ${getFunctionCallRelationDetail.toString()};`,
    `const getFunctionCallRelativePath = ${getFunctionCallRelativePath.toString()};`,
    `const getFunctionCallFileName = ${getFunctionCallFileName.toString()};`,
    `const getFunctionCallDirectoryName = ${getFunctionCallDirectoryName.toString()};`
  ].join("\n");
}

/** Builds visible tree rows from the current graph and expansion state. */
export function createFunctionCallTreeRows(
  graph: ProjectGraph,
  expandedTreeIds: Set<string>
): FunctionCallTreeRow[] {
  const index = createFunctionCallTreeIndex(graph);
  const rows: FunctionCallTreeRow[] = [];

  for (const fileGroup of index.files) {
    appendFunctionCallFileRow(graph, expandedTreeIds, fileGroup, rows);
  }

  return rows;
}

/** Creates a file/function/call relation index from flat graph edges. */
export function createFunctionCallTreeIndex(graph: ProjectGraph): FunctionCallTreeIndex {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const callableNodes = graph.nodes.filter(isFunctionCallNode).sort(compareFunctionCallNodes);
  const callableNodesById = new Map(callableNodes.map((node) => [node.id, node]));
  const fileNodesByPath = new Map(
    graph.nodes.filter((node) => node.kind === "file").map((node) => [node.filePath, node])
  );
  const outgoingBySourceId = new Map<string, FunctionCallRelation[]>();
  const incomingByTargetId = new Map<string, FunctionCallRelation[]>();

  for (const edge of graph.edges) {
    if (edge.kind !== "calls") {
      continue;
    }

    const source = callableNodesById.get(edge.sourceId);
    const target = nodesById.get(edge.targetId);

    if (!source || !target) {
      continue;
    }

    addFunctionCallRelation(outgoingBySourceId, source.id, target, edge);

    if (callableNodesById.has(target.id)) {
      addFunctionCallRelation(incomingByTargetId, target.id, source, edge);
    }
  }

  sortFunctionCallRelationMap(outgoingBySourceId);
  sortFunctionCallRelationMap(incomingByTargetId);

  const filesByPath = new Map<string, FunctionCallFileGroup>();

  for (const node of callableNodes) {
    const filePath = node.filePath || "";
    const fileGroup = filesByPath.get(filePath) ?? {
      filePath,
      fileNode: fileNodesByPath.get(filePath),
      functions: []
    };
    fileGroup.functions.push({
      node,
      outgoing: outgoingBySourceId.get(node.id) ?? [],
      incoming: incomingByTargetId.get(node.id) ?? []
    });
    filesByPath.set(filePath, fileGroup);
  }

  const files = Array.from(filesByPath.values()).sort((left, right) =>
    getFunctionCallRelativePath(graph, left.filePath).localeCompare(
      getFunctionCallRelativePath(graph, right.filePath)
    )
  );

  return { files };
}

/** Adds or merges one relation into a source-keyed relation map. */
function addFunctionCallRelation(
  relationsByNodeId: Map<string, FunctionCallRelation[]>,
  ownerId: string,
  relatedNode: SymbolNode,
  edge: GraphEdge
): void {
  const relations = relationsByNodeId.get(ownerId) ?? [];
  const existing = relations.find((relation) => relation.node.id === relatedNode.id);

  if (existing) {
    existing.count += 1;
    existing.confidences.add(edge.confidence);
  } else {
    relations.push({
      node: relatedNode,
      count: 1,
      confidences: new Set([edge.confidence])
    });
  }

  relationsByNodeId.set(ownerId, relations);
}

/** Sorts each relation list so rows remain stable across renders. */
function sortFunctionCallRelationMap(relationsByNodeId: Map<string, FunctionCallRelation[]>): void {
  for (const relations of relationsByNodeId.values()) {
    relations.sort(compareFunctionCallRelations);
  }
}

/** Appends one file group and its child functions when expanded. */
function appendFunctionCallFileRow(
  graph: ProjectGraph,
  expandedTreeIds: Set<string>,
  fileGroup: FunctionCallFileGroup,
  rows: FunctionCallTreeRow[]
): void {
  const relativePath = getFunctionCallRelativePath(graph, fileGroup.filePath);
  const rowId = "call-file:" + fileGroup.filePath;
  const expanded = fileGroup.functions.length > 0 && expandedTreeIds.has(rowId);

  rows.push({
    id: rowId,
    label: relativePath,
    name: getFunctionCallFileName(relativePath),
    detail:
      getFunctionCallDirectoryName(relativePath) + " / " + String(fileGroup.functions.length) + " functions",
    kind: "entry",
    nodeId: fileGroup.fileNode?.id,
    depth: 0,
    hasChildren: fileGroup.functions.length > 0,
    expanded
  });

  if (!expanded) {
    return;
  }

  for (const record of fileGroup.functions) {
    appendFunctionCallFunctionRow(graph, expandedTreeIds, rowId, record, rows, 1);
  }
}

/** Appends one callable function row plus relation buckets when expanded. */
function appendFunctionCallFunctionRow(
  graph: ProjectGraph,
  expandedTreeIds: Set<string>,
  parentTreeId: string,
  record: FunctionCallRecord,
  rows: FunctionCallTreeRow[],
  depth: number
): void {
  const rowId = parentTreeId + ":fn:" + record.node.id;
  const counts = getFunctionCallCounts(record);
  const hasChildren = record.outgoing.length > 0 || record.incoming.length > 0;
  const expanded = hasChildren && expandedTreeIds.has(rowId);

  rows.push({
    id: rowId,
    label: getFunctionCallDisplayName(record.node),
    name: getFunctionCallDisplayName(record.node),
    detail:
      record.node.kind +
      " / " +
      String(counts.outgoing) +
      " calls / " +
      String(counts.incoming) +
      " callers",
    kind: "semantic",
    nodeId: record.node.id,
    depth,
    hasChildren,
    expanded
  });

  if (!expanded) {
    return;
  }

  appendFunctionCallBucketRow(graph, expandedTreeIds, rowId, "Calls", record.outgoing, rows, depth + 1);
  appendFunctionCallBucketRow(graph, expandedTreeIds, rowId, "Called by", record.incoming, rows, depth + 1);
}

/** Appends one relation bucket and direct related functions when expanded. */
function appendFunctionCallBucketRow(
  graph: ProjectGraph,
  expandedTreeIds: Set<string>,
  parentTreeId: string,
  name: string,
  relations: FunctionCallRelation[],
  rows: FunctionCallTreeRow[],
  depth: number
): void {
  if (relations.length === 0) {
    return;
  }

  const rowId = parentTreeId + ":" + name.toLowerCase().replace(/\s+/g, "-");
  const expanded = expandedTreeIds.has(rowId);

  rows.push({
    id: rowId,
    label: name,
    name,
    detail: String(relations.length) + " functions",
    kind: "semantic",
    depth,
    hasChildren: relations.length > 0,
    expanded
  });

  if (!expanded) {
    return;
  }

  for (const relation of relations) {
    appendFunctionCallRelationRow(graph, rowId, relation, rows, depth + 1);
  }
}

/** Appends one direct caller/callee relation row. */
function appendFunctionCallRelationRow(
  graph: ProjectGraph,
  parentTreeId: string,
  relation: FunctionCallRelation,
  rows: FunctionCallTreeRow[],
  depth: number
): void {
  const name = getFunctionCallDisplayName(relation.node);

  rows.push({
    id: parentTreeId + ":rel:" + relation.node.id,
    label: name,
    name,
    detail: getFunctionCallRelationDetail(graph, relation),
    kind: relation.node.kind === "external" ? "external" : "semantic",
    nodeId: relation.node.kind === "external" ? undefined : relation.node.id,
    depth,
    hasChildren: false,
    expanded: false
  });
}

/** Returns stable display counts for one callable. */
function getFunctionCallCounts(record: FunctionCallRecord): { outgoing: number; incoming: number } {
  return {
    outgoing: record.outgoing.reduce((total, relation) => total + relation.count, 0),
    incoming: record.incoming.reduce((total, relation) => total + relation.count, 0)
  };
}

/** Returns whether a graph node represents a callable function-like symbol. */
function isFunctionCallNode(node: SymbolNode): boolean {
  return node.kind === "function" || node.kind === "method" || node.kind === "constructor";
}

/** Sorts callable symbols by file, source line, then qualified name. */
function compareFunctionCallNodes(left: SymbolNode, right: SymbolNode): number {
  return (
    String(left.filePath).localeCompare(String(right.filePath)) ||
    Number(left.range?.startLine ?? 0) - Number(right.range?.startLine ?? 0) ||
    getFunctionCallDisplayName(left).localeCompare(getFunctionCallDisplayName(right))
  );
}

/** Sorts relation targets by node kind, file path, and display name. */
function compareFunctionCallRelations(
  left: FunctionCallRelation,
  right: FunctionCallRelation
): number {
  return (
    String(left.node.kind).localeCompare(String(right.node.kind)) ||
    String(left.node.filePath).localeCompare(String(right.node.filePath)) ||
    getFunctionCallDisplayName(left.node).localeCompare(getFunctionCallDisplayName(right.node))
  );
}

/** Returns a concise callable label. */
function getFunctionCallDisplayName(node: SymbolNode): string {
  return node.qualifiedName || node.name || "anonymous";
}

/** Returns source location and confidence metadata for a relation row. */
function getFunctionCallRelationDetail(graph: ProjectGraph, relation: FunctionCallRelation): string {
  const confidences = Array.from(relation.confidences).sort().join(",");
  const path = relation.node.kind === "external"
    ? "external"
    : getFunctionCallRelativePath(graph, relation.node.filePath);
  const count = relation.count > 1 ? " x" + String(relation.count) : "";

  return path + count + " / " + confidences;
}

/** Returns a workspace-relative path with a compact fallback for external nodes. */
function getFunctionCallRelativePath(graph: ProjectGraph, filePath: string): string {
  if (!filePath) {
    return "external";
  }

  const workspaceRoot = graph.workspaceRoot.replace(/\\\\/g, "/");
  const normalized = String(filePath).replace(/\\\\/g, "/");

  if (normalized.startsWith(workspaceRoot + "/")) {
    return normalized.slice(workspaceRoot.length + 1);
  }

  return normalized.split("/").slice(-3).join("/");
}

/** Returns the last segment of a path. */
function getFunctionCallFileName(relativePath: string): string {
  const parts = relativePath.split("/");
  return parts[parts.length - 1] || relativePath;
}

/** Returns the parent directory label for a path. */
function getFunctionCallDirectoryName(relativePath: string): string {
  const parts = relativePath.split("/");
  parts.pop();
  return parts.join("/") || ".";
}
