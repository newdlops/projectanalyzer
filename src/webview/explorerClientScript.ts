/**
 * Browser-side script factory for the graph browser WebviewPanel. The returned
 * script is dependency-free and runs under the Webview CSP nonce.
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
 * Builds the browser script that owns local rendering and GUI event wiring.
 */
export function getExplorerClientScript(options: ExplorerClientScriptOptions): string {
  const createGraphSceneSource = createGraphScene.toString();

  return /* js */ `
    const createGraphScene = ${createGraphSceneSource};
    const vscode = acquireVsCodeApi();
    const state = {
      graph: undefined,
      mode: ${JSON.stringify(options.initialMode)},
      nodeViewMode: "tree",
      query: "",
      selectedNodeId: undefined,
      analysisState: "idle",
      expandedTreeIds: new Set()
    };
    const defaultDepth = ${JSON.stringify(options.defaultDepth)};
    const canvasHeight = ${JSON.stringify(options.canvasHeight)};
    const canvasWidth = ${JSON.stringify(options.canvasWidth)};
    const maxNodes = ${JSON.stringify(options.maxNodes)};
    const elements = {
      exportJson: document.getElementById("export-json"),
      openSource: document.getElementById("open-source"),
      showCallers: document.getElementById("show-callers"),
      showCallees: document.getElementById("show-callees"),
      search: document.getElementById("search"),
      status: document.getElementById("status"),
      files: document.getElementById("files"),
      symbols: document.getElementById("symbols"),
      edges: document.getElementById("edges"),
      graphCanvas: document.getElementById("graph-canvas"),
      list: document.getElementById("list"),
      detailTitle: document.getElementById("detail-title"),
      detailMeta: document.getElementById("detail-meta"),
      modeButtons: Array.from(document.querySelectorAll(".mode-button")),
      nodeViewButtons: Array.from(document.querySelectorAll(".view-button"))
    };

    elements.exportJson.addEventListener("click", () => {
      postRequest("export/run", { format: "json" }, "Export requested");
    });

    elements.openSource.addEventListener("click", () => {
      postSelectedNode("node/openSource");
    });

    elements.showCallers.addEventListener("click", () => {
      postSelectedRelationship("callers");
    });

    elements.showCallees.addEventListener("click", () => {
      postSelectedRelationship("callees");
    });

    elements.search.addEventListener("input", (event) => {
      state.query = event.target.value.toLowerCase();
      render();
    });

    for (const button of elements.modeButtons) {
      button.addEventListener("click", () => {
        state.mode = button.dataset.mode;
        postRequest("graph/load", { mode: state.mode, depth: defaultDepth }, "Switching view");
        render();
      });
    }

    for (const button of elements.nodeViewButtons) {
      button.addEventListener("click", () => {
        state.nodeViewMode = button.dataset.nodeView;
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
        elements.status.textContent = "Loaded";
        render();
        return;
      }

      if (message.type === "analysis/status") {
        state.analysisState = message.payload.state;
        elements.status.textContent = message.payload.message;
        renderActions();
        return;
      }

      if (message.type === "graph/cleared") {
        state.graph = undefined;
        state.selectedNodeId = undefined;
        state.analysisState = "idle";
        render();
        return;
      }

      if (message.type === "view/modeChanged") {
        state.mode = message.payload.mode;
        render();
        return;
      }

      if (message.type === "error") {
        state.analysisState = "failed";
        elements.status.textContent = message.payload.message;
        renderActions();
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
      renderNodeViewButtons();
      renderStats();
      renderGraphCanvas();
      renderList();
      renderDetail();
      renderActions();
    }

    function renderModeButtons() {
      for (const button of elements.modeButtons) {
        button.classList.toggle("active", button.dataset.mode === state.mode);
      }
    }

    function renderNodeViewButtons() {
      for (const button of elements.nodeViewButtons) {
        button.classList.toggle("active", button.dataset.nodeView === state.nodeViewMode);
      }
    }

    function renderStats() {
      const graph = state.graph;
      elements.files.textContent = graph ? String(graph.metadata.fileCount) : "0";
      elements.symbols.textContent = graph ? String(graph.metadata.symbolCount) : "0";
      elements.edges.textContent = graph ? String(graph.metadata.edgeCount) : "0";
    }

    function renderGraphCanvas() {
      elements.graphCanvas.replaceChildren();
      const graph = state.graph;
      const scene = createGraphScene(graph, {
        mode: state.mode,
        query: state.query,
        selectedNodeId: state.selectedNodeId,
        maxNodes,
        width: canvasWidth,
        height: canvasHeight
      });

      if (!graph || scene.nodes.length === 0) {
        appendCanvasMessage(graph ? "No graph nodes in this view" : "Analyze to render graph");
        return;
      }

      appendArrowMarker();

      for (const edge of scene.edges.slice(0, 90)) {
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

      if (scene.omittedNodeCount > 0) {
        appendCanvasNotice(String(scene.omittedNodeCount) + " nodes hidden by render limit");
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

    function appendCanvasNotice(message) {
      const text = createSvgElement("text");

      text.setAttribute("class", "graph-message");
      text.setAttribute("x", String(canvasWidth / 2));
      text.setAttribute("y", String(canvasHeight - 18));
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
        selectNode(node.id);
      });
      group.addEventListener("dblclick", () => {
        vscode.postMessage({ type: "node/openSource", payload: { nodeId: node.id } });
      });
      group.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectNode(node.id);
        }
      });

      elements.graphCanvas.append(group);
    }

    function renderList() {
      elements.list.replaceChildren();

      if (state.nodeViewMode === "tree") {
        renderTree();
        return;
      }

      renderFlatList();
    }

    function renderFlatList() {
      const visibleNodes = getVisibleNodes();

      if (visibleNodes.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent = state.graph ? "No nodes in this view" : "Analyze a workspace to load nodes";
        elements.list.append(empty);
        return;
      }

      for (const node of visibleNodes) {
        const row = document.createElement("button");
        const name = document.createElement("span");
        const meta = document.createElement("span");

        row.type = "button";
        row.className = "node-row";
        row.classList.toggle("selected", node.id === state.selectedNodeId);
        name.className = "node-name";
        meta.className = "node-meta";
        name.textContent = node.name || node.qualifiedName;
        meta.textContent = node.kind + " · " + compactPath(node.filePath);

        row.append(name, meta);
        row.addEventListener("click", () => {
          selectNode(node.id);
        });
        row.addEventListener("dblclick", () => {
          vscode.postMessage({ type: "node/openSource", payload: { nodeId: node.id } });
        });

        elements.list.append(row);
      }
    }

    function renderTree() {
      const rows = getTreeRows();

      if (rows.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent = state.graph ? "No nodes in this tree" : "Analyze a workspace to load nodes";
        elements.list.append(empty);
        return;
      }

      for (const row of rows.slice(0, 500)) {
        const button = document.createElement("button");
        const disclosure = document.createElement("span");
        const text = document.createElement("span");
        const name = document.createElement("span");
        const meta = document.createElement("span");

        button.type = "button";
        button.className = "node-row tree-row";
        button.style.paddingLeft = String(8 + row.depth * 16) + "px";
        button.classList.toggle("selected", row.nodeId === state.selectedNodeId);
        disclosure.className = "tree-disclosure" + (row.hasChildren ? "" : " empty");
        disclosure.textContent = row.hasChildren ? (row.expanded ? "-" : "+") : "-";
        text.className = "node-text";
        name.className = "node-name";
        meta.className = "node-meta";
        name.textContent = row.label;
        meta.textContent = row.meta;

        text.append(name, meta);
        button.append(disclosure, text);
        button.addEventListener("click", () => {
          if (row.hasChildren) {
            toggleTreeRow(row.id);
          }

          if (row.nodeId) {
            selectNode(row.nodeId);
          } else {
            render();
          }
        });
        button.addEventListener("dblclick", () => {
          if (row.nodeId) {
            vscode.postMessage({ type: "node/openSource", payload: { nodeId: row.nodeId } });
          }
        });

        elements.list.append(button);
      }
    }

    function renderDetail() {
      const node = state.graph?.nodes.find((candidate) => candidate.id === state.selectedNodeId);

      if (!node) {
        elements.detailTitle.textContent = "No selection";
        elements.detailMeta.textContent = "";
        return;
      }

      elements.detailTitle.textContent = node.qualifiedName;
      elements.detailMeta.textContent =
        node.kind + " · " + node.language + " · " + compactPath(node.filePath) +
        " · " + (node.selectionRange.startLine + 1) + ":" + (node.selectionRange.startCharacter + 1);
    }

    function renderActions() {
      const hasSelection = Boolean(state.selectedNodeId);
      const analysisRunning = state.analysisState === "running";
      elements.openSource.disabled = !hasSelection;
      elements.showCallers.disabled = !hasSelection;
      elements.showCallees.disabled = !hasSelection;
      elements.exportJson.disabled = !state.graph || analysisRunning;
    }

    function postSelectedNode(type) {
      if (!state.selectedNodeId) {
        return;
      }

      postRequest(type, { nodeId: state.selectedNodeId }, "Opening source");
    }

    function postSelectedRelationship(direction) {
      if (!state.selectedNodeId) {
        return;
      }

      postRequest("node/showRelationship", {
        nodeId: state.selectedNodeId,
        direction
      }, direction === "callers" ? "Loading callers" : "Loading callees");
    }

    function getVisibleNodes(limit = 200) {
      const graph = state.graph;

      if (!graph) {
        return [];
      }

      return graph.nodes
        .filter((node) => isNodeInMode(node))
        .filter((node) => {
          if (!state.query) {
            return true;
          }

          return [node.name, node.qualifiedName, node.filePath, node.kind]
            .filter(Boolean)
            .some((value) => value.toLowerCase().includes(state.query));
        })
        .slice(0, limit);
    }

    function getTreeRows() {
      const graph = state.graph;

      if (!graph) {
        return [];
      }

      const root = createTreeEntry("root", "", "workspace", "", undefined);
      const nodes = getVisibleNodes(1000);

      for (const node of nodes) {
        insertNodeIntoTree(root, graph, node);
      }

      const rows = [];
      appendTreeRows(root, rows, -1);
      return rows;
    }

    function insertNodeIntoTree(root, graph, node) {
      const relativePath = getRelativePath(graph, node.filePath);
      const pathParts = relativePath.split(/[\\\\/]/).filter(Boolean);
      let current = root;
      let currentPath = "";

      for (let index = 0; index < pathParts.length; index += 1) {
        const part = pathParts[index];
        const isFile = index === pathParts.length - 1;
        currentPath = currentPath ? currentPath + "/" + part : part;
        current = getOrCreateTreeChild(
          current,
          "path:" + currentPath,
          part,
          isFile ? "file" : "folder",
          isFile && state.mode === "file" ? node.id : undefined
        );
      }

      if (state.mode === "file") {
        return;
      }

      const symbolParts = (node.qualifiedName || node.name || node.id)
        .split(".")
        .filter(Boolean);
      let symbolPath = current.id;

      for (let index = 0; index < symbolParts.length; index += 1) {
        const part = symbolParts[index];
        const isLeaf = index === symbolParts.length - 1;
        symbolPath += "::" + part;
        current = getOrCreateTreeChild(
          current,
          "symbol:" + node.id + ":" + symbolPath,
          part,
          isLeaf ? node.kind : "namespace",
          isLeaf ? node.id : undefined
        );
      }
    }

    function createTreeEntry(id, label, kind, meta, nodeId) {
      return {
        id,
        label,
        kind,
        meta,
        nodeId,
        children: new Map()
      };
    }

    function getOrCreateTreeChild(parent, id, label, kind, nodeId) {
      const existing = parent.children.get(id);

      if (existing) {
        if (nodeId) {
          existing.nodeId = nodeId;
        }

        return existing;
      }

      const child = createTreeEntry(id, label, kind, kind, nodeId);
      parent.children.set(id, child);
      return child;
    }

    function appendTreeRows(parent, rows, depth) {
      const children = [...parent.children.values()].sort(compareTreeEntries);

      for (const child of children) {
        const hasChildren = child.children.size > 0;
        const expanded = hasChildren && isTreeRowExpanded(child.id, depth + 1);

        rows.push({
          id: child.id,
          label: child.label,
          meta: child.meta,
          nodeId: child.nodeId,
          depth: depth + 1,
          hasChildren,
          expanded
        });

        if (expanded) {
          appendTreeRows(child, rows, depth + 1);
        }
      }
    }

    function compareTreeEntries(left, right) {
      const leftGroup = left.children.size > 0 && left.kind !== "file" ? 0 : 1;
      const rightGroup = right.children.size > 0 && right.kind !== "file" ? 0 : 1;

      if (leftGroup !== rightGroup) {
        return leftGroup - rightGroup;
      }

      return left.label.localeCompare(right.label);
    }

    function isTreeRowExpanded(treeId, depth) {
      return depth < 2 || state.expandedTreeIds.has(treeId);
    }

    function toggleTreeRow(treeId) {
      if (state.expandedTreeIds.has(treeId)) {
        state.expandedTreeIds.delete(treeId);
      } else {
        state.expandedTreeIds.add(treeId);
      }
    }

    function getRelativePath(graph, filePath) {
      const workspaceRoot = graph.workspaceRoot.replace(/\\\\/g, "/");
      const normalized = filePath.replace(/\\\\/g, "/");

      if (normalized.startsWith(workspaceRoot + "/")) {
        return normalized.slice(workspaceRoot.length + 1);
      }

      return compactPath(filePath);
    }

    function selectNode(nodeId) {
      state.selectedNodeId = nodeId;
      render();
    }

    function createSvgElement(name) {
      return document.createElementNS("http://www.w3.org/2000/svg", name);
    }

    function classNames(values) {
      return values.filter(Boolean).join(" ");
    }

    function isNodeInMode(node) {
      if (state.mode === "file") {
        return node.kind === "file" || node.kind === "folder";
      }

      if (state.mode === "class") {
        return node.kind === "class" || node.kind === "interface" || node.kind === "enum";
      }

      return node.kind === "function" || node.kind === "method" || node.kind === "constructor";
    }

    function compactPath(filePath) {
      const parts = filePath.split(/[\\\\/]/);
      return parts.slice(Math.max(0, parts.length - 3)).join("/");
    }
  `;
}
