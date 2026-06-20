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
  importedFileIds: Set<string>;
  nodesById: Map<string, SymbolNode>;
};

/** Returns browser-injected source for progressive import graph helpers. */
export function getProgressiveFileGraphBrowserSource(): string {
  return [
    `const getGraphRelativePath = ${getGraphRelativePath.toString()};`,
    `const compareFileNodes = ${compareFileNodes.toString()};`,
    `const isFileImportTarget = ${isFileImportTarget.toString()};`,
    `const getFileNodes = ${getFileNodes.toString()};`,
    `const pushProgressiveChild = ${pushProgressiveChild.toString()};`,
    `const sortProgressiveChildMap = ${sortProgressiveChildMap.toString()};`,
    `const createProgressiveGraphIndex = ${createProgressiveGraphIndex.toString()};`,
    `const getImportRootNodes = ${getImportRootNodes.toString()};`,
    `const getApplicationEntrypointScore = ${getApplicationEntrypointScore.toString()};`,
    `const isNonApplicationRootPath = ${isNonApplicationRootPath.toString()};`,
    `const getOutgoingFileImportCount = ${getOutgoingFileImportCount.toString()};`,
    `const isImportedFile = ${isImportedFile.toString()};`,
    `const getApplicationEntryNodes = ${getApplicationEntryNodes.toString()};`,
    `const getApplicationEntryChildren = ${getApplicationEntryChildren.toString()};`,
    `const getImportedFileChildren = ${getImportedFileChildren.toString()};`
  ].join("\n");
}

/** Builds lookup maps once per received graph payload. */
export function createProgressiveGraphIndex(graph: ProjectGraph): ProgressiveGraphIndex {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const fileNodes = getFileNodes(graph).sort((left, right) => compareFileNodes(graph, left, right));
  const fileNodeIds = new Set(fileNodes.map((node) => node.id));
  const fileImportEdges: GraphEdge[] = [];
  const fileImportChildrenBySourceId = new Map<string, ProgressiveFileChild[]>();
  const containsChildrenBySourceId = new Map<string, ProgressiveFileChild[]>();
  const edgesBySourceId = new Map<string, ProgressiveFileChild[]>();
  const importedFileIds = new Set<string>();

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

    if (isFileImportTarget(edge, targetNode, fileNodeIds)) {
      fileImportEdges.push(edge);
      if (targetNode.kind === "file") {
        importedFileIds.add(edge.targetId);
      }
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
    importedFileIds,
    nodesById
  };
}

/** Returns application entry files for initial file-mode rendering. */
export function getApplicationEntryChildren(
  graph: ProjectGraph,
  index = createProgressiveGraphIndex(graph)
): ProgressiveFileChild[] {
  return getApplicationEntryNodes(graph, index).map((node) => ({ node, edgeKind: "contains" }));
}

/** Returns import graph root files for diagnostics and fallback rendering. */
export function getImportRootNodes(
  graph: ProjectGraph,
  index = createProgressiveGraphIndex(graph)
): SymbolNode[] {
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

  return roots;
}

/** Returns import graph root files for diagnostics and old call sites. */
export function getImportRootChildren(
  graph: ProjectGraph,
  index = createProgressiveGraphIndex(graph)
): ProgressiveFileChild[] {
  return getImportRootNodes(graph, index).map((node) => ({ node, edgeKind: "contains" }));
}

/**
 * Selects true application entrypoints instead of every zero-incoming import root.
 */
export function getApplicationEntryNodes(
  graph: ProjectGraph,
  index = createProgressiveGraphIndex(graph)
): SymbolNode[] {
  const scoredEntries = index.fileNodes
    .map((node) => ({
      node,
      score: getApplicationEntrypointScore(getGraphRelativePath(graph, node.filePath))
    }))
    .filter((candidate) => candidate.score > 0 && !isImportedFile(index, candidate.node.id))
    .sort((left, right) =>
      right.score - left.score || compareFileNodes(graph, left.node, right.node)
    )
    .map((candidate) => candidate.node);

  if (scoredEntries.length > 0) {
    return scoredEntries;
  }

  const importRoots = getImportRootNodes(graph, index);
  const filteredRoots = importRoots.filter((node) =>
    !isNonApplicationRootPath(getGraphRelativePath(graph, node.filePath))
  );
  const fallbackRoots = filteredRoots.length > 0 ? filteredRoots : importRoots;

  return fallbackRoots
    .sort((left, right) =>
      getOutgoingFileImportCount(index, right.id) -
        getOutgoingFileImportCount(index, left.id) ||
      compareFileNodes(graph, left, right)
    )
    .slice(0, 24);
}

