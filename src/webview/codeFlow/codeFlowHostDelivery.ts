/**
 * Extension Host delivery boundary shared by flow-first Webview surfaces. It correlates
 * requests with one immutable graph snapshot and keeps graph/source identities
 * behind application projections and the source-token registry.
 */

import {
  CODE_FLOW_CATALOG_DEFAULT_LIMIT,
  type CodeFlowInsightCache,
  type SymbolCodeFlowProjectionOptions,
  createCodeFlowCatalogPayload,
  createCodeFlowIdentity,
  createEntrypointCodeFlowDetail,
  createFunctionLogicCodeFlowDetail,
  buildFunctionTutorModel
} from "../../application/codeFlow";
import { analyzeFunctionLogic } from "../../analyzer/functionLogic";
import {
  analyzeFunctionTutorDeclaration,
  createUnavailableFunctionTutorDeclaration
} from "../../analyzer/functionTutor";
import type {
  CodeFlowCatalogRequest,
  CodeFlowFailurePayload,
  CodeFlowSelectRequest,
  CodeFlowSelectSourceRequest
} from "../../protocol/codeFlow";
import type { CodeFlowOpenEvidenceRequest } from "../../protocol/functionLogic";
import type { ExtensionResponse } from "../../protocol/messages";
import type { ProjectAnalyzerLogger } from "../../observability/logger";
import { localizeHost, type UiLanguage } from "../../localization/uiLanguage";
import type { ProjectGraph, SymbolNode } from "../../shared/types";
import type { WebviewGraphDelivery } from "../sidebarGraphDelivery";
import type { SourceNodeTokenRegistry } from "../sourceNavigation";
import type {
  CodeFlowEvidenceLocation,
  CodeFlowEvidenceTokenRegistry
} from "./codeFlowEvidenceTokenRegistry";

/** Collaborators retained by the Host-only CodeFlow delivery service. */
export type CodeFlowHostDeliveryDependencies = {
  graphDelivery: WebviewGraphDelivery;
  insightCache: CodeFlowInsightCache;
  sourceNodeTokens: SourceNodeTokenRegistry;
  evidenceTokens: CodeFlowEvidenceTokenRegistry;
  logger: ProjectAnalyzerLogger;
  getUiLanguage(): UiLanguage;
  projectionOptions?: SymbolCodeFlowProjectionOptions;
  readSourceText(filePath: string): Promise<string | undefined>;
  openEvidenceLocation(location: CodeFlowEvidenceLocation): Promise<void>;
  postMessage(message: ExtensionResponse): Promise<void>;
};

/** Active graph plus its snapshot-local browser delivery identity. */
type ActiveCodeFlowGraph = {
  graph: ProjectGraph;
  version: string;
};

/** Publishes entrypoint catalogs and bounded flow details for the active graph. */
export class CodeFlowHostDelivery {
  public constructor(private readonly dependencies: CodeFlowHostDeliveryDependencies) {}

  /** Sends the first bounded catalog immediately after a new graph shell. */
  public async publishInitial(graph: ProjectGraph, graphVersion: string): Promise<void> {
    await this.publishCatalog({
      graphVersion,
      requestId: 0,
      query: "",
      limit: CODE_FLOW_CATALOG_DEFAULT_LIMIT
    }, graph);
  }

  /** Searches the active semantic-flow index without exposing the whole graph. */
  public async publishCatalog(
    request: CodeFlowCatalogRequest,
    knownGraph?: ProjectGraph
  ): Promise<void> {
    const active = this.resolveActiveGraph(request.graphVersion, knownGraph);
    if (!active) {
      await this.publishFailure(request.graphVersion, "staleGraph", "staleStartAgain", this.localize("staleGraph", this.localize("startAgain")));
      return;
    }

    const insights = this.dependencies.insightCache.get(active.graph);
    const payload = createCodeFlowCatalogPayload(
      active.graph,
      insights.semanticFlows,
      active.version,
      { ...request, graphVersion: active.version }
    );
    this.dependencies.logger.debug("codeFlow.catalog.publish", {
      requestId: request.requestId,
      queryLength: request.query.length,
      rows: payload.items.length,
      total: payload.totalMatchCount
    });
    await this.dependencies.postMessage({ type: "codeFlow/catalogLoaded", payload });
  }

