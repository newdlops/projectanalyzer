/**
 * Iterative graph traversal helpers. All traversal is queue-based to avoid call
 * stack growth and to keep cycle handling explicit for large project graphs.
 */

import type { EdgeKind, GraphEdge, SymbolNode } from "../shared/types";
import type { GraphStore } from "./graphStore";

/** Direction used when expanding callers, callees, or file dependencies. */
export type TraversalDirection = "outgoing" | "incoming";

/** Query options for bounded graph expansion. */
export type TraversalOptions = {
  rootNodeId: string;
  direction: TraversalDirection;
  maxDepth: number;
  edgeKinds?: readonly EdgeKind[];
};

/** Bounded subgraph returned to command handlers and Webview protocol. */
export type TraversalResult = {
  nodes: SymbolNode[];
  edges: GraphEdge[];
};

/**
 * Expands a subgraph from a root node with explicit depth and visited guards.
 */
export function traverseGraph(store: GraphStore, options: TraversalOptions): TraversalResult {
  const root = store.getNode(options.rootNodeId);

  if (!root) {
    return { nodes: [], edges: [] };
  }

  /** Node IDs that have already been queued or visited. */
  const visitedNodeIds = new Set<string>([options.rootNodeId]);

  /** Edge IDs included in the resulting subgraph. */
  const includedEdgeIds = new Set<string>();

  /** Queue entries carry depth so expansion can stop without recursion. */
  const queue: Array<{ nodeId: string; depth: number }> = [{ nodeId: options.rootNodeId, depth: 0 }];

  const nodes: SymbolNode[] = [root];
  const edges: GraphEdge[] = [];
  const allowedEdgeKinds = options.edgeKinds ? new Set(options.edgeKinds) : undefined;

  while (queue.length > 0) {
    const current = queue.shift();

    if (!current || current.depth >= options.maxDepth) {
      continue;
    }

    const candidateEdges = getEdgesForDirection(store, current.nodeId, options.direction);

    for (const edge of candidateEdges) {
      if (allowedEdgeKinds && !allowedEdgeKinds.has(edge.kind)) {
        continue;
      }

      if (!includedEdgeIds.has(edge.id)) {
        includedEdgeIds.add(edge.id);
        edges.push(edge);
      }

      const nextNodeId = options.direction === "outgoing" ? edge.targetId : edge.sourceId;

      if (visitedNodeIds.has(nextNodeId)) {
        continue;
      }

      const nextNode = store.getNode(nextNodeId);

      if (!nextNode) {
        continue;
      }

      visitedNodeIds.add(nextNodeId);
      nodes.push(nextNode);
      queue.push({ nodeId: nextNodeId, depth: current.depth + 1 });
    }
  }

  return { nodes, edges };
}

/**
 * Selects incoming or outgoing edge indexes from the graph store.
 */
function getEdgesForDirection(
  store: GraphStore,
  nodeId: string,
  direction: TraversalDirection
): GraphEdge[] {
  return direction === "outgoing" ? store.getOutgoingEdges(nodeId) : store.getIncomingEdges(nodeId);
}
