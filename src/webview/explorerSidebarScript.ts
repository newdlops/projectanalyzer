/**
 * Browser-side script for the Activity Bar sidebar. It renders a VS Code
 * Explorer-like file tree and keeps analysis controls close to navigation.
 */

/**
 * Builds the sidebar control and file-tree script.
 */
export function getExplorerSidebarScript(): string {
  return /* js */ `
    const vscode = acquireVsCodeApi();
    const state = {
      graph: undefined,
      analysisState: "idle",
      expandedTreeIds: new Set(["root"])
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
        const text = document.createElement("span");
        const name = document.createElement("span");
        const meta = document.createElement("span");

        button.type = "button";
        button.className = "node-row tree-row";
        button.style.paddingLeft = String(8 + row.depth * 16) + "px";
        disclosure.className = "tree-disclosure" + (row.hasChildren ? "" : " empty");
        disclosure.textContent = row.hasChildren ? (row.expanded ? "-" : "+") : "-";
        text.className = "node-text";
        name.className = "node-name";
        meta.className = "node-meta";
        name.textContent = row.label;
        meta.textContent = row.kind;

        text.append(name, meta);
        button.append(disclosure, text);
        button.addEventListener("click", () => {
          if (row.hasChildren) {
            toggleTreeRow(row.id);
          }

          if (row.nodeId) {
            postRequest("graph/focusNode", { nodeId: row.nodeId }, "Opening graph browser");
          } else {
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

      for (const rootNode of getImportRootNodes(index)) {
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
        fileNodes,
        importedFileIds,
        importerFileIds
      };
    }

    function getImportRootNodes(index) {
      let roots = index.fileNodes.filter((node) =>
        !index.importedFileIds.has(node.id) && (index.importerFileIds.has(node.id) || index.importerFileIds.size === 0)
      );

      if (roots.length === 0 && index.importerFileIds.size > 0) {
        roots = index.fileNodes.filter((node) => index.importerFileIds.has(node.id));
      }

      return roots.length > 0 ? roots : index.fileNodes;
    }

    function appendImportRows(graph, index, fileNode, rows, ancestorIds, depth) {
      const nextAncestorIds = [...ancestorIds, fileNode.id];
      const rowId = "import:" + nextAncestorIds.join(">");
      const children = (index.childrenByImporterId.get(fileNode.id) ?? [])
        .filter((child) => !nextAncestorIds.includes(child.id));
      const hasChildren = children.length > 0;
      const expanded = hasChildren && state.expandedTreeIds.has(rowId);

      rows.push({
        id: rowId,
        label: getRelativePath(graph, fileNode.filePath),
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
  `;
}
