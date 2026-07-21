/**
 * Host-side Function Logic delivery for the Module Flow canvas.
 *
 * This adapter resolves only function cards issued by the active module
 * projection, reads their source through the Host boundary, and reuses the
 * shared analyzer/projector before returning one correlated bounded payload.
 */

import {
  CodeFlowInsightCache,
  createFunctionLogicCodeFlowDetail,
  createFunctionLogicGraphLayout
} from "../../application/codeFlow";
import type { ModuleFlowProjectionService } from "../../application/moduleFlow";
import { analyzeFunctionLogic } from "../../analyzer/functionLogic";
import type {
  ModuleFlowFunctionLogicPayload,
  ModuleFlowFunctionLogicRequest
} from "../../protocol/moduleFlow";
import type { ProjectGraph } from "../../shared/types";
import type { WebviewGraphDelivery } from "../sidebarGraphDelivery";
import type { SourceNodeTokenRegistry } from "../sourceNavigation";
import type { CodeFlowEvidenceTokenRegistry } from "../codeFlow";

/** Collaborators that keep filesystem and token authority outside pure analysis. */
export type ModuleFlowFunctionLogicDeliveryDependencies = {
  graphDelivery: WebviewGraphDelivery;
  projection: ModuleFlowProjectionService;
  sourceNodeTokens: SourceNodeTokenRegistry;
  evidenceTokens: CodeFlowEvidenceTokenRegistry;
  readSourceText(filePath: string): Promise<string | undefined>;
};

/** Builds function-local deltas without opening another editor Webview. */
export class ModuleFlowFunctionLogicDelivery {
  /** Semantic-flow evidence is reused across function expansions in one snapshot. */
  private readonly insightCache = new CodeFlowInsightCache();

  public constructor(
    private readonly dependencies: ModuleFlowFunctionLogicDeliveryDependencies
  ) {}

  /** Resolves, analyzes, and projects one issued function card under hard limits. */
  public async project(
    request: ModuleFlowFunctionLogicRequest
  ): Promise<ModuleFlowFunctionLogicPayload | undefined> {
    const active = this.resolveActiveGraph(request.graphVersion);
    const node = this.dependencies.projection.resolveFunctionNode(request.functionId);
    if (!active || !node) {
      return undefined;
    }

    const sourceText = await this.dependencies.readSourceText(node.filePath);
    const analysis = analyzeFunctionLogic({
      functionNode: node,
      sourceText,
      maxBlocks: normalizeLimit(request.blockLimit, 48)
    });
    const insights = this.insightCache.get(active.graph);
    const detail = createFunctionLogicCodeFlowDetail(
      active.graph,
      insights.semanticFlows,
      node,
      analysis,
      active.version,
      (filePath, range) => this.dependencies.evidenceTokens.createToken(filePath, range),
      (nodeId) => this.dependencies.sourceNodeTokens.createToken(nodeId),
      0
    );
    if (!detail.logic) {
      throw new Error("Function Logic projection did not produce a graph.");
    }

    const allEdges = detail.logic.edges;
    const edges = allEdges.slice(0, normalizeLimit(request.edgeLimit, 96));
    const logic = {
      ...detail.logic,
      edges,
      layout: createFunctionLogicGraphLayout(detail.logic.blocks, edges)
    };
    return {
      graphVersion: active.version,
      requestId: request.requestId,
      anchorFunctionId: request.functionId,
      title: detail.title,
      subtitle: detail.subtitle,
      logic,
      gaps: detail.gaps.map((gap) => `${gap.label}: ${gap.detail}`),
      summary: {
        visibleBlockCount: logic.blocks.length,
        visibleEdgeCount: edges.length,
        omittedEdgeCount: allEdges.length - edges.length,
        gapCount: detail.gaps.length
      }
    };
  }

  /** Releases graph-wide insight references with the owning panel snapshot. */
  public clear(): void {
    this.insightCache.clear();
  }

  /** Narrows the active immutable graph after a snapshot-version check. */
  private resolveActiveGraph(
    graphVersion: string
  ): { graph: ProjectGraph; version: string } | undefined {
    const snapshot = this.dependencies.graphDelivery.current();
    return snapshot && this.dependencies.graphDelivery.matches(graphVersion)
      ? { graph: snapshot.graph, version: snapshot.version }
      : undefined;
  }
}

/** Applies a defensive finite upper bound even after protocol validation. */
function normalizeLimit(value: number, maximum: number): number {
  return Number.isFinite(value)
    ? Math.min(maximum, Math.max(1, Math.floor(value)))
    : maximum;
}
