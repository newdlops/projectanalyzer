/**
 * Unit tests for the Function Explorer inventory foundation. The fixtures keep
 * external and unresolved call targets in the graph summary so completeness
 * regressions are caught before Webview rendering is added.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  createAllFunctionsInventoryRows,
  createFunctionUniverse,
  getFunctionInventoryBrowserSource
} from "../../webview/explorerFunctionInventory";
import type { EdgeConfidence, GraphEdge, ProjectGraph, SourceRange, SymbolKind, SymbolNode } from "../../shared/types";

test("createFunctionUniverse preserves callable, external, and unresolved call targets", () => {
  const graph = createInventoryGraph();
  const universe = createFunctionUniverse(graph);
  const entry = requireUniverseNode(universe, "entry");
  const service = requireUniverseNode(universe, "service");
  const utility = requireUniverseNode(universe, "utility");
  const external = requireUniverseNode(universe, "external:pkg.call");
  const unresolved = requireUniverseNode(universe, "unresolved:missing-call-target");

  assert.equal(universe.summary.callableNodeCount, 6);
  assert.equal(universe.summary.callEdgeCount, 5);
  assert.equal(universe.summary.externalCallableCount, 1);
  assert.equal(universe.summary.unresolvedCallableCount, 1);
  assert.equal(universe.summary.externalCallEdgeCount, 1);
  assert.equal(universe.summary.unresolvedCallEdgeCount, 1);
  assert.equal(universe.summary.inferredCallEdgeCount, 1);
  assert.equal(universe.summary.parserFailureCount, 1);
  assert.equal(universe.summary.excludedFileCount, 1);
  assert.equal(universe.summary.visibleByDefaultViewCount, 1);
  assert.equal(universe.summary.hiddenByDefaultViewCount, 5);
  assert.equal(universe.nodesById.has("external:unused"), false);

  assert.equal(entry.role, "entrypoint");
  assert.equal(entry.metrics.directCallerCount, 0);
  assert.equal(entry.metrics.directCalleeCount, 2);
  assert.equal(entry.metrics.reachableEntrypointCount, 1);

  assert.equal(service.metrics.directCallerCount, 1);
  assert.equal(service.metrics.directCalleeCount, 3);
  assert.equal(service.metrics.externalCallCount, 1);
  assert.equal(service.metrics.unresolvedCallCount, 1);
  assert.deepEqual(service.tags, ["externalCall", "unresolvedCall"]);

  assert.equal(utility.role, "utility");
  assert.deepEqual(utility.tags, ["leaf", "sharedUtility"]);
  assert.equal(external.role, "external");
  assert.equal(unresolved.role, "unresolved");
  assert.equal(unresolved.name, "missingCall");

  assert.deepEqual(
    universe.calleesByNodeId.get("service")?.map((relation) => relation.kind),
    ["external", "function", "unresolved"]
  );
  assert.deepEqual(
    universe.callersByNodeId.get("utility")?.map((relation) => relation.nodeId),
    ["entry", "service"]
  );
});

test("createAllFunctionsInventoryRows returns sidebar-compatible flat rows", () => {
  const universe = createFunctionUniverse(createInventoryGraph());
  const rows = createAllFunctionsInventoryRows(universe, { sortBy: "name" });
  const entryRow = requireRow(rows, "function-inventory:entry");
  const externalRow = requireRow(rows, "function-inventory:external:pkg.call");
  const unresolvedRow = requireRow(rows, "function-inventory:unresolved:missing-call-target");

  assert.equal(rows.length, 6);
  assert.equal(entryRow.kind, "semantic");
  assert.equal(entryRow.nodeId, "entry");
  assert.equal(entryRow.hasChildren, false);
  assert.equal(entryRow.expanded, false);
  assert.equal(externalRow.kind, "external");
  assert.equal(externalRow.nodeId, undefined);
  assert.equal(unresolvedRow.kind, "unresolved");
  assert.equal(unresolvedRow.nodeId, undefined);

  assert.deepEqual(
    createAllFunctionsInventoryRows(universe, {
      query: "missing",
      includeUnresolved: true
    }).map((row) => row.id),
    ["function-inventory:unresolved:missing-call-target"]
  );
  assert.deepEqual(
    createAllFunctionsInventoryRows(universe, {
      query: "missing",
      includeUnresolved: false
    }).map((row) => row.id),
    []
  );
  assert.equal(createAllFunctionsInventoryRows(universe, { sortBy: "fan-in" })[0]?.nodeId, "utility");
});

test("getFunctionInventoryBrowserSource injects executable inventory helpers", () => {
  const script = getFunctionInventoryBrowserSource();
  const helpers = new Function(
    script + "\nreturn { createFunctionUniverse, createAllFunctionsInventoryRows };"
  )() as {
    createAllFunctionsInventoryRows: typeof createAllFunctionsInventoryRows;
    createFunctionUniverse: typeof createFunctionUniverse;
  };
  const universe = helpers.createFunctionUniverse(createInventoryGraph());

  assert.match(script, /createFunctionUniverse/);
  assert.doesNotThrow(() => new Function(script));
  assert.equal(universe.summary.callableNodeCount, 6);
  assert.equal(helpers.createAllFunctionsInventoryRows(universe).length, 6);
});

/**
 * Creates a graph with real callables, one used external placeholder, one
 * unused external node, and one missing calls target.
 */
