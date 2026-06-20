/**
 * Browser-side script factory for the graph browser WebviewPanel. The panel is
 * intentionally visual-only: it renders a progressively expanded graph canvas.
 */

import { createGraphScene } from "./explorerGraphLayout";
import { clampNumber, getSeparationSign, moveToward } from "./explorerGraphGeometry";
import {
  createOrderMap,
  getBestPreviousOrder,
  orderGraphNodeIdsByPreviousLayer,
  shouldUseLayeredSelection
} from "./explorerGraphOrdering";
import { getExplorerCanvasRendererSource } from "./explorerCanvasRenderer";
import {
  compareFileNodes,
  createProgressiveGraphIndex,
  getFileNodes,
  getGraphRelativePath,
  getImportedFileChildren,
  getImportRootChildren,
  pushProgressiveChild,
  sortProgressiveChildMap
} from "./explorerProgressiveFileGraph";
import { createCrossFreeTreePositions } from "./explorerGraphTreeLayout";

/** Data injected into the browser-side explorer script. */
export type ExplorerClientScriptOptions = {
  canvasHeight: number;
  canvasWidth: number;
  defaultDepth: number;
  initialMode: "call" | "file" | "class";
  maxNodes: number;
};

/**
 * Builds the browser script that owns graph rendering and node expansion.
 */
