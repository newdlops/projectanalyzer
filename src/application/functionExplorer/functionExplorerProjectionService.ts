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
import {
  createFunctionArchitectureIndex,
  type FunctionArchitectureIndex
} from "../../insights/architecturalLayers";
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
  architecture: FunctionArchitectureIndex;
};

/** Builds bounded payloads while reusing an injected or locally-owned graph index. */
export class FunctionExplorerProjectionService {
  private cached: FunctionIndexProjectionCache | undefined;

  /** Projects one request without exposing Maps or graph-wide rows to Webview. */
  public project(
    graph: ProjectGraph,
    semanticFlows: SemanticFlowIndex,
    request: FunctionExplorerIndexRequest = {},
    architectureIndex?: FunctionArchitectureIndex
  ): FunctionExplorerPayload {
    const selectedFunctionId = request.options?.selectedFunctionId;
    const expandedTreeIds = request.options?.expandedRowIds
      ?? createDefaultSemanticFlowExpandedRowIds(semanticFlows);
    const changeImpact = selectedFunctionId
      ? analyzeChangeImpact(graph, semanticFlows, selectedFunctionId)
      : undefined;
    const cache = this.getCache(graph, architectureIndex);
    const index = cache.projector.project({
      expandedTreeIds,
      includeInventoryRows: false,
      inventoryLimit: 500
    });
    const payload = createFunctionExplorerPayload(graph, index, {
      initialRowLimit: 500,
      expandedRowIds: expandedTreeIds,
      semanticFlowRows: createSemanticFlowRows(semanticFlows, {
        expandedRowIds: expandedTreeIds,
        architectureIndex: cache.architecture
      }),
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
    createSourceToken?: (nodeId: string) => SourceNodeToken | undefined,
    architectureIndex?: FunctionArchitectureIndex
  ): FunctionExplorerSearchPayload {
    const cache = this.getCache(graph, architectureIndex);
    return searchFunctionIndex({
      workspaceRoot: graph.workspaceRoot,
      nodes: cache.projector.getNodes(),
      architectureIndex: cache.architecture,
      request,
      createSourceToken
    });
  }

  /** Drops graph references when another analysis snapshot becomes active. */
  public clear(): void {
    this.cached = undefined;
  }

  /** Returns one graph-wide projector reused by presentation-only refreshes. */
  private getCache(
    graph: ProjectGraph,
    architectureIndex?: FunctionArchitectureIndex
  ): FunctionIndexProjectionCache {
    if (this.cached?.graph === graph) {
      if (architectureIndex && this.cached.architecture !== architectureIndex) {
        this.cached = { ...this.cached, architecture: architectureIndex };
      }
      return this.cached;
    }

    const projector = createFunctionIndexProjector(graph);
    const architecture = architectureIndex ?? createFunctionArchitectureIndex(graph);
    this.cached = { graph, projector, architecture };
    return this.cached;
  }
}
