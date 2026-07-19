/**
 * Browser program for the dedicated Module Flow panel.
 *
 * It merges bounded Host deltas into one canvas, runs the shared deterministic
 * layout, preserves the clicked module's viewport position, and routes all Host
 * text through textContent. No raw analyzer identity or source path is accepted.
 */

import { getModuleFlowGraphLayoutBrowserSource } from "../../application/moduleFlow/moduleFlowGraphLayout";
import { getModuleFlowViewportBrowserSource } from "../../application/moduleFlow/moduleFlowViewport";
import { getModuleFlowExpansionStoreBrowserSource } from "./moduleFlowExpansionStore";
import { getModuleFlowFrameSchedulerBrowserSource } from "./moduleFlowFrameScheduler";
import { getModuleFlowLayoutCacheBrowserSource } from "./moduleFlowLayoutCache";
import { getModuleVisualizerGraphRendererSource } from "./moduleVisualizerGraphRendererSource";
import { getModuleVisualizerViewportBrowserSource } from "./moduleVisualizerViewportBrowserSource";

/** Returns one nonce-compatible script with the pure layout runtime embedded. */
export function getModuleVisualizerBrowserSource(): string {
  return /* javascript */ `(function () {
    "use strict";
    ${getModuleFlowGraphLayoutBrowserSource()}
    ${getModuleFlowViewportBrowserSource()}
    ${getModuleFlowExpansionStoreBrowserSource()}
    ${getModuleFlowFrameSchedulerBrowserSource()}
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
      pendingModules: new Set(),
      nextRequestId: 0,
      latestListRequestId: 0,
      selectedNodeId: undefined,
      selectedEdgeId: undefined,
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
      frameScheduler: undefined
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
      setStatus("Updating the module lens");
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
      if (state.expansions.has(key)) {
        state.expansions.delete(key);
        state.pendingModules.delete(module.id);
        state.enteringNodeIds.clear();
        state.enteringEdgeIds.clear();
        renderGraph(anchor, true);
        setStatus("Collapsed " + module.label);
        return;
      }
      if (state.pendingModules.has(module.id)) return;
      state.pendingModules.add(module.id);
      setStatus("Attaching " + (expansion === "boundaryFunctions" ? "boundary functions" : "child modules"));
      post("moduleFlow/expand", {
        graphVersion: state.graphVersion,
        moduleId: module.id,
        expansion: expansion,
        direction: "both",
        nodeLimit: 48,
        edgeLimit: 96
      }, { operation: "expand", key: key, anchor: anchor, moduleId: module.id });
      renderGraph(anchor, false);
    }

    /** Handles typed Extension Host responses with stale correlation guards. */
    function handleModuleFlowHostMessage(event) {
      const message = event.data;
      if (!message || typeof message.type !== "string" || !message.payload) return;
      const payload = message.payload;
      if (message.type === "error") {
        setStatus(payload.message || "Module Flow could not be loaded");
        return;
      }
      if (message.type === "moduleFlow/listLoaded") {
        acceptList(payload);
        return;
      }
      if (!state.graphVersion || payload.graphVersion !== state.graphVersion) return;
      if (message.type === "moduleFlow/expanded") {
        acceptExpansion(payload);
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
      state.pendingModules.clear();
      state.selectedNodeId = undefined;
      state.selectedEdgeId = undefined;
      state.enteringNodeIds.clear();
      state.enteringEdgeIds.clear();
      state.latestListRequestId = payload.requestId;
      syncModeButtons();
      const summary = payload.summary;
      dom.summary.textContent = summary.visibleModuleCount + " of " + summary.totalModuleCount
        + " modules · " + summary.visibleEdgeCount + " of " + summary.totalEdgeCount
        + " relationships · " + summary.crossModuleEvidenceCount + " evidence points";
      renderEmptyDetail();
      renderGraph(undefined, true);
      setStatus(summary.omittedModuleCount + summary.omittedEdgeCount > 0
        ? "Bounded scene loaded; omitted counts are shown in the header"
        : "Module Flow ready");
    }

    /** Merges one bounded delta and restores the clicked module's viewport point. */
    function acceptExpansion(payload) {
      const pending = state.pending.get(payload.requestId);
      if (!pending || pending.operation !== "expand") return;
      state.pending.delete(payload.requestId);
      state.pendingModules.delete(pending.moduleId);
      const currentAnchor = captureViewportAnchor(pending.moduleId) || pending.anchor;
      const retention = state.expansions.retain(
        pending.key,
        payload,
        state.baseNodes.keys(),
        state.baseEdges.keys()
      );
      if (!retention.accepted) {
        state.enteringNodeIds.clear();
        state.enteringEdgeIds.clear();
        renderGraph(currentAnchor, false);
        setStatus("This expansion exceeds the complete canvas resource budget");
        return;
      }
      state.enteringNodeIds = new Set((payload.nodes || []).map(function (node) { return node.id; }));
      state.enteringEdgeIds = new Set((payload.edges || []).map(function (edge) { return edge.id; }));
      renderGraph(currentAnchor, true);
      const released = retention.evictedKeys.length > 0
        ? " · " + retention.evictedKeys.length + " oldest branch(es) released"
        : "";
      setStatus(payload.summary.visibleNodeCount + " nodes attached · "
        + payload.summary.omittedNodeCount + " additional nodes outside this expansion budget"
        + released);
    }

    /** Clears request-local loading state and exposes a display-safe failure. */
    function acceptFailure(payload) {
      const pending = state.pending.get(payload.requestId);
      if (pending) {
        state.pending.delete(payload.requestId);
        if (pending.moduleId) state.pendingModules.delete(pending.moduleId);
      }
      setStatus(payload.message || "Module Flow request failed");
      renderGraph(undefined, false);
    }

    /** Merges the base scene and every currently expanded same-canvas branch. */
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
      return { nodes: nodes, edges: edges };
    }

    /** Projects all browser-visible strings into the layout measurement contract. */
    function toLayoutNode(node) {
      if (node.kind === "function") {
        return {
          id: node.id,
          kind: "function",
          title: node.label,
          subtitle: node.detail,
          badges: ["function", node.confidence || "static"],
          metricLines: [
            node.incomingBoundaryCount + " incoming boundary calls",
            node.outgoingBoundaryCount + " outgoing boundary calls"
          ],
          detailLines: node.locationLabel ? [node.locationLabel, "Open in Function Visualizer"] : ["Open in Function Visualizer"]
        };
      }
      const badges = [node.basis, node.confidence].concat(node.frameworks || [], node.ecosystems || []);
      const metrics = node.metrics || {};
      return {
        id: node.id,
        kind: node.external ? "external" : "module",
        title: node.label,
        subtitle: node.detail,
        badges: badges,
        metricLines: [
          (metrics.analyzedFileCount || 0) + " direct files · " + (metrics.callableCount || 0) + " direct functions",
          (metrics.descendantFileCount || 0) + " tree files · " + (metrics.descendantCallableCount || 0) + " tree functions",
          (metrics.incomingEvidenceCount || 0) + " incoming · " + (metrics.outgoingEvidenceCount || 0) + " outgoing evidence",
          (metrics.entrypointCount || 0) + " entrypoints · " + (metrics.frameworkUnitCount || 0) + " framework units"
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

    /** Selects a module/function; module clicks toggle their preferred expansion. */
    function selectNode(node) {
      state.selectedNodeId = node.id;
      state.selectedEdgeId = undefined;
      if (node.kind === "function") {
        if (node.sourceToken) requestOpenSource({ kind: "node", sourceToken: node.sourceToken });
        return;
      }
      requestDetail({ kind: "module", id: node.id });
      if (node.external) {
        renderGraph(undefined, false);
        return;
      }
      const expansion = node.expandable && node.expandable.boundaryFunctions
        ? "boundaryFunctions"
        : node.expandable && node.expandable.childModules
          ? "childModules"
          : undefined;
      if (expansion) toggleExpansion(node, expansion);
      else renderGraph(undefined, false);
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
      dom.detail.replaceChildren();
      if (!detail) return;
      if (detail.kind === "edge") {
        appendText(dom.detail, "h2", "detail-title", edgeLabel(detail.edge) || "Relationship");
        appendText(dom.detail, "div", "detail-row", detail.edge.evidenceCount + " evidence points · " + detail.omittedEvidenceCount + " not shown");
        const section = createDetailSection("Source evidence");
        for (const evidence of detail.evidence || []) {
          const row = appendText(section, "div", "detail-row", evidence.label + " · " + evidence.confidence);
          if (evidence.evidenceToken) {
            const button = appendText(row, "button", "detail-action", "Open exact source range");
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
      appendText(dom.detail, "h2", "detail-title", module.label);
      appendText(dom.detail, "div", "detail-row", module.detail + (module.locationLabel ? " · " + module.locationLabel : ""));
      const actions = createDetailSection("Attach to this canvas");
      if (module.expandable.boundaryFunctions) addExpansionAction(actions, module, "boundaryFunctions", "Toggle boundary functions");
      if (module.expandable.childModules) addExpansionAction(actions, module, "childModules", "Toggle child modules");
      if (actions.children.length > 1) dom.detail.appendChild(actions);
      appendDetailRows("Why this is a module", detail.boundaryEvidence || [], function (entry) { return entry.label; });
      appendDetailRows("Internal relationships", detail.internalRelations || [], function (entry) { return entry.kind + " · " + entry.count; });
      const sources = createDetailSection("Representative source");
      for (const source of detail.representativeSources || []) {
        const row = appendText(sources, "div", "detail-row", source.label);
        if (source.sourceToken) {
          const button = appendText(row, "button", "detail-action", "Open source");
          button.type = "button";
          button.addEventListener("click", function () {
            requestOpenSource({ kind: "node", sourceToken: source.sourceToken });
          });
        }
      }
      if (detail.omittedSourceCount > 0) appendText(sources, "div", "detail-row", detail.omittedSourceCount + " additional source files");
      dom.detail.appendChild(sources);
      appendEdgeButtons("Incoming module relationships", detail.incomingEdges || []);
      appendEdgeButtons("Outgoing module relationships", detail.outgoingEdges || []);
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

    function appendEdgeButtons(title, edges) {
      if (edges.length === 0) return;
      const section = createDetailSection(title);
      for (const edge of edges) {
        const button = appendText(section, "button", "detail-action", edgeLabel(edge));
        button.type = "button";
        button.addEventListener("click", function () { selectEdge(edge); });
      }
      dom.detail.appendChild(section);
    }

    /** Displays synthetic containment/concrete-call information locally. */
    function renderLocalEdgeDetail(edge) {
      dom.detail.replaceChildren();
      appendText(dom.detail, "h2", "detail-title", edgeLabel(edge) || "Structural relationship");
      appendText(dom.detail, "div", "detail-row", edge.presentationKind === "contains"
        ? "This card belongs to the source module boundary."
        : edge.evidenceCount + " concrete boundary calls");
    }

    function renderEmptyDetail() {
      dom.detail.replaceChildren();
      appendText(dom.detail, "div", "detail-empty", "Select a module or relationship to inspect source-backed details.");
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

    function edgeLabel(edge) {
      if (!edge) return "";
      if (edge.presentationKind === "contains") return "contains";
      const values = (edge.relations || []).map(function (relation) {
        return relation.kind + " " + relation.count;
      });
      return values.join(" · ") || (edge.presentationKind === "concreteCall" ? "calls" : "relationship");
    }

    function expansionHint(node) {
      if (!node.expandable) return "Inspect module details";
      if (node.expandable.boundaryFunctions) return "Click to attach boundary functions";
      if (node.expandable.childModules) return "Click to attach child modules";
      return "Inspect module details";
    }

    function setStatus(value) { dom.status.textContent = value || ""; }

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
      state.pendingModules.clear();
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
