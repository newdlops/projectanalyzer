/**
 * Bounded browser-side storage for Module Flow lazy expansions.
 *
 * The store keeps insertion order as an LRU-like exploration order and measures
 * the exact merged node/edge identities before accepting a delta. This prevents
 * individually bounded expansions from growing one Webview canvas without bound.
 */

/** Minimum structural payload required from a Module Flow expansion response. */
export type ModuleFlowExpansionScene = {
  nodes?: readonly { id: string }[];
  edges?: readonly { id: string }[];
  replacedEdgeIds?: readonly string[];
};

/** Result of retaining one expansion within the aggregate scene budget. */
export type ModuleFlowExpansionRetention = {
  accepted: boolean;
  evictedKeys: string[];
  nodeCount: number;
  edgeCount: number;
};

/**
 * Owns active expansion deltas and evicts the oldest branches iteratively.
 * The newly requested branch is retained whenever it can fit with the base scene.
 */
export class ModuleFlowExpansionStore<T extends ModuleFlowExpansionScene> {
  /** Map order records oldest-to-newest active exploration branches. */
  private readonly entries = new Map<string, T>();

  public constructor(
    private readonly maximumNodes: number,
    private readonly maximumEdges: number
  ) {}

  /** Returns whether a branch is currently attached to the shared canvas. */
  public has(key: string): boolean {
    return this.entries.has(key);
  }

  /** Removes one explicit branch and releases its payload immediately. */
  public delete(key: string): boolean {
    return this.entries.delete(key);
  }

  /** Iterates active payloads without exposing the mutable registry. */
  public values(): IterableIterator<T> {
    return this.entries.values();
  }

  /** Iterates stable keys with payloads for dependency-aware branch cleanup. */
  public entryPairs(): IterableIterator<[string, T]> {
    return this.entries.entries();
  }

  /** Iterates stable expansion identities for compact layout cache keys. */
  public keys(): IterableIterator<string> {
    return this.entries.keys();
  }

  /** Drops every branch when the base list or graph snapshot changes. */
  public clear(): void {
    this.entries.clear();
  }

  /** Number of currently retained expansion payloads. */
  public get size(): number {
    return this.entries.size;
  }

  /**
   * Adds or refreshes one branch, then evicts oldest branches until the exact
   * merged scene fits. If base + incoming alone exceeds the limit, incoming is
   * rejected rather than leaving the store above its invariant.
   */
  public retain(
    key: string,
    value: T,
    baseNodeIds: Iterable<string>,
    baseEdgeIds: Iterable<string>,
    protectedKeys: Iterable<string> = []
  ): ModuleFlowExpansionRetention {
    // Retention is transactional: an expansion that still cannot fit after
    // eligible eviction must not destroy branches that were visible beforehand.
    const previousEntries = new Map(this.entries);
    // Map.keys() is a single-use iterator in the browser; materialize the base
    // identities once because eviction can require several exact measurements.
    const stableBaseNodeIds = new Set(baseNodeIds);
    const stableBaseEdgeIds = new Set(baseEdgeIds);
    // A child function graph must never evict the branch containing its anchor.
    const protectedKeySet = new Set(protectedKeys);
    this.entries.delete(key);
    this.entries.set(key, value);
    const evictedKeys: string[] = [];
    let measurement = this.measure(stableBaseNodeIds, stableBaseEdgeIds);

    while (!this.fits(measurement) && this.entries.size > 1) {
      let oldestKey: string | undefined;
      for (const candidateKey of this.entries.keys()) {
        if (candidateKey !== key && !protectedKeySet.has(candidateKey)) {
          oldestKey = candidateKey;
          break;
        }
      }
      if (oldestKey === undefined) {
        break;
      }
      this.entries.delete(oldestKey);
      evictedKeys.push(oldestKey);
      measurement = this.measure(stableBaseNodeIds, stableBaseEdgeIds);
    }

    if (!this.fits(measurement)) {
      this.entries.clear();
      for (const [previousKey, previousValue] of previousEntries) {
        this.entries.set(previousKey, previousValue);
      }
      measurement = this.measure(stableBaseNodeIds, stableBaseEdgeIds);
      return { accepted: false, evictedKeys: [], ...measurement };
    }

    return { accepted: true, evictedKeys, ...measurement };
  }

  /** Counts unique identities after applying every replacement before additions. */
  private measure(
    baseNodeIds: Iterable<string>,
    baseEdgeIds: Iterable<string>
  ): { nodeCount: number; edgeCount: number } {
    const nodeIds = new Set(baseNodeIds);
    const edgeIds = new Set(baseEdgeIds);
    for (const expansion of this.entries.values()) {
      for (const edgeId of expansion.replacedEdgeIds ?? []) {
        edgeIds.delete(edgeId);
      }
    }
    for (const expansion of this.entries.values()) {
      for (const node of expansion.nodes ?? []) {
        nodeIds.add(node.id);
      }
      for (const edge of expansion.edges ?? []) {
        edgeIds.add(edge.id);
      }
    }
    return { nodeCount: nodeIds.size, edgeCount: edgeIds.size };
  }

  /** Applies positive finite limits even if future configuration is malformed. */
  private fits(measurement: { nodeCount: number; edgeCount: number }): boolean {
    const nodeLimit = Math.max(1, Number.isFinite(this.maximumNodes) ? this.maximumNodes : 1);
    const edgeLimit = Math.max(1, Number.isFinite(this.maximumEdges) ? this.maximumEdges : 1);
    return measurement.nodeCount <= nodeLimit && measurement.edgeCount <= edgeLimit;
  }
}

/** Serializes the dependency-free store into the nonce Webview program. */
export function getModuleFlowExpansionStoreBrowserSource(): string {
  return ModuleFlowExpansionStore.toString();
}
