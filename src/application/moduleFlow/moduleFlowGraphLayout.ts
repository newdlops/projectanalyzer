/**
 * Deterministic, browser-portable layout for project Module Flow graphs.
 *
 * Strongly connected modules are rendered as explicit cycle groups, the
 * condensation DAG flows from top to bottom, visible text determines each
 * node's wrapped height, and orthogonal edge tracks stay outside unrelated
 * node boxes. The public input types deliberately contain presentation text
 * only so this pure module remains independent of protocol and VS Code APIs.
 */

import {
  createModuleFlowSccIndex,
  getModuleFlowSccBrowserSource,
  type ModuleFlowSccComponent
} from "./moduleFlowScc";
import {
  getModuleFlowGraphRoutingBrowserSource,
  routeModuleFlowGraphEdges, type ModuleFlowEdgeBridge
} from "./moduleFlowGraphRouting";

// Local aliases prevent CommonJS import rewrites from leaking into the
// serialized browser function body returned by getModuleFlowGraphLayoutBrowserSource.
const createModuleFlowSccIndexForLayout = createModuleFlowSccIndex;
const routeModuleFlowGraphEdgesForLayout = routeModuleFlowGraphEdges;

const MODULE_FLOW_MIN_NODE_WIDTH = 220, MODULE_FLOW_MAX_NODE_WIDTH = 420;
const MODULE_FLOW_MIN_NODE_HEIGHT = 104;
const MODULE_FLOW_NODE_PADDING_X = 22, MODULE_FLOW_NODE_PADDING_Y = 18;
const MODULE_FLOW_SECTION_GAP = 9, MODULE_FLOW_TEXT_ROW_GAP = 4;
const MODULE_FLOW_TITLE_CHARACTER_WIDTH = 7.8, MODULE_FLOW_BODY_CHARACTER_WIDTH = 6.4;
const MODULE_FLOW_BADGE_CHARACTER_WIDTH = 6.1;
const MODULE_FLOW_TITLE_LINE_HEIGHT = 20, MODULE_FLOW_BODY_LINE_HEIGHT = 16;
const MODULE_FLOW_BADGE_LINE_HEIGHT = 15;
const MODULE_FLOW_BADGE_PADDING_X = 14, MODULE_FLOW_BADGE_PADDING_Y = 5;
const MODULE_FLOW_BADGE_GAP = 7, MODULE_FLOW_COMPONENT_GAP = 72;
const MODULE_FLOW_CYCLE_MEMBER_GAP = 34, MODULE_FLOW_CYCLE_PADDING_X = 22;
const MODULE_FLOW_CYCLE_HEADER_HEIGHT = 38, MODULE_FLOW_CYCLE_PADDING_BOTTOM = 20;
const MODULE_FLOW_CANVAS_MARGIN_X = 42, MODULE_FLOW_CANVAS_MARGIN_Y = 28;
const MODULE_FLOW_EDGE_TRACK_GAP = 16, MODULE_FLOW_EDGE_TRACK_PADDING = 18;
const MODULE_FLOW_OUTER_CHANNEL_GAP = 18, MODULE_FLOW_OUTER_CHANNEL_OFFSET = 40;
const MODULE_FLOW_MIN_CANVAS_WIDTH = 320;

/** Presentation-only node accepted by the reusable Module Flow layout. */
export type ModuleFlowGraphNodeInput = {
  id: string;
  kind: "module" | "function" | "external";
  title: string;
  subtitle?: string;
  badges?: readonly string[];
  metricLines?: readonly string[];
  detailLines?: readonly string[];
};

/** Presentation-only directed relation accepted by the layout. */
export type ModuleFlowGraphEdgeInput = {
  id: string;
  sourceId: string;
  targetId: string;
  label?: string;
  kind?: string;
};

/** Positioned node rectangle consumed directly by the Module Flow Webview. */
export type ModuleFlowGraphNodeLayout = {
  nodeId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rank: number;
  lane: number;
  componentId: string;
};

/** Semantic route class used to style orthogonal connectors. */
export type ModuleFlowGraphEdgeRoute = "forward" | "long" | "back" | "cycle";

/** One completely routed orthogonal connector. */
export type ModuleFlowGraphEdgeLayout = {
  edgeId: string;
  points: Array<{ x: number; y: number }>;
  labelX: number;
  labelY: number;
  route: ModuleFlowGraphEdgeRoute;
  /** Stable, unique index for an edge using the graph's outer channel. */
  outerTrack?: number;
  bridges?: ModuleFlowEdgeBridge[];
};

/** Visible enclosure for one cyclic strongly connected component. */
export type ModuleFlowCycleGroupLayout = {
  id: string;
  label: string;
  nodeIds: string[];
  x: number;
  y: number;
  width: number;
  height: number;
  rank: number;
};

