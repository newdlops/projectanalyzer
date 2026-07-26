/**
 * Iterative, deterministic Function Logic attention projection. It combines
 * branch reachability, reader lens, selection, focus frames, and value
 * playback into one visual priority so feature modules never own opacity.
 */

import type {
  FunctionLogicAttentionBlock,
  FunctionLogicAttentionEdge,
  FunctionLogicAttentionInputs,
  FunctionLogicAttentionLevel,
  FunctionLogicAttentionProjection,
  FunctionLogicComprehensionState
} from "./types";

type FunctionLogicAttentionIndex = {
  blocksById: ReadonlyMap<string, FunctionLogicAttentionBlock>;
  incomingByTargetId: ReadonlyMap<string, readonly FunctionLogicAttentionEdge[]>;
  outgoingBySourceId: ReadonlyMap<string, readonly FunctionLogicAttentionEdge[]>;
  childrenByParentId: ReadonlyMap<string, readonly string[]>;
};

const attentionRank: Readonly<Record<FunctionLogicAttentionLevel, number>> = {
  muted: 0,
  context: 1,
  related: 2,
  active: 3
};

/** Builds stable adjacency indexes once per projection without recursive walks. */
function createFunctionLogicAttentionIndex(
  blocks: readonly FunctionLogicAttentionBlock[],
  edges: readonly FunctionLogicAttentionEdge[]
): FunctionLogicAttentionIndex {
  const blocksById = new Map(blocks.map((block) => [block.id, block]));
  const incomingByTargetId = new Map<string, FunctionLogicAttentionEdge[]>();
  const outgoingBySourceId = new Map<string, FunctionLogicAttentionEdge[]>();
  const childrenByParentId = new Map<string, string[]>();
  for (const block of blocks) {
    if (!block.parentBlockId || !blocksById.has(block.parentBlockId)) {
      continue;
    }
    const children = childrenByParentId.get(block.parentBlockId) ?? [];
    children.push(block.id);
    childrenByParentId.set(block.parentBlockId, children);
  }
  for (const edge of edges) {
    if (!blocksById.has(edge.sourceId) || !blocksById.has(edge.targetId)) {
      continue;
    }
    const incoming = incomingByTargetId.get(edge.targetId) ?? [];
    incoming.push(edge);
    incomingByTargetId.set(edge.targetId, incoming);
    const outgoing = outgoingBySourceId.get(edge.sourceId) ?? [];
    outgoing.push(edge);
    outgoingBySourceId.set(edge.sourceId, outgoing);
  }
  return { blocksById, incomingByTargetId, outgoingBySourceId, childrenByParentId };
}

/** Returns a bounded descendant membership set using an explicit queue. */
function collectFunctionLogicFocusMembers(
  ownerId: string | undefined,
  index: FunctionLogicAttentionIndex,
  maximumCount: number
): Set<string> | undefined {
  if (!ownerId || !index.blocksById.has(ownerId)) {
    return undefined;
  }
  const members = new Set<string>([ownerId]);
  const pending = [ownerId];
  let cursor = 0;
  while (cursor < pending.length && members.size < maximumCount) {
    const parentId = pending[cursor];
    cursor += 1;
    for (const childId of index.childrenByParentId.get(parentId) ?? []) {
      if (!members.has(childId)) {
        members.add(childId);
        pending.push(childId);
      }
    }
  }
  return members;
}

/** Collects one embedded boundary and every virtual block explicitly mapped to it. */
function collectFunctionLogicEmbeddedFocusMembers(
  boundaryId: string | undefined,
  blocks: readonly FunctionLogicAttentionBlock[],
  index: FunctionLogicAttentionIndex
): Set<string> | undefined {
  if (!boundaryId || !blocks.some((block) => block.id === boundaryId)) {
    return undefined;
  }
  const members = collectFunctionLogicFocusMembers(boundaryId, index, blocks.length)
    ?? new Set<string>([boundaryId]);
  for (const block of blocks) {
    if (block.embeddedBoundaryId === boundaryId) members.add(block.id);
  }
  return members;
}

/** Identifies blocks that answer the active semantic reader question. */
function isFunctionLogicLensRelevant(
  block: FunctionLogicAttentionBlock,
  state: FunctionLogicComprehensionState
): boolean {
  if (state.lens === "flow") {
    return ["entry", "condition", "loop", "switch", "try", "return", "throw", "exit"]
      .includes(block.kind);
  }
  if (state.lens === "values") {
    return Boolean(state.selectedBindingId
      ? block.valueAccesses?.some((access) => access.bindingId === state.selectedBindingId)
      : block.valueChanges?.length);
  }
  if (state.lens === "calls") {
    return Boolean(block.drillTargets?.length)
      || ["call", "callable", "render", "event", "embedded"].includes(block.kind);
  }
  return Boolean(block.valueChanges?.length)
    || ["effect", "mutation", "return", "throw"].includes(block.kind);
}

/** Raises one node's level only when the proposed semantic priority is stronger. */
function raiseFunctionLogicNodeAttention(
  levels: Map<string, FunctionLogicAttentionLevel>,
  reasons: Map<string, string>,
  blockId: string,
  level: FunctionLogicAttentionLevel,
  reason: string
): void {
  const current = levels.get(blockId) ?? "muted";
  if (attentionRank[level] > attentionRank[current]) {
    levels.set(blockId, level);
    reasons.set(blockId, reason);
  }
}

/**
 * Projects one graph state into attention attributes. Invalid references are
 * ignored, cycles are bounded by visited sets, and output order follows input.
 */
