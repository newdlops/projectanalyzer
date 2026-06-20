/**
 * Sidebar control provider. It owns the Activity Bar WebviewView lifecycle and
 * opens the editor-tab graph browser for visual exploration.
 */

import * as vscode from "vscode";
import type { AnalysisBackend } from "../analyzer/core/analysisBackend";
import type {
  AnalysisStatusPayload,
  ExportRequest,
  ExtensionResponse,
  WebviewRequest
} from "../protocol/messages";
import { createContentHash } from "../shared/hash";
import type { ProjectGraph } from "../shared/types";
import type { AnalysisCacheStore } from "../storage/cacheStore";
import type { ProjectAnalyzerConfig } from "../vscode/configuration";
import type { ExplorerGraphPanelProvider } from "./explorerGraphPanelProvider";
import { getExplorerHtml } from "./webviewHtml";
import { createNonce, exportGraphToJson } from "./webviewHostActions";

/** Dependencies required by the sidebar explorer provider. */
export type ExplorerViewProviderDependencies = {
  context: vscode.ExtensionContext;
  analyzer: AnalysisBackend;
  cacheStore: AnalysisCacheStore;
  config: ProjectAnalyzerConfig;
  graphPanelProvider: ExplorerGraphPanelProvider;
};

/**
 * Registers and serves the Project Analyzer sidebar Webview.
 */
