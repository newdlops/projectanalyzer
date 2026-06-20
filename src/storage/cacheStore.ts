/**
 * Cache storage contracts. The initial memory implementation supports command
 * flows and tests while a VS Code workspace-state adapter is added later.
 */

import type { ProjectGraph } from "../shared/types";

/** Analysis cache API used by extension services. */
export interface AnalysisCacheStore {
  getLatestGraph(): Promise<ProjectGraph | undefined>;
  saveLatestGraph(graph: ProjectGraph): Promise<void>;
  clear(): Promise<void>;
}

/** In-memory cache for the scaffold and unit tests. */
export class MemoryAnalysisCacheStore implements AnalysisCacheStore {
  /** Latest graph produced by an analysis command in this extension session. */
  private latestGraph: ProjectGraph | undefined;

  /**
   * Returns the most recently saved project graph.
   */
  public async getLatestGraph(): Promise<ProjectGraph | undefined> {
    return this.latestGraph;
  }

  /**
   * Saves the latest project graph for subsequent explorer loads.
   */
  public async saveLatestGraph(graph: ProjectGraph): Promise<void> {
    this.latestGraph = graph;
  }

  /**
   * Clears all in-memory analysis data.
   */
  public async clear(): Promise<void> {
    this.latestGraph = undefined;
  }
}
