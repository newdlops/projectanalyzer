/**
 * Visual Explorer Webview panel. This module owns panel lifecycle and message
 * bridging while graph data remains in extension services and protocol modules.
 */

import * as crypto from "node:crypto";
import * as vscode from "vscode";
import type { AnalysisCacheStore } from "../storage/cacheStore";
import type { WebviewRequest } from "../protocol/messages";
import { getExplorerHtml } from "./webviewHtml";

/** Dependencies required by the Webview panel. */
export type ExplorerPanelDependencies = {
  context: vscode.ExtensionContext;
  cacheStore: AnalysisCacheStore;
};

/**
 * Manages a singleton Visual Explorer panel.
 */
export class ExplorerPanel {
  /** Current panel instance so repeated commands reveal instead of duplicating UI. */
  private panel: vscode.WebviewPanel | undefined;

  public constructor(private readonly dependencies: ExplorerPanelDependencies) {}

  /**
   * Opens the explorer panel or reveals the existing instance.
   */
  public open(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "projectAnalyzer.explorer",
      "Project Analyzer",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    this.panel.webview.html = getExplorerHtml({
      webview: this.panel.webview,
      extensionUri: this.dependencies.context.extensionUri,
      nonce: createNonce()
    });

    this.panel.webview.onDidReceiveMessage((message: WebviewRequest) => {
      void this.handleMessage(message);
    });

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });
  }

  /**
   * Handles typed Webview requests. The scaffold only returns the latest graph
   * and leaves richer protocol behavior for the Webview milestone.
   */
  private async handleMessage(message: WebviewRequest): Promise<void> {
    if (!this.panel) {
      return;
    }

    if (message.type === "graph/load") {
      const graph = await this.dependencies.cacheStore.getLatestGraph();

      if (graph) {
        await this.panel.webview.postMessage({ type: "graph/loaded", payload: graph });
      }
    }
  }
}

/**
 * Creates a nonce for Webview script CSP.
 */
function createNonce(): string {
  return crypto.randomBytes(16).toString("base64");
}
