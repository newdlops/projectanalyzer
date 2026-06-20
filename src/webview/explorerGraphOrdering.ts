/**
 * Deterministic layer ordering helpers for graph layouts. They keep children
 * near their previous-layer parent so depth expansion avoids avoidable crosses.
 */

import type { EdgeKind } from "../shared/types";

/** Minimal edge shape needed for ordering adjacent graph layers. */
export type OrderedGraphEdge = {
  sourceId: string;
  targetId: string;
};

/** Direction used to find a node's previous-layer neighbor. */
export type PreviousLayerDirection = "incoming" | "layered" | "outgoing";

/**
 * Creates a stable order lookup for a layer that has already been positioned.
 */
export function createOrderMap(nodeIds: readonly string[]): Map<string, number> {
  return new Map(nodeIds.map((nodeId, index) => [nodeId, index]));
}

/**
 * Orders a layer by the nearest known parent order before falling back to ID.
 */
export function orderGraphNodeIdsByPreviousLayer(
  nodeIds: readonly string[],
  previousOrder: ReadonlyMap<string, number>,
  edges: readonly OrderedGraphEdge[],
  direction: PreviousLayerDirection
): string[] {
  return [...nodeIds].sort((left, right) => {
    const leftOrder = getBestPreviousOrder(left, previousOrder, edges, direction);
    const rightOrder = getBestPreviousOrder(right, previousOrder, edges, direction);

    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    return left.localeCompare(right);
  });
}

/**
 * Detects graph views that should remain in tree-like left-to-right layers.
 */
export function shouldUseLayeredSelection(edges: readonly { kind?: EdgeKind }[]): boolean {
  if (edges.length === 0) {
    return false;
  }

  const structuralCount = edges.filter((edge) =>
    edge.kind === "contains" || edge.kind === "imports" || edge.kind === "exports"
  ).length;

  return structuralCount / edges.length >= 0.6;
}

/**
 * Finds the lowest previous-layer order connected to the current node.
 */
export function getBestPreviousOrder(
  nodeId: string,
  previousOrder: ReadonlyMap<string, number>,
  edges: readonly OrderedGraphEdge[],
  direction: PreviousLayerDirection
): number {
  let bestOrder = Number.MAX_SAFE_INTEGER;

  for (const edge of edges) {
    const previousNodeId = direction === "incoming"
      ? edge.sourceId === nodeId ? edge.targetId : undefined
      : edge.targetId === nodeId ? edge.sourceId : undefined;
    const order = previousNodeId ? previousOrder.get(previousNodeId) : undefined;

    if (order !== undefined && order < bestOrder) {
      bestOrder = order;
    }
  }

  return bestOrder;
}
