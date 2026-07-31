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
  WebviewLogRequest,
  WebviewRequest
} from "../protocol/messages";
import { validateWebviewRequest } from "../protocol/webviewRequestValidation";
import type { ProjectAnalyzerLogger } from "../observability/logger";
import type { ProjectGraph } from "../shared/types";
import type { AnalysisCacheStore } from "../storage/cacheStore";
import type { ProjectAnalyzerConfig } from "../vscode/configuration";
import { localizeHost, type HostMessageKey } from "../localization/uiLanguage";
import type { SourceHighlighter } from "../vscode/sourceHighlightService";
import {
  GraphPanelPayloadDelivery,
  normalizeGraphPanelNodeBudget
} from "./graphPanel";
import { projectGraphForView, summarizeProjectedGraph } from "./graphProjection";
import { getExplorerHtml } from "./webviewHtml";
import {
  createNonce,
  exportGraphToJson,
  getNodeDisplayName
} from "./webviewHostActions";

/** Dependencies required by the graph browser panel provider. */
export type ExplorerGraphPanelProviderDependencies = {
  context: vscode.ExtensionContext;
  cacheStore: AnalysisCacheStore;
  config: ProjectAnalyzerConfig;
  logger: ProjectAnalyzerLogger;
  sourceHighlighter: SourceHighlighter;
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
  /** Current locale is retained for a hidden or not-yet-created graph panel. */
  private uiLanguage: "ko" | "en";
  private semanticStatus: { state: AnalysisStatusPayload["state"]; key: HostMessageKey; params: Record<string, string | number> } | undefined;

  /** Graph payload to send after a newly created panel reports readiness. */
  private pendingGraph: ProjectGraph | undefined;

  /** Optional focus seed that must survive the next bounded projection. */
  private pendingProjectionRootNodeId: string | undefined;

  /** Node focus request to send after a newly created panel reports readiness. */
  private pendingFocusNodeId: string | undefined;

  /** Last full Host graph; the Webview receives only its bounded projection. */
  private activeGraph: ProjectGraph | undefined;

  /** Suppresses duplicate same-snapshot/mode payloads after successful delivery. */
  private readonly payloadDelivery = new GraphPanelPayloadDelivery();

  public constructor(private readonly dependencies: ExplorerGraphPanelProviderDependencies) {
    this.uiLanguage = dependencies.config.uiLanguage;
  }

  /**
   * Opens or reveals the graph browser tab and optionally publishes a graph.
   */
  public async openGraph(graph?: ProjectGraph, rootNodeId?: string): Promise<void> {
    this.dependencies.logger.info("graphPanel.openGraph", {
      hasGraph: Boolean(graph),
      hasPanel: Boolean(this.panel)
    });

    if (graph) {
      this.activeGraph = graph;
      this.pendingGraph = graph;
      this.pendingProjectionRootNodeId = rootNodeId;
    }

    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        ExplorerGraphPanelProvider.viewType,
        localizeHost(this.uiLanguage, "projectGraph"),
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true
        }
      );
      this.webviewReady = false;
      this.payloadDelivery.clear();
      this.panel.webview.html = getExplorerHtml({
        webview: this.panel.webview,
        extensionUri: this.dependencies.context.extensionUri,
        nonce: createNonce(),
        defaultDepth: this.dependencies.config.defaultDepth,
        maxRenderedNodes: normalizeGraphPanelNodeBudget(
          this.dependencies.config.maxRenderedNodes
        ),
        initialMode: this.mode,
        surface: "panel",
        language: this.uiLanguage
      });
      this.panel.webview.onDidReceiveMessage((message: unknown) => {
        const validation = validateWebviewRequest(message);
        if (!validation.ok) {
          this.dependencies.logger.warn("graphPanel.message.rejected", {
            reason: validation.reason,
            receivedType: validation.receivedType
          });
          return;
        }

        void this.handleMessage(validation.value);
      });
      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.webviewReady = false;
        this.pendingGraph = undefined;
        this.pendingProjectionRootNodeId = undefined;
        this.pendingFocusNodeId = undefined;
        this.activeGraph = undefined;
        this.payloadDelivery.clear();
      });
      return;
    }

    this.panel.reveal(vscode.ViewColumn.Active, false);

    if (graph) {
      await this.publishGraph(graph, rootNodeId);
    }
  }

  /** Updates panel chrome in place without touching its graph projection. */
  public async updateUiLanguage(language: "ko" | "en"): Promise<void> {
    if (this.uiLanguage === language) return;
    this.uiLanguage = language;
    if (this.panel) this.panel.title = localizeHost(language, "projectGraph");
    await this.postMessage({ type: "ui/language", payload: { language } });
    if (this.semanticStatus) await this.postStatus(this.semanticStatus.state, this.semanticStatus.key, this.semanticStatus.params);
  }

  /**
   * Sends a graph payload to the panel when it is open.
   */
  public async publishGraph(graph: ProjectGraph, rootNodeId?: string): Promise<void> {
    this.activeGraph = graph;
    this.pendingGraph = graph;
    this.pendingProjectionRootNodeId = rootNodeId;

    if (!this.panel || !this.webviewReady) {
      this.dependencies.logger.debug("graphPanel.publishGraph.queued", {
        edges: graph.edges.length,
        nodes: graph.nodes.length,
        ready: this.webviewReady
      });
      return;
    }

    if (!this.payloadDelivery.needsDelivery(graph, this.mode, rootNodeId)) {
      this.dependencies.logger.debug("graphPanel.publishGraph.skipped", {
        mode: this.mode,
        reason: "same bounded projection"
      });
      this.pendingGraph = undefined;
      this.pendingProjectionRootNodeId = undefined;
      return;
    }

    const projectedGraph = projectGraphForView(graph, this.mode, {
      maxNodes: normalizeGraphPanelNodeBudget(this.dependencies.config.maxRenderedNodes),
      rootNodeId
    });
    this.dependencies.logger.info("graphPanel.publishGraph.projected", summarizeProjectedGraph(projectedGraph));
    const delivered = await this.postMessage({ type: "graph/loaded", payload: projectedGraph });
    if (!delivered) {
      this.dependencies.logger.warn("graphPanel.publishGraph.notDelivered", {
        mode: this.mode
      });
      return;
    }
    this.payloadDelivery.record(graph, this.mode, projectedGraph, rootNodeId);
    this.pendingGraph = undefined;
    this.pendingProjectionRootNodeId = undefined;
  }

  /**
   * Clears panel state after cache removal.
   */
  public async clearGraph(): Promise<void> {
    this.activeGraph = undefined;
    this.pendingGraph = undefined;
    this.pendingProjectionRootNodeId = undefined;
    this.pendingFocusNodeId = undefined;
    this.payloadDelivery.clear();
    await this.postMessage({ type: "graph/cleared", payload: {} });
  }

  /**
   * Opens the graph browser and asks the panel to reveal a specific graph node.
   */
  public async focusNode(nodeId: string, graph?: ProjectGraph): Promise<void> {
    const sourceGraph = graph ?? await this.readActiveGraph();
    if (sourceGraph) {
      const focusedMode = readGraphModeForNode(sourceGraph, nodeId, this.mode);
      if (focusedMode !== this.mode) {
        await this.setMode(focusedMode);
      }
    }
    this.pendingFocusNodeId = nodeId;
    await this.openGraph(sourceGraph, nodeId);

    if (this.webviewReady) {
      await this.postMessage({ type: "graph/focusNode", payload: { nodeId } });
      this.pendingFocusNodeId = undefined;
    }
  }

  /**
   * Handles typed Webview requests from the graph browser tab.
   */
  private async handleMessage(message: WebviewRequest): Promise<void> {
    this.dependencies.logger.debug("graphPanel.message", { type: message.type });

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
      case "telemetry/log":
        this.logWebviewMessage(message.payload);
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
    this.dependencies.logger.info("graphPanel.ready", {
      hasPendingFocus: Boolean(this.pendingFocusNodeId),
      hasPendingGraph: Boolean(this.pendingGraph)
    });
    await this.postMessage({ type: "ui/language", payload: { language: this.uiLanguage } });
    await this.postMessage({ type: "ui/ready", payload: {} });
    if (this.semanticStatus) await this.postStatus(this.semanticStatus.state, this.semanticStatus.key, this.semanticStatus.params);

    if (this.pendingGraph) {
      await this.publishGraph(this.pendingGraph, this.pendingProjectionRootNodeId);
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
    const graph = await this.readActiveGraph();
    this.dependencies.logger.info("graphPanel.postLatestGraph", { hasGraph: Boolean(graph) });

    if (graph) {
      await this.publishGraph(graph);
      return;
    }

    await this.postStatus("idle", "noGraphLoaded");
  }

  /**
   * Opens the source location represented by a graph node.
   */
  private async openSourceNode(nodeId: string): Promise<void> {
    const graph = await this.readActiveGraph();
    const node = graph?.nodes.find((candidate) => candidate.id === nodeId);

    if (!node) {
      await this.postStatus("idle", "nodeUnavailable");
      return;
    }

    await this.dependencies.sourceHighlighter.revealNode(node);
  }

  /**
   * Shows callers or callees for the selected node inside the panel.
   */
  private async showNodeRelationship(
    nodeId: string,
    direction: "callers" | "callees"
  ): Promise<void> {
    const graph = await this.readActiveGraph();

    if (!graph) {
      await this.postStatus("idle", "analyzeBeforeFunctionFlows");
      return;
    }

    const node = graph.nodes.find((candidate) => candidate.id === nodeId);

    if (!node) {
      await this.postStatus("idle", "graphItemUnavailable");
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
    const projectedSubgraph = projectGraphForView(subgraph, "call", {
      maxNodes: normalizeGraphPanelNodeBudget(this.dependencies.config.maxRenderedNodes),
      rootNodeId: nodeId
    });
    const nodeLabel = getNodeDisplayName(node);

    await this.setMode("call");
    const delivered = await this.postMessage({ type: "graph/updated", payload: projectedSubgraph });
    if (delivered) {
      this.payloadDelivery.record(graph, "call", projectedSubgraph, nodeId);
    }

    if (result.edges.length === 0) {
      await this.postStatus("idle", direction === "callers" ? "noCallersFound" : "noCalleesFound", { name: nodeLabel });
      return;
    }

    await this.postStatus(
      "complete",
      direction === "callers" ? "showingCallers" : "showingCallees", { name: nodeLabel, count: result.edges.length, depth: relationshipDepth }
    );
  }

  /**
   * Exports the latest cached graph to JSON.
   */
  private async exportGraph(request: ExportRequest): Promise<void> {
    const graph = await this.readActiveGraph();

    if (!graph) {
      await this.postStatus("idle", "analyzeBeforeExport");
      return;
    }

    if (request.format !== "json") {
      await this.postStatus("idle", "exportNotImplemented", { format: request.format.toUpperCase() });
      return;
    }

    const result = await exportGraphToJson(graph, this.uiLanguage);
    await this.postStatus(result ? "complete" : "idle", result ? "exportSucceeded" : "exportCanceled", result ? { nodes: result.nodeCount } : {});
  }

  /**
   * Posts an analysis status update to the graph browser.
   */
  private async postStatus(
    state: AnalysisStatusPayload["state"],
    key: HostMessageKey,
    params: Record<string, string | number> = {}
  ): Promise<void> {
    this.semanticStatus = { state, key, params };
    await this.postMessage({ type: "analysis/status", payload: { state, message: localizeHost(this.uiLanguage, key, params) } });
  }

  /**
   * Posts a typed response to the graph panel when it is open.
   */
  private async postMessage(message: ExtensionResponse): Promise<boolean> {
    if (!this.panel || (!this.webviewReady && message.type !== "ui/ready")) {
      this.dependencies.logger.debug("graphPanel.postMessage.skipped", {
        hasPanel: Boolean(this.panel),
        ready: this.webviewReady,
        type: message.type
      });
      return false;
    }

    this.dependencies.logger.debug("graphPanel.postMessage", { type: message.type });
    return this.panel.webview.postMessage(message);
  }

  /** Routes browser-side diagnostics into the extension output channel. */
  private logWebviewMessage(payload: WebviewLogRequest): void {
    this.dependencies.logger[payload.level](`webview.${payload.source}.${payload.message}`, payload.fields);
  }

  /** Reuses the active immutable object before consulting persisted cache. */
  private async readActiveGraph(): Promise<ProjectGraph | undefined> {
    return this.activeGraph ?? this.dependencies.cacheStore.getLatestGraph();
  }
}

/** Selects the graph mode that can actually contain one requested node kind. */
function readGraphModeForNode(
  graph: ProjectGraph,
  nodeId: string,
  fallback: GraphViewMode
): GraphViewMode {
  const kind = graph.nodes.find((node) => node.id === nodeId)?.kind;
  if (kind === "function" || kind === "method" || kind === "constructor") return "call";
  if (kind === "class" || kind === "interface" || kind === "enum" || kind === "property") {
    return "class";
  }
  return kind === "file" || kind === "external" ? "file" : fallback;
}
