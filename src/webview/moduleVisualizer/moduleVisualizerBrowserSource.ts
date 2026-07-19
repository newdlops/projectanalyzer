/**
 * Browser program for the dedicated Module Flow panel.
 *
 * It merges bounded Host deltas into one canvas, runs the shared deterministic
 * layout, preserves the clicked module's viewport position, and routes all Host
 * text through textContent. No raw analyzer identity or source path is accepted.
 */

import { getModuleFlowGraphLayoutBrowserSource } from "../../application/moduleFlow/moduleFlowGraphLayout";

/** Returns one nonce-compatible script with the pure layout runtime embedded. */
export function getModuleVisualizerBrowserSource(): string {
  return /* javascript */ `(function () {
    "use strict";
    ${getModuleFlowGraphLayoutBrowserSource()}

    const vscode = acquireVsCodeApi();
    const SVG_NS = "http://www.w3.org/2000/svg";
    const dom = {
      summary: document.getElementById("module-summary"),
      status: document.getElementById("module-status"),
      viewport: document.getElementById("module-viewport"),
      stage: document.getElementById("module-stage"),
      cycles: document.getElementById("module-cycles"),
      edges: document.getElementById("module-edges"),
      nodes: document.getElementById("module-nodes"),
      detail: document.getElementById("module-detail"),
      includeExternal: document.getElementById("include-external"),
      includeInferred: document.getElementById("include-inferred"),
      fit: document.getElementById("fit-graph"),
      reset: document.getElementById("reset-graph")
    };
    const state = {
      graphVersion: undefined,
      snapshotSession: undefined,
      snapshotRevision: -1,
      mode: "execution",
      baseNodes: new Map(),
      baseEdges: new Map(),
      expansions: new Map(),
      pending: new Map(),
      pendingModules: new Set(),
      nextRequestId: 0,
      latestListRequestId: 0,
      selectedNodeId: undefined,
      selectedEdgeId: undefined,
      enteringNodeIds: new Set(),
      enteringEdgeIds: new Set(),
      scale: 1,
      layout: undefined,
      nodesById: new Map(),
      edgesById: new Map()
    };

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
      post("moduleFlow/detail", {
        graphVersion: state.graphVersion,
        target: target,
        relationLimit: 40,
        evidenceLimit: 5
      }, { operation: "detail", target: target });
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
        renderGraph(anchor);
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
      renderGraph(anchor);
    }

    /** Handles typed Extension Host responses with stale correlation guards. */
    window.addEventListener("message", function (event) {
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
    });

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
      state.graphVersion = payload.graphVersion;
      state.snapshotSession = snapshotIdentity && snapshotIdentity.session;
      state.snapshotRevision = snapshotIdentity ? snapshotIdentity.revision : state.snapshotRevision + 1;
      state.mode = payload.mode;
      state.baseNodes = new Map((payload.nodes || []).map(function (node) { return [node.id, node]; }));
      state.baseEdges = new Map((payload.edges || []).map(function (edge) { return [edge.id, edge]; }));
      state.expansions.clear();
      state.pending.clear();
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
      renderGraph(undefined);
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
      state.expansions.set(pending.key, payload);
      state.enteringNodeIds = new Set((payload.nodes || []).map(function (node) { return node.id; }));
      state.enteringEdgeIds = new Set((payload.edges || []).map(function (edge) { return edge.id; }));
      renderGraph(pending.anchor);
      setStatus(payload.summary.visibleNodeCount + " nodes attached · "
        + payload.summary.omittedNodeCount + " additional nodes outside this expansion budget");
    }

    /** Clears request-local loading state and exposes a display-safe failure. */
    function acceptFailure(payload) {
      const pending = state.pending.get(payload.requestId);
      if (pending) {
        state.pending.delete(payload.requestId);
        if (pending.moduleId) state.pendingModules.delete(pending.moduleId);
      }
      setStatus(payload.message || "Module Flow request failed");
      renderGraph(pending && pending.anchor);
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

    /** Runs the shared layout and mounts complete text without truncation. */
    function renderGraph(anchor) {
      const scene = collectScene();
      state.nodesById = scene.nodes;
      state.edgesById = scene.edges;
      const depthByModuleId = createModuleDepthIndex(scene.nodes);
      const layoutNodes = [];
      for (const node of scene.nodes.values()) {
        layoutNodes.push(toLayoutNode(node));
      }
      const layoutEdges = [];
      for (const edge of scene.edges.values()) {
        layoutEdges.push({
          id: edge.id,
          sourceId: edge.sourceId,
          targetId: edge.targetId,
          label: edgeLabel(edge),
          kind: edge.presentationKind
        });
      }
      const layout = createModuleFlowGraphLayout(layoutNodes, layoutEdges);
      state.layout = layout;
      sizeStage(layout);
      renderCycles(layout);
      renderEdges(layout, scene.edges);
      renderNodes(layout, scene.nodes, depthByModuleId);
      restoreViewportAnchor(anchor, layout);
      requestAnimationFrame(function () {
        state.enteringNodeIds.clear();
        state.enteringEdgeIds.clear();
      });
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

    /** Sizes logical layers while the outer stage supplies scaled scroll extent. */
    function sizeStage(layout) {
      const scaledWidth = Math.max(dom.viewport.clientWidth, layout.width * state.scale);
      const scaledHeight = Math.max(dom.viewport.clientHeight, layout.height * state.scale);
      dom.stage.style.width = scaledWidth + "px";
      dom.stage.style.height = scaledHeight + "px";
      for (const layer of [dom.cycles, dom.edges, dom.nodes]) {
        layer.style.width = layout.width + "px";
        layer.style.height = layout.height + "px";
        layer.style.transformOrigin = "0 0";
        layer.style.transform = "scale(" + state.scale + ")";
      }
      dom.edges.setAttribute("viewBox", "0 0 " + Math.max(1, layout.width) + " " + Math.max(1, layout.height));
      dom.edges.setAttribute("width", String(Math.max(1, layout.width)));
      dom.edges.setAttribute("height", String(Math.max(1, layout.height)));
    }

    /** Mounts dashed SCC enclosures behind their member cards. */
    function renderCycles(layout) {
      dom.cycles.replaceChildren();
      for (const group of layout.cycleGroups) {
        const element = document.createElement("div");
        element.className = "cycle-group";
        element.style.left = group.x + "px";
        element.style.top = group.y + "px";
        element.style.width = group.width + "px";
        element.style.height = group.height + "px";
        element.textContent = group.label;
        dom.cycles.appendChild(element);
      }
    }

    /** Mounts orthogonal routes with wide hit targets and source-safe labels. */
    function renderEdges(layout, edgesById) {
      dom.edges.replaceChildren();
      const defs = document.createElementNS(SVG_NS, "defs");
      const marker = document.createElementNS(SVG_NS, "marker");
      marker.setAttribute("id", "module-arrow");
      marker.setAttribute("viewBox", "0 0 10 10");
      marker.setAttribute("refX", "9");
      marker.setAttribute("refY", "5");
      marker.setAttribute("markerWidth", "6");
      marker.setAttribute("markerHeight", "6");
      marker.setAttribute("orient", "auto-start-reverse");
      const arrow = document.createElementNS(SVG_NS, "path");
      arrow.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
      arrow.setAttribute("fill", "context-stroke");
      marker.appendChild(arrow);
      defs.appendChild(marker);
      dom.edges.appendChild(defs);
      for (const edgeLayout of layout.edges) {
        const edge = edgesById.get(edgeLayout.edgeId);
        if (!edge || edgeLayout.points.length < 2) continue;
        const group = document.createElementNS(SVG_NS, "g");
        const pathData = edgeLayout.points.map(function (point, index) {
          return (index === 0 ? "M " : "L ") + point.x + " " + point.y;
        }).join(" ");
        const labelValue = edgeLabel(edge);
        const hit = document.createElementNS(SVG_NS, "path");
        hit.setAttribute("d", pathData);
        hit.setAttribute("class", "module-edge-hit");
        hit.addEventListener("click", function () { selectEdge(edge); });
        const path = document.createElementNS(SVG_NS, "path");
        const selected = state.selectedEdgeId === edge.id ? " selected" : "";
        const entering = state.enteringEdgeIds.has(edge.id) ? " entering" : "";
        path.setAttribute("d", pathData);
        path.setAttribute("class", "module-edge " + edge.presentationKind + selected + entering);
        path.setAttribute("marker-end", "url(#module-arrow)");
        path.setAttribute("tabindex", "0");
        path.setAttribute("role", "button");
        path.setAttribute("aria-label", "Inspect relationship: " + labelValue);
        path.addEventListener("click", function () { selectEdge(edge); });
        path.addEventListener("keydown", function (event) {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          selectEdge(edge);
        });
        group.appendChild(hit);
        group.appendChild(path);
        if (labelValue) {
          const label = document.createElementNS(SVG_NS, "text");
          label.setAttribute("class", "edge-label");
          label.setAttribute("x", String(edgeLayout.labelX));
          label.setAttribute("y", String(edgeLayout.labelY));
          label.textContent = labelValue;
          group.appendChild(label);
        }
        dom.edges.appendChild(group);
      }
    }

    /** Mounts keyboard-accessible variable-size HTML cards over the SVG routes. */
    function renderNodes(layout, nodesById, depthByModuleId) {
      dom.nodes.replaceChildren();
      for (const nodeLayout of layout.nodes) {
        const node = nodesById.get(nodeLayout.nodeId);
        if (!node) continue;
        const card = document.createElement("button");
        card.type = "button";
        card.className = "module-card " + (node.kind === "function" ? "function" : "module")
          + (node.external ? " external" : "")
          + (state.selectedNodeId === node.id ? " selected" : "")
          + (state.pendingModules.has(node.id) ? " loading" : "")
          + (state.enteringNodeIds.has(node.id) ? " entering" : "");
        card.style.left = nodeLayout.x + "px";
        card.style.top = nodeLayout.y + "px";
        card.style.width = nodeLayout.width + "px";
        card.style.height = nodeLayout.height + "px";
        card.style.setProperty("--module-depth", String(depthByModuleId.get(node.id) || 0));
        appendText(card, "div", "module-card-kind", node.kind === "function" ? "Boundary function" : node.detail);
        appendText(card, "div", "module-card-title", node.label);
        appendText(card, "div", "module-card-detail", node.detail);
        if (node.locationLabel) appendText(card, "div", "module-card-location", node.locationLabel);
        const badges = document.createElement("div");
        badges.className = "module-card-badges";
        const badgeValues = node.kind === "function"
          ? [node.confidence || "static"]
          : [node.basis, node.confidence].concat(node.frameworks || [], node.ecosystems || []);
        for (const value of badgeValues) appendText(badges, "span", "module-badge", value);
        card.appendChild(badges);
        if (node.kind === "function") {
          appendText(card, "div", "module-card-metric", node.incomingBoundaryCount + " incoming · " + node.outgoingBoundaryCount + " outgoing boundary calls");
          appendText(card, "div", "module-card-hint", "Open in Function Visualizer");
        } else if (!node.external) {
          appendText(card, "div", "module-card-metric", node.metrics.callableCount + " direct functions · " + node.metrics.entrypointCount + " entrypoints");
          appendText(card, "div", "module-card-hint", expansionHint(node));
        }
        card.addEventListener("click", function () { selectNode(node); });
        dom.nodes.appendChild(card);
      }
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
        renderGraph(captureViewportAnchor(node.id));
        return;
      }
      const expansion = node.expandable && node.expandable.boundaryFunctions
        ? "boundaryFunctions"
        : node.expandable && node.expandable.childModules
          ? "childModules"
          : undefined;
      if (expansion) toggleExpansion(node, expansion);
      else renderGraph(captureViewportAnchor(node.id));
    }

    /** Selects an evidence-backed aggregate route for its detail rows. */
    function selectEdge(edge) {
      state.selectedEdgeId = edge.id;
      state.selectedNodeId = undefined;
      renderGraph(undefined);
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
      if (!state.layout || !nodeId) return undefined;
      const layout = state.layout.nodes.find(function (node) { return node.nodeId === nodeId; });
      if (!layout) return undefined;
      return {
        nodeId: nodeId,
        relativeX: layout.x * state.scale - dom.viewport.scrollLeft,
        relativeY: layout.y * state.scale - dom.viewport.scrollTop,
        scrollLeft: dom.viewport.scrollLeft,
        scrollTop: dom.viewport.scrollTop
      };
    }

    /** Compensates for layout movement after expansion or local collapse. */
    function restoreViewportAnchor(anchor, layout) {
      if (!anchor) return;
      const node = layout.nodes.find(function (candidate) { return candidate.nodeId === anchor.nodeId; });
      const nextLeft = node ? node.x * state.scale - anchor.relativeX : anchor.scrollLeft;
      const nextTop = node ? node.y * state.scale - anchor.relativeY : anchor.scrollTop;
      requestAnimationFrame(function () {
        dom.viewport.scrollLeft = Math.max(0, nextLeft);
        dom.viewport.scrollTop = Math.max(0, nextTop);
      });
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
    dom.fit.addEventListener("click", function () {
      if (!state.layout || state.layout.width <= 0 || state.layout.height <= 0) return;
      state.scale = Math.min(
        1,
        Math.max(0.2, (dom.viewport.clientWidth - 32) / state.layout.width),
        Math.max(0.2, (dom.viewport.clientHeight - 32) / state.layout.height)
      );
      renderGraph(undefined);
      dom.viewport.scrollLeft = 0;
      dom.viewport.scrollTop = 0;
    });
    dom.reset.addEventListener("click", function () {
      state.scale = 1;
      renderGraph(undefined);
    });

    vscode.postMessage({ type: "ui/ready", payload: {} });
  })();`;
}