function createInventoryGraph(): ProjectGraph {
  const nodes = [
    createTestNode("entry", "function", 0),
    createTestNode("service", "method", 10),
    createTestNode("utility", "function", 20),
    createTestNode("ctor", "constructor", 30),
    createTestNode("external:pkg.call", "external", 0, ""),
    createTestNode("external:unused", "external", 0, "")
  ];
  const edges = [
    createCallEdge("entry-service", "entry", "service"),
    createCallEdge("service-external", "service", "external:pkg.call", "resolved"),
    createCallEdge("service-missing", "service", "missing-call-target", "unresolved", {
      callName: "missingCall"
    }),
    createCallEdge("entry-utility", "entry", "utility", "inferred"),
    createCallEdge("service-utility", "service", "utility")
  ];

  return {
    workspaceRoot: "/workspace",
    version: "test-version",
    generatedAt: "2026-06-21T00:00:00.000Z",
    nodes,
    edges,
    diagnostics: [
      {
        severity: "error",
        code: "parser.failure",
        message: "Parse failed for bad.ts"
      },
      {
        severity: "info",
        code: "file.skipped",
        message: "Skipped generated file"
      }
    ],
    metadata: {
      languages: ["typescript"],
      fileCount: 1,
      symbolCount: nodes.length,
      edgeCount: edges.length
    }
  };
}

/**
 * Creates a minimal symbol node for inventory tests.
 */
function createTestNode(
  id: string,
  kind: SymbolKind,
  startLine: number,
  filePath = "/workspace/src/app.ts"
): SymbolNode {
  const range = createRange(startLine);

  return {
    id,
    kind,
    name: id.split(":").pop() ?? id,
    qualifiedName: id,
    filePath,
    range,
    selectionRange: range,
    language: "typescript"
  };
}

/**
 * Creates a calls edge with optional call metadata.
 */
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
    filePath: "/workspace/src/app.ts",
    range: createRange(40),
    confidence,
    metadata
  };
}

/**
 * Creates a small source range at one line.
 */
function createRange(startLine: number): SourceRange {
  return {
    startLine,
    startCharacter: 0,
    endLine: startLine,
    endCharacter: 1
  };
}

/**
 * Reads one universe node and fails with a clear assertion if it is absent.
 */
function requireUniverseNode(
  universe: ReturnType<typeof createFunctionUniverse>,
  nodeId: string
): ReturnType<typeof createFunctionUniverse>["nodes"][number] {
  const node = universe.nodesById.get(nodeId);

  assert.ok(node, `Expected universe node ${nodeId}`);
  return node;
}

/**
 * Reads one row and fails with a clear assertion if it is absent.
 */
function requireRow(
  rows: ReturnType<typeof createAllFunctionsInventoryRows>,
  rowId: string
): ReturnType<typeof createAllFunctionsInventoryRows>[number] {
  const row = rows.find((candidate) => candidate.id === rowId);

  assert.ok(row, `Expected inventory row ${rowId}`);
  return row;
}
