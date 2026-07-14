/**
 * Privacy and lifecycle tests for snapshot-local source navigation tokens.
 * Realistic analyzer IDs intentionally contain absolute paths so serialization
 * regressions are observable.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectGraph } from "../../shared/types";
import { SourceNodeTokenRegistry } from "../../webview/sourceNavigation";

test("issues opaque tokens and resolves them only in the active snapshot", () => {
  const privateId = "symbol::/Users/alice/private/app.ts::function::handler::0::0";
  const graph = createGraph(privateId);
  const registry = new SourceNodeTokenRegistry();
  registry.activate("sidebar-snapshot:1", graph);

  const token = registry.createToken(privateId);

  assert.match(token ?? "", /^source-node:[0-9a-f]{64}$/u);
  assert.doesNotMatch(JSON.stringify({ token }), /Users|alice|private|app\.ts/u);
  assert.equal(registry.createToken(privateId), token);
  assert.equal(registry.resolve(token ?? "")?.id, privateId);
  assert.equal(registry.resolve(privateId)?.id, privateId, "legacy active IDs remain supported");
  assert.equal(registry.createToken("missing"), undefined);

  registry.activate("sidebar-snapshot:2", createGraph("replacement"));
  assert.equal(registry.resolve(token ?? ""), undefined);
  assert.equal(registry.resolve(privateId), undefined);
});

/** Creates one concrete graph node whose ID mirrors analyzer output. */
function createGraph(nodeId: string): ProjectGraph {
  const range = { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 7 };
  return {
    workspaceRoot: "/workspace",
    version: "engine-v1",
    generatedAt: "2026-07-14T00:00:00.000Z",
    nodes: [{
      id: nodeId,
      kind: "function",
      name: "handler",
      qualifiedName: "Api.handler",
      filePath: "/workspace/src/handler.ts",
      range,
      selectionRange: range,
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