/** Returns directly imported file children for a file node. */
export function getImportedFileChildren(
  graph: ProjectGraph,
  fileNodeId: string,
  index = createProgressiveGraphIndex(graph)
): ProgressiveFileChild[] {
  return index.fileImportChildrenBySourceId.get(fileNodeId) ?? [];
}

/** Returns file import/export edges to project files or external module leaves. */
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
  return getGraphRelativePath(graph, left.filePath).localeCompare(getGraphRelativePath(graph, right.filePath)) ||
    left.qualifiedName.localeCompare(right.qualifiedName) ||
    left.name.localeCompare(right.name);
}

/** Returns whether an edge is a file import tree child. */
function isFileImportTarget(edge: GraphEdge, targetNode: SymbolNode, fileNodeIds: Set<string>): boolean {
  return (
    (edge.kind === "imports" || edge.kind === "exports") &&
    fileNodeIds.has(edge.sourceId) &&
    (fileNodeIds.has(edge.targetId) || targetNode.kind === "external")
  );
}

/** Scores conventional application entrypoint file paths. */
export function getApplicationEntrypointScore(relativePath: string): number {
  const normalized = relativePath.replace(/\\/g, "/");

  if (/(^|\/)manage\.py$/.test(normalized)) {
    return 130;
  }

  if (/(^|\/)(apps|packages|services)\/[^/]+\/src\/(main|index)\.(ts|tsx|js|jsx)$/.test(normalized)) {
    return 124;
  }

  if (/(^|\/)src\/(main|index)\.(ts|tsx|js|jsx)$/.test(normalized)) {
    return 122;
  }

  if (/^(main|index)\.(ts|tsx|js|jsx|py)$/.test(normalized)) {
    return 116;
  }

  if (/(^|\/)src\/(app|bootstrap|client|server)\.(ts|tsx|js|jsx)$/.test(normalized)) {
    return 110;
  }

  if (/(^|\/)src\/pages\/(_app|_document|_error)\.(ts|tsx|js|jsx)$/.test(normalized)) {
    return 104;
  }

  if (/(^|\/)src\/app\/layout\.(ts|tsx|js|jsx)$/.test(normalized)) {
    return 104;
  }

  if (/(^|\/)(apps|packages|services)\/[^/]+\/(main|index)\.(ts|tsx|js|jsx|py)$/.test(normalized)) {
    return 98;
  }

  return 0;
}

/** Filters route, story, generated, and test files out of entrypoint fallback. */
export function isNonApplicationRootPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/");

  return (
    /(^|\/)(node_modules|dist|build|coverage)\//.test(normalized) ||
    /(^|\/)(stories|__tests__|tests)\//.test(normalized) ||
    /(^|\/)\.storybook\//.test(normalized) ||
    /\.(stories|test|spec|d)\.(ts|tsx|js|jsx)$/.test(normalized) ||
    /(^|\/)(__generated__|generated|generated-icons)(\/|$)/.test(normalized) ||
    /(^|\/)pages\//.test(normalized) ||
    /(^|\/)app\/[^/]+\/page\.(ts|tsx|js|jsx)$/.test(normalized) ||
    /-page(\/|\.|-)/.test(normalized)
  );
}

/** Returns outgoing file import degree for fallback root ranking. */
export function getOutgoingFileImportCount(index: ProgressiveGraphIndex, nodeId: string): number {
  return index.fileImportChildrenBySourceId.get(nodeId)?.length ?? 0;
}

/** Returns whether another project file imports this file. */
export function isImportedFile(index: ProgressiveGraphIndex, nodeId: string): boolean {
  return index.importedFileIds.has(nodeId);
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