/** Empty-space boundaries shared by all components in one graph rank. */
export type ModuleFlowGraphRankBounds = {
  top: number;
  bottom: number;
};

/** Complete deterministic scene returned by the pure layout. */
export type ModuleFlowGraphLayout = {
  width: number;
  height: number;
  nodes: ModuleFlowGraphNodeLayout[];
  edges: ModuleFlowGraphEdgeLayout[];
  cycleGroups: ModuleFlowCycleGroupLayout[];
};

/** Estimated browser size for one graph node. */
type ModuleFlowNodeDimensions = { width: number; height: number };

/** Positioned width and height of one condensed component. */
type ModuleFlowComponentDimensions = { width: number; height: number };

/** Condensation ranks and predecessor identities used for lane ordering. */
type ModuleFlowComponentRankIndex = {
  rankByComponentId: Map<string, number>;
  predecessorsByComponentId: Map<string, Set<string>>;
};

/**
 * Builds a finite scene using only iterative graph traversals. Unknown edge
 * endpoints and duplicate identities are removed at this pure boundary.
 */
export function createModuleFlowGraphLayout(
  inputNodes: readonly ModuleFlowGraphNodeInput[],
  inputEdges: readonly ModuleFlowGraphEdgeInput[]
): ModuleFlowGraphLayout {
  const graphNodes = canonicalizeModuleFlowNodes(inputNodes);
  if (graphNodes.length === 0) {
    return { width: 0, height: 0, nodes: [], edges: [], cycleGroups: [] };
  }

  const knownNodeIds = new Set(graphNodes.map((node) => node.id));
  const graphEdges = canonicalizeModuleFlowEdges(inputEdges, knownNodeIds);
  const sccIndex = createModuleFlowSccIndexForLayout(
    graphNodes.map((node) => node.id),
    graphEdges
  );
  const rankIndex = createModuleFlowComponentRanks(sccIndex.components, graphEdges);
  const componentsByRank = orderModuleFlowComponentsByRank(
    sccIndex.components,
    rankIndex
  );
  const nodeDimensionsById = new Map(graphNodes.map((node) => [
    node.id,
    measureModuleFlowNode(node)
  ]));
  const componentDimensionsById = new Map(sccIndex.components.map((component) => [
    component.id,
    measureModuleFlowComponent(component, nodeDimensionsById)
  ]));
  const outerEdgeIds = findModuleFlowOuterEdges(
    graphEdges,
    sccIndex.componentByNodeId,
    rankIndex.rankByComponentId
  );
  const outgoingEdgeCountByRank = countModuleFlowEdgesByRank(
    graphEdges,
    sccIndex.componentByNodeId,
    rankIndex.rankByComponentId,
    false,
    outerEdgeIds
  );
  const incomingOuterEdgeCountByRank = countModuleFlowEdgesByRank(
    graphEdges,
    sccIndex.componentByNodeId,
    rankIndex.rankByComponentId,
    true,
    outerEdgeIds
  );
  const contentWidth = Math.max(1, ...[...componentsByRank.values()].map((components) =>
    measureModuleFlowRankWidth(components, componentDimensionsById)
  ));
  const positioned = positionModuleFlowComponents(
    componentsByRank,
    componentDimensionsById,
    nodeDimensionsById,
    contentWidth,
    incomingOuterEdgeCountByRank,
    outgoingEdgeCountByRank
  );
  const contentRight = MODULE_FLOW_CANVAS_MARGIN_X + contentWidth;
  const outerChannelSpace = outerEdgeIds.size > 0
    ? MODULE_FLOW_OUTER_CHANNEL_OFFSET
      + (outerEdgeIds.size - 1) * MODULE_FLOW_OUTER_CHANNEL_GAP
      + MODULE_FLOW_CANVAS_MARGIN_X
    : MODULE_FLOW_CANVAS_MARGIN_X;
  const width = Math.max(
    MODULE_FLOW_MIN_CANVAS_WIDTH,
    Math.ceil(contentRight + outerChannelSpace)
  );
  const height = Math.ceil(positioned.contentBottom + MODULE_FLOW_CANVAS_MARGIN_Y);
  const edges = routeModuleFlowGraphEdgesForLayout({
    edges: graphEdges,
    nodes: positioned.nodes,
    rankBounds: positioned.rankBounds,
    outerEdgeIds,
    options: {
      contentRight,
      edgeTrackGap: MODULE_FLOW_EDGE_TRACK_GAP,
      edgeTrackPadding: MODULE_FLOW_EDGE_TRACK_PADDING,
      outerChannelGap: MODULE_FLOW_OUTER_CHANNEL_GAP,
      outerChannelOffset: MODULE_FLOW_OUTER_CHANNEL_OFFSET
    }
  });
  return {
    width,
    height,
    nodes: positioned.nodes,
    edges,
    cycleGroups: positioned.cycleGroups
  };
}

