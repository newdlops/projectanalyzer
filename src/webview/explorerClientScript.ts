/**
 * Browser-side script factory for the graph browser WebviewPanel. The panel is
 * intentionally visual-only: it renders a progressively expanded graph canvas.
 */

import { createGraphScene } from "./explorerGraphLayout";

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
  const createGraphSceneSource = createGraphScene.toString();

  return /* js */ `
    const createGraphScene = ${createGraphSceneSource};
    const vscode = acquireVsCodeApi();
    const virtualRootId = "virtual::workspace-root";
    const state = {
      graph: undefined,
      mode: ${JSON.stringify(options.initialMode)},
      selectedNodeId: virtualRootId,
      analysisState: "idle",
      expandedGraphNodeIds: new Set()
    };
    const defaultDepth = ${JSON.stringify(options.defaultDepth)};
    const canvasHeight = ${JSON.stringify(options.canvasHeight)};
    const canvasWidth = ${JSON.stringify(options.canvasWidth)};
    const maxNodes = ${JSON.stringify(options.maxNodes)};
    const elements = {
      status: document.getElementById("status"),
      graphCanvas: document.getElementById("graph-canvas"),
      modeButtons: Array.from(document.querySelectorAll(".mode-button"))
    };

    for (const button of elements.modeButtons) {
      button.addEventListener("click", () => {
        state.mode = button.dataset.mode;
        resetGraphFocus();
        postRequest("graph/load", { mode: state.mode, depth: defaultDepth }, "Switching view");
        render();
      });
    }

    window.addEventListener("message", (event) => {
      const message = event.data;

      if (message.type === "ui/ready") {
        elements.status.textContent = "Connected";
        return;
      }

      if (message.type === "graph/loaded" || message.type === "graph/updated") {
        state.graph = message.payload;
        resetGraphFocus();
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
        resetGraphFocus();
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
    postRequest("graph/load", { mode: state.mode, depth: defaultDepth }, "Loading graph");

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
      elements.graphCanvas.replaceChildren();

      if (!state.graph) {
        appendCanvasMessage("Analyze to render graph");
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

      if (scene.nodes.length === 0) {
        appendCanvasMessage("No graph nodes in this view");
        return;
      }

      appendArrowMarker();

      for (const edge of scene.edges) {
        const path = createSvgElement("path");
        path.setAttribute("class", classNames([
          "graph-edge",
          edge.confidence,
          edge.isSelected ? "selected" : "",
          edge.isDimmed ? "dimmed" : ""
        ]));
        path.setAttribute("d", edge.path);
        path.setAttribute("marker-end", "url(#arrow)");
        elements.graphCanvas.append(path);
      }

      for (const node of scene.nodes) {
        appendGraphNode(node);
      }
    }

    function appendArrowMarker() {
      const defs = createSvgElement("defs");
      const marker = createSvgElement("marker");
      const path = createSvgElement("path");

      marker.setAttribute("id", "arrow");
      marker.setAttribute("viewBox", "0 0 10 10");
      marker.setAttribute("refX", "8");
      marker.setAttribute("refY", "5");
      marker.setAttribute("markerWidth", "4");
      marker.setAttribute("markerHeight", "4");
      marker.setAttribute("orient", "auto-start-reverse");
      path.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
      path.setAttribute("fill", "var(--vscode-descriptionForeground)");
      marker.append(path);
      defs.append(marker);
      elements.graphCanvas.append(defs);
    }

    function appendCanvasMessage(message) {
      const text = createSvgElement("text");

      text.setAttribute("class", "graph-message");
      text.setAttribute("x", String(canvasWidth / 2));
      text.setAttribute("y", String(canvasHeight / 2));
      text.textContent = message;
      elements.graphCanvas.append(text);
    }

    function appendGraphNode(node) {
      const group = createSvgElement("g");
      const circle = createSvgElement("circle");
      const label = createSvgElement("text");
      const title = createSvgElement("title");

      group.setAttribute("class", classNames([
        "graph-node",
        node.kind,
        node.isSelected ? "selected" : "",
        node.isDimmed ? "dimmed" : ""
      ]));
      group.setAttribute("tabindex", "0");
      group.setAttribute("role", "button");
      group.setAttribute("aria-label", node.label);
      group.setAttribute("transform", "translate(" + node.x + " " + node.y + ")");
      circle.setAttribute("r", String(node.radius));
      label.setAttribute("class", "graph-label");
      label.setAttribute("x", "0");
      label.setAttribute("y", "22");
      label.textContent = node.label;
      title.textContent = node.label + " · " + node.kind;

      group.append(title, circle, label);
      group.addEventListener("click", () => {
        selectAndToggleNode(node.id);
      });
      group.addEventListener("dblclick", () => {
        if (!isVirtualNodeId(node.id)) {
          vscode.postMessage({ type: "node/openSource", payload: { nodeId: node.id } });
        }
      });
      group.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectAndToggleNode(node.id);
        }
      });

      elements.graphCanvas.append(group);
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
      render();
    }

    function resetGraphFocus() {
      state.selectedNodeId = virtualRootId;
      state.expandedGraphNodeIds = new Set();
    }

    function createProgressiveGraph(graph) {
      const nodesById = new Map();
      const edgesById = new Map();
      const visitedNodeIds = new Set();

      appendProgressiveBranch(graph, virtualRootId, nodesById, edgesById, visitedNodeIds);

      if (state.selectedNodeId && state.selectedNodeId !== virtualRootId) {
        const selectedNode = resolveProgressiveNode(graph, state.selectedNodeId);

        if (selectedNode) {
          addNode(nodesById, selectedNode);
        }
      }

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

    function appendProgressiveBranch(graph, nodeId, nodesById, edgesById, visitedNodeIds) {
      if (visitedNodeIds.has(nodeId)) {
        return;
      }

      const parentNode = resolveProgressiveNode(graph, nodeId);

      if (!parentNode) {
        return;
      }

      visitedNodeIds.add(nodeId);
      addNode(nodesById, parentNode);

      if (!state.expandedGraphNodeIds.has(nodeId)) {
        return;
      }

      for (const child of getProgressiveChildren(graph, nodeId)) {
        addNode(nodesById, child.node);
        addEdge(edgesById, createProgressiveEdge(parentNode.id, child.node.id, child.edgeKind));
        appendProgressiveBranch(graph, child.node.id, nodesById, edgesById, visitedNodeIds);
      }
    }

    function getProgressiveChildren(graph, nodeId) {
      if (!graph) {
        return [];
      }

      if (nodeId === virtualRootId) {
        return getPathChildren(graph, "");
      }

      if (nodeId.startsWith("virtual::path::")) {
        return getPathChildren(graph, nodeId.slice("virtual::path::".length));
      }

      const node = graph.nodes.find((candidate) => candidate.id === nodeId);

      if (!node) {
        return [];
      }

      if (node.kind === "file") {
        return graph.edges
          .filter((edge) => edge.kind === "contains" && edge.sourceId === node.id)
          .map((edge) => graph.nodes.find((candidate) => candidate.id === edge.targetId))
          .filter(Boolean)
          .filter((candidate) => isSymbolVisibleInMode(candidate))
          .map((candidate) => ({ node: candidate, edgeKind: "contains" }));
      }

      return graph.edges
        .filter((edge) => isExpandableEdge(edge) && edge.sourceId === node.id)
        .map((edge) => graph.nodes.find((candidate) => candidate.id === edge.targetId))
        .filter(Boolean)
        .filter((candidate) => candidate.id !== node.id)
        .map((candidate) => ({ node: candidate, edgeKind: "calls" }));
    }

    function getPathChildren(graph, prefix) {
      const fileNodes = graph.nodes.filter((node) => node.kind === "file");
      const children = new Map();

      for (const fileNode of fileNodes) {
        const relativePath = getRelativePath(graph, fileNode.filePath);

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
      const node = state.graph.nodes.find((candidate) => candidate.id === nodeId);

      if (!node) {
        return;
      }

      state.expandedGraphNodeIds.add(virtualRootId);

      const relativePath = getRelativePath(state.graph, node.filePath);
      const parts = relativePath.split("/").filter(Boolean);
      let currentPath = "";

      for (let index = 0; index < parts.length - 1; index += 1) {
        currentPath = currentPath ? currentPath + "/" + parts[index] : parts[index];
        state.expandedGraphNodeIds.add("virtual::path::" + currentPath);
      }

      const fileNode = state.graph.nodes.find((candidate) =>
        candidate.kind === "file" && candidate.filePath === node.filePath
      );

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

      return graph.nodes.find((node) => node.id === nodeId);
    }

    function isExpandableEdge(edge) {
      if (edge.kind === "contains") {
        return true;
      }

      if (state.mode === "call") {
        return edge.kind === "calls";
      }

      if (state.mode === "class") {
        return ["extends", "implements", "overrides", "instantiates"].includes(edge.kind);
      }

      return ["imports", "exports"].includes(edge.kind);
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

    function createSvgElement(name) {
      return document.createElementNS("http://www.w3.org/2000/svg", name);
    }

    function classNames(values) {
      return values.filter(Boolean).join(" ");
    }

    function getRelativePath(graph, filePath) {
      const workspaceRoot = graph.workspaceRoot.replace(/\\\\/g, "/");
      const normalized = filePath.replace(/\\\\/g, "/");

      if (normalized.startsWith(workspaceRoot + "/")) {
        return normalized.slice(workspaceRoot.length + 1);
      }

      return normalized.split("/").slice(-3).join("/");
    }
  `;
}
