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
  WebviewLogRequest,
  WebviewRequest
} from "../protocol/messages";
import type { ProjectAnalyzerLogger } from "../observability/logger";
import { createContentHash } from "../shared/hash";
import type { ProjectGraph } from "../shared/types";
import type { AnalysisCacheScope, AnalysisCacheStore } from "../storage/cacheStore";
import type { ProjectAnalyzerConfig } from "../vscode/configuration";
import {
  createCurrentFileAnalysisCacheKey,
  createWorkspaceAnalysisCacheKey
} from "../vscode/workspaceFingerprint";
import type { ExplorerGraphPanelProvider } from "./explorerGraphPanelProvider";
import { projectGraphForView, summarizeFileImportGraph, summarizeProjectedGraph } from "./graphProjection";
import { getExplorerHtml } from "./webviewHtml";
import { createNonce, exportGraphToJson, openNodeInEditor } from "./webviewHostActions";

/** Dependencies required by the sidebar explorer provider. */
export type ExplorerViewProviderDependencies = {
  context: vscode.ExtensionContext;
  analyzer: AnalysisBackend;
  cacheStore: AnalysisCacheStore;
  config: ProjectAnalyzerConfig;
  graphPanelProvider: ExplorerGraphPanelProvider;
  logger: ProjectAnalyzerLogger;
};

