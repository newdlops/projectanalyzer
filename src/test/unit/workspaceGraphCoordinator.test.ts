/**
 * Unit tests for exact workspace graph acquisition.
 *
 * The fixtures exercise cache isolation, disabled-cache freshness, single-flight
 * concurrency, retry after failure, metadata normalization, and no-workspace
 * results without loading the VS Code runtime.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  WorkspaceGraphCoordinator,
  type WorkspaceGraphAnalyzer,
  type WorkspaceGraphCacheStore
} from "../../extension/workspaceAnalysis";
import type { AnalyzeResult } from "../../analyzer/core/analyzerPipeline";
import type { ProjectGraph } from "../../shared/types";
import type {
  AnalysisCacheEntry,
  AnalysisCacheScope
} from "../../storage/cacheStore";

/** In-memory exact-cache test double that records every allowed operation. */
class RecordingWorkspaceCache implements WorkspaceGraphCacheStore {
  private readonly entries = new Map<string, ProjectGraph>();

  public readonly getRequests: Array<{ scope: AnalysisCacheScope; cacheKey: string }> = [];
  public readonly savedEntries: AnalysisCacheEntry[] = [];
  public readonly activeRequests: Array<{ scope: AnalysisCacheScope; cacheKey: string }> = [];

  /** Seeds one exact entry without recording a coordinator write. */
  public seed(scope: AnalysisCacheScope, cacheKey: string, graph: ProjectGraph): void {
    this.entries.set(createEntryKey(scope, cacheKey), graph);
  }

  public async getGraph(
    scope: AnalysisCacheScope,
    cacheKey: string
  ): Promise<ProjectGraph | undefined> {
    this.getRequests.push({ scope, cacheKey });
    return this.entries.get(createEntryKey(scope, cacheKey));
  }

  public async saveGraph(entry: AnalysisCacheEntry): Promise<void> {
    this.savedEntries.push(entry);
    this.entries.set(createEntryKey(entry.scope, entry.cacheKey), entry.graph);
  }

  public async setActiveGraph(scope: AnalysisCacheScope, cacheKey: string): Promise<void> {
    this.activeRequests.push({ scope, cacheKey });
  }
}

test("returns and activates only the exact workspace cache entry", async () => {
  const cache = new RecordingWorkspaceCache();
  const cachedGraph = createGraph("cached");
  cache.seed("workspace", "exact-key", cachedGraph);
  cache.seed("workspace", "stale-key", createGraph("stale"));
  let analyzerCalls = 0;
  const coordinator = createCoordinator({
    cache,
    analyzer: {
      async analyzeWorkspace(): Promise<AnalyzeResult> {
        analyzerCalls += 1;
        return { graph: createGraph("analyzed") };
      }
    }
  });

  const result = await coordinator.resolveWorkspaceGraph();

  assert.equal(result.status, "ready");
  if (result.status !== "ready") {
    return;
  }
  assert.equal(result.source, "exactCache");
  assert.equal(result.graph.nodes[0]?.id, "cached");
  assert.deepEqual(cache.getRequests, [{ scope: "workspace", cacheKey: "exact-key" }]);
  assert.deepEqual(cache.activeRequests, [{ scope: "workspace", cacheKey: "exact-key" }]);
  assert.equal(cache.savedEntries.length, 0);
  assert.equal(analyzerCalls, 0);
  assertNormalizedMetadata(result.graph);
});

test("analyzes and stores a normalized graph after an exact cache miss", async () => {
  const cache = new RecordingWorkspaceCache();
  const coordinator = createCoordinator({
    cache,
    now: () => "2026-07-19T00:00:00.000Z"
  });

  const result = await coordinator.resolveWorkspaceGraph();

  assert.equal(result.status, "ready");
  if (result.status !== "ready") {
    return;
  }
  assert.equal(result.source, "analysis");
  assertNormalizedMetadata(result.graph);
  assert.equal(cache.savedEntries.length, 1);
  assert.deepEqual(cache.savedEntries[0], {
    scope: "workspace",
    cacheKey: "exact-key",
    graph: result.graph,
    label: "Workspace analysis",
    savedAt: "2026-07-19T00:00:00.000Z"
  });
});

