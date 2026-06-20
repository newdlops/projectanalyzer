/**
 * Browser-injected helpers for progressive file import graph exploration.
 */

import type { EdgeKind, GraphEdge, ProjectGraph, SymbolNode } from "../shared/types";

/** Progressive graph child record used by the browser script. */
export type ProgressiveFileChild = {
  edgeKind: EdgeKind;
  node: SymbolNode;
};

/** Indexed graph data used by the browser to avoid repeated full-array scans. */
export type ProgressiveGraphIndex = {
  containsChildrenBySourceId: Map<string, ProgressiveFileChild[]>;
  edgesBySourceId: Map<string, ProgressiveFileChild[]>;
  fileImportChildrenBySourceId: Map<string, ProgressiveFileChild[]>;
  fileImportEdges: GraphEdge[];
  fileNodes: SymbolNode[];
  nodesById: Map<string, SymbolNode>;
};

/** Builds lookup maps once per received graph payload. */
export function createProgressiveGraphIndex(graph: ProjectGraph): ProgressiveGraphIndex {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const fileNodes = getFileNodes(graph).sort((left, right) => compareFileNodes(graph, left, right));
  const fileNodeIds = new Set(fileNodes.map((node) => node.id));
  const fileImportEdges: GraphEdge[] = [];
  const fileImportChildrenBySourceId = new Map<string, ProgressiveFileChild[]>();
  const containsChildrenBySourceId = new Map<string, ProgressiveFileChild[]>();
  const edgesBySourceId = new Map<string, ProgressiveFileChild[]>();

  for (const edge of graph.edges) {
    const targetNode = nodesById.get(edge.targetId);

    if (!targetNode) {
      continue;
    }

    pushProgressiveChild(edgesBySourceId, edge.sourceId, {
      edgeKind: edge.kind,
      node: targetNode
    });

    if (edge.kind === "contains") {
      pushProgressiveChild(containsChildrenBySourceId, edge.sourceId, {
        edgeKind: edge.kind,
        node: targetNode
      });
    }

    if (
      (edge.kind === "imports" || edge.kind === "exports") &&
      fileNodeIds.has(edge.sourceId) &&
      fileNodeIds.has(edge.targetId)
    ) {
      fileImportEdges.push(edge);
      pushProgressiveChild(fileImportChildrenBySourceId, edge.sourceId, {
        edgeKind: edge.kind,
        node: targetNode
      });
    }
  }

  sortProgressiveChildMap(graph, containsChildrenBySourceId);
  sortProgressiveChildMap(graph, edgesBySourceId);
  sortProgressiveChildMap(graph, fileImportChildrenBySourceId);

  return {
    containsChildrenBySourceId,
    edgesBySourceId,
    fileImportChildrenBySourceId,
    fileImportEdges,
    fileNodes,
    nodesById
  };
}

/** Returns import graph root files for initial file-mode rendering. */
export function getImportRootChildren(
  graph: ProjectGraph,
  index = createProgressiveGraphIndex(graph)
): ProgressiveFileChild[] {
  const fileNodes = index.fileNodes;
  const importEdges = index.fileImportEdges;
  const importedFileIds = new Set(importEdges.map((edge) => edge.targetId));
  const importerFileIds = new Set(importEdges.map((edge) => edge.sourceId));
  let roots = fileNodes.filter((node) =>
    !importedFileIds.has(node.id) && (importerFileIds.has(node.id) || importEdges.length === 0)
  );

  if (roots.length === 0 && importEdges.length > 0) {
    roots = fileNodes.filter((node) => importerFileIds.has(node.id));
  }

  if (roots.length === 0) {
    roots = fileNodes;
  }

  return roots.map((node) => ({ node, edgeKind: "contains" }));
}

/** Returns directly imported file children for a file node. */
export function getImportedFileChildren(
  graph: ProjectGraph,
  fileNodeId: string,
  index = createProgressiveGraphIndex(graph)
): ProgressiveFileChild[] {
  return index.fileImportChildrenBySourceId.get(fileNodeId) ?? [];
}

/** Returns file-to-file import/export edges only. */
export function getFileImportEdges(graph: ProjectGraph): GraphEdge[] {
  return createProgressiveGraphIndex(graph).fileImportEdges;
}

/** Returns file nodes in a graph payload. */
export function getFileNodes(graph: ProjectGraph): SymbolNode[] {
  return graph.nodes.filter((node) => node.kind === "file");
}

/** Compares files by workspace-relative path. */
export function compareFileNodes(
  graph: ProjectGraph,
  left: SymbolNode,
  right: SymbolNode
): number {
  return getGraphRelativePath(graph, left.filePath).localeCompare(getGraphRelativePath(graph, right.filePath));
}

/** Returns a stable workspace-relative display path. */
export function getGraphRelativePath(graph: ProjectGraph, filePath: string): string {
  if (!filePath) {
    return "";
  }

  const workspaceRoot = graph.workspaceRoot.replace(/\\/g, "/");
  const normalized = filePath.replace(/\\/g, "/");

  if (normalized.startsWith(workspaceRoot + "/")) {
    return normalized.slice(workspaceRoot.length + 1);
  }

  return normalized.split("/").slice(-3).join("/");
}

/** Adds a child relationship to one lookup map. */
export function pushProgressiveChild(
  target: Map<string, ProgressiveFileChild[]>,
  sourceId: string,
  child: ProgressiveFileChild
): void {
  const existing = target.get(sourceId);

  if (existing) {
    existing.push(child);
    return;
  }

  target.set(sourceId, [child]);
}

/** Sorts child maps by stable file path first and node name second. */
export function sortProgressiveChildMap(
  graph: ProjectGraph,
  target: Map<string, ProgressiveFileChild[]>
): void {
  for (const children of target.values()) {
    children.sort((left, right) => compareFileNodes(graph, left.node, right.node));
  }
}
