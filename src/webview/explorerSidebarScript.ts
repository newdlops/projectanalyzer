/**
 * Browser-side script for the Activity Bar sidebar. It renders a VS Code
 * Explorer-like file tree and keeps analysis controls close to navigation.
 */

import { getProgressiveFileGraphBrowserSource } from "./explorerProgressiveFileGraph";

/**
 * Builds the sidebar control and file-tree script.
 */
export function getExplorerSidebarScript(): string {
  const progressiveFileGraphSource = getProgressiveFileGraphBrowserSource();

  return /* js */ `
    ${progressiveFileGraphSource}
    const vscode = acquireVsCodeApi();
    const state = {
      graph: undefined,
      analysisState: "idle",
      expandedTreeIds: new Set(["root"]),
      selectedTreeId: undefined
    };
    const elements = {
      analyzeWorkspace: document.getElementById("analyze-workspace"),
      analyzeCurrent: document.getElementById("analyze-current"),
      openGraph: document.getElementById("open-graph"),
      cancelAnalysis: document.getElementById("cancel-analysis"),
      exportJson: document.getElementById("export-json"),
      clearCache: document.getElementById("clear-cache"),
      status: document.getElementById("status"),
      files: document.getElementById("files"),
      symbols: document.getElementById("symbols"),
      edges: document.getElementById("edges"),
      explorerTree: document.getElementById("explorer-tree")
    };

    elements.analyzeWorkspace.addEventListener("click", () => {
      postRequest("analysis/run", { scope: "workspace" }, "Analyze workspace requested");
    });

    elements.analyzeCurrent.addEventListener("click", () => {
      postRequest("analysis/run", { scope: "currentFile" }, "Analyze current file requested");
    });

    elements.openGraph.addEventListener("click", () => {
      postRequest("graph/openPanel", {}, "Opening graph browser");
    });

    elements.cancelAnalysis.addEventListener("click", () => {
      postRequest("analysis/cancel", {}, "Cancel requested");
    });

    elements.exportJson.addEventListener("click", () => {
      postRequest("export/run", { format: "json" }, "Export requested");
    });

    elements.clearCache.addEventListener("click", () => {
      postRequest("cache/clear", {}, "Clear requested");
    });

    window.addEventListener("message", (event) => {
      const message = event.data;

      if (message.type === "ui/ready") {
        elements.status.textContent = "Connected";
        return;
      }

      if (message.type === "graph/loaded" || message.type === "graph/updated") {
        state.graph = message.payload;
        elements.status.textContent = "Graph available";
        render();
        return;
      }

      if (message.type === "graph/cleared") {
        state.graph = undefined;
        state.analysisState = "idle";
        render();
        return;
      }

      if (message.type === "analysis/status") {
        state.analysisState = message.payload.state;
        elements.status.textContent = message.payload.message;
        renderActions();
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
    postRequest("graph/load", { mode: "file", depth: 1 }, "Loading graph state");

    function postRequest(type, payload, statusText) {
      elements.status.textContent = statusText;
      vscode.postMessage({ type, payload });
    }

    function render() {
      renderStats();
      renderFileTree();
      renderActions();
    }

    function renderStats() {
      const graph = state.graph;
      elements.files.textContent = graph ? String(graph.metadata.fileCount) : "0";
      elements.symbols.textContent = graph ? String(graph.metadata.symbolCount) : "0";
      elements.edges.textContent = graph ? String(graph.metadata.edgeCount) : "0";
    }

    function renderFileTree() {
      elements.explorerTree.replaceChildren();

      if (!state.graph) {
        appendEmptyTree("Analyze a workspace to load files");
        return;
      }

      const rows = createFileTreeRows(state.graph);

      if (rows.length === 0) {
        appendEmptyTree("No files in graph");
        return;
      }

      for (const row of rows) {
        const button = document.createElement("button");
        const disclosure = document.createElement("span");
        const icon = document.createElement("span");
        const text = document.createElement("span");
        const name = document.createElement("span");
        const detail = document.createElement("span");
        const rowClasses = ["tree-row", row.kind + "-row"];

        button.type = "button";
        if (row.hasChildren) {
          rowClasses.push("expandable");
        }
        if (row.expanded) {
          rowClasses.push("expanded");
        }
        if (state.selectedTreeId === row.id) {
          rowClasses.push("selected");
        }

        button.className = rowClasses.join(" ");
        button.style.paddingLeft = String(4 + row.depth * 16) + "px";
        button.title = row.label;
        button.setAttribute("role", "treeitem");
        button.setAttribute("aria-level", String(row.depth + 1));
        if (row.hasChildren) {
          button.setAttribute("aria-expanded", row.expanded ? "true" : "false");
        }

        disclosure.className = "tree-disclosure";
        icon.className = "tree-file-icon";
        text.className = "tree-label-group";
        name.className = "tree-label";
        detail.className = "tree-detail";
        name.textContent = row.name;
        detail.textContent = row.detail;

        text.append(name);
        if (row.detail) {
          text.append(detail);
        }
        button.append(disclosure, icon, text);
        button.addEventListener("click", () => {
          state.selectedTreeId = row.id;

          if (row.hasChildren) {
            toggleTreeRow(row.id);
          }

          render();

          if (row.nodeId) {
            postRequest("graph/focusNode", { nodeId: row.nodeId }, "Opening graph browser");
          }
        });
        button.addEventListener("keydown", (event) => {
          if (event.key === "ArrowRight" && row.hasChildren && !row.expanded) {
            event.preventDefault();
            state.selectedTreeId = row.id;
            toggleTreeRow(row.id);
            render();
          }

          if (event.key === "ArrowLeft" && row.hasChildren && row.expanded) {
            event.preventDefault();
            state.selectedTreeId = row.id;
            toggleTreeRow(row.id);
            render();
          }
        });
        button.addEventListener("dblclick", () => {
          if (row.nodeId) {
            vscode.postMessage({ type: "node/openSource", payload: { nodeId: row.nodeId } });
          }
        });

        elements.explorerTree.append(button);
      }
    }

    function createFileTreeRows(graph) {
      const index = createImportTreeIndex(graph);
      const rows = [];

      for (const rootNode of getApplicationEntryNodes(graph, index)) {
        appendImportRows(graph, index, rootNode, rows, [], 0);
      }

      return rows;
    }

    function createImportTreeIndex(graph) {
      const fileNodes = graph.nodes
        .filter((node) => node.kind === "file")
        .sort((left, right) => getRelativePath(graph, left.filePath).localeCompare(getRelativePath(graph, right.filePath)));
      const fileNodesById = new Map(fileNodes.map((node) => [node.id, node]));
      const importedFileIds = new Set();
      const importerFileIds = new Set();
      const childrenByImporterId = new Map();

      for (const edge of graph.edges) {
        if (!["imports", "exports"].includes(edge.kind)) {
          continue;
        }

        const source = fileNodesById.get(edge.sourceId);
        const target = fileNodesById.get(edge.targetId);

        if (!source || !target) {
          continue;
        }

        importedFileIds.add(target.id);
        importerFileIds.add(source.id);
        const children = childrenByImporterId.get(source.id) ?? [];
        children.push(target);
        childrenByImporterId.set(source.id, children);
      }

      for (const children of childrenByImporterId.values()) {
        children.sort((left, right) => getRelativePath(graph, left.filePath).localeCompare(getRelativePath(graph, right.filePath)));
      }

      return {
        childrenByImporterId,
        fileImportChildrenBySourceId: childrenByImporterId,
        fileNodes,
        fileImportEdges: graph.edges.filter((edge) =>
          ["imports", "exports"].includes(edge.kind) &&
          fileNodesById.has(edge.sourceId) &&
          fileNodesById.has(edge.targetId)
        ),
        importedFileIds,
        importerFileIds,
        nodesById: fileNodesById
      };
    }

    function appendImportRows(graph, index, fileNode, rows, ancestorIds, depth) {
      const nextAncestorIds = [...ancestorIds, fileNode.id];
      const rowId = "import:" + nextAncestorIds.join(">");
      const relativePath = getRelativePath(graph, fileNode.filePath);
      const children = (index.childrenByImporterId.get(fileNode.id) ?? [])
        .filter((child) => !nextAncestorIds.includes(child.id));
      const hasChildren = children.length > 0;
      const expanded = hasChildren && state.expandedTreeIds.has(rowId);

      rows.push({
        id: rowId,
        label: relativePath,
        name: getFileName(relativePath),
        detail: getDirectoryName(relativePath),
        kind: depth === 0 ? "entry" : "import",
        nodeId: fileNode.id,
        depth,
        hasChildren,
        expanded
      });

      if (!expanded) {
        return;
      }

      for (const child of children) {
        appendImportRows(graph, index, child, rows, nextAncestorIds, depth + 1);
      }
    }

    function toggleTreeRow(treeId) {
      if (state.expandedTreeIds.has(treeId)) {
        state.expandedTreeIds.delete(treeId);
      } else {
        state.expandedTreeIds.add(treeId);
      }
    }

    function appendEmptyTree(message) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = message;
      elements.explorerTree.append(empty);
    }

    function renderActions() {
      const analysisRunning = state.analysisState === "running";
      const hasGraph = Boolean(state.graph);

      elements.analyzeWorkspace.disabled = analysisRunning;
      elements.analyzeCurrent.disabled = analysisRunning;
      elements.cancelAnalysis.disabled = !analysisRunning;
      elements.openGraph.disabled = analysisRunning && !hasGraph;
      elements.exportJson.disabled = !hasGraph || analysisRunning;
      elements.clearCache.disabled = analysisRunning;
    }

    function getRelativePath(graph, filePath) {
      const workspaceRoot = graph.workspaceRoot.replace(/\\\\/g, "/");
      const normalized = filePath.replace(/\\\\/g, "/");

      if (normalized.startsWith(workspaceRoot + "/")) {
        return normalized.slice(workspaceRoot.length + 1);
      }

      return normalized.split("/").slice(-3).join("/");
    }

    function getFileName(relativePath) {
      const parts = relativePath.split("/");
      return parts[parts.length - 1] || relativePath;
    }

    function getDirectoryName(relativePath) {
      const parts = relativePath.split("/");
      parts.pop();
      return parts.join("/");
    }
  `;
}
