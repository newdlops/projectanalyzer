/**
 * Browser program for the dedicated Module Flow panel.
 *
 * It merges bounded Host deltas into one canvas, runs the shared deterministic
 * layout, preserves the clicked module's viewport position, and routes all Host
 * text through textContent. No raw analyzer identity or source path is accepted.
 */

import { getModuleFlowGraphLayoutBrowserSource } from "../../application/moduleFlow/moduleFlowGraphLayout";
import { getModuleFlowViewportBrowserSource } from "../../application/moduleFlow/moduleFlowViewport";
import { getCodeSnippetBrowserSource } from "../codePresentation";
import { getModuleFlowExpansionStoreBrowserSource } from "./moduleFlowExpansionStore";
import { getModuleFlowFrameSchedulerBrowserSource } from "./moduleFlowFrameScheduler";
import { getModuleFlowFunctionLogicBrowserSource } from "./moduleFlowFunctionLogicBrowserSource";
import { getModuleFlowFunctionLogicSceneBrowserSource } from "./moduleFlowFunctionLogicScene";
import { getModuleFlowLayoutCacheBrowserSource } from "./moduleFlowLayoutCache";
import { getModuleFlowLineageFocusBrowserSource } from "./moduleFlowLineageFocus";
import { getModuleFlowModuleComponentFocusBrowserSource } from "./moduleFlowModuleComponentFocus";
import { getModuleVisualizerGraphRendererSource } from "./moduleVisualizerGraphRendererSource";
import { getModuleVisualizerViewportBrowserSource } from "./moduleVisualizerViewportBrowserSource";
import { getModuleFlowLabelBrowserSource } from "./moduleFlowLabelBrowserSource";

