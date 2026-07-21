/**
 * Pure directional-lineage filtering for a focused Module Flow scene.
 *
 * Ancestors are reached only through incoming edges and descendants only through
 * outgoing edges, so sibling branches sharing an ancestor do not leak into the
 * focused view. Traversal is iterative, cycle-safe, and explicitly depth-bounded.
 */

/** Minimum node identity required by the browser-side lineage filter. */
export type ModuleFlowLineageNode = {
  id: string;
};

/** Minimum directed edge identity required by the browser-side lineage filter. */
export type ModuleFlowLineageEdge = {
  id: string;
  sourceId: string;
  targetId: string;
};

/** Filtered maps preserve the complete caller-provided payload shapes. */
export type ModuleFlowLineageScene<
  Node extends ModuleFlowLineageNode,
  Edge extends ModuleFlowLineageEdge
> = {
  nodes: Map<string, Node>;
  edges: Map<string, Edge>;
};

/**
 * Retains one anchor, its directed ancestors, and its directed descendants.
 * Edges with unresolved endpoints never participate. `maximumDepth` applies
 * independently to the ancestor and descendant walks.
 */
export function createModuleFlowLineageScene<
  Node extends ModuleFlowLineageNode,
  Edge extends ModuleFlowLineageEdge
>(
  nodes: ReadonlyMap<string, Node>,
  edges: ReadonlyMap<string, Edge>,
  anchorNodeId: string,
  maximumDepth: number
): ModuleFlowLineageScene<Node, Edge> {
  if (!nodes.has(anchorNodeId)) {
    return { nodes: new Map(), edges: new Map() };
  }
  const boundedDepth = Number.isFinite(maximumDepth)
    ? Math.max(0, Math.floor(maximumDepth))
    : 0;
  const incomingByNodeId = new Map<string, string[]>();
  const outgoingByNodeId = new Map<string, string[]>();
  for (const edge of edges.values()) {
    if (!nodes.has(edge.sourceId) || !nodes.has(edge.targetId)) {
      continue;
    }
    const outgoing = outgoingByNodeId.get(edge.sourceId) ?? [];
    outgoing.push(edge.targetId);
    outgoingByNodeId.set(edge.sourceId, outgoing);
    const incoming = incomingByNodeId.get(edge.targetId) ?? [];
    incoming.push(edge.sourceId);
    incomingByNodeId.set(edge.targetId, incoming);
  }

  /** Walks one direction without crossing back into sibling branches. */
  function collectDirectionalLineage(adjacency: ReadonlyMap<string, readonly string[]>): Set<string> {
    const visited = new Set<string>([anchorNodeId]);
    const queue: Array<{ nodeId: string; depth: number }> = [
      { nodeId: anchorNodeId, depth: 0 }
    ];
    let cursor = 0;
    while (cursor < queue.length) {
      const current = queue[cursor];
      cursor += 1;
      if (!current || current.depth >= boundedDepth) {
        continue;
      }
      for (const neighborId of adjacency.get(current.nodeId) ?? []) {
        if (visited.has(neighborId)) {
          continue;
        }
        visited.add(neighborId);
        queue.push({ nodeId: neighborId, depth: current.depth + 1 });
      }
    }
    return visited;
  }

  const retainedNodeIds = collectDirectionalLineage(incomingByNodeId);
  for (const nodeId of collectDirectionalLineage(outgoingByNodeId)) {
    retainedNodeIds.add(nodeId);
  }
  const retainedNodes = new Map<string, Node>();
  for (const [nodeId, node] of nodes) {
    if (retainedNodeIds.has(nodeId)) {
      retainedNodes.set(nodeId, node);
    }
  }
  const retainedEdges = new Map<string, Edge>();
  for (const [edgeId, edge] of edges) {
    if (retainedNodeIds.has(edge.sourceId) && retainedNodeIds.has(edge.targetId)) {
      retainedEdges.set(edgeId, edge);
    }
  }
  return { nodes: retainedNodes, edges: retainedEdges };
}

/** Serializes the dependency-free lineage filter into the nonce Webview. */
export function getModuleFlowLineageFocusBrowserSource(): string {
  return createModuleFlowLineageScene.toString();
}
