/**
 * Sidebar Visual Explorer provider. It owns the WebviewView lifecycle, handles
 * GUI-originated requests, and keeps the sidebar synchronized with analysis data.
 */

import * as crypto from "node:crypto";
import * as vscode from "vscode";
import type { AnalysisBackend } from "../analyzer/core/analysisBackend";
import { InMemoryGraphStore } from "../graph/graphStore";
import { createTraversalSubgraph, traverseCallRelationship } from "../graph/graphTraversal";
import type {
  AnalysisStatusPayload,
  ExportRequest,
  ExtensionResponse,
  GraphViewMode,
  WebviewRequest
} from "../protocol/messages";
import { createContentHash } from "../shared/hash";
import type { ProjectGraph, SymbolNode } from "../shared/types";
import type { AnalysisCacheStore } from "../storage/cacheStore";
import type { ProjectAnalyzerConfig } from "../vscode/configuration";
import { getExplorerHtml } from "./webviewHtml";

/** Dependencies required by the sidebar explorer provider. */
export type ExplorerViewProviderDependencies = {
  context: vscode.ExtensionContext;
  analyzer: AnalysisBackend;
  cacheStore: AnalysisCacheStore;
  config: ProjectAnalyzerConfig;
};

/**
 * Registers and serves the Project Analyzer sidebar Webview.
 */
export class ExplorerViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "projectAnalyzer.explorerView";

  /** Current sidebar view instance, available only after VS Code resolves it. */
  private view: vscode.WebviewView | undefined;

  /** Active graph mode selected by the sidebar GUI. */
  private mode: GraphViewMode = "file";

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
      initialMode: this.mode,
      surface: "sidebar"
    });

    this.view.webview.onDidReceiveMessage((message: WebviewRequest) => {
      void this.handleMessage(message);
    });
  }

  /**
   * Sends a graph payload to the sidebar when it is visible.
   */
  public async publishGraph(graph: ProjectGraph): Promise<void> {
    await this.postMessage({ type: "graph/loaded", payload: graph });
  }

  /**
   * Updates the active explorer mode and notifies the GUI when it is visible.
   */
  public async setMode(mode: GraphViewMode): Promise<void> {
    this.mode = mode;
    await this.postMessage({ type: "view/modeChanged", payload: { mode } });
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
        await this.setMode(message.payload.mode);
        await this.postLatestGraph();
        break;
      case "node/openSource":
        await this.openSourceNode(message.payload.nodeId);
        break;
      case "node/showRelationship":
        await this.showNodeRelationship(message.payload.nodeId, message.payload.direction);
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
   * Handles caller/callee exploration requests from the selected GUI node.
   */
  private async showNodeRelationship(
    nodeId: string,
    direction: "callers" | "callees"
  ): Promise<void> {
    const graph = await this.dependencies.cacheStore.getLatestGraph();

    if (!graph) {
      await this.postStatus("idle", "Analyze before exploring call relationships");
      return;
    }

    const node = graph.nodes.find((candidate) => candidate.id === nodeId);

    if (!node) {
      await this.postStatus("idle", "Selected node is not available");
      return;
    }

    const relationshipDepth = Math.max(0, Math.floor(this.dependencies.config.defaultDepth));
    const store = new InMemoryGraphStore(graph);
    const result = traverseCallRelationship(store, {
      rootNodeId: nodeId,
      direction,
      maxDepth: relationshipDepth
    });
    const subgraph = createTraversalSubgraph(graph, result);
    const relationshipLabel = direction === "callers" ? "callers" : "callees";
    const nodeLabel = getNodeDisplayName(node);

    await this.setMode("call");
    await this.postMessage({ type: "graph/updated", payload: subgraph });

    if (result.edges.length === 0) {
      await this.postStatus("idle", `No ${relationshipLabel} found for ${nodeLabel}`);
      return;
    }

    await this.postStatus(
      "complete",
      `Showing ${relationshipLabel} for ${nodeLabel} (${formatCount(result.edges.length, "call edge")}, depth ${relationshipDepth})`
    );
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

    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file("project-analyzer-graph.json"),
      filters: {
        JSON: ["json"]
      },
      saveLabel: "Export Graph"
    });

    if (!uri) {
      await this.postStatus("idle", "Export canceled");
      return;
    }

    const serializedGraph = JSON.stringify(graph, null, 2);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(serializedGraph, "utf8"));
    await this.postStatus("complete", `Exported ${graph.nodes.length} nodes`);
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

/**
 * Opens a graph node's source range in the active editor group.
 */
async function openNodeInEditor(node: SymbolNode): Promise<void> {
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(node.filePath));
  const editor = await vscode.window.showTextDocument(document);
  const position = new vscode.Position(node.selectionRange.startLine, node.selectionRange.startCharacter);
  const range = new vscode.Range(
    position,
    new vscode.Position(node.selectionRange.endLine, node.selectionRange.endCharacter)
  );

  editor.selection = new vscode.Selection(range.start, range.end);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

/**
 * Creates a nonce for Webview script CSP.
 */
function createNonce(): string {
  return crypto.randomBytes(16).toString("base64");
}

/**
 * Returns the shortest stable display label for status messages.
 */
function getNodeDisplayName(node: SymbolNode): string {
  return node.name || node.qualifiedName || node.id;
}

/**
 * Formats counted nouns for compact sidebar status messages.
 */
function formatCount(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
