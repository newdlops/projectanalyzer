/**
 * Cache storage contracts and implementations for analysis graph reuse.
 *
 * The store keeps an active graph for the UI and also stores scoped cache
 * entries keyed by a workspace fingerprint or current-file content hash.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ProjectGraph } from "../shared/types";

/** Analysis scopes that have independent cache keys and restore behavior. */
export type AnalysisCacheScope = "workspace" | "currentFile" | "latest";

/** Pointer to one cached analysis entry. */
export type AnalysisCachePointer = {
  scope: AnalysisCacheScope;
  cacheKey: string;
};

/** Stored analysis result with a stable cache key. */
export type AnalysisCacheEntry = AnalysisCachePointer & {
  graph: ProjectGraph;
  label?: string;
  savedAt: string;
};

/** Analysis cache API used by extension services. */
export interface AnalysisCacheStore {
  getLatestGraph(): Promise<ProjectGraph | undefined>;
  getLatestGraphForScope(scope: AnalysisCacheScope): Promise<ProjectGraph | undefined>;
  getGraph(scope: AnalysisCacheScope, cacheKey: string): Promise<ProjectGraph | undefined>;
  saveGraph(entry: AnalysisCacheEntry, activate?: boolean): Promise<void>;
  saveLatestGraph(graph: ProjectGraph): Promise<void>;
  setActiveGraph(scope: AnalysisCacheScope, cacheKey: string): Promise<void>;
  clear(): Promise<void>;
}

/** Serialized on-disk cache state. */
type AnalysisCacheState = {
  version: 1;
  active?: AnalysisCachePointer;
  entries: AnalysisCacheEntry[];
};

const CACHE_FILE_NAME = "analysis-cache.json";

/** Per-scope history caps prevent one JSON cache file from retaining revisions forever. */
const CACHE_ENTRY_LIMIT_BY_SCOPE: Record<AnalysisCacheScope, number> = {
  workspace: 2,
  currentFile: 8,
  latest: 1
};

/** In-memory cache for tests and disabled persistent cache mode. */
export class MemoryAnalysisCacheStore implements AnalysisCacheStore {
  /** Scoped graph entries saved during this extension session. */
  private readonly entries = new Map<string, AnalysisCacheEntry>();

  /** Active graph pointer used by sidebar and graph panel load requests. */
  private active: AnalysisCachePointer | undefined;

  public constructor(private readonly maximumEntries = 16) {}

  /** Returns the currently active project graph. */
  public async getLatestGraph(): Promise<ProjectGraph | undefined> {
    return this.active ? this.entries.get(cacheEntryKey(this.active.scope, this.active.cacheKey))?.graph : undefined;
  }

  /** Returns the newest cached graph for one analysis scope. */
  public async getLatestGraphForScope(scope: AnalysisCacheScope): Promise<ProjectGraph | undefined> {
    return newestEntry([...this.entries.values()].filter((entry) => entry.scope === scope))?.graph;
  }

  /** Returns a scoped graph only when the cache key still matches. */
  public async getGraph(scope: AnalysisCacheScope, cacheKey: string): Promise<ProjectGraph | undefined> {
    return this.entries.get(cacheEntryKey(scope, cacheKey))?.graph;
  }

  /** Saves one scoped graph and optionally makes it active. */
  public async saveGraph(entry: AnalysisCacheEntry, activate = true): Promise<void> {
    this.entries.set(cacheEntryKey(entry.scope, entry.cacheKey), entry);

    if (activate) {
      this.active = { scope: entry.scope, cacheKey: entry.cacheKey };
    }
    this.trimEntries();
  }

  /** Saves a graph in the legacy latest slot for older call sites. */
  public async saveLatestGraph(graph: ProjectGraph): Promise<void> {
    await this.saveGraph({
      scope: "latest",
      cacheKey: "latest",
      graph,
      savedAt: new Date().toISOString()
    });
  }

  /** Makes an existing scoped graph the active graph. */
  public async setActiveGraph(scope: AnalysisCacheScope, cacheKey: string): Promise<void> {
    if (this.entries.has(cacheEntryKey(scope, cacheKey))) {
      this.active = { scope, cacheKey };
    }
  }

  /** Clears all in-memory analysis data. */
  public async clear(): Promise<void> {
    this.entries.clear();
    this.active = undefined;
  }

  /** Keeps disabled-persistence sessions from retaining every analyzed revision. */
  private trimEntries(): void {
    const configuredLimit = Math.floor(this.maximumEntries);
    const limit = Number.isFinite(configuredLimit) && configuredLimit > 0
      ? configuredLimit
      : 1;
    while (this.entries.size > limit) {
      const activeKey = this.active
        ? cacheEntryKey(this.active.scope, this.active.cacheKey)
        : undefined;
      const oldest = [...this.entries.entries()]
        .filter(([key]) => key !== activeKey)
        .sort((left, right) =>
          left[1].savedAt.localeCompare(right[1].savedAt)
          || left[0].localeCompare(right[0])
        )[0];
      if (!oldest) {
        break;
      }
      this.entries.delete(oldest[0]);
    }
  }
}

/** File-backed cache store persisted in VS Code workspace storage. */
export class FileAnalysisCacheStore implements AnalysisCacheStore {
  /** Absolute JSON file path that stores graph cache state. */
  private readonly cacheFilePath: string;

  public constructor(
    storageDirectory: string,
    private readonly maxSizeMb: number
  ) {
    this.cacheFilePath = path.join(storageDirectory, CACHE_FILE_NAME);
  }

