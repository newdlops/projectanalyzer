/**
 * Webview HTML factory for the Project Analyzer GUI. The current implementation
 * is a dependency-free sidebar shell that can render real graph payloads.
 */

import * as vscode from "vscode";

/** Data required to construct the explorer Webview HTML. */
export type WebviewHtmlOptions = {
  webview: vscode.Webview;
  extensionUri: vscode.Uri;
  nonce: string;
  defaultDepth: number;
  initialMode: "call" | "file" | "class";
  surface: "sidebar";
};

/**
 * Builds the Visual Explorer HTML document for the sidebar Webview.
 */
export function getExplorerHtml(options: WebviewHtmlOptions): string {
  const cspSource = options.webview.cspSource;

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${options.nonce}';">
  <title>Project Analyzer</title>
  <style>
    :root {
      color-scheme: light dark;
    }

    body {
      margin: 0;
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }

    button,
    input {
      font: inherit;
    }

    .shell {
      display: flex;
      min-width: 0;
      min-height: 100vh;
      flex-direction: column;
      gap: 10px;
      padding: 10px;
      box-sizing: border-box;
    }

    .toolbar,
    .button-grid,
    .action-grid,
    .mode-switch,
    .stats {
      display: flex;
      gap: 6px;
    }

    .toolbar {
      align-items: center;
    }

    .button-grid,
    .action-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .primary-button,
    .secondary-button,
    .action-button,
    .mode-button {
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 4px;
      cursor: pointer;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .primary-button,
    .secondary-button,
    .action-button {
      flex: 1;
      padding: 6px 8px;
    }

    .primary-button {
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
    }

    .primary-button:hover {
      background: var(--vscode-button-hoverBackground);
    }

    .secondary-button,
    .action-button {
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
    }

    .secondary-button:hover,
    .action-button:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }

    .secondary-button:disabled,
    .action-button:disabled,
    .primary-button:disabled {
      cursor: default;
      opacity: 0.55;
    }

    .mode-switch {
      padding: 2px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 5px;
    }

    .mode-button {
      flex: 1;
      min-width: 0;
      padding: 4px 6px;
      color: var(--vscode-foreground);
      background: transparent;
    }

    .mode-button.active {
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-secondaryBackground);
    }

    .search {
      width: 100%;
      box-sizing: border-box;
      padding: 6px 8px;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
      border-radius: 4px;
    }

    .status {
      min-height: 18px;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }

    .stats {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .stat {
      min-width: 0;
      padding: 6px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
    }

    .stat-value {
      display: block;
      font-size: 16px;
      font-weight: 600;
      line-height: 1.1;
    }

    .stat-label {
      display: block;
      overflow: hidden;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .list {
      display: flex;
      min-height: 0;
      flex: 1;
      flex-direction: column;
      gap: 4px;
      overflow: auto;
    }

    .node-row {
      width: 100%;
      min-width: 0;
      padding: 7px 8px;
      color: var(--vscode-foreground);
      background: transparent;
      border: 1px solid transparent;
      border-radius: 4px;
      text-align: left;
      cursor: pointer;
    }

    .node-row:hover,
    .node-row.selected {
      background: var(--vscode-list-hoverBackground);
      border-color: var(--vscode-panel-border);
    }

    .node-name,
    .node-meta {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .node-meta {
      margin-top: 2px;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
    }

    .detail {
      padding-top: 8px;
      border-top: 1px solid var(--vscode-panel-border);
    }

    .detail-title {
      overflow: hidden;
      margin-bottom: 3px;
      font-weight: 600;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .detail-meta {
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      line-height: 1.4;
      overflow-wrap: anywhere;
    }
  </style>
</head>
<body>
  <div class="shell">
    <div class="toolbar">
      <button id="analyze-workspace" class="primary-button" type="button">Analyze Workspace</button>
    </div>
    <div class="button-grid">
      <button id="analyze-current" class="secondary-button" type="button">Current File</button>
      <button id="cancel-analysis" class="secondary-button" type="button">Cancel</button>
      <button id="export-json" class="secondary-button" type="button">Export JSON</button>
      <button id="clear-cache" class="secondary-button" type="button">Clear</button>
    </div>
    <div class="mode-switch" role="tablist">
      <button class="mode-button active" type="button" data-mode="file">Files</button>
      <button class="mode-button" type="button" data-mode="call">Calls</button>
      <button class="mode-button" type="button" data-mode="class">Classes</button>
    </div>
    <input id="search" class="search" type="search" placeholder="Search" aria-label="Search">
    <div id="status" class="status">Ready</div>
    <div class="stats" aria-label="Graph summary">
      <div class="stat"><span id="files" class="stat-value">0</span><span class="stat-label">Files</span></div>
      <div class="stat"><span id="symbols" class="stat-value">0</span><span class="stat-label">Nodes</span></div>
      <div class="stat"><span id="edges" class="stat-value">0</span><span class="stat-label">Edges</span></div>
    </div>
    <div id="list" class="list" aria-label="Graph nodes"></div>
    <section class="detail" aria-label="Selected node">
      <div id="detail-title" class="detail-title">No selection</div>
      <div id="detail-meta" class="detail-meta"></div>
      <div class="action-grid">
        <button id="open-source" class="action-button" type="button" disabled>Open</button>
        <button id="show-callers" class="action-button" type="button" disabled>Callers</button>
        <button id="show-callees" class="action-button" type="button" disabled>Callees</button>
      </div>
    </section>
  </div>
  <script nonce="${options.nonce}">
    const vscode = acquireVsCodeApi();
    const state = {
      graph: undefined,
      mode: ${JSON.stringify(options.initialMode)},
      query: "",
      selectedNodeId: undefined
    };
    const defaultDepth = ${JSON.stringify(options.defaultDepth)};
    const elements = {
      analyzeWorkspace: document.getElementById("analyze-workspace"),
      analyzeCurrent: document.getElementById("analyze-current"),
      cancelAnalysis: document.getElementById("cancel-analysis"),
      exportJson: document.getElementById("export-json"),
      clearCache: document.getElementById("clear-cache"),
      openSource: document.getElementById("open-source"),
      showCallers: document.getElementById("show-callers"),
      showCallees: document.getElementById("show-callees"),
      search: document.getElementById("search"),
      status: document.getElementById("status"),
      files: document.getElementById("files"),
      symbols: document.getElementById("symbols"),
      edges: document.getElementById("edges"),
      list: document.getElementById("list"),
      detailTitle: document.getElementById("detail-title"),
      detailMeta: document.getElementById("detail-meta"),
      modeButtons: Array.from(document.querySelectorAll(".mode-button"))
    };

    elements.analyzeWorkspace.addEventListener("click", () => {
      vscode.postMessage({ type: "analysis/run", payload: { scope: "workspace" } });
    });

    elements.analyzeCurrent.addEventListener("click", () => {
      vscode.postMessage({ type: "analysis/run", payload: { scope: "currentFile" } });
    });

    elements.cancelAnalysis.addEventListener("click", () => {
      vscode.postMessage({ type: "analysis/cancel", payload: {} });
    });

    elements.exportJson.addEventListener("click", () => {
      vscode.postMessage({ type: "export/run", payload: { format: "json" } });
    });

    elements.clearCache.addEventListener("click", () => {
      vscode.postMessage({ type: "cache/clear", payload: {} });
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
        vscode.postMessage({ type: "graph/load", payload: { mode: state.mode, depth: defaultDepth } });
        render();
      });
    }

    window.addEventListener("message", (event) => {
      const message = event.data;

      if (message.type === "graph/loaded" || message.type === "graph/updated") {
        state.graph = message.payload;
        elements.status.textContent = "Loaded";
        render();
        return;
      }

      if (message.type === "analysis/status") {
        elements.status.textContent = message.payload.message;
        return;
      }

      if (message.type === "graph/cleared") {
        state.graph = undefined;
        state.selectedNodeId = undefined;
        render();
        return;
      }

      if (message.type === "view/modeChanged") {
        state.mode = message.payload.mode;
        render();
        return;
      }

      if (message.type === "error") {
        elements.status.textContent = message.payload.message;
      }
    });

    vscode.postMessage({ type: "graph/load", payload: { mode: state.mode, depth: defaultDepth } });

    function render() {
      renderModeButtons();
      renderStats();
      renderList();
      renderDetail();
      renderActions();
    }

    function renderModeButtons() {
      for (const button of elements.modeButtons) {
        button.classList.toggle("active", button.dataset.mode === state.mode);
      }
    }

    function renderStats() {
      const graph = state.graph;
      elements.files.textContent = graph ? String(graph.metadata.fileCount) : "0";
      elements.symbols.textContent = graph ? String(graph.metadata.symbolCount) : "0";
      elements.edges.textContent = graph ? String(graph.metadata.edgeCount) : "0";
    }

    function renderList() {
      elements.list.replaceChildren();

      for (const node of getVisibleNodes()) {
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
          state.selectedNodeId = node.id;
          render();
        });
        row.addEventListener("dblclick", () => {
          vscode.postMessage({ type: "node/openSource", payload: { nodeId: node.id } });
        });

        elements.list.append(row);
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
      elements.openSource.disabled = !hasSelection;
      elements.showCallers.disabled = !hasSelection;
      elements.showCallees.disabled = !hasSelection;
      elements.exportJson.disabled = !state.graph;
    }

    function postSelectedNode(type) {
      if (!state.selectedNodeId) {
        return;
      }

      vscode.postMessage({ type, payload: { nodeId: state.selectedNodeId } });
    }

    function postSelectedRelationship(direction) {
      if (!state.selectedNodeId) {
        return;
      }

      vscode.postMessage({
        type: "node/showRelationship",
        payload: {
          nodeId: state.selectedNodeId,
          direction
        }
      });
    }

    function getVisibleNodes() {
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
        .slice(0, 200);
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
  </script>
</body>
</html>`;
}