/**
 * Returns the exact layout runtime as declarations for a nonce inline script.
 * The result contains its SCC and routing helpers and requires no eval/import.
 */
export function getModuleFlowGraphLayoutBrowserSource(): string {
  const runtimeConstants = [
    `const MODULE_FLOW_MIN_NODE_WIDTH=${MODULE_FLOW_MIN_NODE_WIDTH},MODULE_FLOW_MAX_NODE_WIDTH=${MODULE_FLOW_MAX_NODE_WIDTH},MODULE_FLOW_MIN_NODE_HEIGHT=${MODULE_FLOW_MIN_NODE_HEIGHT};`,
    `const MODULE_FLOW_NODE_PADDING_X=${MODULE_FLOW_NODE_PADDING_X},MODULE_FLOW_NODE_PADDING_Y=${MODULE_FLOW_NODE_PADDING_Y},MODULE_FLOW_SECTION_GAP=${MODULE_FLOW_SECTION_GAP},MODULE_FLOW_TEXT_ROW_GAP=${MODULE_FLOW_TEXT_ROW_GAP};`,
    `const MODULE_FLOW_TITLE_CHARACTER_WIDTH=${MODULE_FLOW_TITLE_CHARACTER_WIDTH},MODULE_FLOW_BODY_CHARACTER_WIDTH=${MODULE_FLOW_BODY_CHARACTER_WIDTH},MODULE_FLOW_BADGE_CHARACTER_WIDTH=${MODULE_FLOW_BADGE_CHARACTER_WIDTH};`,
    `const MODULE_FLOW_TITLE_LINE_HEIGHT=${MODULE_FLOW_TITLE_LINE_HEIGHT},MODULE_FLOW_BODY_LINE_HEIGHT=${MODULE_FLOW_BODY_LINE_HEIGHT},MODULE_FLOW_BADGE_LINE_HEIGHT=${MODULE_FLOW_BADGE_LINE_HEIGHT};`,
    `const MODULE_FLOW_BADGE_PADDING_X=${MODULE_FLOW_BADGE_PADDING_X},MODULE_FLOW_BADGE_PADDING_Y=${MODULE_FLOW_BADGE_PADDING_Y},MODULE_FLOW_BADGE_GAP=${MODULE_FLOW_BADGE_GAP};`,
    `const MODULE_FLOW_COMPONENT_GAP=${MODULE_FLOW_COMPONENT_GAP},MODULE_FLOW_CYCLE_MEMBER_GAP=${MODULE_FLOW_CYCLE_MEMBER_GAP},MODULE_FLOW_CYCLE_PADDING_X=${MODULE_FLOW_CYCLE_PADDING_X};`,
    `const MODULE_FLOW_CYCLE_HEADER_HEIGHT=${MODULE_FLOW_CYCLE_HEADER_HEIGHT},MODULE_FLOW_CYCLE_PADDING_BOTTOM=${MODULE_FLOW_CYCLE_PADDING_BOTTOM};`,
    `const MODULE_FLOW_CANVAS_MARGIN_X=${MODULE_FLOW_CANVAS_MARGIN_X},MODULE_FLOW_CANVAS_MARGIN_Y=${MODULE_FLOW_CANVAS_MARGIN_Y},MODULE_FLOW_MIN_CANVAS_WIDTH=${MODULE_FLOW_MIN_CANVAS_WIDTH};`,
    `const MODULE_FLOW_EDGE_TRACK_GAP=${MODULE_FLOW_EDGE_TRACK_GAP},MODULE_FLOW_EDGE_TRACK_PADDING=${MODULE_FLOW_EDGE_TRACK_PADDING};`,
    `const MODULE_FLOW_OUTER_CHANNEL_GAP=${MODULE_FLOW_OUTER_CHANNEL_GAP},MODULE_FLOW_OUTER_CHANNEL_OFFSET=${MODULE_FLOW_OUTER_CHANNEL_OFFSET};`
  ].join("\n");
  return [
    runtimeConstants,
    getModuleFlowSccBrowserSource(),
    getModuleFlowGraphRoutingBrowserSource(),
    "const createModuleFlowSccIndexForLayout = createModuleFlowSccIndex;",
    "const routeModuleFlowGraphEdgesForLayout = routeModuleFlowGraphEdges;",
    compareModuleFlowText, compareModuleFlowNodes, compareModuleFlowEdges,
    canonicalizeModuleFlowNodes, canonicalizeModuleFlowEdges,
    createModuleFlowComponentRanks, orderModuleFlowComponentsByRank,
    averageModuleFlowPredecessorOrder, measureModuleFlowNode,
    measureModuleFlowComponent, measureModuleFlowRankWidth, measureModuleFlowTextWidth,
    countModuleFlowWrappedLines, countModuleFlowDisplayUnits, measureModuleFlowBadgeRows,
    findModuleFlowOuterEdges, countModuleFlowEdgesByRank, positionModuleFlowComponents,
    createModuleFlowCycleLabel,
    createModuleFlowGraphLayout
  ].map((value) => typeof value === "string" ? value : value.toString()).join("\n");
}

