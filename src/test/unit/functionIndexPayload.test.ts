/**
 * Unit tests for projecting the host-side Function Index into the Webview
 * protocol payload. These tests guard the JSON-facing boundary separately from
 * the richer Map-backed index internals.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createFunctionIndex } from "../../graph/functionIndex";
import { createFunctionExplorerPayload } from "../../graph/functionIndexPayload";
import type { GraphEdge, ProjectGraph, SourceRange, SymbolNode } from "../../shared/types";

test("createFunctionExplorerPayload maps host rows to protocol rows and section summaries", () => {
  const graph = createPayloadGraph();
  const index = createFunctionIndex(graph, {
    expandedTreeIds: ["function-flows:entrypoints", "function-flows:entrypoints:entrypoint:entry"],
    inventoryLimit: 20
  });
  const payload = createFunctionExplorerPayload(graph, index, { initialRowLimit: 20 });

  assert.equal(payload.graphVersion, graph.version);
  assert.equal(payload.workspaceRoot, graph.workspaceRoot);
  assert.equal(payload.summary.callableNodeCount, 3);
  assert.equal(payload.summary.hiddenByDefaultViewCount, 2);
  assert.deepEqual(payload.options.requestedSections, [
    "entrypoints",
    "hotspots",
    "unresolvedExternal",
    "allFunctions"
  ]);
  assert.ok(payload.sections.some((section) => section.id === "entrypoints" && section.visibleRowCount > 0));
  assert.ok(payload.rows.some((row) => row.sectionId === "entrypoints" && row.functionId === "entry"));
  assert.ok(payload.rows.some((row) => row.kind === "call" && row.sectionId === "entrypoints"));
});

/** Creates a compact graph that exercises entrypoint and external call rows. */
function createPayloadGraph(): ProjectGraph {
  const nodes = [
    createNode("entry", "main", "function", 0),
    createNode("service", "Service.handle", "method", 10),
    createNode("external-fetch", "fetch", "external", 0, "")
  ];
  const edges: GraphEdge[] = [
    {
      id: "entry-service",
      kind: "calls",
      sourceId: "entry",
      targetId: "service",
      filePath: "/workspace/src/main.ts",
      confidence: "exact"
    },
    {
      id: "entry-fetch",
      kind: "calls",
      sourceId: "entry",
      targetId: "external-fetch",
      filePath: "/workspace/src/main.ts",
      confidence: "resolved"
    }
  ];

  return {
    workspaceRoot: "/workspace",
    version: "payload-test",
    generatedAt: "2026-06-21T00:00:00.000Z",
    nodes,
    edges,
    diagnostics: [],
    metadata: {
      languages: ["typescript"],
      fileCount: 2,
      symbolCount: nodes.length,
      edgeCount: edges.length
    }
  };
}

/** Creates a minimal symbol node for payload adapter tests. */
function createNode(
  id: string,
  qualifiedName: string,
  kind: SymbolNode["kind"],
  startLine: number,
  filePath = "/workspace/src/main.ts"
): SymbolNode {
  const range = createRange(startLine);

  return {
    id,
    kind,
    name: qualifiedName.split(".").pop() ?? qualifiedName,
    qualifiedName,
    filePath,
    range,
    selectionRange: range,
    language: kind === "external" ? "external" : "typescript"
  };
}

/** Creates a zero-based source range at a single line. */
function createRange(startLine: number): SourceRange {
  return {
    startLine,
    startCharacter: 0,
    endLine: startLine,
    endCharacter: 1
  };
}
