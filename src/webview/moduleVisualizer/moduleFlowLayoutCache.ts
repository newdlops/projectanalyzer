/**
 * Small bounded LRU cache for deterministic Module Flow layouts.
 *
 * Keys contain only snapshot and structural presentation inputs. Viewport,
 * selection, loading, and entry-animation state deliberately stay outside it.
 */

/** Reuses recent base/expanded layouts without allowing unbounded Webview state. */
export class ModuleFlowLayoutCache<T> {
  private readonly entries = new Map<string, T>();

  public constructor(private readonly maximumEntries = 4) {}

  /** Reads and promotes one layout to the most-recently-used position. */
  public get(key: string): T | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  /** Stores one layout and iteratively evicts the oldest entry when bounded. */
  public set(key: string, value: T): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    const limit = Math.max(1, this.maximumEntries);
    while (this.entries.size > limit) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }
  }

  /** Invalidates snapshot-scoped layout authority. */
  public clear(): void {
    this.entries.clear();
  }

  /** Exposes only the bounded count for diagnostics and deterministic tests. */
  public get size(): number {
    return this.entries.size;
  }
}

/** Serializes the exact cache implementation into the nonce Webview script. */
export function getModuleFlowLayoutCacheBrowserSource(): string {
  return ModuleFlowLayoutCache.toString();
}
