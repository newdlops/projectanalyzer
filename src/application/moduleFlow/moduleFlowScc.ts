/**
 * Iterative strongly-connected-component indexing for Module Flow layouts.
 *
 * Kosaraju traversal is expressed with explicit frame and node stacks so large
 * dependency cycles cannot consume the JavaScript call stack. Component and
 * member ordering is canonicalized to keep layout output independent of input
 * array order.
 */

/** Minimal directed edge contract required by SCC discovery. */
export type ModuleFlowSccEdge = {
  sourceId: string;
  targetId: string;
};

/** One canonical strongly connected component. */
export type ModuleFlowSccComponent = {
  id: string;
  nodeIds: string[];
  cyclic: boolean;
  orderKey: string;
};

/** SCC membership index consumed by condensation ranking. */
export type ModuleFlowSccIndex = {
  components: ModuleFlowSccComponent[];
  componentByNodeId: ReadonlyMap<string, ModuleFlowSccComponent>;
};

/** Returns the SCC runtime as declarations suitable for a nonce inline script. */
export function getModuleFlowSccBrowserSource(): string {
  return [
    compareText,
    createAdjacencyIndex,
    createFinishOrder,
    createModuleFlowSccIndex
  ].map((value) => value.toString()).join("\n");
}

/** Explicit DFS frame retaining the next neighbor to inspect. */
type TraversalFrame = {
  nodeId: string;
  nextNeighborIndex: number;
};

/**
 * Creates deterministic SCC membership for a finite directed graph.
 * Unknown edge endpoints are ignored by the caller before this boundary.
 */
export function createModuleFlowSccIndex(
  nodeIds: readonly string[],
  edges: readonly ModuleFlowSccEdge[]
): ModuleFlowSccIndex {
  const orderedNodeIds = [...new Set(nodeIds)].sort(compareText);
  const knownNodeIds = new Set(orderedNodeIds);
  const adjacency = createAdjacencyIndex(orderedNodeIds, edges, knownNodeIds, false);
  const reverseAdjacency = createAdjacencyIndex(orderedNodeIds, edges, knownNodeIds, true);
  const finishOrder = createFinishOrder(orderedNodeIds, adjacency);
  const assigned = new Set<string>();
  const components: ModuleFlowSccComponent[] = [];
  const selfLoopNodeIds = new Set(
    edges
      .filter((edge) => edge.sourceId === edge.targetId && knownNodeIds.has(edge.sourceId))
      .map((edge) => edge.sourceId)
  );

  for (let finishIndex = finishOrder.length - 1; finishIndex >= 0; finishIndex -= 1) {
    const startNodeId = finishOrder[finishIndex];
    if (assigned.has(startNodeId)) {
      continue;
    }

    const members: string[] = [];
    const pending = [startNodeId];
    assigned.add(startNodeId);
    while (pending.length > 0) {
      const nodeId = pending.pop();
      if (nodeId === undefined) {
        continue;
      }
      members.push(nodeId);
      const neighbors = reverseAdjacency.get(nodeId) ?? [];
      // Push in reverse so the canonical lowest neighbor is visited first.
      for (let index = neighbors.length - 1; index >= 0; index -= 1) {
        const neighborId = neighbors[index];
        if (assigned.has(neighborId)) {
          continue;
        }
        assigned.add(neighborId);
        pending.push(neighborId);
      }
    }

    members.sort(compareText);
    const orderKey = members[0] ?? "";
    components.push({
      id: `module-flow-component:${encodeURIComponent(orderKey)}`,
      nodeIds: members,
      cyclic: members.length > 1 || selfLoopNodeIds.has(orderKey),
      orderKey
    });
  }

  components.sort((left, right) => compareText(left.orderKey, right.orderKey));
  const componentByNodeId = new Map<string, ModuleFlowSccComponent>();
  for (const component of components) {
    for (const nodeId of component.nodeIds) {
      componentByNodeId.set(nodeId, component);
    }
  }

  return { components, componentByNodeId };
}

/** Builds sorted, de-duplicated outgoing or incoming neighbor lists. */
function createAdjacencyIndex(
  nodeIds: readonly string[],
  edges: readonly ModuleFlowSccEdge[],
  knownNodeIds: ReadonlySet<string>,
  reverse: boolean
): Map<string, string[]> {
  const mutable = new Map(nodeIds.map((nodeId) => [nodeId, new Set<string>()]));
  for (const edge of edges) {
    if (!knownNodeIds.has(edge.sourceId) || !knownNodeIds.has(edge.targetId)) {
      continue;
    }
    const sourceId = reverse ? edge.targetId : edge.sourceId;
    const targetId = reverse ? edge.sourceId : edge.targetId;
    mutable.get(sourceId)?.add(targetId);
  }

  return new Map([...mutable].map(([nodeId, neighbors]) => [
    nodeId,
    [...neighbors].sort(compareText)
  ]));
}

/** Computes postorder with explicit DFS frames instead of recursion. */
function createFinishOrder(
  nodeIds: readonly string[],
  adjacency: ReadonlyMap<string, readonly string[]>
): string[] {
  const visited = new Set<string>();
  const finishOrder: string[] = [];

  for (const startNodeId of nodeIds) {
    if (visited.has(startNodeId)) {
      continue;
    }
    visited.add(startNodeId);
    const frames: TraversalFrame[] = [{ nodeId: startNodeId, nextNeighborIndex: 0 }];

    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      const neighbors = adjacency.get(frame.nodeId) ?? [];
      if (frame.nextNeighborIndex < neighbors.length) {
        const neighborId = neighbors[frame.nextNeighborIndex];
        frame.nextNeighborIndex += 1;
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          frames.push({ nodeId: neighborId, nextNeighborIndex: 0 });
        }
        continue;
      }

      frames.pop();
      finishOrder.push(frame.nodeId);
    }
  }

  return finishOrder;
}

/** Locale-independent identity comparison for reproducible layout snapshots. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