/** Chooses one stable presentation object for every node identity. */
function canonicalizeModuleFlowNodes(
  nodes: readonly ModuleFlowGraphNodeInput[]
): ModuleFlowGraphNodeInput[] {
  const ordered = [...nodes].sort(compareModuleFlowNodes);
  const nodesById = new Map<string, ModuleFlowGraphNodeInput>();
  for (const node of ordered) {
    if (!nodesById.has(node.id)) {
      nodesById.set(node.id, node);
    }
  }
  return [...nodesById.values()].sort((left, right) =>
    compareModuleFlowText(left.id, right.id)
  );
}

/** Removes unknown and duplicate edge identities with canonical tie-breaking. */
function canonicalizeModuleFlowEdges(
  edges: readonly ModuleFlowGraphEdgeInput[],
  knownNodeIds: ReadonlySet<string>
): ModuleFlowGraphEdgeInput[] {
  const ordered = [...edges]
    .filter((edge) => knownNodeIds.has(edge.sourceId) && knownNodeIds.has(edge.targetId))
    .sort(compareModuleFlowEdges);
  const edgesById = new Map<string, ModuleFlowGraphEdgeInput>();
  for (const edge of ordered) {
    if (!edgesById.has(edge.id)) {
      edgesById.set(edge.id, edge);
    }
  }
  return [...edgesById.values()].sort(compareModuleFlowEdges);
}

/** Creates longest-path ranks over the acyclic SCC condensation graph. */
function createModuleFlowComponentRanks(
  components: readonly ModuleFlowSccComponent[],
  edges: readonly ModuleFlowGraphEdgeInput[]
): ModuleFlowComponentRankIndex {
  const componentByNodeId = new Map<string, ModuleFlowSccComponent>();
  const componentById = new Map(components.map((component) => [component.id, component]));
  for (const component of components) {
    for (const nodeId of component.nodeIds) {
      componentByNodeId.set(nodeId, component);
    }
  }

  const outgoingByComponentId = new Map(components.map((component) => [
    component.id,
    new Set<string>()
  ]));
  const predecessorsByComponentId = new Map(components.map((component) => [
    component.id,
    new Set<string>()
  ]));
  for (const edge of edges) {
    const source = componentByNodeId.get(edge.sourceId);
    const target = componentByNodeId.get(edge.targetId);
    if (!source || !target || source.id === target.id) {
      continue;
    }
    outgoingByComponentId.get(source.id)?.add(target.id);
    predecessorsByComponentId.get(target.id)?.add(source.id);
  }

  const indegreeByComponentId = new Map(components.map((component) => [
    component.id,
    predecessorsByComponentId.get(component.id)?.size ?? 0
  ]));
  const rankByComponentId = new Map(components.map((component) => [component.id, 0]));
  const ready = components
    .filter((component) => (indegreeByComponentId.get(component.id) ?? 0) === 0)
    .sort((left, right) => compareModuleFlowText(left.orderKey, right.orderKey));
  const processed = new Set<string>();
  let readyIndex = 0;

  while (readyIndex < ready.length) {
    const component = ready[readyIndex];
    readyIndex += 1;
    if (!component || processed.has(component.id)) {
      continue;
    }
    processed.add(component.id);
    const sourceRank = rankByComponentId.get(component.id) ?? 0;
    const targetIds = [...(outgoingByComponentId.get(component.id) ?? [])].sort((left, right) =>
      compareModuleFlowText(
        componentById.get(left)?.orderKey ?? left,
        componentById.get(right)?.orderKey ?? right
      )
    );
    for (const targetId of targetIds) {
      rankByComponentId.set(
        targetId,
        Math.max(rankByComponentId.get(targetId) ?? 0, sourceRank + 1)
      );
      const nextIndegree = Math.max(0, (indegreeByComponentId.get(targetId) ?? 0) - 1);
      indegreeByComponentId.set(targetId, nextIndegree);
      if (nextIndegree === 0) {
        const target = componentById.get(targetId);
        if (target) {
          ready.push(target);
        }
      }
    }
  }

  // Kosaraju guarantees a DAG, but stable fallback ranks keep malformed future
  // adapters finite instead of making layout dependent on an infinite retry.
  let fallbackRank = Math.max(0, ...rankByComponentId.values());
  for (const component of [...components].sort((left, right) =>
    compareModuleFlowText(left.orderKey, right.orderKey)
  )) {
    if (!processed.has(component.id)) {
      fallbackRank += 1;
      rankByComponentId.set(component.id, fallbackRank);
    }
  }

  return { rankByComponentId, predecessorsByComponentId };
}

