/**
 * Extension Host boundary for the dedicated Function Visualizer editor tab. It
 * owns an isolated graph snapshot, token registries, and serialized root loads.
 */

import * as vscode from "vscode";
import { CodeFlowInsightCache } from "../../application/codeFlow";
import type { CodeFlowSelectSourceRequest } from "../../protocol/codeFlow";
import type { ExtensionResponse, WebviewRequest } from "../../protocol/messages";
import { validateWebviewRequest } from "../../protocol/webviewRequestValidation";
import type { ProjectAnalyzerLogger } from "../../observability/logger";
import type { ProjectGraph, SymbolNode } from "../../shared/types";
import type { ProjectAnalyzerConfig } from "../../vscode/configuration";
import {
  CodeFlowEvidenceTokenRegistry,
  CodeFlowHostDelivery
} from "../codeFlow";
import { WebviewGraphDelivery } from "../sidebarGraphDelivery";
import { SourceNodeTokenRegistry } from "../sourceNavigation";
import {
  createNonce,
  openSourceLocationInEditor,
  readSourceText
} from "../webviewHostActions";
import { getFunctionVisualizerHtml } from "./functionVisualizerHtml";

/** VS Code collaborators and bounded projection configuration for the panel. */
export type FunctionVisualizerPanelProviderDependencies = {
  config: ProjectAnalyzerConfig;
  logger: ProjectAnalyzerLogger;
};

/** One latest-wins root visualization waiting for a ready Webview. */
type PendingFunctionVisualization = {
  graph: ProjectGraph;
  nodeId: string;
  sourceText?: string;
};

/** Creates and synchronizes one reusable Function Visualizer editor tab. */
export class FunctionVisualizerPanelProvider {
  public static readonly viewType = "projectAnalyzer.functionVisualizer";

  /** Current reusable editor tab, absent before first visualization. */
  private panel: vscode.WebviewPanel | undefined;

  /** Prevents payload delivery before the inline browser program is listening. */
  private webviewReady = false;

  /** Latest explicit root request replaces any root not yet delivered. */
  private pendingVisualization: PendingFunctionVisualization | undefined;

  /** Serializes analysis delivery when users request roots in quick succession. */
  private deliveryQueue: Promise<void> = Promise.resolve();

  /** Panel-local snapshot authority is independent from the Activity Bar view. */
  private readonly graphDelivery = new WebviewGraphDelivery();

  /** Cached graph insights are reused while drilling through the same snapshot. */
  private readonly insightCache = new CodeFlowInsightCache();

  /** Opaque callable and statement tokens expire with the panel snapshot. */
  private readonly sourceNodeTokens = new SourceNodeTokenRegistry();
  private readonly evidenceTokens = new CodeFlowEvidenceTokenRegistry();

  /** Shared application delivery builds function details for this panel only. */
  private readonly codeFlowDelivery: CodeFlowHostDelivery;

  public constructor(
    private readonly dependencies: FunctionVisualizerPanelProviderDependencies
  ) {
    this.codeFlowDelivery = new CodeFlowHostDelivery({
      graphDelivery: this.graphDelivery,
      insightCache: this.insightCache,
      sourceNodeTokens: this.sourceNodeTokens,
      evidenceTokens: this.evidenceTokens,
      logger: dependencies.logger,
      projectionOptions: dependencies.config.codeFlow,
      readSourceText,
      openEvidenceLocation: ({ filePath, range }) => openSourceLocationInEditor(filePath, range),
      postMessage: (message) => this.postMessage(message)
    });
  }

  /** Opens a root callable in a normal editor tab, preserving dirty source text. */
  public async openFunction(
    graph: ProjectGraph,
    nodeId: string,
    sourceText?: string
  ): Promise<void> {
    const node = graph.nodes.find((candidate) => candidate.id === nodeId);
    if (!node || !isConcreteCallable(node)) {
      throw new Error("The selected graph node is not a concrete callable.");
    }

    this.pendingVisualization = { graph, nodeId, sourceText };
    this.ensurePanel();
    this.panel?.reveal(vscode.ViewColumn.Active, false);
    if (this.panel) {
      this.panel.title = createPanelTitle(node);
    }
    if (this.webviewReady) {
      await this.enqueuePendingVisualization();
    }
  }

