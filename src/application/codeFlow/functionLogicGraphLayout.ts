/**
 * Deterministic layered layout for one bounded Function Logic graph. Forward
 * control transfers flow top-to-bottom, source-ordered branches occupy sibling
 * lanes, and repeat/continue transfers use explicit outer back-edge channels.
 */

import type {
  FunctionLogicBlockPayload,
  FunctionLogicEdgePayload,
  FunctionLogicGraphEdgeLayoutPayload,
  FunctionLogicGraphLayoutPayload,
  FunctionLogicGraphNodeLayoutPayload
} from "../../protocol/functionLogic";

const NODE_WIDTH = 184;
const NODE_HEIGHT = 72;
const LANE_GAP = 34;
const RANK_GAP = 66;
const CANVAS_MARGIN_X = 38;
const CANVAS_MARGIN_Y = 24;
const BACK_EDGE_CHANNEL_GAP = 14;

/** Builds a finite graph layout using only iterative queues and indexed maps. */
export function createFunctionLogicGraphLayout(
  blocks: FunctionLogicBlockPayload[],
  edges: FunctionLogicEdgePayload[]
): FunctionLogicGraphLayoutPayload {
  if (blocks.length === 0) {
    return { width: 0, height: 0, nodes: [], edges: [] };
  }

  const blockIndexById = new Map(blocks.map((block, index) => [block.id, index]));
  const blocksById = new Map(blocks.map((block) => [block.id, block]));
  const validEdges = edges.filter((edge) =>
    blocksById.has(edge.sourceId) && blocksById.has(edge.targetId)
  );
  const backEdgeIds = new Set(validEdges.filter((edge) =>
    isBackEdge(edge, blockIndexById)
  ).map((edge) => edge.id));
  const rankByBlockId = assignForwardRanks(blocks, validEdges, backEdgeIds, blockIndexById);
  const blocksByRank = groupBlocksByRank(blocks, rankByBlockId);
  const maxLaneCount = Math.max(1, ...[...blocksByRank.values()].map((values) => values.length));
  const channelEdgeIds = new Set(validEdges.filter((edge) =>
    backEdgeIds.has(edge.id) || isLongForwardEdge(edge, rankByBlockId)
  ).map((edge) => edge.id));
  const channelSpace = channelEdgeIds.size > 0
    ? BACK_EDGE_CHANNEL_GAP * channelEdgeIds.size + 18
    : 0;
  const contentWidth = maxLaneCount * NODE_WIDTH + Math.max(0, maxLaneCount - 1) * LANE_GAP;
  const width = Math.max(280, contentWidth + CANVAS_MARGIN_X * 2 + channelSpace);
  const maxRank = Math.max(0, ...rankByBlockId.values());
  const height = CANVAS_MARGIN_Y * 2 + (maxRank + 1) * NODE_HEIGHT + maxRank * RANK_GAP;
  const nodes = positionNodes(blocksByRank, width, channelSpace);
  const nodeLayoutById = new Map(nodes.map((node) => [node.blockId, node]));
  const routedEdges = routeEdges(
    validEdges,
    nodeLayoutById,
    backEdgeIds,
    channelEdgeIds
  );

  return { width, height, nodes, edges: routedEdges };
}

/** Assigns longest-path ranks after removing known backward control transfers. */
function assignForwardRanks(
  blocks: FunctionLogicBlockPayload[],
  edges: FunctionLogicEdgePayload[],
  backEdgeIds: Set<string>,
  blockIndexById: Map<string, number>
): Map<string, number> {
  const indegreeById = new Map(blocks.map((block) => [block.id, 0]));
  const outgoingById = new Map<string, FunctionLogicEdgePayload[]>();

  for (const edge of edges) {
    if (backEdgeIds.has(edge.id)) {
      continue;
    }
    indegreeById.set(edge.targetId, (indegreeById.get(edge.targetId) ?? 0) + 1);
    const outgoing = outgoingById.get(edge.sourceId) ?? [];
    outgoing.push(edge);
    outgoingById.set(edge.sourceId, outgoing);
  }

  const rankById = new Map(blocks.map((block) => [block.id, 0]));
  const ready = blocks
    .filter((block) => (indegreeById.get(block.id) ?? 0) === 0)
    .sort((left, right) => compareBlockOrder(left.id, right.id, blockIndexById));
  let readyIndex = 0;
  const processed = new Set<string>();

  while (readyIndex < ready.length) {
    const block = ready[readyIndex];
    readyIndex += 1;
    if (processed.has(block.id)) {
      continue;
    }
    processed.add(block.id);
    const sourceRank = rankById.get(block.id) ?? 0;
    const outgoing = outgoingById.get(block.id) ?? [];
    outgoing.sort((left, right) => compareEdgeOrder(left, right, blockIndexById));
    for (const edge of outgoing) {
      rankById.set(edge.targetId, Math.max(rankById.get(edge.targetId) ?? 0, sourceRank + 1));
      const nextIndegree = Math.max(0, (indegreeById.get(edge.targetId) ?? 0) - 1);
      indegreeById.set(edge.targetId, nextIndegree);
      if (nextIndegree === 0) {
        const target = blocks[blockIndexById.get(edge.targetId) ?? -1];
        if (target) {
          ready.push(target);
        }
      }
    }
  }

  // Malformed or newly added edge kinds must not make layout fail. Any node
  // left in a forward cycle receives a stable source-order rank after the DAG.
  let fallbackRank = Math.max(0, ...rankById.values());
  for (const block of blocks) {
    if (!processed.has(block.id)) {
      fallbackRank += 1;
      rankById.set(block.id, fallbackRank);
    }
  }
  return rankById;
}

