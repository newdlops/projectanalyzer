/**
 * Snapshot-local analysis cache for CodeFlow projections. The cache owns only
 * evidence required by the flow-first product and never constructs retired
 * Reading Guide, Guided Tour, or dashboard payloads.
 */

import { createFunctionFrameworkSemantics } from "../../graph/functionFrameworkSemantics";
import { createFunctionIndex, type FunctionIndex } from "../../graph/functionIndex";
import {
  createFunctionArchitectureIndex,
  type FunctionArchitectureIndex
} from "../../insights/architecturalLayers";
import {
  createSemanticFlowIndex,
  type SemanticFlowIndex
} from "../../insights/semanticFlow";
import type { ProjectGraph } from "../../shared/types";

/** Reusable evidence indexes for one exact immutable graph object. */
export type CodeFlowInsightSnapshot = {
  functionArchitecture: FunctionArchitectureIndex;
  semanticFlows: SemanticFlowIndex;
  /** Direct caller/callee evidence reused by Function Explorer and Function Guide. */
  functionIndex: FunctionIndex;
};

/** Computes CodeFlow insight indexes once per immutable graph snapshot. */
export class CodeFlowInsightCache {
  /** Object identity is the cache key because engine schema versions may repeat. */
  private cachedGraph: ProjectGraph | undefined;

  private cachedSnapshot: CodeFlowInsightSnapshot | undefined;

  /** Returns cached evidence or builds both shared indexes in one pass boundary. */
  public get(graph: ProjectGraph): CodeFlowInsightSnapshot {
    if (this.cachedGraph === graph && this.cachedSnapshot) {
      return this.cachedSnapshot;
    }

    const frameworkSemantics = createFunctionFrameworkSemantics(graph);
    const snapshot: CodeFlowInsightSnapshot = {
      functionArchitecture: createFunctionArchitectureIndex(graph, frameworkSemantics),
      semanticFlows: createSemanticFlowIndex(graph, {}, frameworkSemantics),
      functionIndex: createFunctionIndex(graph, { includeInventoryRows: false })
    };
    this.cachedGraph = graph;
    this.cachedSnapshot = snapshot;
    return snapshot;
  }

  /** Drops graph references when the active analysis is cleared. */
  public clear(): void {
    this.cachedGraph = undefined;
    this.cachedSnapshot = undefined;
  }
}
