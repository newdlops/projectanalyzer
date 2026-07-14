/**
 * Request-local Function Explorer projection service.
 *
 * It keeps graph-wide function identities cached in the Extension Host while
 * building only the bounded rows requested after Explore Code Flows is opened.
 * The service is presentation-framework independent and returns protocol data.
 */

import { createChangeImpactRows } from "./changeImpactRows";
import {
  createDefaultSemanticFlowExpandedRowIds,
  createSemanticFlowRows
} from "./semanticFlowRows";
import {
  createFunctionIndexProjector,
  type FunctionIndexProjector
} from "../../graph/functionIndex";
import { createFunctionExplorerPayload } from "../../graph/functionIndexPayload";
import { analyzeChangeImpact } from "../../insights/changeImpact";
import type { SemanticFlowIndex } from "../../insights/semanticFlow";
import type {
  FunctionExplorerIndexRequest,
  FunctionExplorerPayload,
  FunctionExplorerSearchPayload,
  FunctionExplorerSearchRequest
} from "../../protocol/functionExplorer";
import type { ProjectGraph } from "../../shared/types";
import type { SourceNodeToken } from "../../protocol/sourceNavigation";
import { searchFunctionIndex } from "./functionSearchQuery";

/** Reusable Function Index core associated with one immutable graph object. */
type FunctionIndexProjectionCache = {
  graph: ProjectGraph;
  projector: FunctionIndexProjector;
};

/** Builds bounded Function Explorer payloads and owns graph-wide index reuse. */
export class FunctionExplorerProjectionService {
  private cached: FunctionIndexProjectionCache | undefined;

  /** Projects one request without exposing Maps or graph-wide rows to Webview. */
  public project(
    graph: ProjectGraph,
    semanticFlows: SemanticFlowIndex,
    request: FunctionExplorerIndexRequest = {}
  ): FunctionExplorerPayload {
    const selectedFunctionId = request.options?.selectedFunctionId;
    const expandedTreeIds = request.options?.expandedRowIds
      ?? createDefaultSemanticFlowExpandedRowIds(semanticFlows);
    const changeImpact = selectedFunctionId
      ? analyzeChangeImpact(graph, semanticFlows, selectedFunctionId)
      : undefined;
    const index = this.getProjector(graph).project({
      expandedTreeIds,
      includeInventoryRows: false,
      inventoryLimit: 500
    });
    const payload = createFunctionExplorerPayload(graph, index, {
      initialRowLimit: 500,
      expandedRowIds: expandedTreeIds,
      semanticFlowRows: createSemanticFlowRows(semanticFlows, { expandedRowIds: expandedTreeIds }),
      changeImpactRows: changeImpact
        ? createChangeImpactRows(graph, changeImpact)
        : undefined,
      selectedFunctionId
    });
    payload.options.expandedRowIds = expandedTreeIds;
    return payload;
  }

  /** Searches the cached graph-wide node core without rebuilding row sections. */
  public search(
    graph: ProjectGraph,
    request: FunctionExplorerSearchRequest,
    createSourceToken?: (nodeId: string) => SourceNodeToken | undefined
  ): FunctionExplorerSearchPayload {
    return searchFunctionIndex({
      workspaceRoot: graph.workspaceRoot,
      nodes: this.getProjector(graph).getNodes(),
      request,
      createSourceToken
    });
  }

  /** Drops graph references when another analysis snapshot becomes active. */
  public clear(): void {
    this.cached = undefined;
  }

  /** Returns one graph-wide projector reused by presentation-only refreshes. */
  private getProjector(graph: ProjectGraph): FunctionIndexProjector {
    if (this.cached?.graph === graph) {
      return this.cached.projector;
    }

    const projector = createFunctionIndexProjector(graph);
    this.cached = { graph, projector };
    return projector;
  }
}
