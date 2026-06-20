/**
 * In-memory graph store for normalized nodes and edges. The store owns lookup
 * indexes used by analyzers, commands, traversal helpers, and export features.
 */

import type { GraphEdge, ProjectGraph, SymbolNode } from "../shared/types";

/** Mutable graph store API used by analysis and incremental update pipelines. */
export interface GraphStore {
  addNode(node: SymbolNode): void;
  addEdge(edge: GraphEdge): void;
  getNode(nodeId: string): SymbolNode | undefined;
  getEdge(edgeId: string): GraphEdge | undefined;
  getOutgoingEdges(nodeId: string): GraphEdge[];
  getIncomingEdges(nodeId: string): GraphEdge[];
  toProjectGraph(): ProjectGraph;
}

/**
 * Map-backed graph store with source and target indexes. The indexes keep graph
 * traversal iterative and avoid scanning all edges for common queries.
 */
export class InMemoryGraphStore implements GraphStore {
  /** Node records keyed by stable graph node ID. */
  private readonly nodes = new Map<string, SymbolNode>();

  /** Edge records keyed by stable graph edge ID. */
  private readonly edges = new Map<string, GraphEdge>();

  /** Outgoing edge IDs keyed by source node ID. */
  private readonly outgoingEdgeIds = new Map<string, Set<string>>();

  /** Incoming edge IDs keyed by target node ID. */
  private readonly incomingEdgeIds = new Map<string, Set<string>>();

  public constructor(private readonly baseGraph: ProjectGraph) {
    for (const node of baseGraph.nodes) {
      this.addNode(node);
    }

    for (const edge of baseGraph.edges) {
      this.addEdge(edge);
    }
  }

  /**
   * Inserts or replaces a node while preserving edge indexes.
   */
  public addNode(node: SymbolNode): void {
    this.nodes.set(node.id, node);
  }

  /**
   * Inserts or replaces an edge and updates source/target indexes.
   */
  public addEdge(edge: GraphEdge): void {
    this.edges.set(edge.id, edge);
    this.addIndexedEdgeId(this.outgoingEdgeIds, edge.sourceId, edge.id);
    this.addIndexedEdgeId(this.incomingEdgeIds, edge.targetId, edge.id);
  }

  /**
   * Returns a graph node by stable ID.
   */
  public getNode(nodeId: string): SymbolNode | undefined {
    return this.nodes.get(nodeId);
  }

  /**
   * Returns a graph edge by stable ID.
   */
  public getEdge(edgeId: string): GraphEdge | undefined {
    return this.edges.get(edgeId);
  }

  /**
   * Returns outgoing edges without exposing mutable index internals.
   */
  public getOutgoingEdges(nodeId: string): GraphEdge[] {
    return this.getEdgesByIndex(this.outgoingEdgeIds, nodeId);
  }

  /**
   * Returns incoming edges without exposing mutable index internals.
   */
  public getIncomingEdges(nodeId: string): GraphEdge[] {
    return this.getEdgesByIndex(this.incomingEdgeIds, nodeId);
  }

  /**
   * Serializes the store into a ProjectGraph payload.
   */
  public toProjectGraph(): ProjectGraph {
    const nodes = [...this.nodes.values()];
    const edges = [...this.edges.values()];
    const languages = [...new Set(nodes.map((node) => node.language).filter(Boolean))].sort();

    return {
      ...this.baseGraph,
      nodes,
      edges,
      metadata: {
        ...this.baseGraph.metadata,
        languages,
        symbolCount: nodes.length,
        edgeCount: edges.length
      }
    };
  }

  /**
   * Adds an edge ID to an index bucket, creating that bucket when needed.
   */
  private addIndexedEdgeId(index: Map<string, Set<string>>, nodeId: string, edgeId: string): void {
    const edgeIds = index.get(nodeId) ?? new Set<string>();
    edgeIds.add(edgeId);
    index.set(nodeId, edgeIds);
  }

  /**
   * Resolves edge IDs from a source or target index into edge records.
   */
  private getEdgesByIndex(index: Map<string, Set<string>>, nodeId: string): GraphEdge[] {
    const edgeIds = index.get(nodeId);

    if (!edgeIds) {
      return [];
    }

    return [...edgeIds]
      .map((edgeId) => this.edges.get(edgeId))
      .filter((edge): edge is GraphEdge => edge !== undefined);
  }
}
