/**
 * Pure delivery state for the legacy visual Graph Panel. It prevents an
 * immutable graph/mode projection from crossing the Webview boundary again
 * unless a requested focus node was omitted from the last bounded payload.
 */

import type { GraphViewMode } from "../../protocol/messages";
import type { ProjectGraph } from "../../shared/types";

/** Absolute guard even when a manually edited VS Code setting is excessive. */
export const MAX_GRAPH_PANEL_PAYLOAD_NODES = 2_000;

/** Normalizes the shared render/delivery budget used by Host and browser. */
export function normalizeGraphPanelNodeBudget(configuredValue: number): number {
  if (!Number.isFinite(configuredValue)) return 500;
  return Math.min(MAX_GRAPH_PANEL_PAYLOAD_NODES, Math.max(1, Math.floor(configuredValue)));
}

/** Tracks only graph object identity and delivered node identities. */
export class GraphPanelPayloadDelivery {
  private graph: ProjectGraph | undefined;
  private mode: GraphViewMode | undefined;
  private projectionRootNodeId: string | undefined;
  private deliveredNodeIds = new Set<string>();

  /** Returns whether this projection would add or replace browser state. */
  public needsDelivery(
    graph: ProjectGraph,
    mode: GraphViewMode,
    requiredNodeId?: string
  ): boolean {
    if (this.graph !== graph || this.mode !== mode) return true;
    if (requiredNodeId) return !this.deliveredNodeIds.has(requiredNodeId);
    return this.projectionRootNodeId !== undefined;
  }

  /** Commits state only after the Webview accepted a bounded payload. */
  public record(
    sourceGraph: ProjectGraph,
    mode: GraphViewMode,
    projectedGraph: ProjectGraph,
    projectionRootNodeId?: string
  ): void {
    this.graph = sourceGraph;
    this.mode = mode;
    this.projectionRootNodeId = projectionRootNodeId;
    this.deliveredNodeIds = new Set(projectedGraph.nodes.map((node) => node.id));
  }

  /** Clears browser-specific state without mutating or retaining graph data. */
  public clear(): void {
    this.graph = undefined;
    this.mode = undefined;
    this.projectionRootNodeId = undefined;
    this.deliveredNodeIds.clear();
  }
}
