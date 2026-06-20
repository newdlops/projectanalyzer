/**
 * Pure graph scene layout for the editor-tab Visual Explorer. It converts a
 * ProjectGraph plus GUI filters into bounded SVG-ready nodes and edges without
 * depending on VS Code, DOM APIs, or browser globals.
 */

import type { GraphViewMode } from "../protocol/messages";
import type { EdgeConfidence, EdgeKind, ProjectGraph, SymbolKind } from "../shared/types";
import { clampNumber, getSeparationSign, moveToward } from "./explorerGraphGeometry";
import {
  createOrderMap,
  orderGraphNodeIdsByPreviousLayer,
  shouldUseLayeredSelection
} from "./explorerGraphOrdering";

/** Options that describe the currently visible graph viewport. */
export type ExplorerGraphSceneOptions = {
  mode: GraphViewMode;
  query: string;
  selectedNodeId?: string;
  maxNodes: number;
  width: number;
  height: number;
};

/** SVG-ready node record used by the graph browser canvas renderer. */
export type ExplorerGraphSceneNode = {
  id: string;
  label: string;
  kind: SymbolKind;
  filePath: string;
  x: number;
  y: number;
  radius: number;
  incomingCount: number;
  outgoingCount: number;
  isSelected: boolean;
  isDimmed: boolean;
};

/** SVG-ready edge record used by the graph browser canvas renderer. */
export type ExplorerGraphSceneEdge = {
  id: string;
  kind: EdgeKind;
  confidence: EdgeConfidence;
  sourceId: string;
  targetId: string;
  path: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  isSelected: boolean;
  isDimmed: boolean;
};

/** Bounded scene returned to the Webview renderer. */
export type ExplorerGraphScene = {
  nodes: ExplorerGraphSceneNode[];
  edges: ExplorerGraphSceneEdge[];
  omittedNodeCount: number;
  totalNodeCount: number;
  visibleNodeCount: number;
  selectionInScene: boolean;
};

/**
 * Builds a deterministic graph scene for a bounded SVG canvas. The
 * selected node, when present, becomes the flow anchor so callers/callees and
 * structural relationships read left-to-right without force simulation.
 */
