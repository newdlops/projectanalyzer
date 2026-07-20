/**
 * Pure Module Flow edge-crossing presentation. Orthogonal intersections are
 * assigned deterministic horizontal line bridges, and the same helper builds
 * SVG paths for Host tests and the serialized Webview runtime.
 */

const MODULE_FLOW_EDGE_BRIDGE_RADIUS = 7;
const MODULE_FLOW_EDGE_BRIDGE_CLUSTER_GAP = 4;

/** One point in the shared Module Flow world coordinate system. */
export type ModuleFlowEdgePoint = { x: number; y: number };

/** Minimal routed edge input needed to discover geometric crossings. */
export type ModuleFlowRoutedEdgeInput = {
  edgeId: string;
  points: readonly ModuleFlowEdgePoint[];
};

/** One horizontal detour spanning one or more nearby vertical crossings. */
export type ModuleFlowEdgeBridge = {
  segmentIndex: number;
  startX: number;
  endX: number;
  y: number;
  crossingCount: number;
};

type HorizontalSegment = {
  edgeId: string;
  segmentIndex: number;
  minX: number;
  maxX: number;
  y: number;
};

type VerticalSegment = {
  edgeId: string;
  segmentIndex: number;
  x: number;
  minY: number;
  maxY: number;
};

type BridgeCandidates = {
  edgeId: string;
  segmentIndex: number;
  minX: number;
  maxX: number;
  y: number;
  crossingXs: number[];
};

/** Returns every declaration needed by the nonce-protected browser runtime. */
export function getModuleFlowEdgeBridgesBrowserSource(): string {
  return [
    `const MODULE_FLOW_EDGE_BRIDGE_RADIUS=${MODULE_FLOW_EDGE_BRIDGE_RADIUS},MODULE_FLOW_EDGE_BRIDGE_CLUSTER_GAP=${MODULE_FLOW_EDGE_BRIDGE_CLUSTER_GAP};`,
    compareBridgeText,
    compareHorizontalSegments,
    compareVerticalSegments,
    lowerBoundHorizontalSegmentY,
    collectOrthogonalSegments,
    appendBridgeCandidate,
    clusterBridgeCandidates,
    createModuleFlowEdgeBridges,
    groupBridgesBySegment,
    measureModuleFlowBridgeHeight,
    formatModuleFlowPathNumber,
    createModuleFlowEdgePath,
    createModuleFlowBridgeDirectionPath
  ].map((value) => typeof value === "string" ? value : value.toString()).join("\n");
}

/**
 * Detects perpendicular crossings without comparing every edge pair. Horizontal
 * segments are sorted by Y, so each vertical segment scans only its Y range.
 */
export function createModuleFlowEdgeBridges(
  edges: readonly ModuleFlowRoutedEdgeInput[]
): Map<string, ModuleFlowEdgeBridge[]> {
  const segments = collectOrthogonalSegments(edges);
  const horizontal = segments.horizontal.sort(compareHorizontalSegments);
  const vertical = segments.vertical.sort(compareVerticalSegments);
  const candidatesByEdgeId = new Map<string, Map<number, BridgeCandidates>>();
  const endpointClearance = MODULE_FLOW_EDGE_BRIDGE_RADIUS + 1;

  for (const crossingSegment of vertical) {
    const minimumY = crossingSegment.minY + endpointClearance;
    const maximumY = crossingSegment.maxY - endpointClearance;
    if (minimumY > maximumY) {
      continue;
    }
    const firstCandidate = lowerBoundHorizontalSegmentY(horizontal, minimumY);
    for (let index = firstCandidate; index < horizontal.length; index += 1) {
      const bridgedSegment = horizontal[index];
      if (bridgedSegment.y > maximumY) {
        break;
      }
      if (bridgedSegment.edgeId === crossingSegment.edgeId
        || crossingSegment.x < bridgedSegment.minX + endpointClearance
        || crossingSegment.x > bridgedSegment.maxX - endpointClearance) {
        continue;
      }
      appendBridgeCandidate(
        candidatesByEdgeId,
        bridgedSegment,
        crossingSegment.x
      );
    }
  }

  const result = new Map<string, ModuleFlowEdgeBridge[]>();
  const orderedEdgeIds = [...candidatesByEdgeId.keys()].sort(compareBridgeText);
  for (const edgeId of orderedEdgeIds) {
    const bySegment = candidatesByEdgeId.get(edgeId);
    if (!bySegment) {
      continue;
    }
    const bridges: ModuleFlowEdgeBridge[] = [];
    const orderedSegments = [...bySegment.values()].sort((left, right) =>
      left.segmentIndex - right.segmentIndex
    );
    for (const candidate of orderedSegments) {
      bridges.push(...clusterBridgeCandidates(candidate));
    }
    if (bridges.length > 0) {
      result.set(edgeId, bridges);
    }
  }
  return result;
}