test("disabled cache performs fresh analysis without any cache or fingerprint access", async () => {
  const cache = new RecordingWorkspaceCache();
  let analyzerCalls = 0;
  let fingerprintCalls = 0;
  const coordinator = createCoordinator({
    cache,
    cacheEnabled: false,
    analyzer: {
      async analyzeWorkspace(): Promise<AnalyzeResult> {
        analyzerCalls += 1;
        return { graph: createGraph(`fresh-${analyzerCalls}`) };
      }
    },
    async createWorkspaceCacheKey(): Promise<string> {
      fingerprintCalls += 1;
      return "must-not-be-used";
    }
  });

  const first = await coordinator.resolveWorkspaceGraph();
  const second = await coordinator.resolveWorkspaceGraph();

  assert.equal(first.status === "ready" ? first.graph.nodes[0]?.id : undefined, "fresh-1");
  assert.equal(second.status === "ready" ? second.graph.nodes[0]?.id : undefined, "fresh-2");
  assert.equal(analyzerCalls, 2);
  assert.equal(fingerprintCalls, 0);
  assert.equal(cache.getRequests.length, 0);
  assert.equal(cache.savedEntries.length, 0);
  assert.equal(cache.activeRequests.length, 0);
});

test("shares one in-flight analysis across concurrent callers", async () => {
  const cache = new RecordingWorkspaceCache();
  const analysis = createDeferred<AnalyzeResult>();
  let analyzerCalls = 0;
  const coordinator = createCoordinator({
    cache,
    cacheEnabled: false,
    analyzer: {
      analyzeWorkspace(): Promise<AnalyzeResult> {
        analyzerCalls += 1;
        return analysis.promise;
      }
    }
  });

  const firstRequest = coordinator.resolveWorkspaceGraph();
  const secondRequest = coordinator.resolveWorkspaceGraph();
  assert.equal(analyzerCalls, 1);

  analysis.resolve({ graph: createGraph("single-flight") });
  const [first, second] = await Promise.all([firstRequest, secondRequest]);

  assert.equal(first.status === "ready" ? first.graph.nodes[0]?.id : undefined, "single-flight");
  assert.equal(second.status === "ready" ? second.graph.nodes[0]?.id : undefined, "single-flight");
  assert.equal(analyzerCalls, 1);
});

test("clears failed single-flight state so a later request can retry", async () => {
  const cache = new RecordingWorkspaceCache();
  let analyzerCalls = 0;
  const coordinator = createCoordinator({
    cache,
    cacheEnabled: false,
    analyzer: {
      async analyzeWorkspace(): Promise<AnalyzeResult> {
        analyzerCalls += 1;
        if (analyzerCalls === 1) {
          throw new Error("first analysis failed");
        }
        return { graph: createGraph("retry-success") };
      }
    }
  });

  await assert.rejects(
    coordinator.resolveWorkspaceGraph(),
    /first analysis failed/u
  );
  const retried = await coordinator.resolveWorkspaceGraph();

  assert.equal(retried.status === "ready" ? retried.graph.nodes[0]?.id : undefined, "retry-success");
  assert.equal(analyzerCalls, 2);
});

test("bypasses all cache operations when fingerprint creation fails", async () => {
  const cache = new RecordingWorkspaceCache();
  let analyzerCalls = 0;
  const coordinator = createCoordinator({
    cache,
    analyzer: {
      async analyzeWorkspace(): Promise<AnalyzeResult> {
        analyzerCalls += 1;
        return { graph: createGraph("fingerprint-fallback") };
      }
    },
    async createWorkspaceCacheKey(): Promise<string> {
      throw new Error("fingerprint unavailable");
    }
  });

  const result = await coordinator.resolveWorkspaceGraph();

  assert.equal(result.status === "ready" ? result.graph.nodes[0]?.id : undefined, "fingerprint-fallback");
  assert.equal(analyzerCalls, 1);
  assert.equal(cache.getRequests.length, 0);
  assert.equal(cache.savedEntries.length, 0);
  assert.equal(cache.activeRequests.length, 0);
});