/** Orders components within ranks by predecessor barycenter, then identity. */
function orderModuleFlowComponentsByRank(
  components: readonly ModuleFlowSccComponent[],
  rankIndex: ModuleFlowComponentRankIndex
): Map<number, ModuleFlowSccComponent[]> {
  const grouped = new Map<number, ModuleFlowSccComponent[]>();
  for (const component of components) {
    const rank = rankIndex.rankByComponentId.get(component.id) ?? 0;
    const values = grouped.get(rank) ?? [];
    values.push(component);
    grouped.set(rank, values);
  }

  const componentOrderById = new Map<string, number>();
  let globalOrder = 0;
  for (const rank of [...grouped.keys()].sort((left, right) => left - right)) {
    const rankComponents = grouped.get(rank) ?? [];
    rankComponents.sort((left, right) => {
      const leftAverage = averageModuleFlowPredecessorOrder(
        rankIndex.predecessorsByComponentId.get(left.id),
        componentOrderById
      );
      const rightAverage = averageModuleFlowPredecessorOrder(
        rankIndex.predecessorsByComponentId.get(right.id),
        componentOrderById
      );
      return leftAverage - rightAverage
        || compareModuleFlowText(left.orderKey, right.orderKey);
    });
    for (const component of rankComponents) {
      componentOrderById.set(component.id, globalOrder);
      globalOrder += 1;
    }
  }
  return grouped;
}

/** Returns a finite predecessor barycenter for deterministic sibling ordering. */
function averageModuleFlowPredecessorOrder(
  predecessorIds: ReadonlySet<string> | undefined,
  orderByComponentId: ReadonlyMap<string, number>
): number {
  if (!predecessorIds || predecessorIds.size === 0) {
    return Number.MAX_SAFE_INTEGER;
  }
  let total = 0;
  let count = 0;
  for (const predecessorId of predecessorIds) {
    const order = orderByComponentId.get(predecessorId);
    if (order !== undefined) {
      total += order;
      count += 1;
    }
  }
  return count > 0 ? total / count : Number.MAX_SAFE_INTEGER;
}

/** Measures every visible string; no text or row count is truncated. */
function measureModuleFlowNode(node: ModuleFlowGraphNodeInput): ModuleFlowNodeDimensions {
  const bodyLines = [
    ...(node.subtitle === undefined ? [] : [node.subtitle]),
    ...(node.metricLines ?? []),
    ...(node.detailLines ?? [])
  ];
  const desiredTextWidth = Math.max(
    measureModuleFlowTextWidth(node.title, MODULE_FLOW_TITLE_CHARACTER_WIDTH),
    ...bodyLines.map((line) =>
      measureModuleFlowTextWidth(line, MODULE_FLOW_BODY_CHARACTER_WIDTH)
    ),
    ...(node.badges ?? []).map((badge) =>
      measureModuleFlowTextWidth(badge, MODULE_FLOW_BADGE_CHARACTER_WIDTH)
        + MODULE_FLOW_BADGE_PADDING_X * 2
    )
  );
  const width = Math.ceil(Math.max(
    MODULE_FLOW_MIN_NODE_WIDTH,
    Math.min(
      MODULE_FLOW_MAX_NODE_WIDTH,
      desiredTextWidth + MODULE_FLOW_NODE_PADDING_X * 2
    )
  ));
  const availableWidth = width - MODULE_FLOW_NODE_PADDING_X * 2;
  const sectionHeights: number[] = [];
  sectionHeights.push(
    countModuleFlowWrappedLines(
      node.title,
      availableWidth,
      MODULE_FLOW_TITLE_CHARACTER_WIDTH
    ) * MODULE_FLOW_TITLE_LINE_HEIGHT
  );
  if (node.subtitle !== undefined) {
    sectionHeights.push(
      countModuleFlowWrappedLines(
        node.subtitle,
        availableWidth,
        MODULE_FLOW_BODY_CHARACTER_WIDTH
      ) * MODULE_FLOW_BODY_LINE_HEIGHT
    );
  }
  if ((node.badges?.length ?? 0) > 0) {
    sectionHeights.push(measureModuleFlowBadgeRows(node.badges ?? [], availableWidth));
  }
  if ((node.metricLines?.length ?? 0) > 0) {
    sectionHeights.push((node.metricLines ?? []).reduce((total, line, index) =>
      total
        + countModuleFlowWrappedLines(
          line,
          availableWidth,
          MODULE_FLOW_BODY_CHARACTER_WIDTH
        ) * MODULE_FLOW_BODY_LINE_HEIGHT
        + (index > 0 ? MODULE_FLOW_TEXT_ROW_GAP : 0), 0
    ));
  }
  if ((node.detailLines?.length ?? 0) > 0) {
    sectionHeights.push((node.detailLines ?? []).reduce((total, line, index) =>
      total
        + countModuleFlowWrappedLines(
          line,
          availableWidth,
          MODULE_FLOW_BODY_CHARACTER_WIDTH
        ) * MODULE_FLOW_BODY_LINE_HEIGHT
        + (index > 0 ? MODULE_FLOW_TEXT_ROW_GAP : 0), 0
    ));
  }
  const contentHeight = sectionHeights.reduce((total, height) => total + height, 0)
    + Math.max(0, sectionHeights.length - 1) * MODULE_FLOW_SECTION_GAP;
  return {
    width,
    height: Math.ceil(Math.max(
      MODULE_FLOW_MIN_NODE_HEIGHT,
      contentHeight + MODULE_FLOW_NODE_PADDING_Y * 2
    ))
  };
}

