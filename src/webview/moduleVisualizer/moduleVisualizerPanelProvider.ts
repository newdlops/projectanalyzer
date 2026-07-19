/**
 * Extension Host boundary for the dedicated Module Flow editor tab.
 *
 * The provider owns one reusable panel, immutable graph snapshot authority,
 * Host-only projection state, source token registries, and serialized initial
 * delivery. Lazy browser requests are rejected when their snapshot is stale.
 */

import * as vscode from "vscode";
import { ModuleFlowProjectionService } from "../../application/moduleFlow";
import type {
  ModuleFlowDetailRequest,
  ModuleFlowExpandRequest,
  ModuleFlowFailurePayload,
  ModuleFlowListRequest,
  ModuleFlowOpenSourceRequest
} from "../../protocol/moduleFlow";
import type { ExtensionResponse, WebviewRequest } from "../../protocol/messages";
import { validateWebviewRequest } from "../../protocol/webviewRequestValidation";
import type { ProjectAnalyzerLogger } from "../../observability/logger";
import type { ProjectGraph } from "../../shared/types";
import { WebviewGraphDelivery } from "../sidebarGraphDelivery";
import { SourceNodeTokenRegistry } from "../sourceNavigation";
import {
  createNonce,
  openNodeInEditor,
  openSourceLocationInEditor
} from "../webviewHostActions";
import { ModuleFlowEvidenceTokenRegistry } from "./moduleFlowEvidenceTokenRegistry";
import { getModuleVisualizerHtml } from "./moduleVisualizerHtml";

/** Host actions injected by the extension composition root. */
export type ModuleVisualizerPanelProviderDependencies = {
  logger: ProjectAnalyzerLogger;
  openFunction(graph: ProjectGraph, nodeId: string): Promise<void>;
};

/** Creates and synchronizes one reusable project Module Flow editor tab. */
export class ModuleVisualizerPanelProvider {
  public static readonly viewType = "projectAnalyzer.moduleVisualizer";

  /** Reusable editor panel, absent before the first explicit command. */
  private panel: vscode.WebviewPanel | undefined;

  /** Prevents delivery before the nonce-protected browser program is listening. */
  private webviewReady = false;

  /** Latest graph replaces a not-yet-delivered workspace analysis result. */
  private pendingGraph: ProjectGraph | undefined;

  /** Serializes replacement snapshots without recursive delivery callbacks. */
  private deliveryQueue: Promise<void> = Promise.resolve();

  /** Panel-local versions remain independent of analyzer schema versions. */
  private readonly graphDelivery = new WebviewGraphDelivery();

  /** Raw analyzer IDs remain in this snapshot-scoped Host registry. */
  private readonly sourceNodeTokens = new SourceNodeTokenRegistry();

  /** Raw paths and ranges remain in this snapshot-scoped Host registry. */
  private readonly evidenceTokens = new ModuleFlowEvidenceTokenRegistry();

  /** Complete module index is retained only by this bounded projector. */
  private readonly projection = new ModuleFlowProjectionService({
    createSourceToken: (nodeId) => this.sourceNodeTokens.createToken(nodeId),
    createEvidenceToken: (filePath, range) =>
      this.evidenceTokens.createToken(filePath, range)
  });

  public constructor(
    private readonly dependencies: ModuleVisualizerPanelProviderDependencies
  ) {}

  /** Opens or reveals Module Flow for an exact workspace graph object. */
  public async openGraph(graph: ProjectGraph): Promise<void> {
    const current = this.graphDelivery.current();
    this.ensurePanel();
    this.panel?.reveal(vscode.ViewColumn.Active, false);
    if (current?.graph === graph && !this.pendingGraph) {
      return;
    }
    this.pendingGraph = graph;
    if (this.webviewReady) {
      await this.enqueuePendingGraph();
    }
  }