/** Groups blocks by rank while preserving branch/source presentation order. */
function groupBlocksByRank(
  blocks: FunctionLogicBlockPayload[],
  rankByBlockId: Map<string, number>
): Map<number, FunctionLogicBlockPayload[]> {
  const result = new Map<number, FunctionLogicBlockPayload[]>();
  for (const block of blocks) {
    const rank = rankByBlockId.get(block.id) ?? 0;
    const values = result.get(rank) ?? [];
    values.push(block);
    result.set(rank, values);
  }
  return result;
}

/** Centers each rank and assigns non-overlapping horizontal lanes. */
function positionNodes(
  blocksByRank: Map<number, FunctionLogicBlockPayload[]>,
  canvasWidth: number,
  channelSpace: number
): FunctionLogicGraphNodeLayoutPayload[] {
  const result: FunctionLogicGraphNodeLayoutPayload[] = [];
  const ranks = [...blocksByRank.keys()].sort((left, right) => left - right);
  const usableWidth = canvasWidth - channelSpace;

  for (const rank of ranks) {
    const blocks = blocksByRank.get(rank) ?? [];
    const rankWidth = blocks.length * NODE_WIDTH + Math.max(0, blocks.length - 1) * LANE_GAP;
    const startX = Math.max(CANVAS_MARGIN_X, (usableWidth - rankWidth) / 2);
    for (let lane = 0; lane < blocks.length; lane += 1) {
      result.push({
        blockId: blocks[lane].id,
        x: Math.round(startX + lane * (NODE_WIDTH + LANE_GAP)),
        y: CANVAS_MARGIN_Y + rank * (NODE_HEIGHT + RANK_GAP),
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        rank,
        lane
      });
    }
  }
  return result;
}

/** Routes forward edges through rank gaps and backward edges through outer lanes. */
function routeEdges(
  edges: FunctionLogicEdgePayload[],
  nodesById: Map<string, FunctionLogicGraphNodeLayoutPayload>,
  backEdgeIds: Set<string>,
  channelEdgeIds: Set<string>
): FunctionLogicGraphEdgeLayoutPayload[] {
  const result: FunctionLogicGraphEdgeLayoutPayload[] = [];
  let channelEdgeIndex = 0;
  const contentRight = Math.max(0, ...[...nodesById.values()].map((node) => node.x + node.width));

  for (const edge of edges) {
    const source = nodesById.get(edge.sourceId);
    const target = nodesById.get(edge.targetId);
    if (!source || !target) {
      continue;
    }
    const backEdge = backEdgeIds.has(edge.id);
    if (channelEdgeIds.has(edge.id)) {
      const channelX = contentRight + 18 + channelEdgeIndex * BACK_EDGE_CHANNEL_GAP;
      channelEdgeIndex += 1;
      const sourceY = source.y + source.height / 2;
      const targetY = target.y + target.height / 2;
      result.push({
        edgeId: edge.id,
        points: [
          { x: source.x + source.width, y: sourceY },
          { x: channelX, y: sourceY },
          { x: channelX, y: targetY },
          { x: target.x + target.width, y: targetY }
        ],
        labelX: channelX - 5,
        labelY: Math.round((sourceY + targetY) / 2),
        route: backEdge ? "back" : "long"
      });
      continue;
    }

    const sourceX = source.x + source.width / 2;
    const sourceY = source.y + source.height;
    const targetX = target.x + target.width / 2;
    const targetY = target.y;
    const middleY = Math.round(sourceY + Math.max(18, (targetY - sourceY) / 2));
    result.push({
      edgeId: edge.id,
      points: [
        { x: sourceX, y: sourceY },
        { x: sourceX, y: middleY },
        { x: targetX, y: middleY },
        { x: targetX, y: targetY }
      ],
      labelX: Math.round(sourceX + (targetX - sourceX) * 0.28) + 5,
      labelY: middleY - 5,
      route: "forward"
    });
  }
  return result;
}

/** Long forward jumps use an outer channel so they do not cross middle ranks. */
function isLongForwardEdge(
  edge: FunctionLogicEdgePayload,
  rankByBlockId: Map<string, number>
): boolean {
  const sourceRank = rankByBlockId.get(edge.sourceId) ?? 0;
  const targetRank = rankByBlockId.get(edge.targetId) ?? 0;
  return targetRank > sourceRank + 1;
}

/** Identifies explicit loop transfers and defensive source-order back edges. */
function isBackEdge(
  edge: FunctionLogicEdgePayload,
  blockIndexById: Map<string, number>
): boolean {
  if (edge.kind === "repeat" || edge.kind === "continue") {
    return true;
  }
  const sourceIndex = blockIndexById.get(edge.sourceId) ?? -1;
  const targetIndex = blockIndexById.get(edge.targetId) ?? -1;
  return sourceIndex >= 0 && targetIndex >= 0 && targetIndex <= sourceIndex;
}

/** Stable node ordering for queue insertion and fallback behavior. */
function compareBlockOrder(
  leftId: string,
  rightId: string,
  blockIndexById: Map<string, number>
): number {
  return (blockIndexById.get(leftId) ?? Number.MAX_SAFE_INTEGER)
    - (blockIndexById.get(rightId) ?? Number.MAX_SAFE_INTEGER);
}

/** Stable edge order follows the target's source presentation position. */
function compareEdgeOrder(
  left: FunctionLogicEdgePayload,
  right: FunctionLogicEdgePayload,
  blockIndexById: Map<string, number>
): number {
  return compareBlockOrder(left.targetId, right.targetId, blockIndexById)
    || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}
