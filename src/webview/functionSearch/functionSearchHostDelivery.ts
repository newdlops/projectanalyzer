/**
 * Extension Host adapter for bounded Function Index search delivery.
 *
 * It owns active-snapshot validation, cached projection, privacy-safe logging,
 * and typed response publication so the sidebar provider only delegates.
 */

import type { FunctionExplorerProjectionService } from "../../application/functionExplorer";
import type { FunctionArchitectureIndex } from "../../insights/architecturalLayers";
import type { ProjectAnalyzerLogger } from "../../observability/logger";
import type { FunctionExplorerSearchRequest } from "../../protocol/functionExplorer";
import type { ExtensionResponse } from "../../protocol/messages";
import type { SourceNodeToken } from "../../protocol/sourceNavigation";
import type { ProjectGraph } from "../../shared/types";
import type { SidebarGraphDelivery } from "../sidebarGraphDelivery";

/** Collaborators retained by the sidebar while search remains host-only. */
export type FunctionSearchHostDeliveryDependencies = {
  graphDelivery: SidebarGraphDelivery;
  projectionService: FunctionExplorerProjectionService;
  logger: ProjectAnalyzerLogger;
  createSourceToken(nodeId: string): SourceNodeToken | undefined;
  getFunctionArchitecture?(graph: ProjectGraph): FunctionArchitectureIndex;
  postMessage(message: ExtensionResponse): Promise<void>;
};

/**
 * Publishes one search page only when the request belongs to the active graph.
 * Query text is deliberately excluded from logs because it may contain source
 * names or paths.
 */
export async function deliverFunctionSearch(
  request: FunctionExplorerSearchRequest,
  dependencies: FunctionSearchHostDeliveryDependencies
): Promise<void> {
  const snapshot = dependencies.graphDelivery.current();

  if (!snapshot) {
    await dependencies.postMessage({
      type: "function/searchFailed",
      payload: {
        graphVersion: request.graphVersion,
        requestId: request.requestId,
        query: request.query,
        message: "Analyze before searching functions"
      }
    });
    return;
  }
  if (!dependencies.graphDelivery.matches(request.graphVersion)) {
    dependencies.logger.debug("sidebar.lazyRequest.stale", {
      activeGraphVersion: dependencies.graphDelivery.current()?.version,
      feature: "functionSearch",
      requestedGraphVersion: request.graphVersion
    });
    return;
  }

  try {
    const payload = dependencies.projectionService.search(
      snapshot.graph,
      request,
      dependencies.createSourceToken,
      dependencies.getFunctionArchitecture?.(snapshot.graph)
    );
    dependencies.logger.info("sidebar.functionSearch.publish", {
      rows: payload.rows.length,
      totalMatches: payload.totalMatchCount
    });
    await dependencies.postMessage({ type: "function/searchLoaded", payload });
  } catch (error) {
    dependencies.logger.error("sidebar.functionSearch.failed", {
      error: error instanceof Error ? error.message : String(error)
    });
    await dependencies.postMessage({
      type: "function/searchFailed",
      payload: {
        graphVersion: request.graphVersion,
        requestId: request.requestId,
        query: request.query,
        message: "Function search failed; try again"
      }
    });
  }
}
