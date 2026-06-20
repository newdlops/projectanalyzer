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
