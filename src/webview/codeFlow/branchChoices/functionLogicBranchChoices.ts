/**
 * Pure Function Logic branch-choice projection plus its browser adapter.
 * Selected true/false/case edges constrain an iterative, cycle-safe walk from
 * graph roots; DOM presentation remains confined to the serialized Webview API.
 */

/** Minimal block identity needed to find graph roots and reachable nodes. */
export type FunctionLogicBranchChoiceBlock = {
  id: string;
  kind?: string;
};

/** Minimal directed edge identity used by branch-choice traversal. */
export type FunctionLogicBranchChoiceEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  kind: string;
};

/** Reachable presentation identities after every retained choice is applied. */
export type FunctionLogicBranchChoiceProjection = {
  activeBlockIds: Set<string>;
  activeEdgeIds: Set<string>;
  selectedEdgeIds: Set<string>;
};

/** Restricts interactive choices to explicit branch outcomes. */
export function isFunctionLogicBranchChoiceEdge(
  edge: FunctionLogicBranchChoiceEdge
): boolean {
  return edge.kind === "true" || edge.kind === "false" || edge.kind === "case";
}

/** Drops selections whose source/edge identity no longer exists in the scene. */
export function pruneFunctionLogicBranchChoices(
  choices: ReadonlyMap<string, string>,
  edges: readonly FunctionLogicBranchChoiceEdge[]
): Map<string, string> {
  const choiceEdgesById = new Map(edges
    .filter(isFunctionLogicBranchChoiceEdge)
    .map((edge) => [edge.id, edge]));
  const retained = new Map<string, string>();
  for (const [sourceId, edgeId] of choices) {
    const edge = choiceEdgesById.get(edgeId);
    if (edge?.sourceId === sourceId) {
      retained.set(sourceId, edgeId);
    }
  }
  return retained;
}

/** Selects one outcome per decision source; activating it again clears it. */
export function toggleFunctionLogicBranchChoice(
  choices: ReadonlyMap<string, string>,
  edge: FunctionLogicBranchChoiceEdge
): Map<string, string> {
  const next = new Map(choices);
  if (!isFunctionLogicBranchChoiceEdge(edge)) {
    return next;
  }
  if (next.get(edge.sourceId) === edge.id) {
    next.delete(edge.sourceId);
  } else {
    next.set(edge.sourceId, edge.id);
  }
  return next;
}

/**
 * Walks from every real graph root while honoring selected branch edges.
 * Multiple choices compose, shared merge continuations stay reachable, and a
 * minimum-depth visited map terminates loops within an explicit depth bound.
 */
export function createFunctionLogicBranchChoiceProjection(
  blocks: readonly FunctionLogicBranchChoiceBlock[],
  edges: readonly FunctionLogicBranchChoiceEdge[],
  choices: ReadonlyMap<string, string>,
  maximumDepth = blocks.length
): FunctionLogicBranchChoiceProjection {
  const blockIds = new Set(blocks.map((block) => block.id));
  const incomingCountByBlockId = new Map(blocks.map((block) => [block.id, 0]));
  const outgoingBySourceId = new Map<string, FunctionLogicBranchChoiceEdge[]>();
  for (const edge of edges) {
    if (!blockIds.has(edge.sourceId) || !blockIds.has(edge.targetId)) {
      continue;
    }
    incomingCountByBlockId.set(
      edge.targetId,
      (incomingCountByBlockId.get(edge.targetId) ?? 0) + 1
    );
    const outgoing = outgoingBySourceId.get(edge.sourceId) ?? [];
    outgoing.push(edge);
    outgoingBySourceId.set(edge.sourceId, outgoing);
  }

  const retainedChoices = pruneFunctionLogicBranchChoices(choices, edges);
  let roots = blocks.filter((block) =>
    block.kind === "entry" && (incomingCountByBlockId.get(block.id) ?? 0) === 0
  );
  if (roots.length === 0) {
    roots = blocks.filter((block) =>
      (incomingCountByBlockId.get(block.id) ?? 0) === 0
    );
  }
  if (roots.length === 0 && blocks[0]) {
    roots = [blocks[0]];
  }

  const activeBlockIds = new Set(roots.map((block) => block.id));
  const activeEdgeIds = new Set<string>();
  const boundedMaximumDepth = Number.isFinite(maximumDepth)
    ? Math.max(0, Math.floor(maximumDepth))
    : blocks.length;
  const bestDepthByBlockId = new Map(roots.map((block) => [block.id, 0]));
  const pendingBlocks = roots.map((block) => ({ blockId: block.id, depth: 0 }));
  let cursor = 0;
  while (cursor < pendingBlocks.length) {
    const { blockId: sourceId, depth } = pendingBlocks[cursor];
    cursor += 1;
    if (depth >= boundedMaximumDepth) {
      continue;
    }
    const selectedEdgeId = retainedChoices.get(sourceId);
    for (const edge of outgoingBySourceId.get(sourceId) ?? []) {
      if (selectedEdgeId
        && isFunctionLogicBranchChoiceEdge(edge)
        && edge.id !== selectedEdgeId) {
        continue;
      }
      activeEdgeIds.add(edge.id);
      activeBlockIds.add(edge.targetId);
      const targetDepth = depth + 1;
      const bestDepth = bestDepthByBlockId.get(edge.targetId);
      if (bestDepth === undefined || targetDepth < bestDepth) {
        bestDepthByBlockId.set(edge.targetId, targetDepth);
        pendingBlocks.push({ blockId: edge.targetId, depth: targetDepth });
      }
    }
  }

  return {
    activeBlockIds,
    activeEdgeIds,
    selectedEdgeIds: new Set(retainedChoices.values())
  };
}