  /** Creates the WebviewPanel once and binds its typed message lifecycle. */
  private ensurePanel(): void {
    if (this.panel) {
      return;
    }
    this.panel = vscode.window.createWebviewPanel(
      FunctionVisualizerPanelProvider.viewType,
      "Function Visualizer",
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    this.webviewReady = false;
    this.panel.webview.html = getFunctionVisualizerHtml({
      webview: this.panel.webview,
      nonce: createNonce()
    });
    this.panel.webview.onDidReceiveMessage((message: unknown) => {
      const validation = validateWebviewRequest(message);
      if (!validation.ok) {
        this.dependencies.logger.warn("functionVisualizer.message.rejected", {
          reason: validation.reason,
          receivedType: validation.receivedType
        });
        return;
      }
      void this.handleMessage(validation.value);
    });
    this.panel.onDidDispose(() => this.disposePanelState());
  }

  /** Handles only the shared requests meaningful inside this focused panel. */
  private async handleMessage(message: WebviewRequest): Promise<void> {
    this.dependencies.logger.debug("functionVisualizer.message", { type: message.type });
    switch (message.type) {
      case "ui/ready":
        this.webviewReady = true;
        await this.postMessage({ type: "ui/ready", payload: {} });
        await this.enqueuePendingVisualization();
        break;
      case "codeFlow/selectSource":
        await this.openChildFunction(message.payload);
        break;
      case "codeFlow/openEvidence":
        await this.codeFlowDelivery.openEvidence(message.payload);
        break;
      default:
        break;
    }
  }

  /** Publishes one token-approved direct callee into the current browser trail. */
  private async openChildFunction(request: CodeFlowSelectSourceRequest): Promise<void> {
    await this.codeFlowDelivery.publishSourceContext(request);
  }

  /** Adds pending-root delivery to a non-recursive serialized promise queue. */
  private enqueuePendingVisualization(): Promise<void> {
    const scheduled = this.deliveryQueue.then(() => this.publishPendingVisualization());
    this.deliveryQueue = scheduled.catch((error: unknown) => {
      this.dependencies.logger.error("functionVisualizer.delivery.failed", {
        error: error instanceof Error ? error.stack ?? error.message : String(error)
      });
    });
    return this.deliveryQueue;
  }

  /** Activates one graph session, resets browser history, then publishes its root. */
  private async publishPendingVisualization(): Promise<void> {
    if (!this.panel || !this.webviewReady || !this.pendingVisualization) {
      return;
    }
    const request = this.pendingVisualization;
    this.pendingVisualization = undefined;
    // Every explicit root is a new browser session, even when it reuses the
    // exact graph object. This makes late child responses stale by construction.
    this.graphDelivery.clear();
    const activation = this.graphDelivery.activate(request.graph);
    this.insightCache.clear();
    this.sourceNodeTokens.activate(activation.snapshot.version, request.graph);
    this.evidenceTokens.activate(activation.snapshot.version, request.graph);
    const node = request.graph.nodes.find((candidate) => candidate.id === request.nodeId);
    const rootToken = this.sourceNodeTokens.createToken(request.nodeId);
    if (!node || !rootToken) {
      throw new Error("The function is no longer available in the active visualization snapshot.");
    }

    await this.postMessage({
      type: "functionVisualizer/sessionLoaded",
      payload: {
        graphVersion: activation.snapshot.version,
        root: {
          sourceToken: rootToken,
          label: node.qualifiedName || node.name || "Anonymous callable"
        }
      }
    });
    await this.codeFlowDelivery.publishFunctionNode(
      activation.snapshot.version,
      request.nodeId,
      request.sourceText
    );
  }

  /** Posts a typed response only while the panel and its listener are active. */
  private async postMessage(message: ExtensionResponse): Promise<void> {
    if (!this.panel || (!this.webviewReady && message.type !== "ui/ready")) {
      return;
    }
    await this.panel.webview.postMessage(message);
  }

  /** Drops snapshot authority when the editor tab is closed. */
  private disposePanelState(): void {
    this.panel = undefined;
    this.webviewReady = false;
    this.pendingVisualization = undefined;
    this.graphDelivery.clear();
    this.insightCache.clear();
    this.sourceNodeTokens.clear();
    this.evidenceTokens.clear();
  }
}

/** Allows only definitions whose body can be analyzed as function logic. */
function isConcreteCallable(node: SymbolNode): boolean {
  return node.kind === "function" || node.kind === "method" || node.kind === "constructor";
}

/** Keeps the reusable editor-tab label anchored to its explicit root function. */
function createPanelTitle(node: SymbolNode): string {
  return `Function Flow · ${node.name || node.qualifiedName || "Anonymous"}`;
}
