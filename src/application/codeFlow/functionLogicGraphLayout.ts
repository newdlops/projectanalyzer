/**
 * Deterministic layered layout for one bounded Function Logic graph. Forward
 * control transfers flow top-to-bottom, source-ordered branches occupy sibling
 * lanes, node dimensions follow visible content, and non-local transfers use
 * outer channels whose connectors stay inside empty rank gaps.
 */

import type {
  FunctionLogicBlockPayload,
  FunctionLogicEdgePayload,
  FunctionLogicGraphEdgeLayoutPayload,
  FunctionLogicGraphLayoutPayload,
  FunctionLogicGraphNodeLayoutPayload
} from "../../protocol/functionLogic";

const MIN_NODE_WIDTH = 168;
const MAX_NODE_WIDTH = 320;
const MIN_NODE_HEIGHT = 68;
const NODE_HORIZONTAL_PADDING = 18;
const NODE_VERTICAL_PADDING = 14;
const NODE_ROW_GAP = 4;
const LABEL_CHARACTER_WIDTH = 7.2;
const META_CHARACTER_WIDTH = 6.1;
const TOP_CHARACTER_WIDTH = 5.8;
const LABEL_LINE_HEIGHT = 15;
const META_LINE_HEIGHT = 12;
const TOP_LINE_HEIGHT = 18;
const VALUE_CHANGE_CHARACTER_WIDTH = 6.2;
const VALUE_CHANGE_LINE_HEIGHT = 15;
const VALUE_CHANGE_ROW_GAP = 3;
const MAX_VALUE_ACCESS_ROWS = 8;
const LANE_GAP = 34;
const RANK_GAP = 66;
const CANVAS_MARGIN_X = 38;
const CANVAS_MARGIN_Y = 24;
const BACK_EDGE_CHANNEL_GAP = 14;
const CHANNEL_CONNECTOR_CLEARANCE = 18;

/** Estimated rendered size of one browser graph node. */
type NodeDimensions = { width: number; height: number };

/** Empty-space boundaries shared by every node in one horizontal rank. */
type RankBounds = { top: number; bottom: number };

