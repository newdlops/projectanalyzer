/**
 * Unit tests for scoped analysis cache storage.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { FileAnalysisCacheStore, MemoryAnalysisCacheStore } from "../../storage/cacheStore";
import type { ProjectGraph } from "../../shared/types";

test("MemoryAnalysisCacheStore restores active scoped graphs independently", async () => {
  const store = new MemoryAnalysisCacheStore();
  const workspaceGraph = createGraph("/workspace", "workspace-file");
  const fileGraph = createGraph("/workspace", "current-file");

  await store.saveGraph({
    scope: "workspace",
    cacheKey: "workspace-key",
    graph: workspaceGraph,
    savedAt: "2026-06-21T00:00:00.000Z"
  });
  await store.saveGraph({
    scope: "currentFile",
    cacheKey: "file-key",
    graph: fileGraph,
    savedAt: "2026-06-21T00:01:00.000Z"
  });

  assert.equal((await store.getLatestGraph())?.nodes[0]?.id, "current-file");
  await store.setActiveGraph("workspace", "workspace-key");
  assert.equal((await store.getLatestGraph())?.nodes[0]?.id, "workspace-file");
  assert.equal((await store.getGraph("currentFile", "file-key"))?.nodes[0]?.id, "current-file");
});

test("FileAnalysisCacheStore persists scoped graph entries", async () => {
  const storageDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "project-analyzer-cache-"));
  const workspaceGraph = createGraph("/workspace", "workspace-file");

  try {
    const writer = new FileAnalysisCacheStore(storageDirectory, 8);
    await writer.saveGraph({
      scope: "workspace",
      cacheKey: "workspace-key",
      graph: workspaceGraph,
      savedAt: "2026-06-21T00:00:00.000Z"
    });

    const reader = new FileAnalysisCacheStore(storageDirectory, 8);
    assert.equal((await reader.getGraph("workspace", "workspace-key"))?.nodes[0]?.id, "workspace-file");
    assert.equal((await reader.getLatestGraphForScope("workspace"))?.nodes[0]?.id, "workspace-file");
  } finally {
    await fs.rm(storageDirectory, { recursive: true, force: true });
  }
});

/** Creates the smallest valid graph payload for cache tests. */
function createGraph(workspaceRoot: string, nodeId: string): ProjectGraph {
  return {
    workspaceRoot,
    version: "test",
    generatedAt: "2026-06-21T00:00:00.000Z",
    nodes: [
      {
        id: nodeId,
        kind: "file",
        name: `${nodeId}.ts`,
        qualifiedName: `${nodeId}.ts`,
        filePath: `${workspaceRoot}/${nodeId}.ts`,
        range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 0 },
        selectionRange: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 0 },
        language: "typescript"
      }
    ],
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
