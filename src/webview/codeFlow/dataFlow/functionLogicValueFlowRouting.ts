/**
 * Browser-safe Function Logic value-flow routing. It converts semantic
 * definition-to-use relations into bounded nearest-use hops and draws each hop
 * as a quadratic curve so value flow stays distinct from control-flow edges.
 */

/** Minimal value-flow relation consumed by the presentation-only hop planner. */
export type FunctionLogicValueFlowRoute = {
  id: string;
  bindingId: string;
  sourceBlockId: string;
  targetBlockId: string;
  targetAccess: "read" | "readwrite";
  targetUsage?: "consume" | "sink";
  confidence: "exact" | "inferred";
};

/** Minimal control edge needed to find the previous visible value-use node. */
export type FunctionLogicValueFlowControlEdge = {
  sourceId: string;
  targetId: string;
};

/** One presentation edge between adjacent value-related nodes on a CFG path. */
export type FunctionLogicValueFlowHop = FunctionLogicValueFlowRoute;

/** Positioned graph node used by the quadratic hop geometry. */
export type FunctionLogicValueFlowNodeLayout = {
  blockId: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type ValueFlowTarget = {
  bindingId: string;
  targetBlockId: string;
  targetAccess: "read" | "readwrite";
  targetUsage?: "consume" | "sink";
  confidence: "exact" | "inferred";
  originalSourceIds: Set<string>;
};

/** Bounds caller-provided traversal limits before any graph walk begins. */
function normalizeFunctionLogicValueFlowBound(
  value: number,
  fallback: number,
  maximum: number
): number {
  return Number.isFinite(value)
    ? Math.min(maximum, Math.max(0, Math.floor(value)))
    : fallback;
}

/** Builds deterministic incoming adjacency without retaining duplicate edges. */
function createFunctionLogicValueFlowIncomingIndex(
  edges: readonly FunctionLogicValueFlowControlEdge[]
): Map<string, string[]> {
  const incomingByTargetId = new Map<string, string[]>();
  for (const edge of edges) {
    const incoming = incomingByTargetId.get(edge.targetId) ?? [];
    if (!incoming.includes(edge.sourceId)) {
      incoming.push(edge.sourceId);
      incoming.sort();
      incomingByTargetId.set(edge.targetId, incoming);
    }
  }
  return incomingByTargetId;
}

/**
 * Walks each predecessor path until it reaches the nearest value-related node.
 * The explicit queue, visited set, and depth bound also terminate loop edges.
 */
function findNearestFunctionLogicValuePredecessors(
  targetBlockId: string,
  relatedBlockIds: ReadonlySet<string>,
  incomingByTargetId: ReadonlyMap<string, readonly string[]>,
  maximumDepth: number
): string[] {
  if (maximumDepth <= 0) {
    return [];
  }
  const pending = (incomingByTargetId.get(targetBlockId) ?? []).map((blockId) => ({
    blockId,
    depth: 1
  }));
  // Seeding the target prevents loop back-edges from turning a use into its own
  // predecessor; same-block read/write relations are handled explicitly.
  const visited = new Set<string>([targetBlockId]);
  const nearest = new Set<string>();
  let cursor = 0;
  while (cursor < pending.length) {
    const { blockId, depth } = pending[cursor];
    cursor += 1;
    if (visited.has(blockId)) {
      continue;
    }
    visited.add(blockId);
    if (relatedBlockIds.has(blockId)) {
      nearest.add(blockId);
      continue;
    }
    if (depth >= maximumDepth) {
      continue;
    }
    for (const predecessorId of incomingByTargetId.get(blockId) ?? []) {
      if (!visited.has(predecessorId)) {
        pending.push({ blockId: predecessorId, depth: depth + 1 });
      }
    }
  }
  return [...nearest].sort();
}

/** Merges multiple accesses in one block into one unambiguous visual target. */
function mergeFunctionLogicValueFlowTarget(
  target: ValueFlowTarget,
  flow: FunctionLogicValueFlowRoute
): void {
  target.originalSourceIds.add(flow.sourceBlockId);
  if (flow.targetAccess === "readwrite") {
    target.targetAccess = "readwrite";
  }
  if (flow.targetUsage === "sink"
    || (!target.targetUsage && flow.targetUsage === "consume")) {
    target.targetUsage = flow.targetUsage;
  }
  if (flow.confidence === "inferred") {
    target.confidence = "inferred";
  }
}

/**
 * Converts definition-to-use relations into short nearest-use hops. Branches
 * retain one hop per predecessor path, while a join receives each branch hop;
 * unrelated branch uses are never chained merely by visual/source order.
 */
export function createFunctionLogicValueFlowHops(
  flows: readonly FunctionLogicValueFlowRoute[],
  controlEdges: readonly FunctionLogicValueFlowControlEdge[],
  maximumDepth = controlEdges.length + 1,
  maximumHops = 1_500
): FunctionLogicValueFlowHop[] {
  const boundedDepth = normalizeFunctionLogicValueFlowBound(
    maximumDepth,
    controlEdges.length + 1,
    10_000
  );
  const boundedHops = normalizeFunctionLogicValueFlowBound(maximumHops, 1_500, 1_500);
  if (flows.length === 0 || boundedHops === 0) {
    return [];
  }

  const incomingByTargetId = createFunctionLogicValueFlowIncomingIndex(controlEdges);
  const flowsByBindingId = new Map<string, FunctionLogicValueFlowRoute[]>();
  for (const flow of flows) {
    const bindingFlows = flowsByBindingId.get(flow.bindingId) ?? [];
    bindingFlows.push(flow);
    flowsByBindingId.set(flow.bindingId, bindingFlows);
  }

  const hops: FunctionLogicValueFlowHop[] = [];
  const seenHopKeys = new Set<string>();
  for (const [bindingId, bindingFlows] of flowsByBindingId) {
    const relatedBlockIds = new Set<string>();
    const targetsByBlockId = new Map<string, ValueFlowTarget>();
    for (const flow of bindingFlows) {
      relatedBlockIds.add(flow.sourceBlockId);
      relatedBlockIds.add(flow.targetBlockId);
      const target = targetsByBlockId.get(flow.targetBlockId) ?? {
        bindingId,
        targetBlockId: flow.targetBlockId,
        targetAccess: flow.targetAccess,
        ...(flow.targetUsage ? { targetUsage: flow.targetUsage } : {}),
        confidence: flow.confidence,
        originalSourceIds: new Set<string>()
      };
      mergeFunctionLogicValueFlowTarget(target, flow);
      targetsByBlockId.set(flow.targetBlockId, target);
    }

    for (const target of targetsByBlockId.values()) {
      const sourceBlockIds = target.originalSourceIds.has(target.targetBlockId)
        ? [target.targetBlockId]
        : findNearestFunctionLogicValuePredecessors(
            target.targetBlockId,
            relatedBlockIds,
            incomingByTargetId,
            boundedDepth
          );
      // A pruned BODY/deferred relation can omit the visible control path. The
      // semantic reaching definition is a safe fallback in that presentation.
      const retainedSourceBlockIds = sourceBlockIds.length > 0
        ? sourceBlockIds
        : [...target.originalSourceIds].sort();
      for (const sourceBlockId of retainedSourceBlockIds) {
        const key = [
          bindingId,
          sourceBlockId,
          target.targetBlockId,
          target.targetAccess,
          target.targetUsage ?? "use"
        ].join("\0");
        if (seenHopKeys.has(key)) {
          continue;
        }
        seenHopKeys.add(key);
        if (hops.length >= boundedHops) {
          return hops;
        }
        hops.push({
          id: `logic-value-hop:${bindingId}:${sourceBlockId}:${target.targetBlockId}`,
          bindingId,
          sourceBlockId,
          targetBlockId: target.targetBlockId,
          targetAccess: target.targetAccess,
          ...(target.targetUsage ? { targetUsage: target.targetUsage } : {}),
          confidence: target.confidence
        });
      }
    }
  }
  return hops;
}

/** Produces compact stable SVG coordinates without long floating-point tails. */
function formatFunctionLogicValueFlowCoordinate(value: number): string {
  return String(Math.round(value * 10) / 10);
}

/**
 * Draws a genuine quadratic parabola (`Q`) between adjacent value-use nodes.
 * Vertical chains bow around alternating sides; horizontal chains bow above or
 * below, avoiding the centered channels used by ordinary control edges.
 */
export function createFunctionLogicValueFlowHopPath(
  source: FunctionLogicValueFlowNodeLayout,
  target: FunctionLogicValueFlowNodeLayout,
  hopIndex = 0
): string {
  const normalizedIndex = Number.isFinite(hopIndex) ? Math.abs(Math.floor(hopIndex)) : 0;
  const side = normalizedIndex % 2 === 0 ? 1 : -1;
  const lane = Math.floor(normalizedIndex / 2) % 4;
  if (source.blockId === target.blockId) {
    const edgeX = side > 0 ? source.x + source.width : source.x;
    const startY = source.y + source.height * 0.32;
    const endY = source.y + source.height * 0.72;
    const controlX = edgeX + side * (30 + lane * 9);
    return `M ${formatFunctionLogicValueFlowCoordinate(edgeX)} ${formatFunctionLogicValueFlowCoordinate(startY)}`
      + ` Q ${formatFunctionLogicValueFlowCoordinate(controlX)} ${formatFunctionLogicValueFlowCoordinate((startY + endY) / 2)}`
      + ` ${formatFunctionLogicValueFlowCoordinate(edgeX)} ${formatFunctionLogicValueFlowCoordinate(endY)}`;
  }

  const sourceCenterX = source.x + source.width / 2;
  const sourceCenterY = source.y + source.height / 2;
  const targetCenterX = target.x + target.width / 2;
  const targetCenterY = target.y + target.height / 2;
  const deltaX = targetCenterX - sourceCenterX;
  const deltaY = targetCenterY - sourceCenterY;
  if (Math.abs(deltaY) >= Math.abs(deltaX) * 0.6) {
    const sourceX = side > 0 ? source.x + source.width : source.x;
    const targetX = side > 0 ? target.x + target.width : target.x;
    const clearance = 28 + lane * 9 + Math.min(72, Math.abs(deltaY) * 0.14);
    const controlX = side > 0
      ? Math.max(sourceX, targetX) + clearance
      : Math.min(sourceX, targetX) - clearance;
    return `M ${formatFunctionLogicValueFlowCoordinate(sourceX)} ${formatFunctionLogicValueFlowCoordinate(sourceCenterY)}`
      + ` Q ${formatFunctionLogicValueFlowCoordinate(controlX)} ${formatFunctionLogicValueFlowCoordinate((sourceCenterY + targetCenterY) / 2)}`
      + ` ${formatFunctionLogicValueFlowCoordinate(targetX)} ${formatFunctionLogicValueFlowCoordinate(targetCenterY)}`;
  }

  const sourceY = side > 0 ? source.y + source.height : source.y;
  const targetY = side > 0 ? target.y + target.height : target.y;
  const clearance = 24 + lane * 9 + Math.min(64, Math.abs(deltaX) * 0.12);
  const controlY = side > 0
    ? Math.max(sourceY, targetY) + clearance
    : Math.min(sourceY, targetY) - clearance;
  return `M ${formatFunctionLogicValueFlowCoordinate(sourceCenterX)} ${formatFunctionLogicValueFlowCoordinate(sourceY)}`
    + ` Q ${formatFunctionLogicValueFlowCoordinate((sourceCenterX + targetCenterX) / 2)} ${formatFunctionLogicValueFlowCoordinate(controlY)}`
    + ` ${formatFunctionLogicValueFlowCoordinate(targetCenterX)} ${formatFunctionLogicValueFlowCoordinate(targetY)}`;
}

/** Serializes the tested routing helpers into the CSP-isolated Webview script. */
export function getFunctionLogicValueFlowRoutingBrowserSource(): string {
  return [
    normalizeFunctionLogicValueFlowBound,
    createFunctionLogicValueFlowIncomingIndex,
    findNearestFunctionLogicValuePredecessors,
    mergeFunctionLogicValueFlowTarget,
    createFunctionLogicValueFlowHops,
    formatFunctionLogicValueFlowCoordinate,
    createFunctionLogicValueFlowHopPath
  ].map((value) => value.toString()).join("\n");
}
