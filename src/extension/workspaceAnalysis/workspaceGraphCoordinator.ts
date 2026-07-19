/**
 * Workspace-only graph acquisition for extension commands and views.
 *
 * The coordinator reuses only an exact fingerprinted workspace cache entry,
 * shares concurrent analysis through one promise, and keeps VS Code APIs behind
 * injected adapters so acquisition policy remains unit-testable.
 */

import type { AnalysisBackend } from "../../analyzer/core/analysisBackend";
import { normalizeProjectGraphMetadata } from "../../graph/graphMetadata";
import type { ProjectGraph } from "../../shared/types";
import type { AnalysisCacheEntry, AnalysisCacheStore } from "../../storage/cacheStore";

/** Minimal analyzer surface required for a workspace graph. */
export type WorkspaceGraphAnalyzer = Pick<AnalysisBackend, "analyzeWorkspace">;

/** Exact workspace-cache operations used without exposing latest/stale lookup. */
export type WorkspaceGraphCacheStore = Pick<
  AnalysisCacheStore,
  "getGraph" | "saveGraph" | "setActiveGraph"
>;

/** Runtime collaborators supplied by the extension composition root. */
export type WorkspaceGraphCoordinatorDependencies = {
  analyzer: WorkspaceGraphAnalyzer;
  cacheEnabled: boolean;
  cacheStore: WorkspaceGraphCacheStore;
  createWorkspaceCacheKey(workspaceRoot: string): Promise<string>;
  getWorkspaceRoot(): string | undefined;
  /** Clock used only for persisted cache metadata. */
  now?: () => string;
};

/** Explicit result for callers that may run before a folder is open. */
export type WorkspaceGraphResolution =
  | {
      status: "ready";
      source: "analysis" | "exactCache";
      graph: ProjectGraph;
    }
  | {
      status: "unavailable";
      reason: "noWorkspace";
    };

/**
 * Resolves immutable workspace graph snapshots without silently accepting stale
 * cache entries. A rejected request clears its single-flight slot so a later
 * command can retry normally.
 */
export class WorkspaceGraphCoordinator {
  /** The complete acquisition request shared by concurrent callers. */
  private inFlightResolution: Promise<WorkspaceGraphResolution> | undefined;

  public constructor(
    private readonly dependencies: WorkspaceGraphCoordinatorDependencies
  ) {}

  /** Returns an exact cached graph, a freshly analyzed graph, or no-workspace. */
  public async resolveWorkspaceGraph(): Promise<WorkspaceGraphResolution> {
    if (this.inFlightResolution) {
      return this.inFlightResolution;
    }

    const resolution = this.resolveWorkspaceGraphOnce();
    this.inFlightResolution = resolution;

    try {
      return await resolution;
    } finally {
      if (this.inFlightResolution === resolution) {
        this.inFlightResolution = undefined;
      }
    }
  }

  /** Performs one workspace-root snapshot acquisition from cache or analysis. */
  private async resolveWorkspaceGraphOnce(): Promise<WorkspaceGraphResolution> {
    const workspaceRoot = this.dependencies.getWorkspaceRoot();
    if (!workspaceRoot || workspaceRoot.trim().length === 0) {
      return { status: "unavailable", reason: "noWorkspace" };
    }

    if (!this.dependencies.cacheEnabled) {
      return this.analyzeWorkspace(undefined);
    }

    const cacheKey = await this.tryCreateWorkspaceCacheKey(workspaceRoot);
    if (!cacheKey) {
      // Without an exact fingerprint, neither reading nor writing a reusable
      // entry is safe. Fresh analysis still lets the explicit command proceed.
      return this.analyzeWorkspace(undefined);
    }

    const cachedGraph = await this.dependencies.cacheStore.getGraph("workspace", cacheKey);
    if (cachedGraph) {
      await this.dependencies.cacheStore.setActiveGraph("workspace", cacheKey);
      return {
        status: "ready",
        source: "exactCache",
        graph: normalizeProjectGraphMetadata(cachedGraph)
      };
    }

    return this.analyzeWorkspace(cacheKey);
  }

  /**
   * Creates the exact workspace fingerprint. Fingerprint failures bypass cache
   * rather than falling back to a potentially stale latest entry.
   */
  private async tryCreateWorkspaceCacheKey(workspaceRoot: string): Promise<string | undefined> {
    try {
      const cacheKey = (await this.dependencies.createWorkspaceCacheKey(workspaceRoot)).trim();
      return cacheKey || undefined;
    } catch {
      return undefined;
    }
  }

  /** Runs and normalizes analysis, persisting only when an exact key is known. */
  private async analyzeWorkspace(cacheKey: string | undefined): Promise<WorkspaceGraphResolution> {
    const result = await this.dependencies.analyzer.analyzeWorkspace();
    const graph = normalizeProjectGraphMetadata(result.graph);

    if (cacheKey) {
      const entry: AnalysisCacheEntry = {
        scope: "workspace",
        cacheKey,
        graph,
        label: "Workspace analysis",
        savedAt: (this.dependencies.now ?? defaultNow)()
      };
      await this.dependencies.cacheStore.saveGraph(entry);
    }

    return { status: "ready", source: "analysis", graph };
  }
}

/** Returns an ISO timestamp for persisted cache ordering. */
function defaultNow(): string {
  return new Date().toISOString();
}
