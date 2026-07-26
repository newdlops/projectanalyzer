/** Unit tests for same-snapshot Graph Panel payload suppression. */

import assert from "node:assert/strict";
import test from "node:test";
import {
  GraphPanelPayloadDelivery,
  normalizeGraphPanelNodeBudget
} from "../../webview/graphPanel";
import type { ProjectGraph } from "../../shared/types";

test("suppresses the same default projection but distinguishes graph object identity", () => {
  const delivery = new GraphPanelPayloadDelivery();
  const graph = createGraph("same-version", ["file-a", "file-b"]);
  const replacement = createGraph("same-version", ["file-a", "file-b"]);
  const projected = createGraph("same-version", ["file-a"]);

  assert.equal(delivery.needsDelivery(graph, "file"), true);
  delivery.record(graph, "file", projected);
  assert.equal(delivery.needsDelivery(graph, "file"), false);
  assert.equal(delivery.needsDelivery(graph, "call"), true);
  assert.equal(delivery.needsDelivery(replacement, "file"), true);
});

test("reprojects only when a focus was omitted and resets focus projections on normal load", () => {
  const delivery = new GraphPanelPayloadDelivery();
  const graph = createGraph("graph", ["file-a", "file-b"]);
  delivery.record(graph, "file", createGraph("graph", ["file-a"]));

  assert.equal(delivery.needsDelivery(graph, "file", "file-a"), false);
  assert.equal(delivery.needsDelivery(graph, "file", "file-b"), true);

  delivery.record(graph, "file", createGraph("graph", ["file-b"]), "file-b");
  assert.equal(delivery.needsDelivery(graph, "file", "file-b"), false);
  assert.equal(delivery.needsDelivery(graph, "file"), true);

  delivery.clear();
  assert.equal(delivery.needsDelivery(graph, "file"), true);
});

test("normalizes the Graph Panel budget against invalid or excessive settings", () => {
  assert.equal(normalizeGraphPanelNodeBudget(Number.NaN), 500);
  assert.equal(normalizeGraphPanelNodeBudget(0), 1);
  assert.equal(normalizeGraphPanelNodeBudget(120.9), 120);
  assert.equal(normalizeGraphPanelNodeBudget(50_000), 2_000);
});

/** Creates the minimum protocol-shaped graph needed by delivery state. */
function createGraph(version: string, nodeIds: string[]): ProjectGraph {
  return {
    workspaceRoot: "/workspace",
    version,
    generatedAt: "2026-07-21T00:00:00.000Z",
    nodes: nodeIds.map((id) => ({
      id,
      kind: "file",
      name: id,
      qualifiedName: id,
      filePath: `/workspace/${id}.ts`,
      range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 0 },
      selectionRange: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 0 },
      language: "typescript"
    })),
    edges: [],
    diagnostics: [],
    metadata: {
      languages: ["typescript"],
      fileCount: nodeIds.length,
      symbolCount: nodeIds.length,
      edgeCount: 0
    }
  };
}