/** Cached workspace graph selected for reuse before running analysis. */
type WorkspaceCacheMatch = {
  graph: ProjectGraph;
  kind: "exact" | "latest";
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
    const sidebarGraph = projectGraphForView(graph, "file", { preserveMetadata: true });
    this.dependencies.logger.info("sidebar.publishGraph.projected", {
      fileImportGraph: summarizeFileImportGraph(graph),
      projected: summarizeProjectedGraph(sidebarGraph)
    });
    await this.postMessage({ type: "graph/loaded", payload: sidebarGraph });
    await this.dependencies.graphPanelProvider.publishGraph(graph);
  }

  /**
   * Handles typed Webview requests from the sidebar GUI.
   */
  private async handleMessage(message: WebviewRequest): Promise<void> {
    this.dependencies.logger.debug("sidebar.message", { type: message.type });

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
      case "graph/showWorkspaceScope":
        await this.showWorkspaceScope();
        break;
      case "graph/focusNode":
        await this.focusGraphNode(message.payload.nodeId);
        break;
      case "node/openSource":
        await this.openSourceNode(message.payload.nodeId);
        break;
      case "node/showRelationship":
        await this.dependencies.graphPanelProvider.openGraph();
        break;
      case "export/run":
        await this.exportGraph(message.payload);
        break;
      case "telemetry/log":
        this.logWebviewMessage(message.payload);
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
    this.dependencies.logger.info("sidebar.ready", {
      autoAnalyze: this.dependencies.config.autoAnalyze
    });
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
      this.dependencies.logger.warn("sidebar.workspaceAnalysis.alreadyRunning");
      await this.postStatus("running", "Analysis already running");
      return;
    }

    const workspaceCacheKey = await this.createWorkspaceCacheKey();
    const cachedWorkspace = await this.getReusableWorkspaceGraph(workspaceCacheKey);

    if (cachedWorkspace) {
      this.dependencies.logger.info("sidebar.workspaceAnalysis.cacheHit", {
        cacheKind: cachedWorkspace.kind,
        hasFingerprint: Boolean(workspaceCacheKey)
      });
      if (cachedWorkspace.kind === "exact" && workspaceCacheKey) {
        await this.dependencies.cacheStore.setActiveGraph("workspace", workspaceCacheKey);
      }
      await this.publishGraph(cachedWorkspace.graph);
      await this.dependencies.graphPanelProvider.openGraph(cachedWorkspace.graph);
      await this.postStatus(
        "complete",
        `Loaded cached workspace graph, ${cachedWorkspace.graph.nodes.length} nodes`
      );
      return;
    }

    this.analysisRunning = true;
    this.dependencies.logger.info("sidebar.workspaceAnalysis.start", {
      cacheEnabled: this.dependencies.config.cache.enabled,
      hasFingerprint: Boolean(workspaceCacheKey)
    });
    await this.postStatus("running", "Analyzing workspace");

    try {
      const result = await this.dependencies.analyzer.analyzeWorkspace();
      this.dependencies.logger.info("sidebar.workspaceAnalysis.complete", {
        edges: result.graph.edges.length,
        files: result.graph.metadata.fileCount,
        nodes: result.graph.nodes.length
      });
      await this.saveGraphToCache("workspace", workspaceCacheKey ?? "workspace", result.graph, "Workspace analysis");
      await this.publishGraph(result.graph);
      await this.dependencies.graphPanelProvider.openGraph(result.graph);
      await this.postStatus(
        "complete",
        `Indexed ${result.graph.metadata.fileCount} files, ${result.graph.nodes.length} nodes`
      );
    } catch (error) {
      this.dependencies.logger.error("sidebar.workspaceAnalysis.failed", {
        error: error instanceof Error ? error.stack ?? error.message : String(error)
      });
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
      this.dependencies.logger.warn("sidebar.currentFileAnalysis.alreadyRunning");
      await this.postStatus("running", "Analysis already running");
      return;
    }

    const editor = vscode.window.activeTextEditor;

    if (!editor) {
      await this.postStatus("idle", "Open a source file first");
      return;
    }

    this.analysisRunning = true;
    this.dependencies.logger.info("sidebar.currentFileAnalysis.start", {
      fileName: editor.document.fileName,
      languageId: editor.document.languageId
    });
    await this.postStatus("running", "Analyzing current file");

    try {
      const document = editor.document;
      const content = document.getText();
      const contentHash = createContentHash(content);
      const sourceFile = {
        path: document.uri.fsPath,
        languageId: document.languageId,
        content,
        sizeBytes: Buffer.byteLength(content, "utf8"),
        contentHash
      };
      const workspaceRoot = this.getWorkspaceRoot() ?? "";
      const currentFileCacheKey = createCurrentFileAnalysisCacheKey({
        workspaceRoot,
        path: sourceFile.path,
        languageId: sourceFile.languageId,
        contentHash
      });
      const cachedGraph = await this.getCachedGraph("currentFile", currentFileCacheKey);

      if (cachedGraph) {
        this.dependencies.logger.info("sidebar.currentFileAnalysis.cacheHit", {
          fileName: document.fileName
        });
        await this.dependencies.cacheStore.setActiveGraph("currentFile", currentFileCacheKey);
        await this.publishGraph(cachedGraph);
        await this.dependencies.graphPanelProvider.openGraph(cachedGraph);
        await this.postStatus("complete", `Loaded cached ${document.fileName}, ${cachedGraph.nodes.length} nodes`);
        return;
      }

      const result = await this.dependencies.analyzer.analyzeFile(sourceFile);

      this.dependencies.logger.info("sidebar.currentFileAnalysis.complete", {
        edges: result.graph.edges.length,
        nodes: result.graph.nodes.length
      });
      await this.saveGraphToCache("currentFile", currentFileCacheKey, result.graph, document.fileName);
      await this.publishGraph(result.graph);
      await this.dependencies.graphPanelProvider.openGraph(result.graph);
      await this.postStatus("complete", `Analyzed ${document.fileName}, ${result.graph.nodes.length} nodes`);
    } catch (error) {
      this.dependencies.logger.error("sidebar.currentFileAnalysis.failed", {
        error: error instanceof Error ? error.stack ?? error.message : String(error)
      });
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
   * Restores the latest valid workspace graph after the user has viewed a
   * current-file scoped graph. If the workspace cache is stale or absent, this
   * falls back to a normal workspace analysis.
   */
  private async showWorkspaceScope(): Promise<void> {
    const workspaceCacheKey = await this.createWorkspaceCacheKey();
    const cachedWorkspace = await this.getReusableWorkspaceGraph(workspaceCacheKey);

    if (cachedWorkspace) {
      if (cachedWorkspace.kind === "exact" && workspaceCacheKey) {
        await this.dependencies.cacheStore.setActiveGraph("workspace", workspaceCacheKey);
      }
      await this.publishGraph(cachedWorkspace.graph);
      await this.postStatus(
        "complete",
        `Workspace scope restored, ${cachedWorkspace.graph.nodes.length} nodes`
      );
      return;
    }

    await this.postStatus("running", "Workspace cache missing; analyzing workspace");
    await this.runWorkspaceAnalysis();
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
    this.dependencies.logger.info("sidebar.openGraphPanel", { hasGraph: Boolean(graph) });

    if (!graph) {
      await this.dependencies.graphPanelProvider.openGraph();
      await this.postStatus("idle", "Graph browser opened; analyze to load graph");
      return;
    }

    await this.dependencies.graphPanelProvider.openGraph(graph);
    await this.postStatus("complete", "Graph browser opened");
  }

  /**
   * Opens the graph browser and reveals a node selected from the sidebar tree.
   */
  private async focusGraphNode(nodeId: string): Promise<void> {
    const graph = await this.dependencies.cacheStore.getLatestGraph();

    if (!graph) {
      await this.postStatus("idle", "Analyze before focusing graph nodes");
      return;
    }

    await this.dependencies.graphPanelProvider.focusNode(nodeId, graph);
    await this.postStatus("complete", "Graph browser focused");
  }

  /**
   * Opens the source location represented by a graph node.
   */
  private async openSourceNode(nodeId: string): Promise<void> {
    const graph = await this.dependencies.cacheStore.getLatestGraph();
    const node = graph?.nodes.find((candidate) => candidate.id === nodeId);

    if (!node) {
      await this.postStatus("idle", "Node is not available");
      return;
    }

    await openNodeInEditor(node);
  }

  /**
   * Publishes the latest cached graph if one exists.
   */
  private async postLatestGraph(): Promise<void> {
    const graph = await this.dependencies.cacheStore.getLatestGraph();
    this.dependencies.logger.debug("sidebar.postLatestGraph", { hasGraph: Boolean(graph) });

    if (graph) {
      await this.publishGraph(graph);
      return;
    }

    await this.postStatus("idle", "No graph loaded");
  }

  /** Returns a cached graph only when persistent cache reuse is enabled. */
  private async getCachedGraph(
    scope: AnalysisCacheScope,
    cacheKey: string
  ): Promise<ProjectGraph | undefined> {
    if (!this.dependencies.config.cache.enabled) {
      return undefined;
    }

    return this.dependencies.cacheStore.getGraph(scope, cacheKey);
  }

  /** Returns exact workspace cache first, then the newest saved workspace graph. */
  private async getReusableWorkspaceGraph(cacheKey: string | undefined): Promise<WorkspaceCacheMatch | undefined> {
    if (!this.dependencies.config.cache.enabled) {
      return undefined;
    }

    if (cacheKey) {
      const exactGraph = await this.dependencies.cacheStore.getGraph("workspace", cacheKey);

      if (exactGraph) {
        return { graph: exactGraph, kind: "exact" };
      }

      this.dependencies.logger.info("sidebar.workspaceAnalysis.cacheExactMiss", {
        cacheKeyPrefix: cacheKey.slice(0, 12)
      });
    }

    const latestGraph = await this.dependencies.cacheStore.getLatestGraphForScope("workspace");

    if (!latestGraph) {
      this.dependencies.logger.info("sidebar.workspaceAnalysis.cacheMiss", {
        hasFingerprint: Boolean(cacheKey)
      });
      return undefined;
    }

    this.dependencies.logger.info("sidebar.workspaceAnalysis.cacheLatestFallback", {
      hasFingerprint: Boolean(cacheKey),
      nodes: latestGraph.nodes.length
    });
    return { graph: latestGraph, kind: "latest" };
  }

  /** Saves a graph under a scoped cache key and makes it active for the UI. */
  private async saveGraphToCache(
    scope: AnalysisCacheScope,
    cacheKey: string,
    graph: ProjectGraph,
    label: string
  ): Promise<void> {
    await this.dependencies.cacheStore.saveGraph({
      scope,
      cacheKey,
      graph,
      label,
      savedAt: new Date().toISOString()
    });
  }

  /** Creates the current workspace cache key, returning undefined on failure. */
  private async createWorkspaceCacheKey(): Promise<string | undefined> {
    const workspaceRoot = this.getWorkspaceRoot();

    if (!workspaceRoot || !this.dependencies.config.cache.enabled) {
      return undefined;
    }

    try {
      return await createWorkspaceAnalysisCacheKey(workspaceRoot, this.dependencies.config);
    } catch (error) {
      this.dependencies.logger.warn("sidebar.workspaceCacheKey.failed", {
        error: error instanceof Error ? error.message : String(error)
      });
      return undefined;
    }
  }

  /** Returns the first VS Code workspace root used by analyzer adapters. */
  private getWorkspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
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
      this.dependencies.logger.debug("sidebar.postMessage.skipped", {
        hasView: Boolean(this.view),
        ready: this.webviewReady,
        type: message.type
      });
      return;
    }

    this.dependencies.logger.debug("sidebar.postMessage", { type: message.type });
    await this.view.webview.postMessage(message);
  }

  /** Routes browser-side diagnostics into the extension output channel. */
  private logWebviewMessage(payload: WebviewLogRequest): void {
    this.dependencies.logger[payload.level](`webview.${payload.source}.${payload.message}`, payload.fields);
  }
}
