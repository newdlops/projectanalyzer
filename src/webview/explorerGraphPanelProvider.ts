/**
 * Editor-tab graph browser provider. It owns a VS Code WebviewPanel so the
 * visual graph explorer is rendered as a normal editor tab, not inside sidebar.
 */

import * as vscode from "vscode";
import { InMemoryGraphStore } from "../graph/graphStore";
import { createTraversalSubgraph, traverseCallRelationship } from "../graph/graphTraversal";
import type {
  AnalysisStatusPayload,
  ExportRequest,
  ExtensionResponse,
  GraphViewMode,
  WebviewRequest
} from "../protocol/messages";
import type { ProjectGraph } from "../shared/types";
import type { AnalysisCacheStore } from "../storage/cacheStore";
import type { ProjectAnalyzerConfig } from "../vscode/configuration";
import { getExplorerHtml } from "./webviewHtml";
import {
  createNonce,
  exportGraphToJson,
  formatCount,
  getNodeDisplayName,
  openNodeInEditor
} from "./webviewHostActions";

/** Dependencies required by the graph browser panel provider. */
export type ExplorerGraphPanelProviderDependencies = {
  context: vscode.ExtensionContext;
  cacheStore: AnalysisCacheStore;
  config: ProjectAnalyzerConfig;
};

/**
 * Creates and synchronizes the Project Analyzer graph browser editor tab.
 */
export class ExplorerGraphPanelProvider {
  public static readonly viewType = "projectAnalyzer.graphPanel";

  /** Current editor-tab WebviewPanel, if one is open. */
  private panel: vscode.WebviewPanel | undefined;

  /** Active graph mode selected inside the graph browser. */
  private mode: GraphViewMode = "file";

  /** Tracks whether the panel script can receive graph payloads. */
  private webviewReady = false;

  /** Graph payload to send after a newly created panel reports readiness. */
  private pendingGraph: ProjectGraph | undefined;

  /** Node focus request to send after a newly created panel reports readiness. */
  private pendingFocusNodeId: string | undefined;

  public constructor(private readonly dependencies: ExplorerGraphPanelProviderDependencies) {}

  /**
   * Opens or reveals the graph browser tab and optionally publishes a graph.
   */
  public async openGraph(graph?: ProjectGraph): Promise<void> {
    if (graph) {
      this.pendingGraph = graph;
    }

    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        ExplorerGraphPanelProvider.viewType,
        "Project Analyzer Graph",
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true
        }
      );
      this.webviewReady = false;
      this.panel.webview.html = getExplorerHtml({
        webview: this.panel.webview,
        extensionUri: this.dependencies.context.extensionUri,
        nonce: createNonce(),
        defaultDepth: this.dependencies.config.defaultDepth,
        initialMode: this.mode,
        surface: "panel"
      });
      this.panel.webview.onDidReceiveMessage((message: WebviewRequest) => {
        void this.handleMessage(message);
      });
      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.webviewReady = false;
      });
      return;
    }

    this.panel.reveal(vscode.ViewColumn.Active, false);

    if (graph) {
      await this.publishGraph(graph);
    }
  }

  /**
   * Sends a graph payload to the panel when it is open.
   */
  public async publishGraph(graph: ProjectGraph): Promise<void> {
    this.pendingGraph = graph;

    if (!this.panel || !this.webviewReady) {
      return;
    }

    await this.postMessage({ type: "graph/loaded", payload: graph });
    this.pendingGraph = undefined;
  }

  /**
   * Clears panel state after cache removal.
   */
  public async clearGraph(): Promise<void> {
    this.pendingGraph = undefined;
    await this.postMessage({ type: "graph/cleared", payload: {} });
  }

  /**
   * Opens the graph browser and asks the panel to reveal a specific graph node.
   */
  public async focusNode(nodeId: string, graph?: ProjectGraph): Promise<void> {
    this.pendingFocusNodeId = nodeId;
    await this.openGraph(graph);

    if (this.webviewReady) {
      await this.postMessage({ type: "graph/focusNode", payload: { nodeId } });
      this.pendingFocusNodeId = undefined;
    }
  }

  /**
   * Handles typed Webview requests from the graph browser tab.
   */
  private async handleMessage(message: WebviewRequest): Promise<void> {
    switch (message.type) {
      case "ui/ready":
        await this.handleWebviewReady();
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
   * Sends initial state once the Webview script is connected.
   */
  private async handleWebviewReady(): Promise<void> {
    this.webviewReady = true;
    await this.postMessage({ type: "ui/ready", payload: {} });

    if (this.pendingGraph) {
      await this.publishGraph(this.pendingGraph);
    } else {
      await this.postLatestGraph();
    }

    if (this.pendingFocusNodeId) {
      await this.postMessage({
        type: "graph/focusNode",
        payload: { nodeId: this.pendingFocusNodeId }
      });
      this.pendingFocusNodeId = undefined;
    }
  }

  /**
   * Updates the active graph mode in the panel.
   */
  private async setMode(mode: GraphViewMode): Promise<void> {
    this.mode = mode;
    await this.postMessage({ type: "view/modeChanged", payload: { mode } });
  }

  /**
   * Publishes the latest cached graph into the graph browser.
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
   * Shows callers or callees for the selected node inside the panel.
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
   * Exports the latest cached graph to JSON.
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
   * Posts an analysis status update to the graph browser.
   */
  private async postStatus(
    state: AnalysisStatusPayload["state"],
    message: string
  ): Promise<void> {
    await this.postMessage({ type: "analysis/status", payload: { state, message } });
  }

  /**
   * Posts a typed response to the graph panel when it is open.
   */
  private async postMessage(message: ExtensionResponse): Promise<void> {
    if (!this.panel || (!this.webviewReady && message.type !== "ui/ready")) {
      return;
    }

    await this.panel.webview.postMessage(message);
  }
}