/** Measures a singleton or a horizontally packed cyclic component. */
function measureModuleFlowComponent(
  component: ModuleFlowSccComponent,
  nodeDimensionsById: ReadonlyMap<string, ModuleFlowNodeDimensions>
): ModuleFlowComponentDimensions {
  const dimensions = component.nodeIds.map((nodeId) =>
    nodeDimensionsById.get(nodeId) ?? {
      width: MODULE_FLOW_MIN_NODE_WIDTH,
      height: MODULE_FLOW_MIN_NODE_HEIGHT
    }
  );
  if (!component.cyclic) {
    return dimensions[0] ?? {
      width: MODULE_FLOW_MIN_NODE_WIDTH,
      height: MODULE_FLOW_MIN_NODE_HEIGHT
    };
  }
  return {
    width: dimensions.reduce((total, value) => total + value.width, 0)
      + Math.max(0, dimensions.length - 1) * MODULE_FLOW_CYCLE_MEMBER_GAP
      + MODULE_FLOW_CYCLE_PADDING_X * 2,
    height: Math.max(MODULE_FLOW_MIN_NODE_HEIGHT, ...dimensions.map((value) => value.height))
      + MODULE_FLOW_CYCLE_HEADER_HEIGHT
      + MODULE_FLOW_CYCLE_PADDING_BOTTOM
  };
}

/** Measures one horizontal condensation rank including component gaps. */
function measureModuleFlowRankWidth(
  components: readonly ModuleFlowSccComponent[],
  componentDimensionsById: ReadonlyMap<string, ModuleFlowComponentDimensions>
): number {
  return components.reduce((total, component) =>
    total + (componentDimensionsById.get(component.id)?.width ?? 0), 0
  ) + Math.max(0, components.length - 1) * MODULE_FLOW_COMPONENT_GAP;
}

/** Estimates a rendered line width without discarding any code point. */
function measureModuleFlowTextWidth(text: string, characterWidth: number): number {
  return Math.max(...text.split("\n").map((line) =>
    countModuleFlowDisplayUnits(line) * characterWidth
  ), 0);
}

/** Counts wrapped visual lines, preserving explicit empty and newline rows. */
function countModuleFlowWrappedLines(
  text: string,
  availableWidth: number,
  characterWidth: number
): number {
  const unitsPerLine = Math.max(1, Math.floor(availableWidth / characterWidth));
  return text.split("\n").reduce((total, line) =>
    total + Math.max(1, Math.ceil(countModuleFlowDisplayUnits(line) / unitsPerLine)), 0
  );
}

/** Counts wide Unicode code points as two approximate browser character cells. */
function countModuleFlowDisplayUnits(text: string): number {
  let total = 0;
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    total += codePoint > 0xff ? 2 : 1;
  }
  return total;
}

