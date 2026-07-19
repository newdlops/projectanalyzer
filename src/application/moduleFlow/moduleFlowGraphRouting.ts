/**
 * Orthogonal edge routing for positioned Module Flow nodes.
 *
 * Adjacent component edges own distinct tracks inside empty rank gaps. Long,
 * backward, and SCC-internal edges own distinct channels outside all content,
 * which makes crossing an unrelated node box structurally impossible.
 */

import type {
  ModuleFlowGraphEdgeInput,
  ModuleFlowGraphEdgeLayout,
  ModuleFlowGraphNodeLayout,
  ModuleFlowGraphRankBounds
} from "./moduleFlowGraphLayout";

/** Geometry constants supplied by the layout so spacing and routing agree. */
export type ModuleFlowGraphRoutingOptions = {
  contentRight: number;
  edgeTrackGap: number;
  edgeTrackPadding: number;
  outerChannelGap: number;
  outerChannelOffset: number;
};

/** Complete positioned context required to route every retained edge. */
export type ModuleFlowGraphRoutingInput = {
  edges: readonly ModuleFlowGraphEdgeInput[];
  nodes: readonly ModuleFlowGraphNodeLayout[];
  rankBounds: ReadonlyMap<number, ModuleFlowGraphRankBounds>;
  outerEdgeIds: ReadonlySet<string>;
  options: ModuleFlowGraphRoutingOptions;
};

/** Per-edge port and gap-track allocation. */
type MutableEdgeRouting = {
  sourceX?: number;
  targetX?: number;
  sourceTrackIndex?: number;
  targetTrackIndex?: number;
};

/** Returns all routing declarations for a nonce-protected inline script. */
export function getModuleFlowGraphRoutingBrowserSource(): string {
  return [
    compareRoutingText,
    groupRoutingEdges,
    nodeCenterX,
    compareEdgeTargets,
    compareEdgeSources,
    compareEdgesByRanks,
    createEdgeRoutingIndex,
    compactOrthogonalRoute,
    routeModuleFlowGraphEdges
  ].map((value) => value.toString()).join("\n");
}

/** Routes every edge with deterministic ports, gap tracks, and outer channels. */
export function routeModuleFlowGraphEdges(
  input: ModuleFlowGraphRoutingInput
): ModuleFlowGraphEdgeLayout[] {
  const nodesById = new Map(input.nodes.map((node) => [node.nodeId, node]));
  const orderedEdges = [...input.edges].sort((left, right) =>
    compareEdgesByRanks(left, right, nodesById)
  );
  const outerEdges = orderedEdges.filter((edge) => input.outerEdgeIds.has(edge.id));
  const outerTrackByEdgeId = new Map(
    outerEdges.map((edge, index) => [edge.id, index])
  );
  const routingByEdgeId = createEdgeRoutingIndex(
    orderedEdges,
    nodesById,
    input.outerEdgeIds
  );
  const result: ModuleFlowGraphEdgeLayout[] = [];

  for (const edge of orderedEdges) {
    const source = nodesById.get(edge.sourceId);
    const target = nodesById.get(edge.targetId);
    if (!source || !target) {
      continue;
    }
    const routing = routingByEdgeId.get(edge.id) ?? {};
    const sourcePoint = {
      x: routing.sourceX ?? source.x + source.width / 2,
      y: source.y + source.height
    };
    const targetPoint = {
      x: routing.targetX ?? target.x + target.width / 2,
      y: target.y
    };
    const sourceRankBottom = input.rankBounds.get(source.rank)?.bottom ?? sourcePoint.y;
    const sourceGapY = sourceRankBottom
      + input.options.edgeTrackPadding
      + (routing.sourceTrackIndex ?? 0) * input.options.edgeTrackGap;

    if (!input.outerEdgeIds.has(edge.id)) {
      result.push({
        edgeId: edge.id,
        points: compactOrthogonalRoute([
          sourcePoint,
          { x: sourcePoint.x, y: sourceGapY },
          { x: targetPoint.x, y: sourceGapY },
          targetPoint
        ]),
        labelX: Math.round((sourcePoint.x + targetPoint.x) / 2),
        labelY: Math.round(sourceGapY - 6),
        route: "forward"
      });
      continue;
    }

    const outerTrack = outerTrackByEdgeId.get(edge.id) ?? 0;
    const channelX = input.options.contentRight
      + input.options.outerChannelOffset
      + outerTrack * input.options.outerChannelGap;
    const targetRankTop = input.rankBounds.get(target.rank)?.top ?? targetPoint.y;
    const targetGapY = targetRankTop
      - input.options.edgeTrackPadding
      - (routing.targetTrackIndex ?? 0) * input.options.edgeTrackGap;
    const sameComponent = source.componentId === target.componentId;
    const route = sameComponent || source.rank === target.rank
      ? "cycle"
      : target.rank < source.rank
        ? "back"
        : "long";
    result.push({
      edgeId: edge.id,
      points: compactOrthogonalRoute([
        sourcePoint,
        { x: sourcePoint.x, y: sourceGapY },
        { x: channelX, y: sourceGapY },
        { x: channelX, y: targetGapY },
        { x: targetPoint.x, y: targetGapY },
        targetPoint
      ]),
      labelX: Math.round(channelX - 6),
      labelY: Math.round((sourceGapY + targetGapY) / 2),
      route,
      outerTrack
    });
  }

  return result;
}