/** Returns one nonce-compatible script with the pure layout runtime embedded. */
export function getModuleVisualizerBrowserSource(): string {
  return /* javascript */ `(function () {
    "use strict";
    ${getCodeSnippetBrowserSource()}
    ${getModuleFlowGraphLayoutBrowserSource()}
    ${getModuleFlowViewportBrowserSource()}
    ${getModuleFlowExpansionStoreBrowserSource()}
    ${getModuleFlowFrameSchedulerBrowserSource()}
    ${getModuleFlowLineageFocusBrowserSource()}
    ${getModuleFlowModuleComponentFocusBrowserSource()}
    ${getModuleFlowFunctionLogicSceneBrowserSource()}
    ${getModuleFlowFunctionLogicBrowserSource()}
    ${getModuleFlowLayoutCacheBrowserSource()}
    ${getModuleVisualizerGraphRendererSource()}
    ${getModuleVisualizerViewportBrowserSource()}

    const vscode = acquireVsCodeApi();
    const SVG_NS = "http://www.w3.org/2000/svg";
    const dom = {
      summary: document.getElementById("module-summary"),
      status: document.getElementById("module-status"),
      viewport: document.getElementById("module-viewport"),
      stage: document.getElementById("module-stage"),
      scene: document.getElementById("module-scene"),
      cycles: document.getElementById("module-cycles"),
      edges: document.getElementById("module-edges"),
      nodes: document.getElementById("module-nodes"),
      detail: document.getElementById("module-detail"),
      includeExternal: document.getElementById("include-external"),
      includeInferred: document.getElementById("include-inferred"),
      fit: document.getElementById("fit-graph"),
      zoomOut: document.getElementById("zoom-out"),
      zoomLevel: document.getElementById("zoom-level"),
      zoomIn: document.getElementById("zoom-in"),
      zoomAnnouncement: document.getElementById("zoom-announcement")
    };
    const state = {
      graphVersion: undefined,
      snapshotSession: undefined,
      snapshotRevision: -1,
      mode: "execution",
      baseNodes: new Map(),
      baseEdges: new Map(),
      // Per-response limits are insufficient when many branches remain open.
      // This store enforces the complete canvas budget across all expansions.
      expansions: new ModuleFlowExpansionStore(500, 1000),
      pending: new Map(),
      // Modules and functions share one loading registry because both are
      // stable anchors for an attached same-canvas branch.
      pendingNodeIds: new Set(),
      nextRequestId: 0,
      latestListRequestId: 0,
      selectedNodeId: undefined,
      selectedEdgeId: undefined,
      // Module focus is independent from function/block detail selection and
      // limits layout to the selected module's directional graph lineage.
      focusedModuleId: undefined,
      focusedModuleNode: undefined,
      enteringNodeIds: new Set(),
      enteringEdgeIds: new Set(),
      scale: 1,
      baseSceneKey: "",
      layout: undefined,
      layoutByNodeId: new Map(),
      // Current and immediately previous structures cover expand/collapse while
      // bounding retained routed geometry for 500-node scenes.
      layoutCache: new ModuleFlowLayoutCache(2),
      nodesById: new Map(),
      edgesById: new Map(),
      nodeElementsById: new Map(),
      edgeElementsById: new Map(),
      cycleElementsById: new Map(),
      viewportFrame: undefined,
      sceneDirty: false,
      presentationDirty: false,
      viewportDirty: false,
      pendingAnchor: undefined,
      pendingZoom: undefined,
      pendingResizeCenter: undefined,
      detailRequestTimer: undefined,
      pendingDetailTarget: undefined,
      enteringTimer: undefined,
      zoomAnnouncementTimer: undefined,
      resizeObserver: undefined,
      pan: undefined,
      frameScheduler: undefined,
      // Locale-sensitive browser copy is retained as descriptors/literals so a
      // language switch can update text without requesting or rebuilding scene data.
      statusPresentation: undefined,
      summaryPresentation: undefined,
      detailModel: { kind: "empty" }
    };
    state.frameScheduler = new ModuleFlowFrameScheduler(
      window.requestAnimationFrame.bind(window),
      window.cancelAnimationFrame.bind(window),
      flushGraphCommit
    );

    /** Sends one request with a monotonic browser correlation identity. */
    function post(type, payload, pending) {
      state.nextRequestId += 1;
      const requestId = state.nextRequestId;
      if (pending) state.pending.set(requestId, pending);
      vscode.postMessage({ type: type, payload: Object.assign({}, payload, { requestId: requestId }) });
      return requestId;
    }

    /** Requests a complete bounded scene for toolbar changes. */
    function requestList() {
      if (!state.graphVersion) return;
      setSemanticStatus("updating-lens");
      const requestId = post("moduleFlow/list", {
        graphVersion: state.graphVersion,
        mode: state.mode,
        moduleLimit: 80,
        edgeLimit: 160,
        includeExternal: Boolean(dom.includeExternal.checked),
        includeInferred: Boolean(dom.includeInferred.checked)
      }, { operation: "list" });
      state.latestListRequestId = requestId;
    }

    /** Requests detail without changing the graph selection or canvas. */
    function requestDetail(target) {
      if (!state.graphVersion) return;
      state.pendingDetailTarget = target;
      if (state.detailRequestTimer !== undefined) {
        window.clearTimeout(state.detailRequestTimer);
      }
      // Selection can move rapidly across a large canvas. Only the settled
      // target should trigger Host-side relation aggregation and token work.
      state.detailRequestTimer = window.setTimeout(function () {
        const settledTarget = state.pendingDetailTarget;
        state.pendingDetailTarget = undefined;
        state.detailRequestTimer = undefined;
        if (!settledTarget || !state.graphVersion) return;
        post("moduleFlow/detail", {
          graphVersion: state.graphVersion,
          target: settledTarget,
          relationLimit: 40,
          evidenceLimit: 5
        }, { operation: "detail", target: settledTarget });
      }, 60);
    }

    /** Opens a Host-approved definition or exact evidence range. */
    function requestOpenSource(target) {
      if (!state.graphVersion) return;
      post("moduleFlow/openSource", {
        graphVersion: state.graphVersion,
        target: target
      });
    }

    /** Toggles one idempotent expansion while retaining its anchor on screen. */
    function toggleExpansion(module, expansion) {
      if (!state.graphVersion || !module || module.kind !== "module") return;
      const key = module.id + "\u0000" + expansion;
      const anchor = captureViewportAnchor(module.id);
      const focus = focusModuleComponents(module.id, module);
      if (state.expansions.has(key)) {
        state.expansions.delete(key);
        pruneOrphanFunctionLogicExpansions();
        state.pendingNodeIds.delete(module.id);
        state.enteringNodeIds.clear();
        state.enteringEdgeIds.clear();
        renderGraph(anchor, true);
        setSemanticStatus("collapsed", { label: module.label });
        return;
      }
      if (state.pendingNodeIds.has(module.id)) {
        renderGraph(anchor, focus.focusChanged || focus.removedBranchCount > 0);
        return;
      }
      state.pendingNodeIds.add(module.id);
      setSemanticStatus(
        expansion === "boundaryFunctions" ? "attaching-boundary-functions" : "attaching-child-modules"
      );
      post("moduleFlow/expand", {
        graphVersion: state.graphVersion,
        moduleId: module.id,
        expansion: expansion,
        direction: "both",
        nodeLimit: 48,
        edgeLimit: 96
      }, {
        operation: "expand",
        expansion: expansion,
        key: key,
        anchor: anchor,
        moduleId: module.id
      });
      renderGraph(anchor, focus.focusChanged || focus.removedBranchCount > 0);
    }

    /** Handles typed Extension Host responses with stale correlation guards. */
    function handleModuleFlowHostMessage(event) {
      const message = event.data;
      if (!message || typeof message.type !== "string" || !message.payload) return;
      const payload = message.payload;
      if (message.type === "ui/language") {
        applyProjectAnalyzerLanguage(payload.language === "ko" ? "ko" : "en");
        relocalizeModuleFlowPresentation();
        return;
      }
      if (message.type === "error") {
        const key = "error-" + payload.code;
        if (projectAnalyzerText(key) !== key) setSemanticStatus(key, { detail: payload.detail ? ": " + payload.detail : "" });
        else setLiteralStatus(payload.message || projectAnalyzerText("module-failed"));
        return;
      }
      if (message.type === "moduleFlow/listLoaded") {
        acceptList(payload);
        return;
      }
      if (!state.graphVersion || payload.graphVersion !== state.graphVersion) return;
      if (message.type === "moduleFlow/expanded") {
        acceptExpansion(payload);
      } else if (message.type === "moduleFlow/functionLogicLoaded") {
        acceptFunctionLogic(payload);
      } else if (message.type === "moduleFlow/detailLoaded") {
        if (state.pending.has(payload.requestId)) {
          state.pending.delete(payload.requestId);
          renderDetail(payload.detail);
        }
      } else if (message.type === "moduleFlow/requestFailed") {
        acceptFailure(payload);
      }
    }
    window.addEventListener("message", handleModuleFlowHostMessage);

    /** Replaces the base scene while preserving a brand-new panel snapshot. */
    function acceptList(payload) {
      const replacingSnapshot = payload.graphVersion !== state.graphVersion;
      const snapshotIdentity = parseSnapshotIdentity(payload.graphVersion);
      if (replacingSnapshot && payload.requestId !== 0) return;
      if (replacingSnapshot
        && snapshotIdentity
        && state.snapshotSession === snapshotIdentity.session
        && snapshotIdentity.revision <= state.snapshotRevision) return;
      if (!replacingSnapshot && payload.requestId < state.latestListRequestId) return;
      if (replacingSnapshot) resetModuleFlowScene();
      state.graphVersion = payload.graphVersion;
      state.snapshotSession = snapshotIdentity && snapshotIdentity.session;
      state.snapshotRevision = snapshotIdentity ? snapshotIdentity.revision : state.snapshotRevision + 1;
      state.mode = payload.mode;
      state.baseNodes = new Map((payload.nodes || []).map(function (node) { return [node.id, node]; }));
      state.baseEdges = new Map((payload.edges || []).map(function (edge) { return [edge.id, edge]; }));
      state.expansions.clear();
      state.layoutCache.clear();
      state.baseSceneKey = payload.graphVersion + ":" + payload.requestId + ":" + payload.mode;
      state.pending.clear();
      if (state.detailRequestTimer !== undefined) {
        window.clearTimeout(state.detailRequestTimer);
        state.detailRequestTimer = undefined;
      }
      state.pendingDetailTarget = undefined;
      state.pendingNodeIds.clear();
      state.selectedNodeId = undefined;
      state.selectedEdgeId = undefined;
      state.focusedModuleId = undefined;
      state.focusedModuleNode = undefined;
      state.enteringNodeIds.clear();
      state.enteringEdgeIds.clear();
      state.latestListRequestId = payload.requestId;
      syncModeButtons();
      const summary = payload.summary;
      state.summaryPresentation = { key: "module-count-summary", params: { visibleModules: summary.visibleModuleCount, totalModules: summary.totalModuleCount, visibleEdges: summary.visibleEdgeCount, totalEdges: summary.totalEdgeCount, evidence: summary.crossModuleEvidenceCount } };
      dom.summary.textContent = projectAnalyzerText(state.summaryPresentation.key, state.summaryPresentation.params);
      renderEmptyDetail();
      renderGraph(undefined, true);
      setSemanticStatus(summary.omittedModuleCount + summary.omittedEdgeCount > 0
        ? "bounded-scene"
        : "module-ready");
    }

    /** Merges one bounded delta and restores the clicked module's viewport point. */
    function acceptExpansion(payload) {
      const pending = state.pending.get(payload.requestId);
      if (!pending || pending.operation !== "expand") return;
      state.pending.delete(payload.requestId);
      state.pendingNodeIds.delete(pending.moduleId);
      const currentAnchor = captureViewportAnchor(pending.moduleId) || pending.anchor;
      const retention = state.expansions.retain(
        pending.key,
        payload,
        state.baseNodes.keys(),
        state.baseEdges.keys()
      );
      const pruned = pruneOrphanFunctionLogicExpansions();
      if (!retention.accepted) {
        state.enteringNodeIds.clear();
        state.enteringEdgeIds.clear();
        renderGraph(currentAnchor, false);
        setSemanticStatus("module-budget");
        return;
      }
      state.enteringNodeIds = new Set((payload.nodes || []).map(function (node) { return node.id; }));
      state.enteringEdgeIds = new Set((payload.edges || []).map(function (edge) { return edge.id; }));
      renderGraph(currentAnchor, true);
      const releasedCount = retention.evictedKeys.length + pruned;
      setSemanticStatus(
        releasedCount > 0 ? "module-expansion-status-released" : "module-expansion-status",
        { count: payload.summary.visibleNodeCount, omitted: payload.summary.omittedNodeCount, released: releasedCount }
      );
    }

    /** Clears request-local loading state and exposes a display-safe failure. */
    function acceptFailure(payload) {
      const pending = state.pending.get(payload.requestId);
      if (!pending && payload.operation !== "openSource") return;
      if (pending) {
        state.pending.delete(payload.requestId);
        if (pending.anchorNodeId) state.pendingNodeIds.delete(pending.anchorNodeId);
        if (pending.moduleId) state.pendingNodeIds.delete(pending.moduleId);
      }
      setFailureStatus(payload);
      renderGraph(undefined, false);
    }

    /** Merges the scene, then retains only the selected module's directed lineage. */
    function collectScene() {
      const nodes = new Map(state.baseNodes);
      const edges = new Map(state.baseEdges);
      const replaced = new Set();
      for (const expansion of state.expansions.values()) {
        for (const edgeId of expansion.replacedEdgeIds || []) replaced.add(edgeId);
      }
      for (const edgeId of replaced) edges.delete(edgeId);
      for (const expansion of state.expansions.values()) {
        for (const node of expansion.nodes || []) nodes.set(node.id, node);
        for (const edge of expansion.edges || []) edges.set(edge.id, edge);
      }
      if (!state.focusedModuleId) return { nodes: nodes, edges: edges };
      if (!nodes.has(state.focusedModuleId) && state.focusedModuleNode) {
        nodes.set(state.focusedModuleId, state.focusedModuleNode);
      }
      return createModuleFlowLineageScene(
        nodes,
        edges,
        state.focusedModuleId,
        Math.max(0, nodes.size - 1)
      );
    }

    /** Projects all browser-visible strings into the layout measurement contract. */
    function formatModulePresentation(presentation, fallback) {
      return presentation && presentation.key
        ? projectAnalyzerText(presentation.key, presentation.params)
        : fallback;
    }

    function toLayoutNode(node) {
      if (node.kind === "logicBlock") {
        const detailLines = [];
        const title = node.presentation?.labelKey
          ? projectAnalyzerText(node.presentation.labelKey, node.presentation.labelParams)
          : node.label;
        const subtitle = node.presentation?.detailKey
          ? projectAnalyzerText(node.presentation.detailKey, node.presentation.detailParams)
          : node.detail;
        const branchLabel = node.branchPresentation?.key
          ? projectAnalyzerText(node.branchPresentation.key, node.branchPresentation.params)
          : node.branchLabel;
        if (branchLabel) detailLines.push(projectAnalyzerText("branch", { label: branchLabel }));
        if (node.locationLabel) detailLines.push(node.locationLabel);
        return {
          id: node.id,
          kind: "function",
          title,
          subtitle,
          badges: [projectAnalyzerText("module-logic-" + node.blockKind), projectAnalyzerText("module-confidence-" + (node.confidence || "unknown"))],
          metricLines: [
            projectAnalyzerText("module-value-flow-metrics", {
              changes: (node.valueChanges || []).length,
              accesses: (node.valueAccesses || []).length
            })
          ],
          detailLines: detailLines
        };
      }
      if (node.kind === "function") {
        return {
          id: node.id,
          kind: "function",
          title: node.presentation?.labelKey ? projectAnalyzerText(node.presentation.labelKey, node.presentation.params) : node.label,
          subtitle: node.presentation?.detailKey ? projectAnalyzerText(node.presentation.detailKey, node.presentation.params) : node.detail,
          badges: [projectAnalyzerText("function-kind"), projectAnalyzerText("module-confidence-" + (node.confidence || "static"))],
          metricLines: [
            projectAnalyzerText("incoming-boundary-calls", { count: node.incomingBoundaryCount }),
            projectAnalyzerText("outgoing-boundary-calls", { count: node.outgoingBoundaryCount })
          ],
          detailLines: node.locationLabel
            ? [node.locationLabel, projectAnalyzerText("attach-function-graph")]
            : [projectAnalyzerText("attach-function-graph")]
        };
      }
      const badges = [projectAnalyzerText("module-basis-" + (node.basis || "unknown")), projectAnalyzerText("module-confidence-" + (node.confidence || "unknown"))].concat(node.frameworks || [], node.ecosystems || []);
      const metrics = node.metrics || {};
      return {
        id: node.id,
        kind: node.external ? "external" : "module",
        title: node.presentation?.labelKey ? projectAnalyzerText(node.presentation.labelKey, node.presentation.params) : node.label,
        subtitle: node.presentation?.detailKey ? projectAnalyzerText(node.presentation.detailKey, node.presentation.params) : node.detail,
        badges: badges,
        metricLines: [
          projectAnalyzerText("module-direct-metrics", { files: metrics.analyzedFileCount || 0, functions: metrics.callableCount || 0 }),
          projectAnalyzerText("module-tree-metrics", { files: metrics.descendantFileCount || 0, functions: metrics.descendantCallableCount || 0 }),
          projectAnalyzerText("module-evidence-metrics", { incoming: metrics.incomingEvidenceCount || 0, outgoing: metrics.outgoingEvidenceCount || 0 }),
          projectAnalyzerText("module-entry-metrics", { entrypoints: metrics.entrypointCount || 0, units: metrics.frameworkUnitCount || 0 })
        ],
        detailLines: node.locationLabel
          ? [node.locationLabel, expansionHint(node)]
          : [expansionHint(node)]
      };
    }

    /** Computes nested module color depth with an iterative parent walk. */
    function createModuleDepthIndex(nodes) {
      const result = new Map();
      for (const node of nodes.values()) {
        if (node.kind !== "module") continue;
        let depth = 0;
        let parentId = node.parentId;
        const visited = new Set([node.id]);
        while (parentId && !visited.has(parentId)) {
          visited.add(parentId);
          depth += 1;
          const parent = nodes.get(parentId);
          parentId = parent && parent.kind === "module" ? parent.parentId : undefined;
        }
        result.set(node.id, depth);
      }
      return result;
    }

    /** Selects a module, function anchor, or attached function-local block. */
    function selectNode(node) {
      state.selectedNodeId = node.id;
      state.selectedEdgeId = undefined;
      if (node.kind === "function") {
        renderFunctionDetail(node);
        toggleFunctionLogic(node);
        return;
      }
      if (node.kind === "logicBlock") {
        renderLogicBlockDetail(node);
        renderGraph(undefined, false);
        return;
      }
      requestDetail({ kind: "module", id: node.id });
      if (node.external) {
        const anchor = captureViewportAnchor(node.id);
        const focus = focusModuleComponents(node.id, node);
        renderGraph(anchor, focus.focusChanged || focus.removedBranchCount > 0);
        return;
      }
      const expansion = node.expandable && node.expandable.boundaryFunctions
        ? "boundaryFunctions"
        : node.expandable && node.expandable.childModules
          ? "childModules"
          : undefined;
      if (expansion) toggleExpansion(node, expansion);
      else {
        const anchor = captureViewportAnchor(node.id);
        const focus = focusModuleComponents(node.id, node);
        renderGraph(anchor, focus.focusChanged || focus.removedBranchCount > 0);
      }
    }

    /** Clears every lazy branch and restores the exact bounded initial scene. */
    function clearModuleFlowSelection() {
      const hadSceneFocus = Boolean(state.focusedModuleId) || state.expansions.size > 0;
      const hadSelection = Boolean(state.selectedNodeId) || Boolean(state.selectedEdgeId);
      if (!hadSceneFocus && !hadSelection) return;
      state.selectedNodeId = undefined;
      state.selectedEdgeId = undefined;
      state.focusedModuleId = undefined;
      state.focusedModuleNode = undefined;
      state.expansions.clear();
      for (const pair of Array.from(state.pending.entries())) {
        const operation = pair[1].operation;
        if (operation === "detail" || operation === "expand" || operation === "functionLogic") {
          state.pending.delete(pair[0]);
        }
      }
      if (state.detailRequestTimer !== undefined) {
        window.clearTimeout(state.detailRequestTimer);
        state.detailRequestTimer = undefined;
      }
      state.pendingDetailTarget = undefined;
      state.pendingNodeIds.clear();
      state.enteringNodeIds.clear();
      state.enteringEdgeIds.clear();
      state.pendingAnchor = undefined;
      dom.viewport.scrollLeft = 0;
      dom.viewport.scrollTop = 0;
      renderEmptyDetail();
      renderGraph(undefined, hadSceneFocus);
      setSemanticStatus("focus-cleared");
    }

    /** Selects an evidence-backed aggregate route for its detail rows. */
    function selectEdge(edge) {
      state.selectedEdgeId = edge.id;
      state.selectedNodeId = undefined;
      renderGraph(undefined, false);
      if (edge.hasDetails) requestDetail({ kind: "edge", id: edge.id });
      else renderLocalEdgeDetail(edge);
    }

    /** Renders Host-projected module or relation details without HTML parsing. */
    function renderDetail(detail) {
      state.detailModel = detail ? { kind: "host", detail: detail } : { kind: "empty" };
      dom.detail.replaceChildren();
      if (!detail) return;
      if (detail.kind === "edge") {
        appendText(dom.detail, "h2", "detail-title", edgeLabel(detail.edge) || projectAnalyzerText("relationship"));
        appendText(dom.detail, "div", "detail-row", projectAnalyzerText("evidence-points", { count: detail.edge.evidenceCount, omitted: detail.omittedEvidenceCount }));
        const section = createDetailSection(projectAnalyzerText("source-evidence"));
        for (const evidence of detail.evidence || []) {
          const label = formatModulePresentation(evidence.labelPresentation || evidence.presentation, evidence.label);
          const confidence = projectAnalyzerText("module-confidence-" + (evidence.confidence || "unknown"));
          const row = appendText(section, "div", "detail-row", label + " · " + confidence);
          if (evidence.evidenceToken) {
            const button = appendText(row, "button", "detail-action", projectAnalyzerText("open-exact-source"));
            button.type = "button";
            button.addEventListener("click", function () {
              requestOpenSource({ kind: "evidence", evidenceToken: evidence.evidenceToken });
            });
          }
        }
        dom.detail.appendChild(section);
        return;
      }
      const module = detail.module;
      const moduleTitle = module.presentation?.labelKey ? projectAnalyzerText(module.presentation.labelKey, module.presentation.params) : module.label;
      const moduleDetail = module.presentation?.detailKey ? projectAnalyzerText(module.presentation.detailKey, module.presentation.params) : module.detail;
      appendText(dom.detail, "h2", "detail-title", moduleTitle);
      appendText(dom.detail, "div", "detail-row", moduleDetail + (module.locationLabel ? " · " + module.locationLabel : ""));
      const actions = createDetailSection(projectAnalyzerText("attach-canvas"));
      if (module.expandable.boundaryFunctions) addExpansionAction(actions, module, "boundaryFunctions", projectAnalyzerText("toggle-boundary-functions"));
      if (module.expandable.childModules) addExpansionAction(actions, module, "childModules", projectAnalyzerText("toggle-child-modules"));
      if (actions.children.length > 1) dom.detail.appendChild(actions);
      appendDetailRows(projectAnalyzerText("why-module"), detail.boundaryEvidence || [], function (entry) { return formatModulePresentation(entry.labelPresentation || entry.presentation, entry.label); });
      appendDetailRows(projectAnalyzerText("internal-relationships"), detail.internalRelations || [], function (entry) { return projectAnalyzerText("module-relation-" + entry.kind, { count: entry.count }); });
      const sources = createDetailSection(projectAnalyzerText("representative-source"));
      for (const source of detail.representativeSources || []) {
        const row = appendText(sources, "div", "detail-row", formatModulePresentation(source.presentation, source.label));
        if (source.sourceToken) {
          const button = appendText(row, "button", "detail-action", projectAnalyzerText("open-source-range"));
          button.type = "button";
          button.addEventListener("click", function () {
            requestOpenSource({ kind: "node", sourceToken: source.sourceToken });
          });
        }
      }
      if (detail.omittedSourceCount > 0) appendText(sources, "div", "detail-row", projectAnalyzerText("additional-source-files", { count: detail.omittedSourceCount }));
      dom.detail.appendChild(sources);
      appendEdgeButtons(projectAnalyzerText("incoming-relationships"), detail.incomingEdges || [], detail.omittedIncomingEdgeCount, "additional-incoming-relationships");
      appendEdgeButtons(projectAnalyzerText("outgoing-relationships"), detail.outgoingEdges || [], detail.omittedOutgoingEdgeCount, "additional-outgoing-relationships");
    }

    function addExpansionAction(section, module, expansion, label) {
      const button = appendText(section, "button", "detail-action", label);
      button.type = "button";
      button.addEventListener("click", function () { toggleExpansion(module, expansion); });
    }

    function appendDetailRows(title, rows, labelOf) {
      if (rows.length === 0) return;
      const section = createDetailSection(title);
      for (const row of rows) appendText(section, "div", "detail-row", labelOf(row));
      dom.detail.appendChild(section);
    }

    function appendEdgeButtons(title, edges, omittedCount, omittedKey) {
      if (edges.length === 0 && !omittedCount) return;
      const section = createDetailSection(title);
      for (const edge of edges) {
        const button = appendText(section, "button", "detail-action", edgeLabel(edge));
        button.type = "button";
        button.addEventListener("click", function () { selectEdge(edge); });
      }
      if (omittedCount > 0) {
        appendText(section, "div", "detail-row", projectAnalyzerText(omittedKey, { count: omittedCount }));
      }
      dom.detail.appendChild(section);
    }

    /** Displays synthetic containment, calls, and function control locally. */
    function renderLocalEdgeDetail(edge) {
      state.detailModel = { kind: "localEdge", edge: edge };
      dom.detail.replaceChildren();
      appendText(dom.detail, "h2", "detail-title", edgeLabel(edge) || projectAnalyzerText("structural-relationship"));
      const detail = edge.presentationKind === "contains"
        ? projectAnalyzerText("module-local-boundary")
        : edge.presentationKind === "functionEntry"
          ? projectAnalyzerText("module-function-entry")
          : edge.presentationKind === "controlFlow"
            ? projectAnalyzerText("module-control-flow", { kind: projectAnalyzerText("logic-edge-" + edge.controlKind) })
            : projectAnalyzerText("module-calls", { count: edge.evidenceCount });
      appendText(dom.detail, "div", "detail-row", detail);
    }

    function renderEmptyDetail() {
      state.detailModel = { kind: "empty" };
      dom.detail.replaceChildren();
      appendText(dom.detail, "div", "detail-empty", projectAnalyzerText("select-module-detail"));
    }

    function createDetailSection(title) {
      const section = document.createElement("section");
      section.className = "detail-section";
      appendText(section, "h3", "", title);
      return section;
    }

    /** Creates text-only DOM nodes; Host strings never become markup. */
    function appendText(parent, tagName, className, value) {
      const element = document.createElement(tagName);
      if (className) element.className = className;
      element.textContent = value == null ? "" : String(value);
      parent.appendChild(element);
      return element;
    }

    /** Captures one node's viewport-relative location before a graph rebuild. */
    function captureViewportAnchor(nodeId) {
      if (!state.layout || !state.viewportFrame || !nodeId) return undefined;
      const layout = state.layoutByNodeId.get(nodeId);
      if (!layout) return undefined;
      return {
        nodeId: nodeId,
        relativeX: state.viewportFrame.offsetX
          + (layout.x + layout.width / 2) * state.scale
          - dom.viewport.scrollLeft,
        relativeY: state.viewportFrame.offsetY
          + (layout.y + layout.height / 2) * state.scale
          - dom.viewport.scrollTop,
        scrollLeft: dom.viewport.scrollLeft,
        scrollTop: dom.viewport.scrollTop
      };
    }

    /** Compensates for layout movement after expansion or local collapse. */
    function restoreViewportAnchor(anchor, layout) {
      if (!anchor || !state.viewportFrame) return;
      const node = state.layoutByNodeId.get(anchor.nodeId);
      const frame = state.viewportFrame;
      const nextLeft = node
        ? frame.offsetX + (node.x + node.width / 2) * state.scale - anchor.relativeX
        : anchor.scrollLeft;
      const nextTop = node
        ? frame.offsetY + (node.y + node.height / 2) * state.scale - anchor.relativeY
        : anchor.scrollTop;
      dom.viewport.scrollLeft = clampModuleFlowScroll(nextLeft, frame.maxScrollLeft);
      dom.viewport.scrollTop = clampModuleFlowScroll(nextTop, frame.maxScrollTop);
    }

    ${getModuleFlowLabelBrowserSource()}

    function setStatus(value) { dom.status.textContent = value || ""; }

    /** Stores browser-owned status in semantic form when it contains no Host literal. */
    function setSemanticStatus(key, params) {
      state.statusPresentation = { key: key, params: params };
      setStatus(projectAnalyzerText(key, params));
    }

    /** Retains Host-provided legacy copy only when no finite failure reason exists. */
    function setLiteralStatus(value) {
      state.statusPresentation = undefined;
      setStatus(value);
    }

    /** Formats typed failure reasons before falling back to the compatibility message. */
    function setFailureStatus(failure) {
      const key = failure && failure.code ? "module-failure-" + failure.code : undefined;
      if (key && projectAnalyzerText(key) !== key) setSemanticStatus(key, { operation: failure.operation });
      else setLiteralStatus(failure?.message || projectAnalyzerText("request-failed"));
    }

    /** Patches text/accessibility only; it must not trigger layout or Host requests. */
    function relocalizeModuleFlowPresentation() {
      if (state.statusPresentation) setStatus(projectAnalyzerText(state.statusPresentation.key, state.statusPresentation.params));
      if (state.summaryPresentation) dom.summary.textContent = projectAnalyzerText(state.summaryPresentation.key, state.summaryPresentation.params);
      for (const [nodeId, card] of state.nodeElementsById) {
        const node = state.nodesById.get(nodeId);
        if (node) updateModuleFlowNodeContent(card, node);
      }
      refreshModuleFlowEdgePresentation();
      refreshModuleFlowCyclePresentation();
      renderRetainedModuleFlowDetail();
      updateModuleFlowZoomControls(false);
    }

    /** Reuses the chosen detail model while preserving selected node/edge identities. */
    function renderRetainedModuleFlowDetail() {
      const model = state.detailModel || { kind: "empty" };
      if (model.kind === "host") renderDetail(model.detail);
      else if (model.kind === "localEdge") renderLocalEdgeDetail(model.edge);
      else if (model.kind === "function") renderFunctionDetail(model.node);
      else if (model.kind === "logicBlock") renderLogicBlockDetail(model.node);
      else renderEmptyDetail();
    }

    /** Extracts the panel provider's monotonic graph-delivery identity. */
    function parseSnapshotIdentity(value) {
      if (typeof value !== "string") return undefined;
      const match = /^sidebar-snapshot:([0-9a-f]+):(\\d+)$/u.exec(value);
      if (!match) return undefined;
      return { session: match[1], revision: Number(match[2]) };
    }

    function syncModeButtons() {
      for (const button of document.querySelectorAll(".mode-button")) {
        button.classList.toggle("active", button.dataset.mode === state.mode);
      }
    }

    /** Releases browser-owned registries before a hidden tab context is removed. */
    function disposeModuleFlowBrowser() {
      window.removeEventListener("message", handleModuleFlowHostMessage);
      window.removeEventListener("resize", handleModuleFlowResize);
      state.frameScheduler.dispose();
      if (state.resizeObserver) state.resizeObserver.disconnect();
      if (state.enteringTimer !== undefined) window.clearTimeout(state.enteringTimer);
      if (state.zoomAnnouncementTimer !== undefined) window.clearTimeout(state.zoomAnnouncementTimer);
      if (state.detailRequestTimer !== undefined) window.clearTimeout(state.detailRequestTimer);
      resetModuleFlowScene();
      state.baseNodes.clear();
      state.baseEdges.clear();
      state.expansions.clear();
      state.pending.clear();
      state.pendingNodeIds.clear();
      state.focusedModuleId = undefined;
      state.focusedModuleNode = undefined;
      state.nodesById.clear();
      state.edgesById.clear();
      state.enteringNodeIds.clear();
      state.enteringEdgeIds.clear();
      dom.detail.replaceChildren();
    }

    for (const button of document.querySelectorAll(".mode-button")) {
      button.addEventListener("click", function () {
        if (!button.dataset.mode || button.dataset.mode === state.mode) return;
        state.mode = button.dataset.mode;
        syncModeButtons();
        requestList();
      });
    }
    dom.includeExternal.addEventListener("change", requestList);
    dom.includeInferred.addEventListener("change", requestList);
    initializeModuleFlowSceneRenderer();
    initializeModuleFlowViewport();
    window.addEventListener("beforeunload", disposeModuleFlowBrowser);

    vscode.postMessage({ type: "ui/ready", payload: {} });
  })();`;
}