export function getExplorerClientScript(options: ExplorerClientScriptOptions): string {
  const createGraphSceneSource = createBrowserGraphSceneSource();
  const canvasRendererSource = getExplorerCanvasRendererSource();
  const graphOrderingSource = [
    `const createOrderMap = ${createOrderMap.toString()};`,
    `const getBestPreviousOrder = ${getBestPreviousOrder.toString()};`,
    `const orderGraphNodeIdsByPreviousLayer = ${orderGraphNodeIdsByPreviousLayer.toString()};`,
    `const shouldUseLayeredSelection = ${shouldUseLayeredSelection.toString()};`
  ].join("\n");
  const graphGeometrySource = [
    `const clampNumber = ${clampNumber.toString()};`,
    `const getSeparationSign = ${getSeparationSign.toString()};`,
    `const moveToward = ${moveToward.toString()};`
  ].join("\n");
  const graphTreeLayoutSource = `const createCrossFreeTreePositions = ${createCrossFreeTreePositions.toString()};`;
  const progressiveFileGraphSource = [
    `const getGraphRelativePath = ${getGraphRelativePath.toString()};`,
    `const compareFileNodes = ${compareFileNodes.toString()};`,
    `const getFileNodes = ${getFileNodes.toString()};`,
    `const pushProgressiveChild = ${pushProgressiveChild.toString()};`,
    `const sortProgressiveChildMap = ${sortProgressiveChildMap.toString()};`,
    `const createProgressiveGraphIndex = ${createProgressiveGraphIndex.toString()};`,
    `const getImportRootChildren = ${getImportRootChildren.toString()};`,
    `const getImportedFileChildren = ${getImportedFileChildren.toString()};`
  ].join("\n");

  return /* js */ `
    ${graphGeometrySource}
    ${graphOrderingSource}
    ${graphTreeLayoutSource}
    ${progressiveFileGraphSource}
    const createGraphScene = ${createGraphSceneSource};
    ${canvasRendererSource}
    const vscode = acquireVsCodeApi();
    const virtualRootId = "virtual::workspace-root";
    const state = {
      graph: undefined,
      graphIndex: undefined,
      mode: ${JSON.stringify(options.initialMode)},
      selectedNodeId: virtualRootId,
      analysisState: "idle",
      expandedGraphNodeIds: createDefaultExpandedNodeIds(),
      viewport: { scale: 1, x: 0, y: 0 },
      pan: { active: false, pointerId: undefined, lastClientX: 0, lastClientY: 0, moved: false },
      suppressNextClick: false
    };
    const defaultDepth = ${JSON.stringify(options.defaultDepth)};
    const canvasHeight = ${JSON.stringify(options.canvasHeight)};
    const canvasWidth = ${JSON.stringify(options.canvasWidth)};
    const maxNodes = ${JSON.stringify(options.maxNodes)};
    const minZoom = 0.35;
    const maxZoom = 3.5;
    const zoomStep = 1.2;
    const elements = {
      status: document.getElementById("status"),
      graphCanvas: document.getElementById("graph-canvas"),
      centerView: document.getElementById("center-view"),
      fitView: document.getElementById("fit-view"),
      zoomIn: document.getElementById("zoom-in"),
      zoomOut: document.getElementById("zoom-out"),
      zoomReset: document.getElementById("zoom-reset"),
      modeButtons: Array.from(document.querySelectorAll(".mode-button"))
    };
    const graphRenderer = createGraphCanvasRenderer(elements.graphCanvas, {
      height: canvasHeight,
      width: canvasWidth
    });
    logWebview("info", "init", { mode: state.mode });

    for (const button of elements.modeButtons) {
      button.addEventListener("click", () => {
        state.mode = button.dataset.mode;
        resetGraphFocus();
        resetViewport();
        postRequest("graph/load", { mode: state.mode, depth: defaultDepth }, "Switching view");
        render();
      });
    }

    elements.zoomIn?.addEventListener("click", () => {
      zoomViewport(zoomStep, getCanvasCenter());
    });
    elements.zoomOut?.addEventListener("click", () => {
      zoomViewport(1 / zoomStep, getCanvasCenter());
    });
    elements.zoomReset?.addEventListener("click", () => {
      resetViewport();
    });
    elements.fitView?.addEventListener("click", () => {
      fitGraphToView();
    });
    elements.centerView?.addEventListener("click", () => {
      centerGraphInView();
    });
    elements.graphCanvas.addEventListener("click", handleGraphClick);
    elements.graphCanvas.addEventListener("wheel", handleGraphWheel, { passive: false });
    elements.graphCanvas.addEventListener("pointerdown", handleGraphPointerDown);
    elements.graphCanvas.addEventListener("pointermove", handleGraphPointerMove);
    elements.graphCanvas.addEventListener("pointerup", finishGraphPan);
    elements.graphCanvas.addEventListener("pointercancel", finishGraphPan);
    elements.graphCanvas.addEventListener("dblclick", handleGraphDoubleClick);
    elements.graphCanvas.addEventListener("keydown", handleGraphKeyDown);
    window.addEventListener("resize", () => graphRenderer.requestDraw());

    window.addEventListener("message", (event) => {
      const message = event.data;

      if (message.type === "ui/ready") {
        elements.status.textContent = "Connected";
        return;
      }

      if (message.type === "graph/loaded" || message.type === "graph/updated") {
        state.graph = message.payload;
        logWebview("info", "graph.received", summarizeGraph(message.payload));
        state.graphIndex = createProgressiveGraphIndex(state.graph);
        logWebview("info", "graph.indexed", {
          fileImportEdges: state.graphIndex.fileImportEdges.length,
          fileNodes: state.graphIndex.fileNodes.length
        });
        resetGraphFocus();
        resetViewport();
        elements.status.textContent = "Loaded";
        render();
        return;
      }

      if (message.type === "graph/focusNode") {
        focusGraphNode(message.payload.nodeId);
        return;
      }

      if (message.type === "analysis/status") {
        state.analysisState = message.payload.state;
        elements.status.textContent = message.payload.message;
        return;
      }

      if (message.type === "graph/cleared") {
        state.graph = undefined;
        state.graphIndex = undefined;
        resetGraphFocus();
        resetViewport();
        state.analysisState = "idle";
        render();
        return;
      }

      if (message.type === "view/modeChanged") {
        state.mode = message.payload.mode;
        renderModeButtons();
        return;
      }

      if (message.type === "error") {
        state.analysisState = "failed";
        elements.status.textContent = message.payload.message;
      }
    });

    render();
    postRequest("ui/ready", {}, "Connecting");

    function postRequest(type, payload, statusText) {
      elements.status.textContent = statusText;
      vscode.postMessage({ type, payload });
    }

    function render() {
      renderModeButtons();
      renderGraphCanvas();
    }

    function renderModeButtons() {
      for (const button of elements.modeButtons) {
        button.classList.toggle("active", button.dataset.mode === state.mode);
      }
    }

    function renderGraphCanvas() {
      try {
        renderGraphCanvasUnsafe();
      } catch (error) {
        reportGraphRenderError(error);
      }
    }

    function renderGraphCanvasUnsafe() {
      logWebview("debug", "render.start", {
        hasGraph: Boolean(state.graph),
        mode: state.mode
      });

      if (!state.graph) {
        graphRenderer.clearWithMessage("Analyze to render graph");
        return;
      }

      const progressiveGraph = createProgressiveGraph(state.graph);
      const scene = createGraphScene(progressiveGraph, {
        mode: state.mode,
        query: "",
        selectedNodeId: state.selectedNodeId,
        maxNodes,
        width: canvasWidth,
        height: canvasHeight
      });
      logWebview("debug", "scene.created", {
        edges: scene.edges.length,
        nodes: scene.nodes.length,
        omitted: scene.omittedNodeCount
      });

      if (scene.nodes.length === 0) {
        graphRenderer.clearWithMessage("No graph nodes in this view");
        return;
      }

      graphRenderer.setScene(scene);
      logWebview("debug", "render.queued", graphRenderer.getSceneBounds() || {});
    }

    function reportGraphRenderError(error) {
      const message = error instanceof Error ? error.message : "Unknown graph render failure";
      elements.status.textContent = "Render failed: " + message;
      graphRenderer.clearWithMessage("Render failed");
      logWebview("error", "render.failed", { message });
      console.error(error);
    }

    function selectAndToggleNode(nodeId) {
      state.selectedNodeId = nodeId;

      if (getProgressiveChildren(state.graph, nodeId).length > 0) {
        if (state.expandedGraphNodeIds.has(nodeId)) {
          state.expandedGraphNodeIds.delete(nodeId);
        } else {
          state.expandedGraphNodeIds.add(nodeId);
        }
      }

      render();
    }

    function focusGraphNode(nodeId) {
      if (!state.graph) {
        return;
      }

      state.selectedNodeId = nodeId;
      revealPathToNode(nodeId);
      resetViewport();
      render();
    }

    function resetGraphFocus() {
      state.selectedNodeId = virtualRootId;
      state.expandedGraphNodeIds = createDefaultExpandedNodeIds();
    }

    function createDefaultExpandedNodeIds() {
      return new Set([virtualRootId]);
    }

    function handleGraphWheel(event) {
      event.preventDefault();

      const factor = event.deltaY < 0 ? zoomStep : 1 / zoomStep;
      zoomViewport(factor, getCanvasPoint(event));
    }

    function handleGraphPointerDown(event) {
      const hitNode = graphRenderer.hitTestNode(getCanvasPoint(event), state.viewport);

      if (event.button !== 0) {
        return;
      }

      elements.graphCanvas.focus();

      if (hitNode) {
        return;
      }

      state.pan = {
        active: true,
        pointerId: event.pointerId,
        lastClientX: event.clientX,
        lastClientY: event.clientY,
        moved: false
      };
      elements.graphCanvas.classList.add("panning");
      elements.graphCanvas.setPointerCapture(event.pointerId);
    }

    function handleGraphPointerMove(event) {
      if (!state.pan.active || state.pan.pointerId !== event.pointerId) {
        return;
      }

      const previousPoint = getCanvasPointFromClient(state.pan.lastClientX, state.pan.lastClientY);
      const currentPoint = getCanvasPointFromClient(event.clientX, event.clientY);
      const deltaX = currentPoint.x - previousPoint.x;
      const deltaY = currentPoint.y - previousPoint.y;

      event.preventDefault();
      state.pan.moved = true;
      state.pan.lastClientX = event.clientX;
      state.pan.lastClientY = event.clientY;
      state.viewport.x += deltaX;
      state.viewport.y += deltaY;
      applyViewportTransform();
    }

    function finishGraphPan(event) {
      if (!state.pan.active || state.pan.pointerId !== event.pointerId) {
        return;
      }

      const wasMoved = state.pan.moved;

      state.pan.active = false;
      state.pan.pointerId = undefined;
      state.pan.moved = false;
      elements.graphCanvas.classList.remove("panning");

      if (elements.graphCanvas.hasPointerCapture(event.pointerId)) {
        elements.graphCanvas.releasePointerCapture(event.pointerId);
      }

      if (wasMoved) {
        state.suppressNextClick = true;
        window.setTimeout(() => {
          state.suppressNextClick = false;
        }, 0);
      }
    }

    function handleGraphClick(event) {
      if (state.suppressNextClick) {
        state.suppressNextClick = false;
        return;
      }

      const hitNode = graphRenderer.hitTestNode(getCanvasPoint(event), state.viewport);

      if (hitNode) {
        selectAndToggleNode(hitNode.id);
      }
    }

    function handleGraphDoubleClick(event) {
      const hitNode = graphRenderer.hitTestNode(getCanvasPoint(event), state.viewport);

      if (hitNode && !isVirtualNodeId(hitNode.id)) {
        vscode.postMessage({ type: "node/openSource", payload: { nodeId: hitNode.id } });
      }
    }

    function handleGraphKeyDown(event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectAndToggleNode(state.selectedNodeId);
      }
    }

    function zoomViewport(factor, origin) {
      const nextScale = clamp(state.viewport.scale * factor, minZoom, maxZoom);
      const worldX = (origin.x - state.viewport.x) / state.viewport.scale;
      const worldY = (origin.y - state.viewport.y) / state.viewport.scale;

      state.viewport.scale = nextScale;
      state.viewport.x = origin.x - worldX * nextScale;
      state.viewport.y = origin.y - worldY * nextScale;
      applyViewportTransform();
      renderZoomControls();
    }

    function resetViewport() {
      state.viewport = { scale: 1, x: 0, y: 0 };
      applyViewportTransform();
      renderZoomControls();
    }

    function fitGraphToView() {
      const bounds = graphRenderer.getSceneBounds();

      if (!bounds) {
        resetViewport();
        return;
      }

      const padding = 56;
      const width = Math.max(1, bounds.right - bounds.left);
      const height = Math.max(1, bounds.bottom - bounds.top);
      const scale = clamp(
        Math.min((canvasWidth - padding * 2) / width, (canvasHeight - padding * 2) / height),
        minZoom,
        maxZoom
      );

      state.viewport = createCenteredViewport(bounds, scale);
      applyViewportTransform();
      renderZoomControls();
    }

    function centerGraphInView() {
      const bounds = graphRenderer.getSceneBounds();

      if (!bounds) {
        resetViewport();
        return;
      }

      state.viewport = createCenteredViewport(bounds, state.viewport.scale);
      applyViewportTransform();
      renderZoomControls();
    }

    function createCenteredViewport(bounds, scale) {
      const centerX = (bounds.left + bounds.right) / 2;
      const centerY = (bounds.top + bounds.bottom) / 2;

      return {
        scale,
        x: canvasWidth / 2 - centerX * scale,
        y: canvasHeight / 2 - centerY * scale
      };
    }

    function applyViewportTransform() {
      graphRenderer.setViewport(state.viewport);
    }

    function renderZoomControls() {
      if (elements.zoomReset) {
        elements.zoomReset.textContent = Math.round(state.viewport.scale * 100) + "%";
      }
    }

    function getCanvasCenter() {
      return { x: canvasWidth / 2, y: canvasHeight / 2 };
    }

    function getCanvasPoint(event) {
      return getCanvasPointFromClient(event.clientX, event.clientY);
    }

    function getCanvasPointFromClient(clientX, clientY) {
      const rect = elements.graphCanvas.getBoundingClientRect();

      return graphRenderer.screenToCanvas({
        x: clientX - rect.left,
        y: clientY - rect.top
      });
    }

    function createProgressiveGraph(graph) {
      const nodesById = new Map();
      const edgesById = new Map();
      const visitedNodeIds = new Set();

      appendProgressiveBranch(graph, virtualRootId, nodesById, edgesById, visitedNodeIds, maxNodes);

      if (state.selectedNodeId && state.selectedNodeId !== virtualRootId) {
        const selectedNode = resolveProgressiveNode(graph, state.selectedNodeId);

        if (selectedNode) {
          addNode(nodesById, selectedNode);
        }
      }

      logWebview("debug", "progressive.created", {
        edges: edgesById.size,
        expanded: state.expandedGraphNodeIds.size,
        nodes: nodesById.size
      });

      return {
        ...graph,
        nodes: [...nodesById.values()],
        edges: [...edgesById.values()],
        metadata: {
          ...graph.metadata,
          symbolCount: nodesById.size,
          edgeCount: edgesById.size
        }
      };
    }

    function appendProgressiveBranch(graph, nodeId, nodesById, edgesById, visitedNodeIds, nodeLimit) {
      if (visitedNodeIds.has(nodeId)) {
        return;
      }

      const parentNode = resolveProgressiveNode(graph, nodeId);

      if (!parentNode) {
        return;
      }

      if (!nodesById.has(parentNode.id) && nodesById.size >= nodeLimit && parentNode.id !== virtualRootId) {
        return;
      }

      visitedNodeIds.add(nodeId);
      addNode(nodesById, parentNode);

      if (!state.expandedGraphNodeIds.has(nodeId)) {
        return;
      }

      for (const child of getProgressiveChildren(graph, nodeId)) {
        if (visitedNodeIds.has(child.node.id)) {
          continue;
        }

        if (!nodesById.has(child.node.id) && nodesById.size >= nodeLimit) {
          break;
        }

        addNode(nodesById, child.node);
        addEdge(edgesById, createProgressiveEdge(parentNode.id, child.node.id, child.edgeKind));
        appendProgressiveBranch(graph, child.node.id, nodesById, edgesById, visitedNodeIds, nodeLimit);
      }
    }

    function getProgressiveChildren(graph, nodeId) {
      if (!graph) {
        return [];
      }

      if (nodeId === virtualRootId) {
        return state.mode === "file" ? getImportRootChildren(graph, state.graphIndex) : getPathChildren(graph, "");
      }

      if (state.mode !== "file" && nodeId.startsWith("virtual::path::")) {
        return getPathChildren(graph, nodeId.slice("virtual::path::".length));
      }

      const node = state.graphIndex?.nodesById.get(nodeId);

      if (!node) {
        return [];
      }

      if (node.kind === "file") {
        if (state.mode === "file") {
          return getImportedFileChildren(graph, node.id, state.graphIndex);
        }

        return (state.graphIndex?.containsChildrenBySourceId.get(node.id) ?? [])
          .filter((child) => isSymbolVisibleInMode(child.node));
      }

      return (state.graphIndex?.edgesBySourceId.get(node.id) ?? [])
        .filter((child) => isExpandableEdgeKind(child.edgeKind) && child.node.id !== node.id);
    }

    function getPathChildren(graph, prefix) {
      const fileNodes = state.graphIndex?.fileNodes ?? [];
      const children = new Map();

      for (const fileNode of fileNodes) {
        const relativePath = getGraphRelativePath(graph, fileNode.filePath);

        if (prefix && !relativePath.startsWith(prefix + "/")) {
          continue;
        }

        const remainder = prefix ? relativePath.slice(prefix.length + 1) : relativePath;
        const parts = remainder.split("/").filter(Boolean);
        const nextPart = parts[0];

        if (!nextPart) {
          continue;
        }

        if (parts.length === 1) {
          children.set("file:" + fileNode.id, {
            node: fileNode,
            edgeKind: "contains"
          });
          continue;
        }

        const childPath = prefix ? prefix + "/" + nextPart : nextPart;
        const folderNode = createVirtualNode(
          "virtual::path::" + childPath,
          nextPart,
          "folder",
          childPath
        );
        children.set(folderNode.id, {
          node: folderNode,
          edgeKind: "contains"
        });
      }

      return [...children.values()].sort((left, right) =>
        left.node.name.localeCompare(right.node.name)
      );
    }

    function revealPathToNode(nodeId) {
      const node = state.graphIndex?.nodesById.get(nodeId);

      if (!node) {
        return;
      }

      state.expandedGraphNodeIds.add(virtualRootId);

      const relativePath = getGraphRelativePath(state.graph, node.filePath);
      const parts = relativePath.split("/").filter(Boolean);
      let currentPath = "";

      for (let index = 0; index < parts.length - 1; index += 1) {
        currentPath = currentPath ? currentPath + "/" + parts[index] : parts[index];
        state.expandedGraphNodeIds.add("virtual::path::" + currentPath);
      }

      const fileNode = (state.graphIndex?.fileNodes ?? []).find((candidate) => candidate.filePath === node.filePath);

      if (fileNode && fileNode.id !== node.id) {
        state.expandedGraphNodeIds.add(fileNode.id);
      }
    }

    function resolveProgressiveNode(graph, nodeId) {
      if (nodeId === virtualRootId) {
        return createVirtualNode(virtualRootId, "Project Root", "workspace", graph.workspaceRoot);
      }

      if (nodeId.startsWith("virtual::path::")) {
        const path = nodeId.slice("virtual::path::".length);
        const label = path.split("/").filter(Boolean).at(-1) || path;

        return createVirtualNode(nodeId, label, "folder", path);
      }

      return state.graphIndex?.nodesById.get(nodeId);
    }

    function isExpandableEdgeKind(kind) {
      if (kind === "contains") {
        return true;
      }

      if (state.mode === "call") {
        return kind === "calls";
      }

      if (state.mode === "class") {
        return ["extends", "implements", "overrides", "instantiates"].includes(kind);
      }

      return ["imports", "exports"].includes(kind);
    }

    function isSymbolVisibleInMode(node) {
      if (state.mode === "file") {
        return node.kind !== "external";
      }

      if (state.mode === "class") {
        return ["class", "interface", "enum", "method", "constructor", "property"].includes(node.kind);
      }

      return ["function", "method", "constructor"].includes(node.kind);
    }

    function createVirtualNode(id, name, kind, filePath) {
      return {
        id,
        kind,
        name,
        qualifiedName: name,
        filePath,
        range: emptyRange(),
        selectionRange: emptyRange(),
        language: "virtual"
      };
    }

    function createProgressiveEdge(sourceId, targetId, kind) {
      return {
        id: "edge::progressive::" + sourceId + "::" + targetId,
        kind,
        sourceId,
        targetId,
        filePath: "",
        range: emptyRange(),
        confidence: "exact"
      };
    }

    function addNode(nodesById, node) {
      nodesById.set(node.id, node);
    }

    function addEdge(edgesById, edge) {
      edgesById.set(edge.id, edge);
    }

    function isVirtualNodeId(nodeId) {
      return nodeId.startsWith("virtual::");
    }

    function emptyRange() {
      return {
        startLine: 0,
        startCharacter: 0,
        endLine: 0,
        endCharacter: 0
      };
    }

    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value));
    }

    function summarizeGraph(graph) {
      return {
        edges: graph?.edges?.length ?? 0,
        files: graph?.metadata?.fileCount ?? 0,
        nodes: graph?.nodes?.length ?? 0
      };
    }

    function logWebview(level, message, fields) {
      vscode.postMessage({
        type: "telemetry/log",
        payload: {
          fields,
          level,
          message,
          source: "graphPanel"
        }
      });
    }
  `;
}

/**
 * Rewrites TypeScript's CommonJS import wrappers in stringified layout code so
 * the Webview can call the injected geometry helpers without a module loader.
 */
function createBrowserGraphSceneSource(): string {
  return createGraphScene.toString()
    .replace(/\(0,\s*[\w$]+\.clampNumber\)/g, "clampNumber")
    .replace(/\(0,\s*[\w$]+\.getSeparationSign\)/g, "getSeparationSign")
    .replace(/\(0,\s*[\w$]+\.moveToward\)/g, "moveToward")
    .replace(/\(0,\s*[\w$]+\.createOrderMap\)/g, "createOrderMap")
    .replace(/\(0,\s*[\w$]+\.createCrossFreeTreePositions\)/g, "createCrossFreeTreePositions")
    .replace(/\(0,\s*[\w$]+\.orderGraphNodeIdsByPreviousLayer\)/g, "orderGraphNodeIdsByPreviousLayer")
    .replace(/\(0,\s*[\w$]+\.shouldUseLayeredSelection\)/g, "shouldUseLayeredSelection");
}