/** Allocates distinct source/target ports and rank tracks for every edge. */
function createEdgeRoutingIndex(
  edges: readonly ModuleFlowGraphEdgeInput[],
  nodesById: ReadonlyMap<string, ModuleFlowGraphNodeLayout>,
  outerEdgeIds: ReadonlySet<string>
): Map<string, MutableEdgeRouting> {
  const routingByEdgeId = new Map(edges.map((edge) => [edge.id, {} as MutableEdgeRouting]));
  const outgoingByNodeId = groupRoutingEdges(edges, (edge) => edge.sourceId);
  const incomingByNodeId = groupRoutingEdges(edges, (edge) => edge.targetId);

  for (const [nodeId, outgoing] of outgoingByNodeId) {
    const node = nodesById.get(nodeId);
    if (!node) {
      continue;
    }
    outgoing.sort((left, right) => compareEdgeTargets(left, right, nodesById));
    const usableWidth = Math.max(1, node.width - 36);
    for (let index = 0; index < outgoing.length; index += 1) {
      const routing = routingByEdgeId.get(outgoing[index].id);
      if (routing) {
        routing.sourceX = node.x + 18 + usableWidth * (index + 1) / (outgoing.length + 1);
      }
    }
  }

  for (const [nodeId, incoming] of incomingByNodeId) {
    const node = nodesById.get(nodeId);
    if (!node) {
      continue;
    }
    incoming.sort((left, right) => compareEdgeSources(left, right, nodesById));
    const usableWidth = Math.max(1, node.width - 36);
    for (let index = 0; index < incoming.length; index += 1) {
      const routing = routingByEdgeId.get(incoming[index].id);
      if (routing) {
        routing.targetX = node.x + 18 + usableWidth * (index + 1) / (incoming.length + 1);
      }
    }
  }

  const outgoingByRank = groupRoutingEdges(edges, (edge) =>
    nodesById.get(edge.sourceId)?.rank ?? 0
  );
  for (const rankEdges of outgoingByRank.values()) {
    rankEdges.sort((left, right) => compareEdgeSources(left, right, nodesById)
      || compareEdgeTargets(left, right, nodesById));
    for (let index = 0; index < rankEdges.length; index += 1) {
      const routing = routingByEdgeId.get(rankEdges[index].id);
      if (routing) {
        routing.sourceTrackIndex = index;
      }
    }
  }

  const incomingOuterByRank = groupRoutingEdges(
    edges.filter((edge) => outerEdgeIds.has(edge.id)),
    (edge) => nodesById.get(edge.targetId)?.rank ?? 0
  );
  for (const rankEdges of incomingOuterByRank.values()) {
    rankEdges.sort((left, right) => compareEdgeTargets(left, right, nodesById)
      || compareEdgeSources(left, right, nodesById));
    for (let index = 0; index < rankEdges.length; index += 1) {
      const routing = routingByEdgeId.get(rankEdges[index].id);
      if (routing) {
        routing.targetTrackIndex = index;
      }
    }
  }

  return routingByEdgeId;
}