  /** Returns the currently active persisted project graph. */
  public async getLatestGraph(): Promise<ProjectGraph | undefined> {
    const state = await this.loadState();
    const active = state.active;

    if (!active) {
      return newestEntry(state.entries)?.graph;
    }

    return findEntry(state.entries, active.scope, active.cacheKey)?.graph;
  }

  /** Returns the newest graph for one scope regardless of active view. */
  public async getLatestGraphForScope(scope: AnalysisCacheScope): Promise<ProjectGraph | undefined> {
    const state = await this.loadState();
    return newestEntry(state.entries.filter((entry) => entry.scope === scope))?.graph;
  }

  /** Returns a graph when its scope and cache key match exactly. */
  public async getGraph(scope: AnalysisCacheScope, cacheKey: string): Promise<ProjectGraph | undefined> {
    const state = await this.loadState();
    return findEntry(state.entries, scope, cacheKey)?.graph;
  }

  /** Saves a scoped graph entry and optionally marks it active for the UI. */
  public async saveGraph(entry: AnalysisCacheEntry, activate = true): Promise<void> {
    const state = await this.loadState();
    const nextEntries = state.entries.filter(
      (candidate) => candidate.scope !== entry.scope || candidate.cacheKey !== entry.cacheKey
    );
    nextEntries.push(entry);

    await this.saveState(
      trimCacheState({
        version: 1,
        active: activate ? { scope: entry.scope, cacheKey: entry.cacheKey } : state.active,
        entries: nextEntries
      }, this.maxSizeMb)
    );
  }

  /** Saves a graph in the legacy latest slot for older call sites. */
  public async saveLatestGraph(graph: ProjectGraph): Promise<void> {
    await this.saveGraph({
      scope: "latest",
      cacheKey: "latest",
      graph,
      savedAt: new Date().toISOString()
    });
  }

  /** Marks an existing scoped graph as active. */
  public async setActiveGraph(scope: AnalysisCacheScope, cacheKey: string): Promise<void> {
    const state = await this.loadState();

    if (!findEntry(state.entries, scope, cacheKey)) {
      return;
    }

    await this.saveState(trimCacheState(
      { ...state, active: { scope, cacheKey } },
      this.maxSizeMb
    ));
  }

  /** Removes the persisted cache file. */
  public async clear(): Promise<void> {
    await fs.rm(this.cacheFilePath, { force: true });
  }

  /** Loads persisted state, treating corrupt cache data as a cache miss. */
  private async loadState(): Promise<AnalysisCacheState> {
    try {
      const content = await fs.readFile(this.cacheFilePath, "utf8");
      const parsed = JSON.parse(content) as AnalysisCacheState;

      if (parsed.version === 1 && Array.isArray(parsed.entries)) {
        return parsed;
      }
    } catch {
      // Cache misses and corrupt cache files are equivalent for analysis reuse.
    }

    return { version: 1, entries: [] };
  }

  /** Persists cache state atomically enough for single extension-host writes. */
  private async saveState(state: AnalysisCacheState): Promise<void> {
    await fs.mkdir(path.dirname(this.cacheFilePath), { recursive: true });
    await fs.writeFile(this.cacheFilePath, JSON.stringify(state), "utf8");
  }
}

/** Builds a stable map key for one cache entry. */
function cacheEntryKey(scope: AnalysisCacheScope, cacheKey: string): string {
  return `${scope}:${cacheKey}`;
}

/** Finds a scoped cache entry. */
function findEntry(
  entries: readonly AnalysisCacheEntry[],
  scope: AnalysisCacheScope,
  cacheKey: string
): AnalysisCacheEntry | undefined {
  return entries.find((entry) => entry.scope === scope && entry.cacheKey === cacheKey);
}

/** Returns the newest entry by ISO timestamp. */
function newestEntry(entries: readonly AnalysisCacheEntry[]): AnalysisCacheEntry | undefined {
  return [...entries].sort((left, right) => right.savedAt.localeCompare(left.savedAt))[0];
}

/** Evicts old entries when serialized cache data exceeds the configured budget. */
function trimCacheState(state: AnalysisCacheState, maxSizeMb: number): AnalysisCacheState {
  const maxBytes = Math.max(1, maxSizeMb) * 1024 * 1024;
  const retainedByScope = new Map<AnalysisCacheScope, number>();
  let entries = [...state.entries]
    .sort((left, right) => right.savedAt.localeCompare(left.savedAt))
    .filter((entry) => {
      const retained = retainedByScope.get(entry.scope) ?? 0;
      if (retained >= CACHE_ENTRY_LIMIT_BY_SCOPE[entry.scope]) {
        return false;
      }
      retainedByScope.set(entry.scope, retained + 1);
      return true;
    })
    .filter((entry) => Buffer.byteLength(JSON.stringify({
      version: 1,
      entries: [entry]
    }), "utf8") <= maxBytes);
  let trimmed = { ...state, entries };

  while (Buffer.byteLength(JSON.stringify(trimmed), "utf8") > maxBytes && entries.length > 0) {
    entries = entries.slice(0, -1);
    trimmed = { ...state, entries };
  }

  if (trimmed.active && !findEntry(entries, trimmed.active.scope, trimmed.active.cacheKey)) {
    const newest = newestEntry(entries);
    trimmed = {
      ...trimmed,
      active: newest ? { scope: newest.scope, cacheKey: newest.cacheKey } : undefined
    };
  }

  return trimmed;
}
