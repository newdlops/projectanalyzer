/**
 * Unit tests for the Function Flows browser helper. The fixture keeps a small
 * direct call graph with entrypoints, fan-in/fan-out hotspots, and both
 * external and unresolved calls.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  createFunctionFlowTreeRows,
  getFunctionFlowsBrowserSource
} from "../../webview/explorerFunctionFlows";
import type { EdgeConfidence, GraphEdge, ProjectGraph, SymbolNode } from "../../shared/types";

test("createFunctionFlowTreeRows exposes stable top-level flow sections", () => {
  const rows = createFunctionFlowTreeRows(createFunctionFlowFixtureGraph(), new Set());

  assert.deepEqual(
    rows.map((row) => row.label),
    ["Entrypoints", "Hotspots", "Unresolved / External", "All Functions"]
  );
  assert.deepEqual(
    rows.map((row) => row.id),
    [
      "function-flows:entrypoints",
      "function-flows:hotspots",
      "function-flows:unresolved-external",
      "function-flows:all-functions"
    ]
  );
});

test("createFunctionFlowTreeRows expands entrypoints to direct callees only", () => {
  const rows = createFunctionFlowTreeRows(
    createFunctionFlowFixtureGraph(),
    new Set(["function-flows:entrypoints", "function-flows:entrypoints:entrypoint:entry"])
  );
  const entrypoint = rows.find((row) => row.id === "function-flows:entrypoints:entrypoint:entry");
  const callees = rows.filter((row) => row.id.startsWith("function-flows:entrypoints:entrypoint:entry:callee:"));

  assert.ok(entrypoint);
  assert.equal(entrypoint.expanded, true);
  assert.equal(entrypoint.depth, 1);
  assert.deepEqual(
    callees.map((row) => row.label).sort(),
    ["Service.handle", "formatResult"]
  );
  assert.deepEqual(
    callees.map((row) => row.depth),
    [2, 2]
  );
  assert.ok(callees.every((row) => !row.hasChildren));
});

test("createFunctionFlowTreeRows ranks high fan-in and fan-out hotspots", () => {
  const rows = createFunctionFlowTreeRows(
    createFunctionFlowFixtureGraph(),
    new Set(["function-flows:hotspots"])
  );
  const hotspotRows = rows.filter((row) => row.id.startsWith("function-flows:hotspots:hotspot:"));

  assert.ok(hotspotRows.length > 0);
  assert.equal(hotspotRows[0].nodeId, "service");
  assert.match(hotspotRows[0].detail, /high fan-out/);
  assert.match(hotspotRows[0].detail, /fan-out 3/);
  assert.ok(hotspotRows.some((row) => row.nodeId === "format"));
});

test("createFunctionFlowTreeRows summarizes external and unresolved calls", () => {
  const rows = createFunctionFlowTreeRows(
    createFunctionFlowFixtureGraph(),
    new Set([
      "function-flows:unresolved-external",
      "function-flows:unresolved-external:unresolved",
      "function-flows:unresolved-external:external"
    ])
  );
  const section = rows.find((row) => row.id === "function-flows:unresolved-external");
  const unresolved = rows.find((row) => row.id === "function-flows:unresolved-external:unresolved");
  const external = rows.find((row) => row.id === "function-flows:unresolved-external:external");

  assert.ok(section);
  assert.match(section.detail, /1 unresolved/);
  assert.match(section.detail, /1 external/);
  assert.ok(unresolved);
  assert.equal(unresolved.detail, "1 calls / 1 targets");
  assert.ok(external);
  assert.equal(external.detail, "1 calls / 1 targets");
  assert.ok(rows.some((row) => row.label === "Service.handle -> persistUnknown"));
  assert.ok(rows.some((row) => row.label === "Service.handle -> fetch"));
});

test("getFunctionFlowsBrowserSource injects executable browser helpers", () => {
  const script = getFunctionFlowsBrowserSource();
  const createRows = new Function(script + "\nreturn createFunctionFlowTreeRows;")() as typeof createFunctionFlowTreeRows;

  assert.match(script, /createFunctionFlowTreeRows/);
  assert.doesNotThrow(() => new Function(script));
  assert.equal(createRows(createFunctionFlowFixtureGraph(), new Set())[0]?.label, "Entrypoints");
});

/** Creates a minimal graph fixture for Function Flows row generation. */
function createFunctionFlowFixtureGraph(): ProjectGraph {
  const nodes = [
    createFunctionNode("entry", "main", "main", "src/main.ts", 1),
    createFunctionNode("service", "handle", "Service.handle", "src/service.ts", 1, "method"),
    createFunctionNode("format", "formatResult", "formatResult", "src/format.ts", 1),
    createFunctionNode("worker", "worker", "worker", "src/worker.ts", 1),
    createExternalNode("external-fetch", "fetch")
  ];
  const edges = [
    createCallEdge("entry-service", "entry", "service"),
    createCallEdge("entry-format", "entry", "format"),
    createCallEdge("service-format", "service", "format"),
    createCallEdge("service-external", "service", "external-fetch"),
    createCallEdge("service-missing", "service", "missing:persist", "unresolved", {
      callName: "persistUnknown"
    }),
    createCallEdge("worker-format", "worker", "format")
  ];

  return {
    workspaceRoot: "/workspace",
    version: "test",
    generatedAt: "2026-06-21T00:00:00.000Z",
    nodes,
    edges,
    diagnostics: [],
    metadata: {
      languages: ["typescript"],
      fileCount: 4,
      symbolCount: nodes.length,
      edgeCount: edges.length
    }
  };
}

/** Creates a callable symbol node for the Function Flows fixture. */
function createFunctionNode(
  id: string,
  name: string,
  qualifiedName: string,
  filePath: string,
  startLine: number,
  kind: "function" | "method" | "constructor" = "function"
): SymbolNode {
  return {
    id,
    kind,
    name,
    qualifiedName,
    filePath: "/workspace/" + filePath,
    range: {
      startLine,
      startCharacter: 0,
      endLine: startLine,
      endCharacter: 1
    },
    selectionRange: {
      startLine,
      startCharacter: 0,
      endLine: startLine,
      endCharacter: 1
    },
    language: "typescript"
  };
}

/** Creates an external placeholder node used by external call summaries. */
function createExternalNode(id: string, name: string): SymbolNode {
  return {
    id,
    kind: "external",
    name,
    qualifiedName: name,
    filePath: "",
    range: {
      startLine: 0,
      startCharacter: 0,
      endLine: 0,
      endCharacter: 0
    },
    selectionRange: {
      startLine: 0,
      startCharacter: 0,
      endLine: 0,
      endCharacter: 0
    },
    language: "external"
  };
}

/** Creates a direct call edge with optional confidence and metadata. */
function createCallEdge(
  id: string,
  sourceId: string,
  targetId: string,
  confidence: EdgeConfidence = "exact",
  metadata?: Record<string, unknown>
): GraphEdge {
  return {
    id,
    kind: "calls",
    sourceId,
    targetId,
    filePath: "/workspace/src/main.ts",
    confidence,
    metadata
  };
}