/** Collects only positive-length axis-aligned segments from compact routes. */
function collectOrthogonalSegments(
  edges: readonly ModuleFlowRoutedEdgeInput[]
): { horizontal: HorizontalSegment[]; vertical: VerticalSegment[] } {
  const horizontal: HorizontalSegment[] = [];
  const vertical: VerticalSegment[] = [];
  for (const edge of edges) {
    for (let pointIndex = 1; pointIndex < edge.points.length; pointIndex += 1) {
      const start = edge.points[pointIndex - 1];
      const end = edge.points[pointIndex];
      if (start.x === end.x && start.y !== end.y) {
        vertical.push({
          edgeId: edge.edgeId,
          segmentIndex: pointIndex - 1,
          x: start.x,
          minY: Math.min(start.y, end.y),
          maxY: Math.max(start.y, end.y)
        });
      } else if (start.y === end.y && start.x !== end.x) {
        horizontal.push({
          edgeId: edge.edgeId,
          segmentIndex: pointIndex - 1,
          minX: Math.min(start.x, end.x),
          maxX: Math.max(start.x, end.x),
          y: start.y
        });
      }
    }
  }
  return { horizontal, vertical };
}

/** Records one crossing against its horizontal edge and segment identity. */
function appendBridgeCandidate(
  candidatesByEdgeId: Map<string, Map<number, BridgeCandidates>>,
  segment: HorizontalSegment,
  crossingX: number
): void {
  const bySegment = candidatesByEdgeId.get(segment.edgeId) ?? new Map();
  const candidate = bySegment.get(segment.segmentIndex) ?? {
    edgeId: segment.edgeId,
    segmentIndex: segment.segmentIndex,
    minX: segment.minX,
    maxX: segment.maxX,
    y: segment.y,
    crossingXs: []
  };
  candidate.crossingXs.push(crossingX);
  bySegment.set(segment.segmentIndex, candidate);
  candidatesByEdgeId.set(segment.edgeId, bySegment);
}

/** Coalesces a close bundle of vertical lines into one readable wider jump. */
function clusterBridgeCandidates(candidate: BridgeCandidates): ModuleFlowEdgeBridge[] {
  const crossingXs = [...new Set(candidate.crossingXs)].sort((left, right) => left - right);
  const bridges: ModuleFlowEdgeBridge[] = [];
  let currentStart: number | undefined;
  let currentEnd: number | undefined;
  let currentCount = 0;

  for (const crossingX of crossingXs) {
    const nextStart = Math.max(candidate.minX, crossingX - MODULE_FLOW_EDGE_BRIDGE_RADIUS);
    const nextEnd = Math.min(candidate.maxX, crossingX + MODULE_FLOW_EDGE_BRIDGE_RADIUS);
    if (currentStart === undefined || currentEnd === undefined) {
      currentStart = nextStart;
      currentEnd = nextEnd;
      currentCount = 1;
      continue;
    }
    if (nextStart <= currentEnd + MODULE_FLOW_EDGE_BRIDGE_CLUSTER_GAP) {
      currentEnd = Math.max(currentEnd, nextEnd);
      currentCount += 1;
      continue;
    }
    bridges.push({
      segmentIndex: candidate.segmentIndex,
      startX: currentStart,
      endX: currentEnd,
      y: candidate.y,
      crossingCount: currentCount
    });
    currentStart = nextStart;
    currentEnd = nextEnd;
    currentCount = 1;
  }

  if (currentStart !== undefined && currentEnd !== undefined) {
    bridges.push({
      segmentIndex: candidate.segmentIndex,
      startX: currentStart,
      endX: currentEnd,
      y: candidate.y,
      crossingCount: currentCount
    });
  }
  return bridges;
}

