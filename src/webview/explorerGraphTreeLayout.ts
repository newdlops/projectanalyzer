/**
 * Cross-free tree layout used by progressive graph exploration. It deliberately
 * allows the world bounds to grow beyond the canvas so spacing stays stable and
 * users can pan or fit the view instead of seeing nodes compressed together.
 */

/** Minimal node shape needed by the tree layout. */
export type TreeLayoutNode = {
  id: string;
};

/** Minimal edge shape needed by the tree layout. */
export type TreeLayoutEdge = {
  sourceId: string;
  targetId: string;
};

/**
 * Returns a top-down ordered tree layout when visible edges form a forest.
 */
export function createCrossFreeTreePositions(
  nodes: readonly TreeLayoutNode[],
  edges: readonly TreeLayoutEdge[],
  sceneWidth: number
): Map<string, { x: number; y: number }> | undefined {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const incomingCounts = new Map<string, number>();
  const childrenBySourceId = new Map<string, string[]>();

  for (const edge of edges) {
    if (!nodeIds.has(edge.sourceId) || !nodeIds.has(edge.targetId)) {
      continue;
    }

    incomingCounts.set(edge.targetId, (incomingCounts.get(edge.targetId) ?? 0) + 1);

    if ((incomingCounts.get(edge.targetId) ?? 0) > 1) {
      return undefined;
    }

    const children = childrenBySourceId.get(edge.sourceId) ?? [];
    children.push(edge.targetId);
    childrenBySourceId.set(edge.sourceId, children);
  }

  const roots = nodes
    .map((node) => node.id)
    .filter((nodeId) => (incomingCounts.get(nodeId) ?? 0) === 0)
    .sort();

  if (edges.length === 0 || roots.length === 0) {
    return undefined;
  }

  const positions = new Map<string, { x: number; y: number }>();
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const horizontalGap = 190;
  const verticalGap = 92;
  const marginX = Math.max(74, Math.min(140, sceneWidth * 0.1));
  const marginY = 78;
  let nextLeafIndex = 0;

  for (const rootId of roots) {
    if (!placeSubtree(rootId, 0)) {
      return undefined;
    }
  }

  if (visited.size !== nodeIds.size) {
    return undefined;
  }

  return positions;

  /** Places one subtree and returns false when a cycle is encountered. */
  function placeSubtree(nodeId: string, depth: number): boolean {
    if (visiting.has(nodeId)) {
      return false;
    }

    if (visited.has(nodeId)) {
      return true;
    }

    visiting.add(nodeId);

    const children = [...(childrenBySourceId.get(nodeId) ?? [])].sort();
    const childYs: number[] = [];

    for (const childId of children) {
      if (!placeSubtree(childId, depth + 1)) {
        return false;
      }

      const childPosition = positions.get(childId);

      if (childPosition) {
        childYs.push(childPosition.y);
      }
    }

    const y = childYs.length > 0
      ? childYs.reduce((sum, childY) => sum + childY, 0) / childYs.length
      : marginY + nextLeafIndex++ * verticalGap;
    positions.set(nodeId, {
      x: marginX + depth * horizontalGap,
      y
    });
    visiting.delete(nodeId);
    visited.add(nodeId);
    return true;
  }
}