/** One real or layout-only ordering rule used by longest-path ranking. */
type RankConstraint = {
  sourceId: string;
  targetId: string;
  orderKey: string;
};

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
  const dimensionsByBlockId = new Map(blocks.map((block) => [
    block.id,
    measureNodeDimensions(block)
  ]));
  const channelEdgeIds = new Set(validEdges.filter((edge) =>
    backEdgeIds.has(edge.id) || isLongForwardEdge(edge, rankByBlockId)
  ).map((edge) => edge.id));
  const channelSpace = channelEdgeIds.size > 0
    ? BACK_EDGE_CHANNEL_GAP * channelEdgeIds.size + 18
    : 0;
  const contentWidth = Math.max(1, ...[...blocksByRank.values()].map((rankBlocks) =>
    measureRankWidth(rankBlocks, dimensionsByBlockId)
  ));
  const width = Math.max(280, contentWidth + CANVAS_MARGIN_X * 2 + channelSpace);
  const nodes = positionNodes(
    blocksByRank,
    dimensionsByBlockId,
    width,
    channelSpace
  );
  const height = Math.max(...nodes.map((node) => node.y + node.height)) + CANVAS_MARGIN_Y;
  const nodeLayoutById = new Map(nodes.map((node) => [node.blockId, node]));
  const rankBounds = createRankBounds(nodes);
  const routedEdges = routeEdges(
    validEdges,
    nodeLayoutById,
    rankBounds,
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
  const outgoingById = new Map<string, RankConstraint[]>();
  const rankConstraints = createForwardRankConstraints(blocks, edges, backEdgeIds);

  for (const constraint of rankConstraints) {
    indegreeById.set(
      constraint.targetId,
      (indegreeById.get(constraint.targetId) ?? 0) + 1
    );
    const outgoing = outgoingById.get(constraint.sourceId) ?? [];
    outgoing.push(constraint);
    outgoingById.set(constraint.sourceId, outgoing);
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
    outgoing.sort((left, right) => compareRankConstraintOrder(
      left,
      right,
      blockIndexById
    ));
    for (const constraint of outgoing) {
      rankById.set(
        constraint.targetId,
        Math.max(rankById.get(constraint.targetId) ?? 0, sourceRank + 1)
      );
      const nextIndegree = Math.max(
        0,
        (indegreeById.get(constraint.targetId) ?? 0) - 1
      );
      indegreeById.set(constraint.targetId, nextIndegree);
      if (nextIndegree === 0) {
        const target = blocks[blockIndexById.get(constraint.targetId) ?? -1];
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

/**
 * Adds a layout-only body-terminal -> loop-exit ordering rule. Without it the
 * loop body and the first post-loop statement are sibling ranks, so the latter
 * appears inside the visual loop-back ring even though control has left it.
 */
function createForwardRankConstraints(
  blocks: FunctionLogicBlockPayload[],
  edges: FunctionLogicEdgePayload[],
  backEdgeIds: ReadonlySet<string>
): RankConstraint[] {
  const blocksById = new Map(blocks.map((block) => [block.id, block]));
  const constraints: RankConstraint[] = [];
  const constraintKeys = new Set<string>();
  const exitEdgesByLoopId = new Map<string, FunctionLogicEdgePayload[]>();

  for (const edge of edges) {
    if (backEdgeIds.has(edge.id)) {
      continue;
    }
    addRankConstraint(
      constraints,
      constraintKeys,
      edge.sourceId,
      edge.targetId,
      edge.id
    );
    if (blocksById.get(edge.sourceId)?.kind === "loop" && edge.kind === "exit") {
      const exits = exitEdgesByLoopId.get(edge.sourceId) ?? [];
      exits.push(edge);
      exitEdgesByLoopId.set(edge.sourceId, exits);
    }
  }

  for (const backEdge of edges) {
    if (!backEdgeIds.has(backEdge.id)
      || blocksById.get(backEdge.targetId)?.kind !== "loop") {
      continue;
    }
    for (const exitEdge of exitEdgesByLoopId.get(backEdge.targetId) ?? []) {
      addRankConstraint(
        constraints,
        constraintKeys,
        backEdge.sourceId,
        exitEdge.targetId,
        `loop-boundary:${backEdge.id}:${exitEdge.id}`
      );
    }
  }
  return constraints;
}

/** Adds one de-duplicated ranking constraint without changing rendered edges. */
function addRankConstraint(
  constraints: RankConstraint[],
  keys: Set<string>,
  sourceId: string,
  targetId: string,
  orderKey: string
): void {
  const key = `${sourceId}\0${targetId}`;
  if (keys.has(key)) {
    return;
  }
  keys.add(key);
  constraints.push({ sourceId, targetId, orderKey });
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

/** Estimates a node's browser dimensions from every string rendered inside it. */
function measureNodeDimensions(block: FunctionLogicBlockPayload): NodeDimensions {
  const metaText = block.sourceLocation || block.detail;
  const valueChangeTexts = (block.valueChanges ?? []).map(formatValueChangeText);
  const allValueAccessTexts = (block.valueAccesses ?? []).map(formatValueAccessText);
  const valueAccessTexts = allValueAccessTexts.slice(0, MAX_VALUE_ACCESS_ROWS);
  if (allValueAccessTexts.length > MAX_VALUE_ACCESS_ROWS) {
    valueAccessTexts.push(`+${allValueAccessTexts.length - MAX_VALUE_ACCESS_ROWS} more bindings`);
  }
  const valueRowTexts = [...valueChangeTexts, ...valueAccessTexts];
  const longestLineUnits = Math.max(
    1,
    longestDisplayLineUnits(block.label),
    longestDisplayLineUnits(metaText),
    longestDisplayLineUnits(block.branchLabel ?? ""),
    ...valueRowTexts.map(longestDisplayLineUnits)
  );
  const targetCharactersPerLine = clamp(
    Math.ceil(Math.sqrt(longestLineUnits * 12)),
    20,
    42
  );
  const topTextUnits = estimateTopRowUnits(block);
  const width = Math.round(clamp(
    Math.max(
      NODE_HORIZONTAL_PADDING + targetCharactersPerLine * LABEL_CHARACTER_WIDTH,
      NODE_HORIZONTAL_PADDING + Math.min(topTextUnits, 48) * TOP_CHARACTER_WIDTH
    ),
    MIN_NODE_WIDTH,
    MAX_NODE_WIDTH
  ));
  const innerWidth = Math.max(1, width - NODE_HORIZONTAL_PADDING);
  const topLines = estimateWrappedLineCount(topTextUnits, innerWidth, TOP_CHARACTER_WIDTH);
  const labelLines = estimateWrappedTextLineCount(
    block.label,
    innerWidth,
    LABEL_CHARACTER_WIDTH
  );
  const metaLines = estimateWrappedTextLineCount(
    metaText,
    innerWidth,
    META_CHARACTER_WIDTH
  );
  const valueRowLines = valueRowTexts.reduce(
    (count, text) => count + estimateWrappedTextLineCount(
      text,
      innerWidth,
      VALUE_CHANGE_CHARACTER_WIDTH
    ),
    0
  );
  const valueRowHeight = valueRowLines * VALUE_CHANGE_LINE_HEIGHT
    + Math.max(0, valueRowTexts.length - 1) * VALUE_CHANGE_ROW_GAP;
  const height = Math.max(
    MIN_NODE_HEIGHT,
    NODE_VERTICAL_PADDING
      + topLines * TOP_LINE_HEIGHT
      + labelLines * LABEL_LINE_HEIGHT
      + valueRowHeight
      + metaLines * META_LINE_HEIGHT
      + NODE_ROW_GAP * (valueRowTexts.length > 0 ? 3 : 2)
  );
  return { width, height: Math.ceil(height) };
}

/** Mirrors one parameter/local/constant access row rendered in the browser. */
function formatValueAccessText(
  access: NonNullable<FunctionLogicBlockPayload["valueAccesses"]>[number]
): string {
  return `${access.bindingKind} ${access.access} ${access.name} ${access.confidence}`;
}

/** Mirrors the compact value-change text rendered inside a graph node. */
function formatValueChangeText(
  change: NonNullable<FunctionLogicBlockPayload["valueChanges"]>[number]
): string {
  return `${change.targetKind} ${change.confidence} ${change.target} ${change.operator}`
    + (change.value ? ` ${change.value}` : "");
}

/** Sums variable node widths and the fixed visual space between sibling lanes. */
function measureRankWidth(
  blocks: FunctionLogicBlockPayload[],
  dimensionsByBlockId: Map<string, NodeDimensions>
): number {
  let width = Math.max(0, blocks.length - 1) * LANE_GAP;
  for (const block of blocks) {
    width += dimensionsByBlockId.get(block.id)?.width ?? MIN_NODE_WIDTH;
  }
  return width;
}

/** Centers each rank and assigns non-overlapping variable-width lanes. */
function positionNodes(
  blocksByRank: Map<number, FunctionLogicBlockPayload[]>,
  dimensionsByBlockId: Map<string, NodeDimensions>,
  canvasWidth: number,
  channelSpace: number
): FunctionLogicGraphNodeLayoutPayload[] {
  const result: FunctionLogicGraphNodeLayoutPayload[] = [];
  const ranks = [...blocksByRank.keys()].sort((left, right) => left - right);
  const usableWidth = canvasWidth - channelSpace;
  let rankY = CANVAS_MARGIN_Y;

  for (const rank of ranks) {
    const blocks = blocksByRank.get(rank) ?? [];
    const rankWidth = measureRankWidth(blocks, dimensionsByBlockId);
    const startX = Math.max(CANVAS_MARGIN_X, (usableWidth - rankWidth) / 2);
    const rankHeight = Math.max(
      MIN_NODE_HEIGHT,
      ...blocks.map((block) => dimensionsByBlockId.get(block.id)?.height ?? MIN_NODE_HEIGHT)
    );
    let laneX = startX;
    for (let lane = 0; lane < blocks.length; lane += 1) {
      const dimensions = dimensionsByBlockId.get(blocks[lane].id)
        ?? { width: MIN_NODE_WIDTH, height: MIN_NODE_HEIGHT };
      result.push({
        blockId: blocks[lane].id,
        x: Math.round(laneX),
        y: rankY,
        width: dimensions.width,
        height: dimensions.height,
        rank,
        lane
      });
      laneX += dimensions.width + LANE_GAP;
    }
    rankY += rankHeight + RANK_GAP;
  }
  return result;
}

/** Indexes the occupied vertical extent of every rank for obstacle-free gaps. */
function createRankBounds(
  nodes: FunctionLogicGraphNodeLayoutPayload[]
): Map<number, RankBounds> {
  const result = new Map<number, RankBounds>();
  for (const node of nodes) {
    const existing = result.get(node.rank);
    const bottom = node.y + node.height;
    if (existing) {
      existing.top = Math.min(existing.top, node.y);
      existing.bottom = Math.max(existing.bottom, bottom);
    } else {
      result.set(node.rank, { top: node.y, bottom });
    }
  }
  return result;
}

/** Routes every horizontal segment through a rank gap or an outer channel. */
function routeEdges(
  edges: FunctionLogicEdgePayload[],
  nodesById: Map<string, FunctionLogicGraphNodeLayoutPayload>,
  rankBounds: Map<number, RankBounds>,
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
      result.push(routeChannelEdge(
        edge,
        source,
        target,
        rankBounds,
        channelX,
        backEdge
      ));
      continue;
    }

    const sourceX = source.x + source.width / 2;
    const sourceY = source.y + source.height;
    const targetX = target.x + target.width / 2;
    const targetY = target.y;
    const sourceRankBottom = rankBounds.get(source.rank)?.bottom ?? sourceY;
    const targetRankTop = rankBounds.get(target.rank)?.top ?? targetY;
    const middleY = Math.round((sourceRankBottom + targetRankTop) / 2);
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

/** Routes long and backward transfers outside nodes before changing rank. */
function routeChannelEdge(
  edge: FunctionLogicEdgePayload,
  source: FunctionLogicGraphNodeLayoutPayload,
  target: FunctionLogicGraphNodeLayoutPayload,
  rankBounds: Map<number, RankBounds>,
  channelX: number,
  backEdge: boolean
): FunctionLogicGraphEdgeLayoutPayload {
  const sourceX = source.x + source.width / 2;
  const sourceY = source.y + source.height;
  const sourceRankBottom = rankBounds.get(source.rank)?.bottom ?? sourceY;
  const sourceGapY = sourceRankBottom + CHANNEL_CONNECTOR_CLEARANCE;
  const targetX = target.x + target.width / 2;
  const targetRank = rankBounds.get(target.rank);
  const targetY = backEdge ? target.y + target.height : target.y;
  const targetGapY = backEdge
    ? (targetRank?.bottom ?? targetY) + CHANNEL_CONNECTOR_CLEARANCE
    : (targetRank?.top ?? targetY) - CHANNEL_CONNECTOR_CLEARANCE;

  return {
    edgeId: edge.id,
    points: [
      { x: sourceX, y: sourceY },
      { x: sourceX, y: sourceGapY },
      { x: channelX, y: sourceGapY },
      { x: channelX, y: targetGapY },
      { x: targetX, y: targetGapY },
      { x: targetX, y: targetY }
    ],
    labelX: channelX - 5,
    labelY: Math.round((sourceGapY + targetGapY) / 2),
    route: backEdge ? "back" : "long"
  };
}

/** Estimates the combined badge and branch-label width in display units. */
function estimateTopRowUnits(block: FunctionLogicBlockPayload): number {
  let units = displayTextUnits(block.kind) + 6;
  if (block.drillTargets && block.drillTargets.length > 0) {
    units += displayTextUnits(`${block.drillTargets.length} child`) + 7;
  }
  if (block.branchLabel) {
    units += displayTextUnits(block.branchLabel) + 5;
  }
  return units;
}

/** Counts conservatively wrapped browser lines, including explicit newlines. */
function estimateWrappedTextLineCount(
  text: string,
  availableWidth: number,
  characterWidth: number
): number {
  const capacity = Math.max(1, Math.floor(availableWidth / characterWidth));
  let lines = 0;
  for (const sourceLine of text.split(/\r?\n/u)) {
    lines += Math.max(1, Math.ceil(displayTextUnits(sourceLine) / capacity));
  }
  return Math.max(1, lines);
}

/** Converts a precomputed display-unit count into conservative wrapped rows. */
function estimateWrappedLineCount(
  displayUnits: number,
  availableWidth: number,
  characterWidth: number
): number {
  const capacity = Math.max(1, Math.floor(availableWidth / characterWidth));
  return Math.max(1, Math.ceil(displayUnits / capacity));
}

/** Returns the widest explicit source line using wide-character-aware units. */
function longestDisplayLineUnits(text: string): number {
  let longest = 0;
  for (const line of text.split(/\r?\n/u)) {
    longest = Math.max(longest, displayTextUnits(line));
  }
  return longest;
}

/** Approximates rendered width without requiring DOM measurement in the Host. */
function displayTextUnits(text: string): number {
  let units = 0;
  for (const character of text) {
    if (character === "\t") {
      units += 4;
      continue;
    }
    units += (character.codePointAt(0) ?? 0) > 0xff ? 2 : 1;
  }
  return units;
}

/** Bounds one finite layout estimate between its readable minimum and maximum. */
function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
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

/** Stable rank-constraint order follows target presentation position. */
function compareRankConstraintOrder(
  left: RankConstraint,
  right: RankConstraint,
  blockIndexById: Map<string, number>
): number {
  return compareBlockOrder(left.targetId, right.targetId, blockIndexById)
    || (left.orderKey < right.orderKey ? -1 : left.orderKey > right.orderKey ? 1 : 0);
}