  /** Creates the editor tab once and binds its typed message lifecycle. */
  private ensurePanel(): void {
    if (this.panel) {
      return;
    }
    this.panel = vscode.window.createWebviewPanel(
      ModuleVisualizerPanelProvider.viewType,
      "Module Flow",
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    this.webviewReady = false;
    this.panel.webview.html = getModuleVisualizerHtml({
      webview: this.panel.webview,
      nonce: createNonce()
    });
    this.panel.webview.onDidReceiveMessage((message: unknown) => {
      const validation = validateWebviewRequest(message);
      if (!validation.ok) {
        this.dependencies.logger.warn("moduleVisualizer.message.rejected", {
          reason: validation.reason,
          receivedType: validation.receivedType
        });
        return;
      }
      void this.handleMessage(validation.value);
    });
    this.panel.onDidDispose(() => this.disposePanelState());
  }

  /** Dispatches only requests owned by the Module Flow editor surface. */
  private async handleMessage(message: WebviewRequest): Promise<void> {
    this.dependencies.logger.debug("moduleVisualizer.message", { type: message.type });
    switch (message.type) {
      case "ui/ready":
        this.webviewReady = true;
        await this.postMessage({ type: "ui/ready", payload: {} });
        await this.enqueuePendingGraph();
        break;
      case "moduleFlow/list":
        await this.publishList(message.payload);
        break;
      case "moduleFlow/detail":
        await this.publishDetail(message.payload);
        break;
      case "moduleFlow/expand":
        await this.publishExpansion(message.payload);
        break;
      case "moduleFlow/openSource":
        await this.openSource(message.payload);
        break;
      default:
        break;
    }
  }

  /** Adds the latest root delivery to a non-recursive promise queue. */
  private enqueuePendingGraph(): Promise<void> {
    const scheduled = this.deliveryQueue.then(() => this.publishPendingGraph());
    this.deliveryQueue = scheduled.catch(async (error: unknown) => {
      this.dependencies.logger.error("moduleVisualizer.delivery.failed", {
        error: formatError(error)
      });
      await this.postMessage({
        type: "error",
        payload: {
          code: "moduleFlow.deliveryFailed",
          message: `Could not build Module Flow: ${formatError(error)}`
        }
      });
    });
    return this.deliveryQueue;
  }

  /** Activates a new session and pushes its default execution-flow scene. */
  private async publishPendingGraph(): Promise<void> {
    if (!this.panel || !this.webviewReady || !this.pendingGraph) {
      return;
    }
    const graph = this.pendingGraph;
    this.pendingGraph = undefined;
    this.graphDelivery.clear();
    const activation = this.graphDelivery.activate(graph);
    this.sourceNodeTokens.activate(activation.snapshot.version, graph);
    this.evidenceTokens.activate(activation.snapshot.version, graph);
    this.projection.activate(activation.snapshot.version, graph);
    const request: ModuleFlowListRequest = {
      graphVersion: activation.snapshot.version,
      requestId: 0,
      mode: "execution",
      moduleLimit: 80,
      edgeLimit: 160,
      includeExternal: true,
      includeInferred: true
    };
    await this.postMessage({
      type: "moduleFlow/listLoaded",
      payload: this.projection.projectList(request)
    });
  }

  /** Reprojects the scene for a mode or confidence-filter change. */
  private async publishList(request: ModuleFlowListRequest): Promise<void> {
    if (!(await this.ensureCurrentRequest(request, "list"))) {
      return;
    }
    try {
      await this.postMessage({
        type: "moduleFlow/listLoaded",
        payload: this.projection.projectList(request)
      });
    } catch (error) {
      await this.publishFailure(request, "list", "projectionFailed", formatError(error));
    }
  }

  /** Publishes a bounded module or relation detail selection. */
  private async publishDetail(request: ModuleFlowDetailRequest): Promise<void> {
    if (!(await this.ensureCurrentRequest(request, "detail"))) {
      return;
    }
    try {
      const payload = this.projection.projectDetail(request);
      if (!payload) {
        const code = request.target.kind === "module" ? "moduleNotFound" : "edgeNotFound";
        await this.publishFailure(request, "detail", code, "The selected graph item is unavailable.");
        return;
      }
      await this.postMessage({ type: "moduleFlow/detailLoaded", payload });
    } catch (error) {
      await this.publishFailure(request, "detail", "projectionFailed", formatError(error));
    }
  }

  /** Publishes an idempotent same-canvas expansion delta. */
  private async publishExpansion(request: ModuleFlowExpandRequest): Promise<void> {
    if (!(await this.ensureCurrentRequest(request, "expand"))) {
      return;
    }
    try {
      const payload = this.projection.projectExpansion(request);
      if (!payload) {
        await this.publishFailure(
          request,
          "expand",
          "moduleNotFound",
          "This module cannot be expanded in the active graph."
        );
        return;
      }
      await this.postMessage({ type: "moduleFlow/expanded", payload });
    } catch (error) {
      await this.publishFailure(request, "expand", "projectionFailed", formatError(error));
    }
  }

  /** Resolves a Host-issued source token and opens its appropriate destination. */
  private async openSource(request: ModuleFlowOpenSourceRequest): Promise<void> {
    if (!(await this.ensureCurrentRequest(request, "openSource"))) {
      return;
    }
    try {
      if (request.target.kind === "evidence") {
        const location = this.evidenceTokens.resolve(request.target.evidenceToken);
        if (!location) {
          await this.publishFailure(
            request,
            "openSource",
            "evidenceNotFound",
            "This source evidence has expired."
          );
          return;
        }
        await openSourceLocationInEditor(location.filePath, location.range);
        return;
      }

      const node = this.sourceNodeTokens.resolve(request.target.sourceToken);
      const graph = this.graphDelivery.current()?.graph;
      if (!node || !graph) {
        await this.publishFailure(
          request,
          "openSource",
          "sourceNotFound",
          "This source definition has expired."
        );
        return;
      }
      if (isCallable(node.kind)) {
        await this.dependencies.openFunction(graph, node.id);
      } else {
        await openNodeInEditor(node);
      }
    } catch (error) {
      await this.publishFailure(request, "openSource", "projectionFailed", formatError(error));
    }
  }

  /** Rejects stale lazy requests before resolving any opaque identities. */
  private async ensureCurrentRequest(
    request: { graphVersion: string; requestId: number },
    operation: ModuleFlowFailurePayload["operation"]
  ): Promise<boolean> {
    if (this.graphDelivery.matches(request.graphVersion)
      && this.projection.matches(request.graphVersion)) {
      return true;
    }
    await this.publishFailure(
      request,
      operation,
      "staleGraph",
      "The project graph changed. Reload Module Flow and try again."
    );
    return false;
  }

  /** Sends one correlated, display-safe Module Flow failure. */
  private async publishFailure(
    request: { graphVersion: string; requestId: number },
    operation: ModuleFlowFailurePayload["operation"],
    code: ModuleFlowFailurePayload["code"],
    message: string
  ): Promise<void> {
    await this.postMessage({
      type: "moduleFlow/requestFailed",
      payload: {
        graphVersion: request.graphVersion,
        requestId: request.requestId,
        operation,
        code,
        message
      }
    });
  }

  /** Posts a typed response only while the panel listener is active. */
  private async postMessage(message: ExtensionResponse): Promise<void> {
    if (!this.panel || (!this.webviewReady && message.type !== "ui/ready")) {
      return;
    }
    await this.panel.webview.postMessage(message);
  }

  /** Drops every snapshot authority when the editor tab is closed. */
  private disposePanelState(): void {
    this.panel = undefined;
    this.webviewReady = false;
    this.pendingGraph = undefined;
    this.graphDelivery.clear();
    this.projection.clear();
    this.sourceNodeTokens.clear();
    this.evidenceTokens.clear();
  }
}

/** Function nodes hand off to the existing dedicated Function Visualizer tab. */
function isCallable(kind: string): boolean {
  return kind === "function" || kind === "method" || kind === "constructor";
}

/** Produces concise user-safe errors for status and failure messages. */
function formatError(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown Module Flow failure";
}