export function createFunctionLogicAttentionProjection(
  blocks: readonly FunctionLogicAttentionBlock[],
  edges: readonly FunctionLogicAttentionEdge[],
  state: FunctionLogicComprehensionState,
  inputs: FunctionLogicAttentionInputs = {}
): FunctionLogicAttentionProjection {
  const index = createFunctionLogicAttentionIndex(blocks, edges);
  const reachableBlockIds = inputs.reachableBlockIds ?? new Set(blocks.map((block) => block.id));
  const reachableEdgeIds = inputs.reachableEdgeIds ?? new Set(edges.map((edge) => edge.id));
  const focusMembers = state.embeddedFocusBoundaryId
    ? collectFunctionLogicEmbeddedFocusMembers(state.embeddedFocusBoundaryId, blocks, index)
    : collectFunctionLogicFocusMembers(state.bodyFocusOwnerId, index, blocks.length);
  const nodeLevelById = new Map<string, FunctionLogicAttentionLevel>();
  const edgeLevelById = new Map<string, FunctionLogicAttentionLevel>();
  const reasonByNodeId = new Map<string, string>();
  const excludedNodeIds = new Set<string>();
  const excludedEdgeIds = new Set<string>();

  for (const block of blocks) {
    const reachable = reachableBlockIds.has(block.id);
    const withinFocus = !focusMembers || focusMembers.has(block.id);
    if (!reachable) {
      excludedNodeIds.add(block.id);
    }
    const level: FunctionLogicAttentionLevel = reachable && withinFocus ? "context" : "muted";
    nodeLevelById.set(block.id, level);
    reasonByNodeId.set(block.id, !reachable ? "branch-excluded" : withinFocus ? "graph-context" : "focus-outside");
    if (reachable && withinFocus && isFunctionLogicLensRelevant(block, state)) {
      raiseFunctionLogicNodeAttention(nodeLevelById, reasonByNodeId, block.id, "related", "lens-relevant");
    }
  }

  for (const edge of edges) {
    const sourceLevel = nodeLevelById.get(edge.sourceId) ?? "muted";
    const targetLevel = nodeLevelById.get(edge.targetId) ?? "muted";
    const reachable = reachableEdgeIds.has(edge.id);
    if (!reachable) {
      excludedEdgeIds.add(edge.id);
    }
    edgeLevelById.set(edge.id, reachable && sourceLevel !== "muted" && targetLevel !== "muted"
      ? "context"
      : "muted");
  }

  // Guide focus is explicit reader intent. It is applied before selection and
  // playback so those established states retain their higher visual priority.
  if (state.guideFocus) {
    for (const blockId of state.guideFocus.blockIds) {
      if (index.blocksById.has(blockId)) {
        raiseFunctionLogicNodeAttention(nodeLevelById, reasonByNodeId, blockId, "related", "guide-related");
      }
    }
    if (state.guideFocus.primaryBlockId && index.blocksById.has(state.guideFocus.primaryBlockId)) {
      raiseFunctionLogicNodeAttention(nodeLevelById, reasonByNodeId, state.guideFocus.primaryBlockId, "active", "guide-primary");
    }
    for (const edgeId of state.guideFocus.edgeIds) {
      if (edgeLevelById.has(edgeId)) edgeLevelById.set(edgeId, "related");
    }
  }

  const selectedBlockId = state.selectedBlockId;
  if (selectedBlockId && index.blocksById.has(selectedBlockId)) {
    for (const edge of [
      ...(index.incomingByTargetId.get(selectedBlockId) ?? []),
      ...(index.outgoingBySourceId.get(selectedBlockId) ?? [])
    ]) {
      raiseFunctionLogicNodeAttention(nodeLevelById, reasonByNodeId, edge.sourceId, "related", "selected-neighbour");
      raiseFunctionLogicNodeAttention(nodeLevelById, reasonByNodeId, edge.targetId, "related", "selected-neighbour");
      edgeLevelById.set(edge.id, "related");
    }
    raiseFunctionLogicNodeAttention(nodeLevelById, reasonByNodeId, selectedBlockId, "active", "selected");
  }

  const activeHopBlockId = state.playback.status === "idle"
    ? undefined
    : inputs.valueHopBlockIds?.[state.playback.activeHopIndex];
  if (activeHopBlockId && index.blocksById.has(activeHopBlockId)) {
    if (selectedBlockId && selectedBlockId !== activeHopBlockId) {
      // Playback owns the single active endpoint. This is the only intentional
      // demotion in the priority table, so it is explicit rather than using
      // the monotonic raise helper above.
      nodeLevelById.set(selectedBlockId, "related");
      reasonByNodeId.set(selectedBlockId, "selected-during-playback");
    }
    raiseFunctionLogicNodeAttention(nodeLevelById, reasonByNodeId, activeHopBlockId, "active", "playback-endpoint");
  }

  if (state.embeddedFocusBoundaryId && index.blocksById.has(state.embeddedFocusBoundaryId)) {
    raiseFunctionLogicNodeAttention(
      nodeLevelById,
      reasonByNodeId,
      state.embeddedFocusBoundaryId,
      selectedBlockId === state.embeddedFocusBoundaryId ? "active" : "related",
      "embedded-context"
    );
  }
  return { nodeLevelById, edgeLevelById, excludedNodeIds, excludedEdgeIds, reasonByNodeId };
}

/** Serializes the pure projection for the CSP-restricted Webview runtime. */
export function getFunctionLogicAttentionProjectionBrowserSource(): string {
  return `
    const attentionRank = ${JSON.stringify(attentionRank)};
    ${createFunctionLogicAttentionIndex.toString()}
    ${collectFunctionLogicFocusMembers.toString()}
    ${collectFunctionLogicEmbeddedFocusMembers.toString()}
    ${isFunctionLogicLensRelevant.toString()}
    ${raiseFunctionLogicNodeAttention.toString()}
    ${createFunctionLogicAttentionProjection.toString()}
  `;
}
