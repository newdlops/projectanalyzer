/**
 * Browser-side lane ordering, spacing, and port allocation for compound
 * function graphs. These helpers keep child-call routes distinct and iterative.
 */

/** Returns CSP-compatible routing helpers used by the compound scene layout. */
export function getCompoundFunctionLogicRoutingSource(): string {
  return /* js */ `
    /** Orders each rank near its incoming parent lanes to reduce edge crossings. */
    function orderCompoundBlocksByParentLane(
      blocksByRank,
      orderedRanks,
      edges,
      rankByBlockId,
      backEdgeIds,
      blockIndexById
    ) {
      const incomingByTargetId = new Map();
      for (const edge of edges) {
        if (backEdgeIds.has(edge.id)) continue;
        const values = incomingByTargetId.get(edge.targetId) || [];
        values.push(edge);
        incomingByTargetId.set(edge.targetId, values);
      }
      const laneByBlockId = new Map();
      for (const rank of orderedRanks) {
        const rankBlocks = blocksByRank.get(rank) || [];
        rankBlocks.sort((left, right) => {
          const leftScore = compoundParentLaneScore(
            left.id,
            rank,
            incomingByTargetId,
            laneByBlockId,
            rankByBlockId,
            blockIndexById
          );
          const rightScore = compoundParentLaneScore(
            right.id,
            rank,
            incomingByTargetId,
            laneByBlockId,
            rankByBlockId,
            blockIndexById
          );
          return leftScore - rightScore
            || (blockIndexById.get(left.id) || 0) - (blockIndexById.get(right.id) || 0);
        });
        for (let lane = 0; lane < rankBlocks.length; lane += 1) {
          laneByBlockId.set(rankBlocks[lane].id, lane);
        }
      }
    }

    /** Computes a stable barycentric lane score with branch-aware sibling bias. */
    function compoundParentLaneScore(
      blockId,
      rank,
      incomingByTargetId,
      laneByBlockId,
      rankByBlockId,
      blockIndexById
    ) {
      const incoming = (incomingByTargetId.get(blockId) || []).filter((edge) =>
        (rankByBlockId.get(edge.sourceId) || 0) < rank
      );
      if (incoming.length === 0) {
        return 100000 + (blockIndexById.get(blockId) || 0);
      }
      let total = 0;
      for (const edge of incoming) {
        total += (laneByBlockId.get(edge.sourceId) || 0) + compoundEdgeLaneBias(edge);
      }
      return total / incoming.length;
    }

    /** Keeps control, synchronous call, and detached event siblings in order. */
    function compoundEdgeLaneBias(edge) {
      if (edge.kind === "true" || edge.kind === "iterate") return -0.3;
      if (edge.relation === "call" || edge.relation === "callReturn") return 0;
      if (edge.kind === "false" || edge.kind === "exit") return 0.3;
      if (edge.relation === "event") return 0.45;
      return 0.05;
    }

    /** Reserves enough vertical space for every edge to own a distinct gap track. */
    function createCompoundRankSpacing(
      orderedRanks,
      edges,
      rankByBlockId,
      backEdgeIds,
      routeHintByEdgeId
    ) {
      const outgoingCountByRank = new Map();
      const nonLocalIncomingCountByRank = new Map();
      for (const edge of edges) {
        const sourceRank = rankByBlockId.get(edge.sourceId) || 0;
        const targetRank = rankByBlockId.get(edge.targetId) || 0;
        outgoingCountByRank.set(sourceRank, (outgoingCountByRank.get(sourceRank) || 0) + 1);
        if (!isCompoundAdjacentEdge(
          edge,
          sourceRank,
          targetRank,
          backEdgeIds,
          routeHintByEdgeId
        )) {
          nonLocalIncomingCountByRank.set(
            targetRank,
            (nonLocalIncomingCountByRank.get(targetRank) || 0) + 1
          );
        }
      }
      const gapAfterRank = new Map();
      for (let rankIndex = 0; rankIndex < orderedRanks.length; rankIndex += 1) {
        const rank = orderedRanks[rankIndex];
        const nextRank = orderedRanks[rankIndex + 1];
        const departureCount = outgoingCountByRank.get(rank) || 0;
        const arrivalCount = nextRank === undefined
          ? 0
          : nonLocalIncomingCountByRank.get(nextRank) || 0;
        gapAfterRank.set(rank, Math.max(
          COMPOUND_RANK_GAP,
          COMPOUND_EDGE_TRACK_PADDING * 2
            + (departureCount + arrivalCount + 1) * COMPOUND_EDGE_TRACK_GAP
        ));
      }
      const firstRank = orderedRanks[0] || 0;
      const lastRank = orderedRanks[orderedRanks.length - 1] || 0;
      const topArrivalCount = nonLocalIncomingCountByRank.get(firstRank) || 0;
      const bottomDepartureCount = outgoingCountByRank.get(lastRank) || 0;
      return {
        gapAfterRank,
        topMargin: Math.max(
          COMPOUND_MARGIN_Y,
          COMPOUND_EDGE_TRACK_PADDING
            + (topArrivalCount + 1) * COMPOUND_EDGE_TRACK_GAP
        ),
        bottomMargin: Math.max(
          COMPOUND_MARGIN_Y,
          COMPOUND_EDGE_TRACK_PADDING
            + (bottomDepartureCount + 1) * COMPOUND_EDGE_TRACK_GAP
        )
      };
    }

    /** Allocates distinct node ports and departure/arrival tracks for every edge. */
    function createCompoundEdgeRoutingIndex(
      edges,
      nodeLayoutById,
      rankByBlockId,
      backEdgeIds,
      routeHintByEdgeId
    ) {
      const routingByEdgeId = new Map(edges.map((edge) => [edge.id, {}]));
      const outgoingByNodeId = groupCompoundEdges(edges, (edge) => edge.sourceId);
      const incomingByNodeId = groupCompoundEdges(edges, (edge) => edge.targetId);
      for (const [nodeId, outgoing] of outgoingByNodeId) {
        const node = nodeLayoutById.get(nodeId);
        if (!node) continue;
        outgoing.sort((left, right) => compareCompoundEdgeTargets(
          left,
          right,
          nodeLayoutById
        ));
        for (let index = 0; index < outgoing.length; index += 1) {
          const usableWidth = Math.max(1, node.width - COMPOUND_NODE_PORT_PADDING * 2);
          routingByEdgeId.get(outgoing[index].id).sourceX = node.x
            + COMPOUND_NODE_PORT_PADDING
            + usableWidth * (index + 1) / (outgoing.length + 1);
        }
      }
      for (const [nodeId, incoming] of incomingByNodeId) {
        const node = nodeLayoutById.get(nodeId);
        if (!node) continue;
        incoming.sort((left, right) => compareCompoundEdgeSources(
          left,
          right,
          nodeLayoutById
        ));
        for (let index = 0; index < incoming.length; index += 1) {
          const usableWidth = Math.max(1, node.width - COMPOUND_NODE_PORT_PADDING * 2);
          routingByEdgeId.get(incoming[index].id).targetX = node.x
            + COMPOUND_NODE_PORT_PADDING
            + usableWidth * (index + 1) / (incoming.length + 1);
        }
      }

      const outgoingByRank = groupCompoundEdges(edges, (edge) =>
        rankByBlockId.get(edge.sourceId) || 0
      );
      for (const rankEdges of outgoingByRank.values()) {
        rankEdges.sort((left, right) => compareCompoundEdgeSources(
          left,
          right,
          nodeLayoutById
        ) || compareCompoundEdgeTargets(left, right, nodeLayoutById));
        for (let index = 0; index < rankEdges.length; index += 1) {
          routingByEdgeId.get(rankEdges[index].id).sourceTrackIndex = index;
        }
      }

      const nonLocalEdges = edges.filter((edge) => {
        const sourceRank = rankByBlockId.get(edge.sourceId) || 0;
        const targetRank = rankByBlockId.get(edge.targetId) || 0;
        return !isCompoundAdjacentEdge(
          edge,
          sourceRank,
          targetRank,
          backEdgeIds,
          routeHintByEdgeId
        );
      });
      const incomingNonLocalByRank = groupCompoundEdges(nonLocalEdges, (edge) =>
        rankByBlockId.get(edge.targetId) || 0
      );
      for (const rankEdges of incomingNonLocalByRank.values()) {
        rankEdges.sort((left, right) => compareCompoundEdgeTargets(
          left,
          right,
          nodeLayoutById
        ) || compareCompoundEdgeSources(left, right, nodeLayoutById));
        for (let index = 0; index < rankEdges.length; index += 1) {
          routingByEdgeId.get(rankEdges[index].id).targetTrackIndex = index;
        }
      }
      return routingByEdgeId;
    }

    /** Groups finite edge arrays without recursive graph traversal. */
    function groupCompoundEdges(edges, keyOf) {
      const result = new Map();
      for (const edge of edges) {
        const key = keyOf(edge);
        const values = result.get(key) || [];
        values.push(edge);
        result.set(key, values);
      }
      return result;
    }

    /** Sorts outgoing ports toward their target lanes. */
    function compareCompoundEdgeTargets(left, right, nodesById) {
      return compoundNodeCenterX(nodesById.get(left.targetId))
        - compoundNodeCenterX(nodesById.get(right.targetId))
        || compoundEdgeLaneBias(left) - compoundEdgeLaneBias(right)
        || left.id.localeCompare(right.id);
    }

    /** Sorts incoming ports from their source lanes. */
    function compareCompoundEdgeSources(left, right, nodesById) {
      return compoundNodeCenterX(nodesById.get(left.sourceId))
        - compoundNodeCenterX(nodesById.get(right.sourceId))
        || left.id.localeCompare(right.id);
    }

    /** Returns a safe horizontal center for one positioned node. */
    function compoundNodeCenterX(node) {
      return node ? node.x + node.width / 2 : 0;
    }

    /** Identifies one-rank forward edges that can remain inside a rank gap. */
    function isCompoundAdjacentEdge(
      edge,
      sourceRank,
      targetRank,
      backEdgeIds,
      routeHintByEdgeId
    ) {
      return !backEdgeIds.has(edge.id)
        && routeHintByEdgeId.get(edge.id) !== "long"
        && targetRank === sourceRank + 1;
    }
  `;
}