  /** Resolves one opaque entrypoint identity and publishes its bounded flow. */
  public async publishEntrypoint(request: CodeFlowSelectRequest): Promise<void> {
    const active = this.resolveActiveGraph(request.graphVersion);
    if (!active) {
      await this.publishFailure(request.graphVersion, "staleGraph", "staleStartAgain", this.localize("staleGraph", this.localize("startAgain")));
      return;
    }

    const insights = this.dependencies.insightCache.get(active.graph);
    const flow = insights.semanticFlows.flows.find((candidate) =>
      createCodeFlowIdentity(active.version, candidate.id) === request.flowId
    );
    if (!flow) {
      await this.publishFailure(active.version, "flowNotFound", "flowNotFound", this.localize("flowNotFound"));
      return;
    }

    const payload = createEntrypointCodeFlowDetail(
      active.graph,
      flow,
      active.version,
      insights.functionArchitecture,
      (nodeId) => this.dependencies.sourceNodeTokens.createToken(nodeId)
    );
    this.dependencies.logger.debug("codeFlow.detail.entrypoint", {
      gaps: payload.gaps.length,
      steps: payload.steps.length
    });
    await this.dependencies.postMessage({ type: "codeFlow/detailLoaded", payload });
  }

  /** Builds syntax-backed internal logic from one Host-issued function token. */
  public async publishSourceContext(request: CodeFlowSelectSourceRequest): Promise<void> {
    const active = this.resolveActiveGraph(request.graphVersion);
    if (!active) {
      await this.publishFailure(request.graphVersion, "staleGraph", "staleSearchAgain", this.localize("staleGraph", this.localize("searchAgain")));
      return;
    }

    const node = this.dependencies.sourceNodeTokens.resolve(request.sourceToken);
    if (!node) {
      await this.publishFailure(active.version, "sourceNotFound", "sourceNotFound", this.localize("sourceNotFound"));
      return;
    }
    if (!isConcreteCallable(node)) {
      await this.publishFailure(active.version, "sourceNotCallable", "sourceNotCallable", this.localize("sourceNotCallable"));
      return;
    }

    await this.publishFunctionLogic(active, node);
  }

  /** Publishes a Host-selected graph callable without exposing analyzer IDs. */
  public async publishFunctionNode(
    graphVersion: string,
    nodeId: string,
    sourceText?: string
  ): Promise<boolean> {
    const active = this.resolveActiveGraph(graphVersion);
    if (!active) {
      await this.publishFailure(graphVersion, "staleGraph", "staleVisualizeAgain", this.localize("staleGraph", this.localize("visualizeAgain")));
      return false;
    }
    const node = active.graph.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) {
      await this.publishFailure(active.version, "sourceNotFound", "currentFunctionUnavailable", this.localize("currentFunctionUnavailable"));
      return false;
    }
    if (!isConcreteCallable(node)) {
      await this.publishFailure(active.version, "sourceNotCallable", "cursorNotCallable", this.localize("cursorNotCallable"));
      return false;
    }

