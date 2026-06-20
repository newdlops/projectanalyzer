/**
 * Graph projection utilities for Webview delivery. The extension keeps the full
 * analysis graph in cache, while the graph panel receives only the slice needed
 * for the active visual mode.
 */

import type { GraphViewMode } from "../protocol/messages";
import type { EdgeKind, GraphEdge, ProjectGraph, SymbolKind } from "../shared/types";

/** Small summary used by host-side logging. */
export type GraphProjectionSummary = {
  edges: number;
  nodes: number;
};

/** Import graph health summary used to diagnose entry-point explosions. */
export type FileImportGraphSummary = {
  entryRoots: number;
  entryRootDirectories: Array<{ count: number; path: string }>;
  fileNodes: number;
  importedFiles: number;
  importerFiles: number;
  importEdges: number;
};

/** Controls whether projected payload counts replace original analysis counts. */
export type GraphProjectionOptions = {
  preserveMetadata?: boolean;
};

const callNodeKinds = new Set<SymbolKind>(["function", "method", "constructor"]);
const classNodeKinds = new Set<SymbolKind>([
  "class",
  "interface",
  "enum",
  "method",
  "constructor",
  "property"
]);
const callEdgeKinds = new Set<EdgeKind>(["calls"]);
const classEdgeKinds = new Set<EdgeKind>(["extends", "implements", "overrides", "instantiates"]);

/**
 * Creates a mode-specific graph payload for the visual graph browser.
 */
export function projectGraphForView(
  graph: ProjectGraph,
  mode: GraphViewMode,
  options: GraphProjectionOptions = {}
): ProjectGraph {
  const includedNodeIds = createIncludedNodeIds(graph, mode);
  const edges = graph.edges.filter((edge) =>
    isProjectedEdge(edge, mode) &&
    includedNodeIds.has(edge.sourceId) &&
    includedNodeIds.has(edge.targetId)
  );
  const nodes = graph.nodes.filter((node) => includedNodeIds.has(node.id));

  return {
    ...graph,
    nodes,
    edges,
    metadata: options.preserveMetadata
      ? graph.metadata
      : {
        ...graph.metadata,
        symbolCount: nodes.length,
        edgeCount: edges.length
      }
  };
}

/** Builds a concise count summary for logging projected payload sizes. */
export function summarizeProjectedGraph(graph: ProjectGraph): GraphProjectionSummary {
  return {
    edges: graph.edges.length,
    nodes: graph.nodes.length
  };
}

/** Builds root and edge counts for the file import graph. */
export function summarizeFileImportGraph(graph: ProjectGraph): FileImportGraphSummary {
  const fileNodes = graph.nodes.filter((node) => node.kind === "file");
  const fileNodeIds = new Set(fileNodes.map((node) => node.id));
  const importEdges = graph.edges.filter((edge) =>
    (edge.kind === "imports" || edge.kind === "exports") &&
    fileNodeIds.has(edge.sourceId) &&
    fileNodeIds.has(edge.targetId)
  );
  const importedFileIds = new Set(importEdges.map((edge) => edge.targetId));
  const importerFileIds = new Set(importEdges.map((edge) => edge.sourceId));
  const entryRoots = fileNodes.filter((node) =>
    !importedFileIds.has(node.id) && (importerFileIds.has(node.id) || importEdges.length === 0)
  );
  const entryRootDirectories = createTopEntryRootDirectories(graph.workspaceRoot, entryRoots);

  return {
    entryRoots: entryRoots.length,
    entryRootDirectories,
    fileNodes: fileNodes.length,
    importedFiles: importedFileIds.size,
    importerFiles: importerFileIds.size,
    importEdges: importEdges.length
  };
}

/** Returns the largest directories that are producing entry roots. */
function createTopEntryRootDirectories(
  workspaceRoot: string,
  entryRoots: Array<{ filePath: string }>
): Array<{ count: number; path: string }> {
  const countsByDirectory = new Map<string, number>();

  for (const root of entryRoots) {
    const relativePath = getWorkspaceRelativePath(workspaceRoot, root.filePath);
    const directory = relativePath.split("/").slice(0, -1).join("/") || ".";
    countsByDirectory.set(directory, (countsByDirectory.get(directory) ?? 0) + 1);
  }

  return [...countsByDirectory.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 12)
    .map(([path, count]) => ({ count, path }));
}

/** Converts absolute file paths to stable workspace-relative paths for logs. */
function getWorkspaceRelativePath(workspaceRoot: string, filePath: string): string {
  const normalizedRoot = workspaceRoot.replace(/\\/g, "/");
  const normalizedFilePath = filePath.replace(/\\/g, "/");

  if (normalizedFilePath.startsWith(normalizedRoot + "/")) {
    return normalizedFilePath.slice(normalizedRoot.length + 1);
  }

  return normalizedFilePath.split("/").slice(-3).join("/");
}

/** Determines which node ids are needed for a panel mode. */
function createIncludedNodeIds(graph: ProjectGraph, mode: GraphViewMode): Set<string> {
  const includedNodeIds = new Set<string>();

  for (const node of graph.nodes) {
    if (node.kind === "file" || isProjectedSymbolNode(node.kind, mode)) {
      includedNodeIds.add(node.id);
    }
  }

  return includedNodeIds;
}

/** Checks whether a symbol node belongs to the active visual mode. */
function isProjectedSymbolNode(kind: SymbolKind, mode: GraphViewMode): boolean {
  if (mode === "file") {
    return false;
  }

  if (mode === "call") {
    return callNodeKinds.has(kind);
  }

  return classNodeKinds.has(kind);
}

/** Checks whether an edge belongs to the active visual mode. */
function isProjectedEdge(edge: GraphEdge, mode: GraphViewMode): boolean {
  if (mode === "file") {
    return edge.kind === "imports" || edge.kind === "exports";
  }

  if (edge.kind === "contains") {
    return true;
  }

  return getModeEdgeKinds(mode).has(edge.kind);
}

/** Returns structural relationship kinds for non-file visual modes. */
function getModeEdgeKinds(mode: GraphViewMode): Set<EdgeKind> {
  if (mode === "call") {
    return callEdgeKinds;
  }

  return classEdgeKinds;
}
