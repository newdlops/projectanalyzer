/**
 * Sidebar Visual Explorer provider. It owns the WebviewView lifecycle, handles
 * GUI-originated requests, and keeps the sidebar synchronized with analysis data.
 */

import * as crypto from "node:crypto";
import * as vscode from "vscode";
import type { AnalyzerPipeline } from "../analyzer/core/analyzerPipeline";
import type {
  AnalysisStatusPayload,
  ExtensionResponse,
  GraphViewMode,
  WebviewRequest
} from "../protocol/messages";
import type { ProjectGraph, SymbolNode } from "../shared/types";
import type { AnalysisCacheStore } from "../storage/cacheStore";
import type { ProjectAnalyzerConfig } from "../vscode/configuration";
import { getExplorerHtml } from "./webviewHtml";

/** Dependencies required by the sidebar explorer provider. */
export type ExplorerViewProviderDependencies = {
  context: vscode.ExtensionContext;
  analyzer: AnalyzerPipeline;
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

  /** Active graph mode selected by commands or the GUI. */
  private mode: GraphViewMode = "file";

  /** Guards workspace analysis so repeated GUI clicks do not overlap scans. */
  private analysisRunning = false;

  public constructor(private readonly dependencies: ExplorerViewProviderDependencies) {}

  /**
   * Resolves the sidebar Webview when the user opens the Project Analyzer view.
   */
  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
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

    if (this.dependencies.config.autoAnalyze) {
      void this.runWorkspaceAnalysis();
      return;
    }

    void this.postLatestGraph();
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
      case "analysis/run":
        await this.runWorkspaceAnalysis();
        break;
      case "graph/load":
        await this.setMode(message.payload.mode);
        await this.postLatestGraph();
        break;
      case "node/openSource":
        await this.openSourceNode(message.payload.nodeId);
        break;
      default:
        break;
    }
  }

  /**
   * Runs workspace analysis and publishes the resulting graph to the sidebar.
   */
  private async runWorkspaceAnalysis(): Promise<void> {
    if (this.analysisRunning) {
      return;
    }

    this.analysisRunning = true;
    await this.postStatus("running", "Analyzing workspace");

    try {
      const result = await this.dependencies.analyzer.analyzeWorkspace();
      await this.dependencies.cacheStore.saveLatestGraph(result.graph);
      await this.postStatus("complete", `Indexed ${result.graph.metadata.fileCount} files`);
      await this.publishGraph(result.graph);
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
    if (!this.view) {
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