export function createGraphScene(
  graph: ProjectGraph | undefined,
  options: ExplorerGraphSceneOptions
): ExplorerGraphScene {
  const width = Math.max(280, Math.floor(options.width));
  const height = Math.max(180, Math.floor(options.height));
  const maxNodes = Math.max(1, Math.floor(options.maxNodes));
  const query = options.query.trim().toLowerCase();
  const selectedNodeId = options.selectedNodeId;
  const collisionGapX = 104;
  const collisionGapY = 72;
  const columnMarginY = 72;
  const laneGapX = 92;
  const rowGapY = 76;

  if (!graph) {
    return {
      nodes: [],
      edges: [],
      omittedNodeCount: 0,
      totalNodeCount: 0,
      visibleNodeCount: 0,
      selectionInScene: false
    };
  }

  const relevantEdges = graph.edges.filter((edge) => isEdgeInMode(edge.kind, options.mode));
  const degreeByNodeId = createDegreeMap(relevantEdges);
  const nodesMatchingModeAndSearch = graph.nodes.filter(
    (node) => isNodeInMode(node.kind, options.mode) && matchesQuery(node, query)
  );
  const selectedNode = selectedNodeId
    ? graph.nodes.find((node) => node.id === selectedNodeId)
    : undefined;
  const visibleCandidates = [...nodesMatchingModeAndSearch];

  if (
    selectedNode &&
    isNodeInMode(selectedNode.kind, options.mode) &&
    !visibleCandidates.some((node) => node.id === selectedNode.id)
  ) {
    visibleCandidates.unshift(selectedNode);
  }

  const orderedNodes = visibleCandidates.sort((left, right) =>
    compareNodes(left, right, selectedNodeId, degreeByNodeId)
  );
  const limitedNodes = limitNodes(orderedNodes, maxNodes, selectedNodeId);
  const includedNodeIds = new Set(limitedNodes.map((node) => node.id));
  const visibleEdges = relevantEdges.filter(
    (edge) => includedNodeIds.has(edge.sourceId) && includedNodeIds.has(edge.targetId)
  );
  const positions = separateNodePositions(
    createNodePositions(limitedNodes, visibleEdges, selectedNodeId, width, height),
    selectedNodeId,
    width,
    height
  );
  const reachableFromSelection = selectedNodeId
    ? createReachableSet(selectedNodeId, visibleEdges)
    : new Set<string>();
  const selectionInScene = Boolean(selectedNodeId && includedNodeIds.has(selectedNodeId));
  const sceneNodes = limitedNodes.map((node) => {
    const position = positions.get(node.id) ?? { x: width / 2, y: height / 2 };
    const degree = degreeByNodeId.get(node.id) ?? { incoming: 0, outgoing: 0 };

    return {
      id: node.id,
      label: truncateLabel(node.name || node.qualifiedName || node.id),
      kind: node.kind,
      filePath: node.filePath,
      x: position.x,
      y: position.y,
      radius: getNodeRadius(node.kind, node.id === selectedNodeId),
      incomingCount: degree.incoming,
      outgoingCount: degree.outgoing,
      isSelected: node.id === selectedNodeId,
      isDimmed: selectionInScene && !reachableFromSelection.has(node.id)
    };
  });
  const positionByNodeId = new Map(sceneNodes.map((node) => [node.id, node]));
  const sceneEdges = visibleEdges.map((edge) => {
    const source = positionByNodeId.get(edge.sourceId);
    const target = positionByNodeId.get(edge.targetId);
    const isSelectedEdge = edge.sourceId === selectedNodeId || edge.targetId === selectedNodeId;

    return {
      id: edge.id,
      kind: edge.kind,
      confidence: edge.confidence,
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      path: createEdgePath(source?.x ?? 0, source?.y ?? 0, target?.x ?? 0, target?.y ?? 0),
      x1: source?.x ?? 0,
      y1: source?.y ?? 0,
      x2: target?.x ?? 0,
      y2: target?.y ?? 0,
      isSelected: isSelectedEdge,
      isDimmed: selectionInScene && (!source || !target || source.isDimmed || target.isDimmed)
    };
  });

  return {
    nodes: sceneNodes,
    edges: sceneEdges,
    omittedNodeCount: Math.max(0, orderedNodes.length - limitedNodes.length),
    totalNodeCount: graph.nodes.length,
    visibleNodeCount: orderedNodes.length,
    selectionInScene
  };

  /**
   * Keeps each tab focused on its dominant relationship types while still
   * showing structural containment where that makes the view interpretable.
   */
  function isEdgeInMode(kind: EdgeKind, mode: GraphViewMode): boolean {
    if (mode === "call") {
      return kind === "calls";
    }

    if (mode === "class") {
      return ["contains", "extends", "implements", "overrides", "instantiates"].includes(kind);
    }

    return ["contains", "imports", "exports"].includes(kind);
  }

  /**
   * Includes enough node categories for each mode to create a useful structural
   * graph even before advanced import and call extraction is available.
   */
  function isNodeInMode(kind: SymbolKind, mode: GraphViewMode): boolean {
    if (["workspace", "folder", "file"].includes(kind)) {
      return true;
    }

    if (mode === "call") {
      return ["function", "method", "constructor"].includes(kind);
    }

    if (mode === "class") {
      return ["class", "interface", "enum", "method", "constructor", "property"].includes(kind);
    }

    return kind !== "external";
  }

  /**
   * Applies graph browser search across stable graph identity and display fields.
   */
  function matchesQuery(node: { id: string; name: string; qualifiedName: string; filePath: string; kind: string }, value: string): boolean {
    if (!value) {
      return true;
    }

    return [node.id, node.name, node.qualifiedName, node.filePath, node.kind]
      .filter(Boolean)
      .some((field) => field.toLowerCase().includes(value));
  }

  /**
   * Counts relevant incoming and outgoing edges for ranking and compact badges.
   */
  function createDegreeMap(edges: readonly { sourceId: string; targetId: string }[]): Map<string, { incoming: number; outgoing: number }> {
    const degrees = new Map<string, { incoming: number; outgoing: number }>();

    for (const edge of edges) {
      const source = degrees.get(edge.sourceId) ?? { incoming: 0, outgoing: 0 };
      source.outgoing += 1;
      degrees.set(edge.sourceId, source);

      const target = degrees.get(edge.targetId) ?? { incoming: 0, outgoing: 0 };
      target.incoming += 1;
      degrees.set(edge.targetId, target);
    }

    return degrees;
  }

  /**
   * Ranks high-signal nodes first while keeping selection pinned in bounded
   * scenes so action buttons never lose their graph context.
   */
  function compareNodes(
    left: { id: string; kind: SymbolKind; name: string; qualifiedName: string },
    right: { id: string; kind: SymbolKind; name: string; qualifiedName: string },
    selectedId: string | undefined,
    degrees: Map<string, { incoming: number; outgoing: number }>
  ): number {
    if (left.id === selectedId) {
      return -1;
    }

    if (right.id === selectedId) {
      return 1;
    }

    const leftDegree = degrees.get(left.id);
    const rightDegree = degrees.get(right.id);
    const leftTotal = (leftDegree?.incoming ?? 0) + (leftDegree?.outgoing ?? 0);
    const rightTotal = (rightDegree?.incoming ?? 0) + (rightDegree?.outgoing ?? 0);

    if (leftTotal !== rightTotal) {
      return rightTotal - leftTotal;
    }

    const rankDifference = getKindRank(left.kind) - getKindRank(right.kind);

    if (rankDifference !== 0) {
      return rankDifference;
    }

    return (left.qualifiedName || left.name).localeCompare(right.qualifiedName || right.name);
  }

  /**
   * Keeps the selected node inside a capped render set by replacing the last
   * lower-priority node when necessary.
   */
  function limitNodes<T extends { id: string }>(
    nodes: readonly T[],
    limit: number,
    selectedId: string | undefined
  ): T[] {
    const limited = nodes.slice(0, limit);

    if (!selectedId || limited.some((node) => node.id === selectedId)) {
      return limited;
    }

    const selected = nodes.find((node) => node.id === selectedId);

    if (!selected) {
      return limited;
    }

    if (limited.length === 0) {
      return [selected];
    }

    limited[limited.length - 1] = selected;
    return limited;
  }

  /**
   * Lays out selected graphs as directional columns and unselected graphs as a
   * stable grid sized to the current graph browser viewport.
   */
  function createNodePositions(
    nodes: readonly { id: string }[],
    edges: readonly { sourceId: string; targetId: string; kind?: EdgeKind }[],
    selectedId: string | undefined,
    sceneWidth: number,
    sceneHeight: number
  ): Map<string, { x: number; y: number }> {
    if (selectedId && nodes.some((node) => node.id === selectedId)) {
      if (shouldUseLayeredSelection(edges)) {
        return createLayeredPositions(nodes, edges, sceneWidth, sceneHeight);
      }

      return createFlowPositions(nodes, edges, selectedId, sceneWidth, sceneHeight);
    }

    if (edges.length > 0) {
      return createLayeredPositions(nodes, edges, sceneWidth, sceneHeight);
    }
    return createGridPositions(nodes, sceneWidth, sceneHeight);
  }

  /**
   * Applies a small deterministic collision pass after the structural layout so
   * expanded children do not sit directly on top of nodes or labels.
   */
  function separateNodePositions(
    positions: Map<string, { x: number; y: number }>,
    anchorId: string | undefined,
    sceneWidth: number,
    sceneHeight: number
  ): Map<string, { x: number; y: number }> {
    const relaxed = new Map<string, { x: number; y: number }>();

    for (const [nodeId, position] of positions) {
      relaxed.set(nodeId, { ...position });
    }

    const entries = [...relaxed.entries()];
    const minGapX = collisionGapX;
    const minGapY = collisionGapY;
    const margin = 30;

    for (let pass = 0; pass < 10; pass += 1) {
      let changed = false;

      for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
          const [leftId, left] = entries[leftIndex];
          const [rightId, right] = entries[rightIndex];
          const deltaX = right.x - left.x;
          const deltaY = right.y - left.y;
          const overlapX = minGapX - Math.abs(deltaX);
          const overlapY = minGapY - Math.abs(deltaY);

          if (overlapX <= 0 || overlapY <= 0) {
            continue;
          }

          const axis = overlapX < overlapY ? "x" : "y";
          const sign = getSeparationSign(axis === "x" ? deltaX : deltaY, leftIndex, rightIndex);
          const amount = ((axis === "x" ? overlapX : overlapY) / 2) + 1;
          const limit = axis === "x" ? sceneWidth - margin : sceneHeight - margin;
          const leftLocked = leftId === anchorId;
          const rightLocked = rightId === anchorId;

          if (!leftLocked) {
            left[axis] = clampNumber(left[axis] - sign * (rightLocked ? amount * 2 : amount), margin, limit);
          }

          if (!rightLocked) {
            right[axis] = clampNumber(right[axis] + sign * (leftLocked ? amount * 2 : amount), margin, limit);
          }

          changed = true;
        }
      }

      if (!changed) {
        break;
      }
    }

    return relaxed;
  }

  /**
   * Places incoming depths left of the selected node and outgoing depths right
   * of it. The traversal is iterative to keep cycles bounded by visited sets.
   */
  function createFlowPositions(
    nodes: readonly { id: string }[],
    edges: readonly { sourceId: string; targetId: string; kind?: EdgeKind }[],
    selectedId: string,
    sceneWidth: number,
    sceneHeight: number
  ): Map<string, { x: number; y: number }> {
    const positions = new Map<string, { x: number; y: number }>();
    const assigned = new Set<string>([selectedId]);
    const center = { x: sceneWidth / 2, y: sceneHeight / 2 };
    const marginX = Math.max(64, sceneWidth * 0.12);
    const incomingDepths = createDepthMap(selectedId, edges, "incoming");
    const outgoingDepths = createDepthMap(selectedId, edges, "outgoing");

    positions.set(selectedId, center);
    placeDepthColumns(groupByDepth(incomingDepths), "incoming", selectedId, edges, assigned, positions, marginX, sceneWidth, sceneHeight);
    placeDepthColumns(groupByDepth(outgoingDepths), "outgoing", selectedId, edges, assigned, positions, marginX, sceneWidth, sceneHeight);

    const remaining = nodes.filter((node) => !assigned.has(node.id));
    const remainingPositions = createGridPositions(remaining, sceneWidth, Math.max(100, sceneHeight * 0.24));
    const offsetY = sceneHeight * 0.76;

    for (const node of remaining) {
      const position = remainingPositions.get(node.id);

      if (position) {
        positions.set(node.id, {
          x: position.x,
          y: Math.min(sceneHeight - 24, offsetY + position.y * 0.28)
        });
      }
    }

    return positions;
  }

  /**
   * Creates a left-to-right relationship layout when no node is selected.
   */
  function createLayeredPositions(
    nodes: readonly { id: string }[],
    edges: readonly { sourceId: string; targetId: string; kind?: EdgeKind }[],
    sceneWidth: number,
    sceneHeight: number
  ): Map<string, { x: number; y: number }> {
    const positions = new Map<string, { x: number; y: number }>();
    const ranks = createLayerRanks(nodes, edges);
    const grouped = new Map<number, string[]>();

    for (const node of nodes) {
      const rank = ranks.get(node.id) ?? 0;
      const group = grouped.get(rank) ?? [];
      group.push(node.id);
      grouped.set(rank, group);
    }

    const orderedRanks = [...grouped.keys()].sort((left, right) => left - right);

    let previousOrder = new Map<string, number>();

    orderedRanks.forEach((rank, columnIndex) => {
      const rawNodeIds = grouped.get(rank) ?? [];
      const nodeIds = previousOrder.size > 0
        ? orderGraphNodeIdsByPreviousLayer(rawNodeIds, previousOrder, edges, "layered")
        : [...rawNodeIds].sort();
      const x = distribute(columnIndex, orderedRanks.length, sceneWidth, 62);

      nodeIds.forEach((nodeId, rowIndex) => {
        positions.set(nodeId, {
          x,
          y: distributeStaggered(rowIndex, nodeIds.length, columnIndex, sceneHeight, columnMarginY)
        });
      });
      previousOrder = createOrderMap(nodeIds);
    });

    return positions;
  }

  /**
   * Assigns graph layers by walking outgoing edges from source-like roots.
   */
  function createLayerRanks(
    nodes: readonly { id: string }[],
    edges: readonly { sourceId: string; targetId: string }[]
  ): Map<string, number> {
    const nodeIds = new Set(nodes.map((node) => node.id));
    const incomingCounts = new Map<string, number>();
    const outgoingByNodeId = new Map<string, string[]>();

    for (const edge of edges) {
      if (!nodeIds.has(edge.sourceId) || !nodeIds.has(edge.targetId)) {
        continue;
      }

      incomingCounts.set(edge.targetId, (incomingCounts.get(edge.targetId) ?? 0) + 1);
      const outgoing = outgoingByNodeId.get(edge.sourceId) ?? [];
      outgoing.push(edge.targetId);
      outgoingByNodeId.set(edge.sourceId, outgoing);
    }

    const roots = nodes
      .map((node) => node.id)
      .filter((nodeId) => (incomingCounts.get(nodeId) ?? 0) === 0);
    const queue: Array<{ nodeId: string; rank: number }> = (roots.length > 0 ? roots : [nodes[0]?.id])
      .filter((nodeId): nodeId is string => Boolean(nodeId))
      .map((nodeId) => ({ nodeId, rank: 0 }));
    const ranks = new Map<string, number>();

    while (queue.length > 0) {
      const current = queue.shift();

      if (!current) {
        continue;
      }

      const existingRank = ranks.get(current.nodeId);

      if (existingRank !== undefined && existingRank <= current.rank) {
        continue;
      }

      ranks.set(current.nodeId, current.rank);

      for (const targetId of outgoingByNodeId.get(current.nodeId) ?? []) {
        queue.push({ nodeId: targetId, rank: current.rank + 1 });
      }
    }

    for (const node of nodes) {
      if (!ranks.has(node.id)) {
        ranks.set(node.id, Math.min(3, ranks.size % 4));
      }
    }

    return ranks;
  }

  /**
   * Computes graph distance from the selected node in one edge direction.
   */
  function createDepthMap(
    rootId: string,
    edges: readonly { sourceId: string; targetId: string }[],
    direction: "incoming" | "outgoing"
  ): Map<string, number> {
    const depths = new Map<string, number>();
    const visited = new Set<string>([rootId]);
    const queue: Array<{ nodeId: string; depth: number }> = [{ nodeId: rootId, depth: 0 }];

    while (queue.length > 0) {
      const current = queue.shift();

      if (!current) {
        continue;
      }

      for (const edge of edges) {
        const nextNodeId = direction === "incoming" && edge.targetId === current.nodeId
          ? edge.sourceId
          : direction === "outgoing" && edge.sourceId === current.nodeId
            ? edge.targetId
            : undefined;

        if (!nextNodeId || visited.has(nextNodeId)) {
          continue;
        }

        visited.add(nextNodeId);
        depths.set(nextNodeId, current.depth + 1);
        queue.push({ nodeId: nextNodeId, depth: current.depth + 1 });
      }
    }

    return depths;
  }

  /**
   * Groups node IDs by traversal depth for column placement.
   */
  function groupByDepth(depths: Map<string, number>): Map<number, string[]> {
    const groups = new Map<number, string[]>();

    for (const [nodeId, depth] of depths) {
      const group = groups.get(depth) ?? [];
      group.push(nodeId);
      groups.set(depth, group);
    }

    return groups;
  }

  /**
   * Places one side of the selected-flow layout.
   */
  function placeDepthColumns(
    groups: Map<number, string[]>,
    side: "incoming" | "outgoing",
    rootId: string,
    edges: readonly { sourceId: string; targetId: string }[],
    assigned: Set<string>,
    positions: Map<string, { x: number; y: number }>,
    marginX: number,
    sceneWidth: number,
    sceneHeight: number
  ): void {
    const depths = [...groups.keys()].sort((left, right) => left - right);
    const maxDepth = Math.max(1, depths.at(-1) ?? 1);
    const centerX = sceneWidth / 2;
    const horizontalSpan = side === "incoming" ? centerX - marginX : sceneWidth - marginX - centerX;
    const rowCapacity = getColumnRowCapacity(sceneHeight);
    let previousOrder = new Map<string, number>([[rootId, 0]]);

    for (const depth of depths) {
      const rawIds = (groups.get(depth) ?? []).filter((nodeId) => !assigned.has(nodeId));
      const ids = orderGraphNodeIdsByPreviousLayer(rawIds, previousOrder, edges, side);
      const baseX = side === "incoming"
        ? centerX - (horizontalSpan * depth) / (maxDepth + 0.35)
        : centerX + (horizontalSpan * depth) / (maxDepth + 0.35);
      const laneCount = Math.max(1, Math.ceil(ids.length / rowCapacity));
      const laneDirection = side === "incoming" ? -1 : 1;

      ids.forEach((nodeId, index) => {
        const laneIndex = Math.floor(index / rowCapacity);
        const rowIndex = index % rowCapacity;
        const rowCount = Math.min(rowCapacity, ids.length - laneIndex * rowCapacity);
        const laneOffset = (laneIndex - (laneCount - 1) / 2) * laneGapX * laneDirection;

        assigned.add(nodeId);
        positions.set(nodeId, {
          x: clampNumber(baseX + laneOffset, 34, sceneWidth - 34),
          y: distributeStaggered(rowIndex, rowCount, depth + laneIndex, sceneHeight, columnMarginY)
        });
      });
      previousOrder = createOrderMap(ids);
    }
  }

  // Computes when a depth column should fan into a neighboring lane.
  function getColumnRowCapacity(sceneHeight: number): number {
    return Math.max(1, Math.floor(Math.max(1, sceneHeight - columnMarginY * 2) / rowGapY) + 1);
  }

  // Places unanchored nodes in a deterministic responsive grid.
  function createGridPositions(
    nodes: readonly { id: string }[],
    sceneWidth: number,
    sceneHeight: number
  ): Map<string, { x: number; y: number }> {
    const positions = new Map<string, { x: number; y: number }>();

    if (nodes.length === 0) {
      return positions;
    }

    const columns = Math.max(1, Math.ceil(Math.sqrt((nodes.length * sceneWidth) / sceneHeight)));
    const rows = Math.max(1, Math.ceil(nodes.length / columns));

    nodes.forEach((node, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);

      positions.set(node.id, {
        x: distribute(column, columns, sceneWidth, 34),
        y: distributeStaggered(row, rows, column, sceneHeight, columnMarginY)
      });
    });

    return positions;
  }

  // Returns all nodes connected to the current selection through visible edges.
  function createReachableSet(rootId: string, edges: readonly { sourceId: string; targetId: string }[]): Set<string> {
    const reachable = new Set<string>([rootId]);
    const queue = [rootId];

    while (queue.length > 0) {
      const nodeId = queue.shift();

      if (!nodeId) {
        continue;
      }

      for (const edge of edges) {
        const nextNodeId = edge.sourceId === nodeId
          ? edge.targetId
          : edge.targetId === nodeId
            ? edge.sourceId
            : undefined;

        if (!nextNodeId || reachable.has(nextNodeId)) {
          continue;
        }

        reachable.add(nextNodeId);
        queue.push(nextNodeId);
      }
    }

    return reachable;
  }

  // Evenly spaces nodes while keeping them inside canvas margins.
  function distribute(index: number, count: number, size: number, margin: number): number {
    if (count <= 1) {
      return size / 2;
    }

    return margin + (index * (size - margin * 2)) / (count - 1);
  }

  // Distributes a column while staggering singleton rows away from a flat line.
  function distributeStaggered(
    index: number,
    count: number,
    columnIndex: number,
    size: number,
    margin: number
  ): number {
    if (count <= 1) {
      const offset = Math.min(74, size * 0.16);
      const direction = columnIndex % 2 === 0 ? -1 : 1;

      return size / 2 + offset * direction;
    }

    return distribute(index, count, size, margin);
  }

  // Creates a curved edge path so parallel directional structure is readable.
  function createEdgePath(x1: number, y1: number, x2: number, y2: number): string {
    const start = moveToward(x1, y1, x2, y2, 18);
    const end = moveToward(x2, y2, x1, y1, 20);
    const deltaX = end.x - start.x;
    const deltaY = end.y - start.y;
    const controlOffset = Math.max(36, Math.abs(deltaX) * 0.42);
    const bend = Math.sign(deltaY || deltaX || 1) * Math.min(42, Math.max(10, Math.abs(deltaY) * 0.18));
    const controlX1 = start.x + (deltaX >= 0 ? controlOffset : -controlOffset);
    const controlX2 = end.x - (deltaX >= 0 ? controlOffset : -controlOffset);

    return `M ${start.x} ${start.y} C ${controlX1} ${start.y + bend}, ${controlX2} ${end.y - bend}, ${end.x} ${end.y}`;
  }

  // Keeps labels compact enough for SVG text.
  function truncateLabel(label: string): string {
    const normalized = label.trim();

    if (normalized.length <= 24) {
      return normalized;
    }

    return `${normalized.slice(0, 21)}...`;
  }

  // Provides a stable rank for mixed graph mode ordering.
  function getKindRank(kind: SymbolKind): number {
    const ranks: Record<SymbolKind, number> = {
      workspace: 0,
      folder: 1,
      file: 2,
      module: 3,
      namespace: 4,
      class: 5,
      interface: 6,
      enum: 7,
      constructor: 8,
      function: 9,
      method: 10,
      property: 11,
      variable: 12,
      external: 13
    };

    return ranks[kind];
  }

  // Sizes selected and file/class nodes slightly larger than leaf symbols.
  function getNodeRadius(kind: SymbolKind, selected: boolean): number {
    if (selected) {
      return 15;
    }

    if (kind === "file" || kind === "class" || kind === "interface") {
      return 13;
    }

    return 11;
  }
}