    await this.publishFunctionLogic(active, node, sourceText);
    return true;
  }

  /** Builds and projects one syntax-backed function-logic graph. */
  private async publishFunctionLogic(
    active: ActiveCodeFlowGraph,
    node: SymbolNode,
    sourceSnapshot?: string
  ): Promise<void> {
    const insights = this.dependencies.insightCache.get(active.graph);
    const sourceText = sourceSnapshot ?? await this.dependencies.readSourceText(node.filePath);
    const analysis = analyzeFunctionLogic({
      functionNode: node,
      sourceText,
      maxBlocks: this.dependencies.projectionOptions?.maxLogicBlocks
    });
    let tutorModel;
    try {
      const declaration = analyzeFunctionTutorDeclaration({
        functionNode: node,
        sourceText,
        functionLogic: analysis
      });
      tutorModel = await buildFunctionTutorModel({
        graph: active.graph,
        declaration,
        functionLogic: analysis,
        architectureIndex: insights.functionArchitecture,
        semanticFlows: insights.semanticFlows,
        functionIndex: insights.functionIndex,
        readSourceText: this.dependencies.readSourceText
      });
    } catch (error) {
      // A parser edge case must not suppress the Guide. Reuse Function Logic's
      // source blocks and surface the unavailable analysis as an honest gap.
      this.dependencies.logger.debug("codeFlow.detail.functionTutor.failed", {
        message: error instanceof Error ? error.message : "unknown Tutor failure"
      });
      const declaration = createUnavailableFunctionTutorDeclaration(
        node,
        analysis,
        this.localize("tutorUnavailable")
      );
      tutorModel = await buildFunctionTutorModel({
        graph: active.graph,
        declaration,
        functionLogic: analysis,
        architectureIndex: insights.functionArchitecture,
        semanticFlows: insights.semanticFlows,
        functionIndex: insights.functionIndex,
        readSourceText: this.dependencies.readSourceText
      });
    }
    const payload = createFunctionLogicCodeFlowDetail(
      active.graph,
      insights.semanticFlows,
      node,
      analysis,
      active.version,
      (filePath, range) => this.dependencies.evidenceTokens.createToken(filePath, range),
      (nodeId) => this.dependencies.sourceNodeTokens.createToken(nodeId),
      this.dependencies.projectionOptions?.originLimit,
      tutorModel
    );
    this.dependencies.logger.debug("codeFlow.detail.functionLogic", {
      blocks: analysis.blocks.length,
      edges: analysis.edges.length,
      gaps: payload.gaps.length,
      origins: payload.origins.length
    });
    await this.dependencies.postMessage({ type: "codeFlow/detailLoaded", payload });
  }

  /** Opens a statement range only when its graph and opaque token are active. */
  public async openEvidence(request: CodeFlowOpenEvidenceRequest): Promise<void> {
    const active = this.resolveActiveGraph(request.graphVersion);
    if (!active) {
      await this.publishFailure(request.graphVersion, "staleGraph", "staleReopenLogic", this.localize("staleGraph", this.localize("reopenLogic")));
      return;
    }
    const location = this.dependencies.evidenceTokens.resolve(request.evidenceToken);
    if (!location) {
      await this.publishFailure(active.version, "evidenceNotFound", "evidenceNotFound", this.localize("evidenceNotFound"));
      return;
    }
    await this.dependencies.openEvidenceLocation(location);
  }

  /** Resolves a snapshot only when the browser and Host versions still agree. */
  private resolveActiveGraph(
    requestedVersion: string,
    knownGraph?: ProjectGraph
  ): ActiveCodeFlowGraph | undefined {
    const snapshot = this.dependencies.graphDelivery.current();
    if (!snapshot || !this.dependencies.graphDelivery.matches(requestedVersion)) {
      return undefined;
    }
    if (knownGraph && snapshot.graph !== knownGraph) {
      return undefined;
    }
    return { graph: snapshot.graph, version: snapshot.version };
  }

  /** Posts one display-safe failure through the typed response union. */
  private async publishFailure(
    graphVersion: string,
    code: CodeFlowFailurePayload["code"],
    presentationKey: CodeFlowFailurePayload["presentationKey"],
    message: string
  ): Promise<void> {
    this.dependencies.logger.debug("codeFlow.detail.failed", { code });
    await this.dependencies.postMessage({
      type: "codeFlow/detailFailed",
      payload: { graphVersion, code, presentationKey, message }
    });
  }

  /** Formats owned failure wrappers at delivery time; caller-supplied details remain literal. */
  private localize(key: "staleGraph" | "startAgain" | "searchAgain" | "visualizeAgain" | "reopenLogic" | "flowNotFound" | "sourceNotFound" | "sourceNotCallable" | "evidenceNotFound" | "currentFunctionUnavailable" | "cursorNotCallable" | "tutorUnavailable", action = ""): string {
    return localizeHost(this.dependencies.getUiLanguage(), key, { action });
  }
}

/** Allows symbol-context projection only for source-backed callable definitions. */
function isConcreteCallable(node: SymbolNode): boolean {
  return node.kind === "function" || node.kind === "method" || node.kind === "constructor";
}