/** Groups finite edge arrays without graph traversal. */
function groupRoutingEdges<K>(
  edges: readonly ModuleFlowGraphEdgeInput[],
  keyOf: (edge: ModuleFlowGraphEdgeInput) => K
): Map<K, ModuleFlowGraphEdgeInput[]> {
  const result = new Map<K, ModuleFlowGraphEdgeInput[]>();
  for (const edge of edges) {
    const key = keyOf(edge);
    const values = result.get(key) ?? [];
    values.push(edge);
    result.set(key, values);
  }
  return result;
}

/** Orders outgoing ports toward target lanes. */
function compareEdgeTargets(
  left: ModuleFlowGraphEdgeInput,
  right: ModuleFlowGraphEdgeInput,
  nodesById: ReadonlyMap<string, ModuleFlowGraphNodeLayout>
): number {
  return nodeCenterX(nodesById.get(left.targetId))
    - nodeCenterX(nodesById.get(right.targetId))
    || compareRoutingText(left.targetId, right.targetId)
    || compareRoutingText(left.id, right.id);
}

/** Orders incoming ports from source lanes. */
function compareEdgeSources(
  left: ModuleFlowGraphEdgeInput,
  right: ModuleFlowGraphEdgeInput,
  nodesById: ReadonlyMap<string, ModuleFlowGraphNodeLayout>
): number {
  return nodeCenterX(nodesById.get(left.sourceId))
    - nodeCenterX(nodesById.get(right.sourceId))
    || compareRoutingText(left.sourceId, right.sourceId)
    || compareRoutingText(left.id, right.id);
}

/** Stable complete-edge ordering keeps outer channel identities reproducible. */
function compareEdgesByRanks(
  left: ModuleFlowGraphEdgeInput,
  right: ModuleFlowGraphEdgeInput,
  nodesById: ReadonlyMap<string, ModuleFlowGraphNodeLayout>
): number {
  const leftSource = nodesById.get(left.sourceId);
  const rightSource = nodesById.get(right.sourceId);
  const leftTarget = nodesById.get(left.targetId);
  const rightTarget = nodesById.get(right.targetId);
  return (leftSource?.rank ?? 0) - (rightSource?.rank ?? 0)
    || (leftTarget?.rank ?? 0) - (rightTarget?.rank ?? 0)
    || compareRoutingText(left.sourceId, right.sourceId)
    || compareRoutingText(left.targetId, right.targetId)
    || compareRoutingText(left.id, right.id);
}

/** Returns a safe horizontal center for one positioned node. */
function nodeCenterX(node: ModuleFlowGraphNodeLayout | undefined): number {
  return node ? node.x + node.width / 2 : 0;
}

/** Drops duplicate turns while retaining an orthogonal polyline. */
function compactOrthogonalRoute(
  points: readonly { x: number; y: number }[]
): Array<{ x: number; y: number }> {
  const compact: Array<{ x: number; y: number }> = [];
  for (const point of points) {
    const rounded = { x: Math.round(point.x), y: Math.round(point.y) };
    const previous = compact.at(-1);
    if (previous?.x === rounded.x && previous.y === rounded.y) {
      continue;
    }
    compact.push(rounded);
  }
  return compact;
}

/** Locale-independent comparison for identities crossing rendering runtimes. */
function compareRoutingText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
