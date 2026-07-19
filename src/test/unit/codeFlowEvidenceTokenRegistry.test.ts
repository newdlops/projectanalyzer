/**
 * Statement-evidence token tests. They verify opacity, source membership,
 * range validation, dedupe, and invalidation across immutable graph snapshots.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectGraph, SourceRange } from "../../shared/types";
import { CodeFlowEvidenceTokenRegistry } from "../../webview/codeFlow";

const sourceRange: SourceRange = {
  startLine: 12,
  startCharacter: 4,
  endLine: 12,
  endCharacter: 21
};

test("issues opaque evidence tokens only for active graph source ranges", () => {
  const filePath = "/Users/alice/private/orders.ts";
  const registry = new CodeFlowEvidenceTokenRegistry();
  registry.activate("sidebar-snapshot:1", createGraph(filePath));

  const token = registry.createToken(filePath, sourceRange);

  assert.match(token ?? "", /^code-evidence:[0-9a-f]{64}$/u);
  assert.doesNotMatch(JSON.stringify({ token }), /alice|private|orders/u);
  assert.equal(registry.createToken(filePath, sourceRange), token);
  assert.deepEqual(token ? registry.resolve(token) : undefined, { filePath, range: sourceRange });
  assert.equal(registry.createToken("/tmp/other.ts", sourceRange), undefined);
  assert.equal(registry.createToken(filePath, { ...sourceRange, endLine: 1 }), undefined);

  registry.activate("sidebar-snapshot:2", createGraph("/workspace/replacement.ts"));
  assert.equal(token ? registry.resolve(token) : undefined, undefined);
});

/** Creates the smallest graph authorizing one source file. */
function createGraph(filePath: string): ProjectGraph {
  return {
    workspaceRoot: "/workspace",
    version: "engine-v1",
    generatedAt: "2026-07-19T00:00:00.000Z",
    nodes: [{
      id: "function:handler",
      kind: "function",
      name: "handler",
      qualifiedName: "handler",
      filePath,
      range: sourceRange,
      selectionRange: sourceRange,
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