/** Returns pure traversal and DOM adapter declarations for the Webview. */
export function getFunctionLogicBranchChoicesBrowserSource(): string {
  const pureSource = [
    isFunctionLogicBranchChoiceEdge,
    pruneFunctionLogicBranchChoices,
    toggleFunctionLogicBranchChoice,
    createFunctionLogicBranchChoiceProjection
  ].map((value) => value.toString()).join("\n");
  return `${pureSource}
    let functionLogicBranchChoiceSessionKey = "";
    let functionLogicBranchChoices = new Map();

    /** Retains choices while the root graph identity is stable across relayouts. */
    function readFunctionLogicBranchChoices(sessionKey, edges) {
      if (functionLogicBranchChoiceSessionKey !== sessionKey) {
        functionLogicBranchChoiceSessionKey = sessionKey;
        functionLogicBranchChoices = new Map();
      }
      functionLogicBranchChoices = pruneFunctionLogicBranchChoices(
        functionLogicBranchChoices,
        edges
      );
      return functionLogicBranchChoices;
    }

    /** Toggles one branch outcome in the active graph session. */
    function toggleFunctionLogicBranchChoiceSession(sessionKey, edges, edge) {
      const choices = readFunctionLogicBranchChoices(sessionKey, edges);
      functionLogicBranchChoices = toggleFunctionLogicBranchChoice(choices, edge);
      return functionLogicBranchChoices;
    }

    /** Clears every selected outcome without replacing the graph DOM. */
    function clearFunctionLogicBranchChoiceSession(sessionKey) {
      functionLogicBranchChoiceSessionKey = sessionKey;
      functionLogicBranchChoices = new Map();
      return functionLogicBranchChoices;
    }

    /** Applies scenario reachability independently from selected-node emphasis. */
    function applyFunctionLogicBranchChoicePresentation(
      blocks,
      edges,
      choices,
      nodeButtonsById,
      edgeElementsById
    ) {
      const projection = createFunctionLogicBranchChoiceProjection(blocks, edges, choices);
      const constrained = projection.selectedEdgeIds.size > 0;
      for (const [blockId, button] of nodeButtonsById) {
        const reachable = !constrained || projection.activeBlockIds.has(blockId);
        button.classList.toggle("choice-dimmed", !reachable);
        button.classList.toggle("choice-reachable", constrained && reachable);
      }
      for (const [edgeId, elements] of edgeElementsById) {
        const reachable = !constrained || projection.activeEdgeIds.has(edgeId);
        const selected = projection.selectedEdgeIds.has(edgeId);
        elements.path.classList.toggle("choice-dimmed", !reachable);
        elements.path.classList.toggle("choice-reachable", constrained && reachable);
        elements.path.classList.toggle("choice-selected", selected);
        elements.label.classList.toggle("choice-dimmed", !reachable);
        elements.label.classList.toggle("choice-reachable", constrained && reachable);
        elements.label.classList.toggle("choice-selected", selected);
        if (elements.choice) {
          elements.label.setAttribute("aria-pressed", selected ? "true" : "false");
        }
      }
      return projection;
    }

    /** Creates one keyboard-accessible choice in the selected-block panel. */
    function createFunctionLogicBranchChoiceButton(edge, target, choices, onChoice) {
      const button = document.createElement("button");
      const selected = choices.get(edge.sourceId) === edge.id;
      const transfer = formatLogicEdge(edge)
        + (target ? " → " + completeTargetLabel(target) : "");
      button.type = "button";
      button.className = "flow-badge logic-transfer logic-transfer-choice " + edge.kind
        + (selected ? " selected" : "");
      button.textContent = (selected ? "Selected " : "Choose ") + transfer;
      button.title = (selected ? "Clear selected path · " : "Choose path · ") + transfer;
      button.setAttribute("aria-pressed", selected ? "true" : "false");
      button.addEventListener("click", () => onChoice(edge));
      return button;
    }

    /** Explains the active scenario and offers one complete reset action. */
    function createFunctionLogicBranchChoiceSummary(choices, onClear) {
      if (choices.size === 0) return undefined;
      const summary = document.createElement("div");
      const text = document.createElement("span");
      const reset = document.createElement("button");
      summary.className = "logic-choice-summary";
      text.textContent = choices.size + " branch choice"
        + (choices.size === 1 ? "" : "s")
        + " selected · reachable continuation highlighted";
      reset.type = "button";
      reset.className = "logic-choice-reset";
      reset.textContent = "Reset choices";
      reset.title = "Clear all selected branch choices";
      reset.addEventListener("click", onClear);
      summary.append(text, reset);
      return summary;
    }
  `;
}