/** Packs badges into wrapped rows and includes multi-line badge height. */
function measureModuleFlowBadgeRows(
  badges: readonly string[],
  availableWidth: number
): number {
  let rowWidth = 0;
  let rowHeight = 0;
  let totalHeight = 0;
  for (const badge of badges) {
    const rawWidth = measureModuleFlowTextWidth(
      badge,
      MODULE_FLOW_BADGE_CHARACTER_WIDTH
    ) + MODULE_FLOW_BADGE_PADDING_X * 2;
    const badgeWidth = Math.min(availableWidth, Math.max(1, rawWidth));
    const badgeTextWidth = Math.max(1, badgeWidth - MODULE_FLOW_BADGE_PADDING_X * 2);
    const badgeHeight = countModuleFlowWrappedLines(
      badge,
      badgeTextWidth,
      MODULE_FLOW_BADGE_CHARACTER_WIDTH
    ) * MODULE_FLOW_BADGE_LINE_HEIGHT + MODULE_FLOW_BADGE_PADDING_Y * 2;
    const nextWidth = rowWidth === 0
      ? badgeWidth
      : rowWidth + MODULE_FLOW_BADGE_GAP + badgeWidth;
    if (rowWidth > 0 && nextWidth > availableWidth) {
      totalHeight += rowHeight + MODULE_FLOW_TEXT_ROW_GAP;
      rowWidth = badgeWidth;
      rowHeight = badgeHeight;
    } else {
      rowWidth = nextWidth;
      rowHeight = Math.max(rowHeight, badgeHeight);
    }
  }
  return totalHeight + rowHeight;
}

/** Marks SCC-internal and non-adjacent-rank relations for outer routing. */
function findModuleFlowOuterEdges(
  edges: readonly ModuleFlowGraphEdgeInput[],
  componentByNodeId: ReadonlyMap<string, ModuleFlowSccComponent>,
  rankByComponentId: ReadonlyMap<string, number>
): Set<string> {
  const result = new Set<string>();
  for (const edge of edges) {
    const source = componentByNodeId.get(edge.sourceId);
    const target = componentByNodeId.get(edge.targetId);
    if (!source || !target) {
      continue;
    }
    const sourceRank = rankByComponentId.get(source.id) ?? 0;
    const targetRank = rankByComponentId.get(target.id) ?? 0;
    if (source.id === target.id || targetRank !== sourceRank + 1) {
      result.add(edge.id);
    }
  }
  return result;
}

/** Counts outgoing tracks or outer incoming tracks for each rank boundary. */
function countModuleFlowEdgesByRank(
  edges: readonly ModuleFlowGraphEdgeInput[],
  componentByNodeId: ReadonlyMap<string, ModuleFlowSccComponent>,
  rankByComponentId: ReadonlyMap<string, number>,
  incoming: boolean,
  outerEdgeIds: ReadonlySet<string>
): Map<number, number> {
  const result = new Map<number, number>();
  for (const edge of edges) {
    if (incoming && !outerEdgeIds.has(edge.id)) {
      continue;
    }
    const nodeId = incoming ? edge.targetId : edge.sourceId;
    const component = componentByNodeId.get(nodeId);
    if (!component) {
      continue;
    }
    const rank = rankByComponentId.get(component.id) ?? 0;
    result.set(rank, (result.get(rank) ?? 0) + 1);
  }
  return result;
}