/** Builds one SVG path whose horizontal crossings visibly hop over other edges. */
export function createModuleFlowEdgePath(
  points: readonly ModuleFlowEdgePoint[],
  bridges: readonly ModuleFlowEdgeBridge[] = []
): string {
  const first = points[0];
  if (!first) {
    return "";
  }
  const bridgesBySegment = groupBridgesBySegment(bridges);
  const commands = [
    `M ${formatModuleFlowPathNumber(first.x)} ${formatModuleFlowPathNumber(first.y)}`
  ];

  for (let pointIndex = 1; pointIndex < points.length; pointIndex += 1) {
    const start = points[pointIndex - 1];
    const end = points[pointIndex];
    const segmentBridges = bridgesBySegment.get(pointIndex - 1) ?? [];
    if (start.y !== end.y || start.x === end.x || segmentBridges.length === 0) {
      commands.push(
        `L ${formatModuleFlowPathNumber(end.x)} ${formatModuleFlowPathNumber(end.y)}`
      );
      continue;
    }

    const direction = end.x > start.x ? 1 : -1;
    const orderedBridges = [...segmentBridges].sort((left, right) => direction * (
      ((left.startX + left.endX) / 2) - ((right.startX + right.endX) / 2)
    ));
    let cursorX = start.x;
    for (const bridge of orderedBridges) {
      const approachX = direction > 0 ? bridge.startX : bridge.endX;
      const departureX = direction > 0 ? bridge.endX : bridge.startX;
      const approachAhead = direction > 0 ? approachX > cursorX : approachX < cursorX;
      const departureBeforeEnd = direction > 0 ? departureX < end.x : departureX > end.x;
      if (!approachAhead || !departureBeforeEnd) {
        continue;
      }
      commands.push(
        `L ${formatModuleFlowPathNumber(approachX)} ${formatModuleFlowPathNumber(start.y)}`
      );
      const bridgeWidth = Math.abs(departureX - approachX);
      const controlOffset = bridgeWidth * 0.24;
      const bridgeHeight = measureModuleFlowBridgeHeight(bridgeWidth);
      commands.push([
        "C",
        formatModuleFlowPathNumber(approachX + direction * controlOffset),
        formatModuleFlowPathNumber(start.y - bridgeHeight),
        formatModuleFlowPathNumber(departureX - direction * controlOffset),
        formatModuleFlowPathNumber(start.y - bridgeHeight),
        formatModuleFlowPathNumber(departureX),
        formatModuleFlowPathNumber(start.y)
      ].join(" "));
      cursorX = departureX;
    }
    commands.push(
      `L ${formatModuleFlowPathNumber(end.x)} ${formatModuleFlowPathNumber(end.y)}`
    );
  }
  return commands.join(" ");
}

/** Creates a small direction triangle at every bridge crest. */
export function createModuleFlowBridgeDirectionPath(
  points: readonly ModuleFlowEdgePoint[],
  bridges: readonly ModuleFlowEdgeBridge[] = []
): string {
  const commands: string[] = [];
  for (const bridge of bridges) {
    const start = points[bridge.segmentIndex];
    const end = points[bridge.segmentIndex + 1];
    if (!start || !end || start.y !== end.y || start.x === end.x) {
      continue;
    }
    const direction = end.x > start.x ? 1 : -1;
    const centerX = (bridge.startX + bridge.endX) / 2;
    const bridgeHeight = measureModuleFlowBridgeHeight(bridge.endX - bridge.startX);
    const centerY = bridge.y - bridgeHeight * 0.75;
    const tipX = centerX + direction * 3.8;
    const tailX = centerX - direction * 3.2;
    commands.push([
      "M",
      formatModuleFlowPathNumber(tailX),
      formatModuleFlowPathNumber(centerY - 2.5),
      "L",
      formatModuleFlowPathNumber(tipX),
      formatModuleFlowPathNumber(centerY),
      "L",
      formatModuleFlowPathNumber(tailX),
      formatModuleFlowPathNumber(centerY + 2.5),
      "Z"
    ].join(" "));
  }
  return commands.join(" ");
}

/** Groups already-clustered bridges for a single linear path walk. */
function groupBridgesBySegment(
  bridges: readonly ModuleFlowEdgeBridge[]
): Map<number, ModuleFlowEdgeBridge[]> {
  const result = new Map<number, ModuleFlowEdgeBridge[]>();
  for (const bridge of bridges) {
    const values = result.get(bridge.segmentIndex) ?? [];
    values.push(bridge);
    result.set(bridge.segmentIndex, values);
  }
  return result;
}

/** Keeps bridge crests visible but inside the empty inter-rank track. */
function measureModuleFlowBridgeHeight(width: number): number {
  return Math.min(9, Math.max(5, Math.abs(width) * 0.3));
}

/** Finds the first horizontal segment at or below the requested Y coordinate. */
function lowerBoundHorizontalSegmentY(
  segments: readonly HorizontalSegment[],
  minimumY: number
): number {
  let low = 0;
  let high = segments.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if ((segments[middle]?.y ?? Number.POSITIVE_INFINITY) < minimumY) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

/** Stable Y/extent/identity ordering supports binary range lookup. */
function compareHorizontalSegments(left: HorizontalSegment, right: HorizontalSegment): number {
  return left.y - right.y
    || left.minX - right.minX
    || left.maxX - right.maxX
    || compareBridgeText(left.edgeId, right.edgeId)
    || left.segmentIndex - right.segmentIndex;
}

/** Stable vertical ordering makes reversed input produce identical bridges. */
function compareVerticalSegments(left: VerticalSegment, right: VerticalSegment): number {
  return left.x - right.x
    || left.minY - right.minY
    || left.maxY - right.maxY
    || compareBridgeText(left.edgeId, right.edgeId)
    || left.segmentIndex - right.segmentIndex;
}

/** Keeps compact SVG path numbers stable without locale formatting. */
function formatModuleFlowPathNumber(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

/** Locale-independent comparison for opaque edge identities. */
function compareBridgeText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