export class ExplorerViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "projectAnalyzer.explorerView";

  /** Current sidebar view instance, available only after VS Code resolves it. */
  private view: vscode.WebviewView | undefined;

  /** Guards workspace analysis so repeated GUI clicks do not overlap scans. */
  private analysisRunning = false;

  /** Tracks whether the Webview script has loaded and can receive responses. */
  private webviewReady = false;

  public constructor(private readonly dependencies: ExplorerViewProviderDependencies) {}

  /**
   * Resolves the sidebar Webview when the user opens the Project Analyzer view.
   */
  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    this.webviewReady = false;
    this.view.webview.options = {
      enableScripts: true
    };
    this.view.webview.html = getExplorerHtml({
      webview: this.view.webview,
      extensionUri: this.dependencies.context.extensionUri,
      nonce: createNonce(),
      defaultDepth: this.dependencies.config.defaultDepth,
      initialMode: "file",
      surface: "sidebar"
    });

    this.view.webview.onDidReceiveMessage((message: WebviewRequest) => {
      void this.handleMessage(message);
    });
  }

  /**
   * Sends graph availability to the sidebar and any open graph panel.
   */
  public async publishGraph(graph: ProjectGraph): Promise<void> {
    await this.postMessage({ type: "graph/loaded", payload: graph });
    await this.dependencies.graphPanelProvider.publishGraph(graph);
  }

  /**
   * Handles typed Webview requests from the sidebar GUI.
   */
  private async handleMessage(message: WebviewRequest): Promise<void> {
    switch (message.type) {
      case "ui/ready":
        await this.handleWebviewReady();
        break;
      case "analysis/run":
        await this.runAnalysis(message.payload.scope);
        break;
      case "analysis/cancel":
        await this.requestAnalysisCancellation();
        break;
      case "cache/clear":
        await this.clearCache();
        break;
      case "graph/load":
        await this.postLatestGraph();
        break;
      case "graph/openPanel":
        await this.openGraphPanel();
        break;
      case "node/openSource":
        await this.dependencies.graphPanelProvider.openGraph();
        break;
      case "node/showRelationship":
        await this.dependencies.graphPanelProvider.openGraph();
        break;
      case "export/run":
        await this.exportGraph(message.payload);
        break;
      default:
        break;
    }
  }

  /**
   * Handles the Webview readiness handshake before sending graph or status data.
   */
  private async handleWebviewReady(): Promise<void> {
    this.webviewReady = true;
    await this.postMessage({ type: "ui/ready", payload: {} });

    if (this.dependencies.config.autoAnalyze) {
      await this.runWorkspaceAnalysis();
      return;
    }

    await this.postLatestGraph();
  }

  /**
   * Routes a GUI analysis request to the requested analysis scope.
   */
  private async runAnalysis(scope: "workspace" | "currentFile"): Promise<void> {
    if (scope === "currentFile") {
      await this.runCurrentFileAnalysis();
      return;
    }

    await this.runWorkspaceAnalysis();
  }

  /**
   * Runs workspace analysis and publishes the resulting graph to the sidebar.
   */
  private async runWorkspaceAnalysis(): Promise<void> {
    if (this.analysisRunning) {
      await this.postStatus("running", "Analysis already running");
      return;
    }

    this.analysisRunning = true;
    await this.postStatus("running", "Analyzing workspace");

    try {
      const result = await this.dependencies.analyzer.analyzeWorkspace();
      await this.dependencies.cacheStore.saveLatestGraph(result.graph);
      await this.publishGraph(result.graph);
      await this.dependencies.graphPanelProvider.openGraph(result.graph);
      await this.postStatus(
        "complete",
        `Indexed ${result.graph.metadata.fileCount} files, ${result.graph.nodes.length} nodes`
      );
    } catch (error) {
      await this.postStatus("failed", "Analysis failed");
      await this.postMessage({
        type: "error",
        payload: {
          code: "analysis.failed",
          message: error instanceof Error ? error.message : "Unknown analysis failure"
        }
      });
    } finally {
      this.analysisRunning = false;
    }
  }

  /**
   * Runs analysis for the active editor document.
   */
  private async runCurrentFileAnalysis(): Promise<void> {
    if (this.analysisRunning) {
      await this.postStatus("running", "Analysis already running");
      return;
    }

    const editor = vscode.window.activeTextEditor;

    if (!editor) {
      await this.postStatus("idle", "Open a source file first");
      return;
    }

    this.analysisRunning = true;
    await this.postStatus("running", "Analyzing current file");

    try {
      const document = editor.document;
      const content = document.getText();
      const result = await this.dependencies.analyzer.analyzeFile({
        path: document.uri.fsPath,
        languageId: document.languageId,
        content,
        sizeBytes: Buffer.byteLength(content, "utf8"),
        contentHash: createContentHash(content)
      });

      await this.dependencies.cacheStore.saveLatestGraph(result.graph);
      await this.publishGraph(result.graph);
      await this.dependencies.graphPanelProvider.openGraph(result.graph);
      await this.postStatus("complete", `Analyzed ${document.fileName}, ${result.graph.nodes.length} nodes`);
    } catch (error) {
      await this.postStatus("failed", "Current-file analysis failed");
      await this.postMessage({
        type: "error",
        payload: {
          code: "analysis.currentFileFailed",
          message: error instanceof Error ? error.message : "Unknown current-file analysis failure"
        }
      });
    } finally {
      this.analysisRunning = false;
    }
  }

  /**
   * Clears cached graph data and tells the GUI to reset its state.
   */
  private async clearCache(): Promise<void> {
    await this.dependencies.cacheStore.clear();
    await this.postMessage({ type: "graph/cleared", payload: {} });
    await this.dependencies.graphPanelProvider.clearGraph();
    await this.postStatus("idle", "Cache cleared");
  }

  /**
   * Handles cancellation requests until cancellation tokens are wired into analysis.
   */
  private async requestAnalysisCancellation(): Promise<void> {
    if (!this.analysisRunning) {
      await this.postStatus("idle", "No analysis is running");
      return;
    }

    await this.postStatus("running", "Cancellation will stop future analyzer workers");
  }

  /**
   * Exports the latest graph to a user-selected file.
   */
  private async exportGraph(request: ExportRequest): Promise<void> {
    const graph = await this.dependencies.cacheStore.getLatestGraph();

    if (!graph) {
      await this.postStatus("idle", "Analyze before exporting");
      return;
    }

    if (request.format !== "json") {
      await this.postStatus("idle", `${request.format.toUpperCase()} export is not implemented yet`);
      return;
    }

    const message = await exportGraphToJson(graph);
    await this.postStatus(message ? "complete" : "idle", message ?? "Export canceled");
  }

  /**
   * Opens the latest graph in a separate editor-tab WebviewPanel.
   */
  private async openGraphPanel(): Promise<void> {
    const graph = await this.dependencies.cacheStore.getLatestGraph();

    if (!graph) {
      await this.dependencies.graphPanelProvider.openGraph();
      await this.postStatus("idle", "Graph browser opened; analyze to load graph");
      return;
    }

    await this.dependencies.graphPanelProvider.openGraph(graph);
    await this.postStatus("complete", "Graph browser opened");
  }

  /**
   * Publishes the latest cached graph if one exists.
   */
  private async postLatestGraph(): Promise<void> {
    const graph = await this.dependencies.cacheStore.getLatestGraph();

    if (graph) {
      await this.publishGraph(graph);
      return;
    }

    await this.postStatus("idle", "No graph loaded");
  }

  /**
   * Posts an analysis status update to the visible sidebar.
   */
  private async postStatus(
    state: AnalysisStatusPayload["state"],
    message: string
  ): Promise<void> {
    await this.postMessage({ type: "analysis/status", payload: { state, message } });
  }

  /**
   * Posts a typed response to the Webview when it has been resolved.
   */
  private async postMessage(message: ExtensionResponse): Promise<void> {
    if (!this.view || (!this.webviewReady && message.type !== "ui/ready")) {
      return;
    }

    await this.view.webview.postMessage(message);
  }
}
