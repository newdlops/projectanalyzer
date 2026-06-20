/**
 * Browser-side script for the Activity Bar sidebar control surface. The sidebar
 * starts analysis and opens the graph browser tab, but does not render graphs.
 */

/**
 * Builds the sidebar control script.
 */
export function getExplorerSidebarScript(): string {
  return /* js */ `
    const vscode = acquireVsCodeApi();
    const state = {
      graph: undefined,
      analysisState: "idle"
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
      edges: document.getElementById("edges")
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
      renderActions();
    }

    function renderStats() {
      const graph = state.graph;
      elements.files.textContent = graph ? String(graph.metadata.fileCount) : "0";
      elements.symbols.textContent = graph ? String(graph.metadata.symbolCount) : "0";
      elements.edges.textContent = graph ? String(graph.metadata.edgeCount) : "0";
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
  `;
}
