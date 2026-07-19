/** Unit tests for snapshot-local Module Flow source-range authorization. */

import assert from "node:assert/strict";
import test from "node:test";

import type { ProjectGraph, SourceRange } from "../../shared/types";
import { ModuleFlowEvidenceTokenRegistry } from "../../webview/moduleVisualizer/moduleFlowEvidenceTokenRegistry";

const RANGE: SourceRange = {
  startLine: 4,
  startCharacter: 2,
  endLine: 4,
  endCharacter: 12
};

test("issues stable opaque evidence tokens only for active graph locations", () => {
  const registry = new ModuleFlowEvidenceTokenRegistry();
  const graph = createGraph("/workspace/src/api.ts");
  registry.activate("sidebar-snapshot:test:1", graph);

  const first = registry.createToken("/workspace/src/api.ts", RANGE);
  const repeated = registry.createToken("/workspace/src/api.ts", { ...RANGE });

  assert.match(first ?? "", /^module-flow-evidence:[0-9a-f]{64}$/u);
  assert.equal(repeated, first);
  assert.deepEqual(first ? registry.resolve(first) : undefined, {
    filePath: "/workspace/src/api.ts",
    range: RANGE
  });
  assert.equal(registry.createToken("/outside/secret.ts", RANGE), undefined);
  assert.equal(registry.createToken("/workspace/src/api.ts", {
    ...RANGE,
    endLine: 3
  }), undefined);
});

test("rotates evidence authority with the graph snapshot and clears mappings", () => {
  const registry = new ModuleFlowEvidenceTokenRegistry();
  const graph = createGraph("/workspace/src/api.ts");
  registry.activate("sidebar-snapshot:test:1", graph);
  const previous = registry.createToken("/workspace/src/api.ts", RANGE);
  assert.ok(previous);

  registry.activate("sidebar-snapshot:test:2", graph);
  const replacement = registry.createToken("/workspace/src/api.ts", RANGE);
  assert.ok(replacement);
  assert.notEqual(replacement, previous);
  assert.equal(registry.resolve(previous), undefined);

  registry.clear();
  assert.equal(registry.resolve(replacement), undefined);
  assert.equal(registry.createToken("/workspace/src/api.ts", RANGE), undefined);
});

/** Creates the smallest immutable graph needed to authorize one source file. */
function createGraph(filePath: string): ProjectGraph {
  return {
    workspaceRoot: "/workspace",
    version: "evidence-fixture-v1",
    generatedAt: "2026-07-19T00:00:00.000Z",
    nodes: [{
      id: "file:api",
      kind: "file",
      name: "api.ts",
      qualifiedName: "src/api.ts",
      filePath,
      range: { ...RANGE },
      selectionRange: { ...RANGE },
      language: "typescript"
    }],
    edges: [],
    diagnostics: [],
    metadata: {
      languages: ["typescript"],
      projectPackageRoots: [],
      frameworkUnits: [],
      frameworkUnitEdges: [],
      fileCount: 1,
      symbolCount: 0,
      edgeCount: 0
    }
  };
}