/** Positions ranks, cycle enclosures, and member nodes without overlap. */
function positionModuleFlowComponents(
  componentsByRank: ReadonlyMap<number, readonly ModuleFlowSccComponent[]>,
  componentDimensionsById: ReadonlyMap<string, ModuleFlowComponentDimensions>,
  nodeDimensionsById: ReadonlyMap<string, ModuleFlowNodeDimensions>,
  contentWidth: number,
  incomingOuterEdgeCountByRank: ReadonlyMap<number, number>,
  outgoingEdgeCountByRank: ReadonlyMap<number, number>
): {
  nodes: ModuleFlowGraphNodeLayout[];
  cycleGroups: ModuleFlowCycleGroupLayout[];
  rankBounds: Map<number, ModuleFlowGraphRankBounds>;
  contentBottom: number;
} {
  const nodes: ModuleFlowGraphNodeLayout[] = [];
  const cycleGroups: ModuleFlowCycleGroupLayout[] = [];
  const rankBounds = new Map<number, ModuleFlowGraphRankBounds>();
  const ranks = [...componentsByRank.keys()].sort((left, right) => left - right);
  const firstRank = ranks[0] ?? 0;
  let currentY = MODULE_FLOW_CANVAS_MARGIN_Y
    + MODULE_FLOW_EDGE_TRACK_PADDING
    + ((incomingOuterEdgeCountByRank.get(firstRank) ?? 0) + 1)
      * MODULE_FLOW_EDGE_TRACK_GAP;

  for (let rankIndex = 0; rankIndex < ranks.length; rankIndex += 1) {
    const rank = ranks[rankIndex];
    const components = componentsByRank.get(rank) ?? [];
    const rankWidth = measureModuleFlowRankWidth(components, componentDimensionsById);
    const rankHeight = Math.max(0, ...components.map((component) =>
      componentDimensionsById.get(component.id)?.height ?? 0
    ));
    let currentX = MODULE_FLOW_CANVAS_MARGIN_X + (contentWidth - rankWidth) / 2;
    let lane = 0;

    for (const component of components) {
      const componentDimensions = componentDimensionsById.get(component.id) ?? {
        width: MODULE_FLOW_MIN_NODE_WIDTH,
        height: MODULE_FLOW_MIN_NODE_HEIGHT
      };
      if (component.cyclic) {
        cycleGroups.push({
          id: component.id,
          label: createModuleFlowCycleLabel(component),
          nodeIds: [...component.nodeIds],
          x: Math.round(currentX),
          y: Math.round(currentY),
          width: Math.ceil(componentDimensions.width),
          height: Math.ceil(componentDimensions.height),
          rank
        });
      }
      let memberX = component.cyclic
        ? currentX + MODULE_FLOW_CYCLE_PADDING_X
        : currentX;
      const memberY = component.cyclic
        ? currentY + MODULE_FLOW_CYCLE_HEADER_HEIGHT
        : currentY;
      for (const nodeId of component.nodeIds) {
        const dimensions = nodeDimensionsById.get(nodeId) ?? {
          width: MODULE_FLOW_MIN_NODE_WIDTH,
          height: MODULE_FLOW_MIN_NODE_HEIGHT
        };
        nodes.push({
          nodeId,
          x: Math.round(memberX),
          y: Math.round(memberY),
          width: dimensions.width,
          height: dimensions.height,
          rank,
          lane,
          componentId: component.id
        });
        lane += 1;
        memberX += dimensions.width + MODULE_FLOW_CYCLE_MEMBER_GAP;
      }
      currentX += componentDimensions.width + MODULE_FLOW_COMPONENT_GAP;
    }

    rankBounds.set(rank, { top: Math.round(currentY), bottom: Math.ceil(currentY + rankHeight) });
    currentY += rankHeight;
    const nextRank = ranks[rankIndex + 1];
    if (nextRank !== undefined) {
      const outgoingCount = outgoingEdgeCountByRank.get(rank) ?? 0;
      const incomingCount = incomingOuterEdgeCountByRank.get(nextRank) ?? 0;
      currentY += MODULE_FLOW_EDGE_TRACK_PADDING * 2
        + (outgoingCount + incomingCount + 1) * MODULE_FLOW_EDGE_TRACK_GAP;
    }
  }

  const lastRank = ranks[ranks.length - 1] ?? 0;
  const contentBottom = currentY
    + MODULE_FLOW_EDGE_TRACK_PADDING
    + ((outgoingEdgeCountByRank.get(lastRank) ?? 0) + 1) * MODULE_FLOW_EDGE_TRACK_GAP;
  return { nodes, cycleGroups, rankBounds, contentBottom };
}

/** Creates concise group chrome without changing or replacing node text. */
function createModuleFlowCycleLabel(component: ModuleFlowSccComponent): string {
  return component.nodeIds.length === 1
    ? "Self cycle"
    : `Cycle · ${component.nodeIds.length} nodes`;
}

/** Full node comparison makes duplicate-ID selection input-order independent. */
function compareModuleFlowNodes(
  left: ModuleFlowGraphNodeInput,
  right: ModuleFlowGraphNodeInput
): number {
  return compareModuleFlowText(left.id, right.id)
    || compareModuleFlowText(left.kind, right.kind)
    || compareModuleFlowText(left.title, right.title)
    || compareModuleFlowText(left.subtitle ?? "", right.subtitle ?? "")
    || compareModuleFlowText((left.badges ?? []).join("\0"), (right.badges ?? []).join("\0"))
    || compareModuleFlowText(
      (left.metricLines ?? []).join("\0"),
      (right.metricLines ?? []).join("\0")
    )
    || compareModuleFlowText(
      (left.detailLines ?? []).join("\0"),
      (right.detailLines ?? []).join("\0")
    );
}

/** Full edge comparison canonicalizes duplicate identities and channel order. */
function compareModuleFlowEdges(
  left: ModuleFlowGraphEdgeInput,
  right: ModuleFlowGraphEdgeInput
): number {
  return compareModuleFlowText(left.sourceId, right.sourceId)
    || compareModuleFlowText(left.targetId, right.targetId)
    || compareModuleFlowText(left.id, right.id)
    || compareModuleFlowText(left.kind ?? "", right.kind ?? "")
    || compareModuleFlowText(left.label ?? "", right.label ?? "");
}

/** Locale-independent comparison shared by host and browser layout runtimes. */
function compareModuleFlowText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