test("expresses a missing workspace without touching analysis or cache", async () => {
  const cache = new RecordingWorkspaceCache();
  let analyzerCalls = 0;
  let fingerprintCalls = 0;
  const coordinator = createCoordinator({
    cache,
    getWorkspaceRoot: () => undefined,
    analyzer: {
      async analyzeWorkspace(): Promise<AnalyzeResult> {
        analyzerCalls += 1;
        return { graph: createGraph("unexpected") };
      }
    },
    async createWorkspaceCacheKey(): Promise<string> {
      fingerprintCalls += 1;
      return "unexpected";
    }
  });

  const result = await coordinator.resolveWorkspaceGraph();

  assert.deepEqual(result, { status: "unavailable", reason: "noWorkspace" });
  assert.equal(analyzerCalls, 0);
  assert.equal(fingerprintCalls, 0);
  assert.equal(cache.getRequests.length, 0);
});

test("workspace fingerprint schema is version 3", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src", "vscode", "workspaceFingerprint.ts"),
    "utf8"
  );

  assert.match(source, /WORKSPACE_CACHE_KEY_VERSION = "workspace-cache-v3"/u);
});

/** Creates a coordinator with deterministic defaults overridden per scenario. */
function createCoordinator(options: {
  cache: RecordingWorkspaceCache;
  analyzer?: WorkspaceGraphAnalyzer;
  cacheEnabled?: boolean;
  createWorkspaceCacheKey?: (workspaceRoot: string) => Promise<string>;
  getWorkspaceRoot?: () => string | undefined;
  now?: () => string;
}): WorkspaceGraphCoordinator {
  return new WorkspaceGraphCoordinator({
    analyzer: options.analyzer ?? {
      async analyzeWorkspace(): Promise<AnalyzeResult> {
        return { graph: createGraph("analyzed") };
      }
    },
    cacheEnabled: options.cacheEnabled ?? true,
    cacheStore: options.cache,
    createWorkspaceCacheKey: options.createWorkspaceCacheKey
      ?? (async () => "exact-key"),
    getWorkspaceRoot: options.getWorkspaceRoot ?? (() => "/workspace"),
    now: options.now
  });
}

/** Creates a small legacy-shaped graph whose optional metadata needs defaults. */
function createGraph(nodeId: string): ProjectGraph {
  return {
    workspaceRoot: "/workspace",
    version: "workspace-graph-test",
    generatedAt: "2026-07-19T00:00:00.000Z",
    nodes: [{
      id: nodeId,
      kind: "file",
      name: `${nodeId}.ts`,
      qualifiedName: `${nodeId}.ts`,
      filePath: `/workspace/${nodeId}.ts`,
      range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 0 },
      selectionRange: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 0 },
      language: "typescript"
    }],
    edges: [],
    diagnostics: [],
    metadata: {
      languages: ["typescript"],
      fileCount: 1,
      symbolCount: 1,
      edgeCount: 0
    }
  };
}

/** Verifies optional graph metadata is safe for downstream module projection. */
function assertNormalizedMetadata(graph: ProjectGraph): void {
  assert.deepEqual(graph.metadata.languageSummary, [{
    language: "typescript",
    fileCount: 1,
    percentage: 100
  }]);
  assert.deepEqual(graph.metadata.frameworks, []);
  assert.deepEqual(graph.metadata.projectPackageRoots, []);
  assert.deepEqual(graph.metadata.frameworkUnits, []);
  assert.deepEqual(graph.metadata.frameworkUnitEdges, []);
}

/** Creates a manually controlled promise for single-flight concurrency tests. */
function createDeferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve(value: T): void {
      resolvePromise?.(value);
    }
  };
}

/** Creates the exact composite identity used by the cache test double. */
function createEntryKey(scope: AnalysisCacheScope, cacheKey: string): string {
  return `${scope}:${cacheKey}`;
}
