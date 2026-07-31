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
        setSemanticStatus("collapsed", { label: functionNode.label });
        return;
      }
      if (state.pendingNodeIds.has(functionNode.id)) return;
      const ownerExpansionKey = findExpansionKeyContainingNode(functionNode.id);
      if (!ownerExpansionKey) {
        setSemanticStatus("function-detached");
        return;
      }
      state.pendingNodeIds.add(functionNode.id);
      setSemanticStatus("attaching-function-graph", { label: functionNode.label });
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
        setSemanticStatus("module-branch-changed");
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
        setSemanticStatus("function-graph-budget");
        return;
      }
      state.enteringNodeIds = new Set(expansion.nodes.map(function (node) { return node.id; }));
      state.enteringEdgeIds = new Set(expansion.edges.map(function (edge) { return edge.id; }));
      renderGraph(currentAnchor, true);
      setSemanticStatus("function-blocks-attached", { count: payload.summary.visibleBlockCount, omitted: payload.summary.omittedEdgeCount, gaps: payload.summary.gapCount, released: retention.evictedKeys.length + pruned });
    }

    /** Keeps function actions in the detail rail while primary click attaches. */
    function renderFunctionDetail(node) {
      state.detailModel = { kind: "function", node: node };
      dom.detail.replaceChildren();
      const title = node.presentation?.labelKey
        ? projectAnalyzerText(node.presentation.labelKey, node.presentation.params) : node.label;
      const detail = node.presentation?.detailKey
        ? projectAnalyzerText(node.presentation.detailKey, node.presentation.params) : node.detail;
      appendText(dom.detail, "h2", "detail-title", title);
      appendText(dom.detail, "div", "detail-row", detail
        + (node.locationLabel ? " · " + node.locationLabel : ""));
      const actions = createDetailSection(projectAnalyzerText("function-graph"));
      const toggle = appendText(actions, "button", "detail-action", projectAnalyzerText("toggle-canvas"));
      toggle.type = "button";
      toggle.addEventListener("click", function () { toggleFunctionLogic(node); });
      if (node.sourceToken) {
        const source = appendText(actions, "button", "detail-action", projectAnalyzerText("open-function-source"));
        source.type = "button";
        source.addEventListener("click", function () {
          requestOpenSource({ kind: "node", sourceToken: node.sourceToken });
        });
      }
      dom.detail.appendChild(actions);
    }

    /** Shows source, value, and call evidence for one attached logic block. */
    function renderLogicBlockDetail(node) {
      state.detailModel = { kind: "logicBlock", node: node };
      dom.detail.replaceChildren();
      const title = node.presentation?.labelKey
        ? projectAnalyzerText(node.presentation.labelKey, node.presentation.labelParams) : node.label;
      const detail = node.presentation?.detailKey
        ? projectAnalyzerText(node.presentation.detailKey, node.presentation.detailParams) : node.detail;
      const branch = node.branchPresentation?.key
        ? projectAnalyzerText(node.branchPresentation.key, node.branchPresentation.params) : node.branchLabel;
      appendText(dom.detail, "h2", "detail-title", title);
      appendText(dom.detail, "div", "detail-row", detail);
      appendText(dom.detail, "div", "detail-row", projectAnalyzerText("module-logic-" + node.blockKind)
        + " · " + projectAnalyzerText("module-confidence-" + (node.confidence || "unknown"))
        + (branch ? " · " + branch : ""));
      if (node.evidenceToken) {
        const source = createDetailSection(projectAnalyzerText("source-evidence"));
        const button = appendText(source, "button", "detail-action", projectAnalyzerText("open-exact-statement"));
        button.type = "button";
        button.addEventListener("click", function () {
          requestOpenSource({ kind: "logicEvidence", evidenceToken: node.evidenceToken });
        });
        dom.detail.appendChild(source);
      }
      appendDetailRows(projectAnalyzerText("value-changes"), node.valueChanges || [], function (change) {
        return change.target + " · " + formatModuleLogicValueOperation(change.operation) + " " + change.operator
          + (change.value ? " " + change.value : "");
      });
      appendDetailRows(projectAnalyzerText("value-accesses"), node.valueAccesses || [], function (access) {
        return access.name + " · " + formatModuleLogicValueOperation(access.access)
          + (access.usage ? " · " + formatModuleLogicValueOperation(access.usage) : "");
      });
      appendDetailRows(projectAnalyzerText("related-functions"), node.drillTargets || [], function (target) {
        return projectAnalyzerText("logic-edge-" + (target.relation || "call"))
          + " · " + (target.qualifiedName || target.name || projectAnalyzerText("called-function"));
      });
    }

    /** Localizes finite analyzer action enums while preserving code identities. */
    function formatModuleLogicValueOperation(operation) {
      const key = "logic-value-operation-" + String(operation || "unknown");
      const localized = projectAnalyzerText(key);
      return localized === key ? projectAnalyzerText("logic-value-operation-unknown") : localized;
    }
  `;
}
