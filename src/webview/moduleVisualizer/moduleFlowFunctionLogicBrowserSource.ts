/**
 * Browser interactions for same-canvas Function Logic branches in Module Flow.
 * The generated functions intentionally use the parent program's state, detail,
 * graph-rendering, and protocol helpers while keeping this feature isolated.
 */

/** Returns the CSP-compatible function-logic interaction slice. */
export function getModuleFlowFunctionLogicBrowserSource(): string {
  return /* javascript */ `
    /** Toggles one function-local graph as a child branch of its current card. */
    function toggleFunctionLogic(functionNode) {
      if (!state.graphVersion || !functionNode || functionNode.kind !== "function") return;
      if (!functionNode.expandable || !functionNode.expandable.functionLogic) return;
      const key = functionNode.id + "\u0000functionLogic";
      const anchor = captureViewportAnchor(functionNode.id);
      if (state.expansions.has(key)) {
        state.expansions.delete(key);
        state.pendingNodeIds.delete(functionNode.id);
        state.enteringNodeIds.clear();
        state.enteringEdgeIds.clear();
        renderGraph(anchor, true);
        setStatus("Collapsed function graph for " + functionNode.label);
        return;
      }
      if (state.pendingNodeIds.has(functionNode.id)) return;
      const ownerExpansionKey = findExpansionKeyContainingNode(functionNode.id);
      if (!ownerExpansionKey) {
        setStatus("This function is no longer attached to the active module branch");
        return;
      }
      state.pendingNodeIds.add(functionNode.id);
      setStatus("Attaching function graph for " + functionNode.label);
      post("moduleFlow/functionLogic", {
        graphVersion: state.graphVersion,
        functionId: functionNode.id,
        blockLimit: 48,
        edgeLimit: 96
      }, {
        operation: "functionLogic",
        key: key,
        ownerExpansionKey: ownerExpansionKey,
        anchor: anchor,
        anchorNodeId: functionNode.id
      });
      renderGraph(anchor, false);
    }

    /** Finds the retained parent branch that currently owns one function card. */
    function findExpansionKeyContainingNode(nodeId) {
      for (const pair of state.expansions.entryPairs()) {
        const key = pair[0];
        const expansion = pair[1];
        if ((expansion.nodes || []).some(function (node) { return node.id === nodeId; })) {
          return key;
        }
      }
      return undefined;
    }

    /** Removes function graphs whose owning function branch has been released. */
    function pruneOrphanFunctionLogicExpansions() {
      const availableNodeIds = new Set(state.baseNodes.keys());
      for (const expansion of state.expansions.values()) {
        if (expansion.expansion === "functionLogic") continue;
        for (const node of expansion.nodes || []) availableNodeIds.add(node.id);
      }
      let removed = 0;
      for (const pair of Array.from(state.expansions.entryPairs())) {
        const key = pair[0];
        const expansion = pair[1];
        if (expansion.expansion !== "functionLogic"
          || availableNodeIds.has(expansion.anchorFunctionId)) continue;
        if (state.expansions.delete(key)) removed += 1;
      }
      return removed;
    }

    /** Adapts one correlated Function Logic result into the shared graph scene. */
    function acceptFunctionLogic(payload) {
      const pending = state.pending.get(payload.requestId);
      if (!pending || pending.operation !== "functionLogic"
        || payload.anchorFunctionId !== pending.anchorNodeId) return;
      state.pending.delete(payload.requestId);
      state.pendingNodeIds.delete(pending.anchorNodeId);
      const currentAnchor = captureViewportAnchor(pending.anchorNodeId) || pending.anchor;
      const ownerExpansionKey = findExpansionKeyContainingNode(pending.anchorNodeId);
      if (!ownerExpansionKey || ownerExpansionKey !== pending.ownerExpansionKey) {
        renderGraph(currentAnchor, false);
        setStatus("The function's module branch changed before its graph was ready");
        return;
      }
      const expansion = createModuleFlowFunctionLogicScene(payload);
      const retention = state.expansions.retain(
        pending.key,
        expansion,
        state.baseNodes.keys(),
        state.baseEdges.keys(),
        [ownerExpansionKey]
      );
      const pruned = pruneOrphanFunctionLogicExpansions();
      if (!retention.accepted) {
        state.enteringNodeIds.clear();
        state.enteringEdgeIds.clear();
        renderGraph(currentAnchor, false);
        setStatus("This function graph exceeds the complete canvas resource budget");
        return;
      }
      state.enteringNodeIds = new Set(expansion.nodes.map(function (node) { return node.id; }));
      state.enteringEdgeIds = new Set(expansion.edges.map(function (edge) { return edge.id; }));
      renderGraph(currentAnchor, true);
      const gaps = payload.summary.gapCount > 0
        ? " · " + payload.summary.gapCount + " analysis gap(s)"
        : "";
      const releasedCount = retention.evictedKeys.length + pruned;
      const released = releasedCount > 0
        ? " · " + releasedCount + " oldest branch(es) released"
        : "";
      setStatus(payload.summary.visibleBlockCount + " function blocks attached"
        + (payload.summary.omittedEdgeCount > 0
          ? " · " + payload.summary.omittedEdgeCount + " edges omitted"
          : "")
        + gaps
        + released);
    }

    /** Keeps function actions in the detail rail while primary click attaches. */
    function renderFunctionDetail(node) {
      dom.detail.replaceChildren();
      appendText(dom.detail, "h2", "detail-title", node.label);
      appendText(dom.detail, "div", "detail-row", node.detail
        + (node.locationLabel ? " · " + node.locationLabel : ""));
      const actions = createDetailSection("Function graph");
      const toggle = appendText(actions, "button", "detail-action", "Toggle on this canvas");
      toggle.type = "button";
      toggle.addEventListener("click", function () { toggleFunctionLogic(node); });
      if (node.sourceToken) {
        const source = appendText(actions, "button", "detail-action", "Open function source");
        source.type = "button";
        source.addEventListener("click", function () {
          requestOpenSource({ kind: "node", sourceToken: node.sourceToken });
        });
      }
      dom.detail.appendChild(actions);
    }

    /** Shows source, value, and call evidence for one attached logic block. */
    function renderLogicBlockDetail(node) {
      dom.detail.replaceChildren();
      appendText(dom.detail, "h2", "detail-title", node.label);
      appendText(dom.detail, "div", "detail-row", node.detail);
      appendText(dom.detail, "div", "detail-row", node.blockKind + " · " + node.confidence
        + (node.branchLabel ? " · " + node.branchLabel : ""));
      if (node.evidenceToken) {
        const source = createDetailSection("Source evidence");
        const button = appendText(source, "button", "detail-action", "Open exact statement");
        button.type = "button";
        button.addEventListener("click", function () {
          requestOpenSource({ kind: "logicEvidence", evidenceToken: node.evidenceToken });
        });
        dom.detail.appendChild(source);
      }
      appendDetailRows("Value changes", node.valueChanges || [], function (change) {
        return change.target + " · " + change.operation + " " + change.operator
          + (change.value ? " " + change.value : "");
      });
      appendDetailRows("Value accesses", node.valueAccesses || [], function (access) {
        return access.name + " · " + access.access + (access.usage ? " · " + access.usage : "");
      });
      appendDetailRows("Related functions", node.drillTargets || [], function (target) {
        return (target.relation || "call") + " · " + (target.qualifiedName || target.name);
      });
    }
  `;
}
