/**
 * Pure graph scene layout for the editor-tab Visual Explorer. It converts a
 * ProjectGraph plus GUI filters into bounded SVG-ready nodes and edges without
 * depending on VS Code, DOM APIs, or browser globals.
 */

import type { GraphViewMode } from "../protocol/messages";
import type { EdgeConfidence, EdgeKind, ProjectGraph, SymbolKind } from "../shared/types";

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
  const positions = createNodePositions(limitedNodes, visibleEdges, selectedNodeId, width, height);
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
    edges: readonly { sourceId: string; targetId: string }[],
    selectedId: string | undefined,
    sceneWidth: number,
    sceneHeight: number
  ): Map<string, { x: number; y: number }> {
    if (selectedId && nodes.some((node) => node.id === selectedId)) {
      return createFlowPositions(nodes, edges, selectedId, sceneWidth, sceneHeight);
    }

    return createGridPositions(nodes, sceneWidth, sceneHeight);
  }

  /**
   * Places incoming depths left of the selected node and outgoing depths right
   * of it. The traversal is iterative to keep cycles bounded by visited sets.
   */
  function createFlowPositions(
    nodes: readonly { id: string }[],
    edges: readonly { sourceId: string; targetId: string }[],
    selectedId: string,
    sceneWidth: number,
    sceneHeight: number
  ): Map<string, { x: number; y: number }> {
    const positions = new Map<string, { x: number; y: number }>();
    const assigned = new Set<string>([selectedId]);
    const center = { x: sceneWidth / 2, y: sceneHeight * 0.44 };
    const marginX = Math.max(42, sceneWidth * 0.13);
    const incomingDepths = createDepthMap(selectedId, edges, "incoming");
    const outgoingDepths = createDepthMap(selectedId, edges, "outgoing");

    positions.set(selectedId, center);
    placeDepthColumns(groupByDepth(incomingDepths), "incoming", assigned, positions, marginX, sceneWidth, sceneHeight);
    placeDepthColumns(groupByDepth(outgoingDepths), "outgoing", assigned, positions, marginX, sceneWidth, sceneHeight);

    const remaining = nodes.filter((node) => !assigned.has(node.id));
    const remainingPositions = createGridPositions(remaining, sceneWidth, Math.max(90, sceneHeight * 0.28));
    const offsetY = sceneHeight * 0.72;

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

    for (const depth of depths) {
      const ids = (groups.get(depth) ?? []).filter((nodeId) => !assigned.has(nodeId));
      const x = side === "incoming"
        ? centerX - (horizontalSpan * depth) / (maxDepth + 0.35)
        : centerX + (horizontalSpan * depth) / (maxDepth + 0.35);

      ids.sort();
      ids.forEach((nodeId, index) => {
        assigned.add(nodeId);
        positions.set(nodeId, {
          x,
          y: distribute(index, ids.length, sceneHeight, 34)
        });
      });
    }
  }

  /**
   * Places unanchored nodes in a deterministic responsive grid.
   */
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
        y: distribute(row, rows, sceneHeight, 34)
      });
    });

    return positions;
  }

  /**
   * Returns all nodes connected to the current selection through visible edges.
   */
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

  /**
   * Evenly spaces nodes while keeping them inside canvas margins.
   */
  function distribute(index: number, count: number, size: number, margin: number): number {
    if (count <= 1) {
      return size / 2;
    }

    return margin + (index * (size - margin * 2)) / (count - 1);
  }

  /**
   * Keeps labels compact enough for SVG text.
   */
  function truncateLabel(label: string): string {
    const normalized = label.trim();

    if (normalized.length <= 24) {
      return normalized;
    }

    return `${normalized.slice(0, 21)}...`;
  }

  /**
   * Provides a stable rank for mixed graph mode ordering.
   */
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

  /**
   * Sizes selected and file/class nodes slightly larger than leaf symbols.
   */
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
