/**
 * Unit tests for the host-side Function Index. The fixture verifies that the
 * graph module preserves real callables, external targets, unresolved targets,
 * direct relation metrics, and Webview-compatible row projections.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  createFunctionIndex,
  createFunctionIndexProjector
} from "../../graph/functionIndex";
import type { EdgeConfidence, GraphEdge, ProjectGraph, SourceRange, SymbolKind, SymbolNode } from "../../shared/types";

test("createFunctionIndex builds summary counts and direct caller/callee indexes", () => {
  const index = createFunctionIndex(createFunctionIndexFixtureGraph(), { inventoryLimit: 20 });
  const entry = requireIndexNode(index, "entry");
  const service = requireIndexNode(index, "service");
  const utility = requireIndexNode(index, "utility");
  const external = requireIndexNode(index, "external:pkg.call");
  const unresolved = requireIndexNode(index, "unresolved:missing-call-target");

  assert.equal(index.summary.graphVersion, "function-index-test");
  assert.equal(index.summary.callableNodeCount, 6);
  assert.equal(index.summary.callEdgeCount, 5);
  assert.equal(index.summary.externalCallableCount, 1);
  assert.equal(index.summary.unresolvedCallableCount, 1);
  assert.equal(index.summary.externalCallEdgeCount, 1);
  assert.equal(index.summary.unresolvedCallEdgeCount, 1);
  assert.equal(index.summary.inferredCallEdgeCount, 1);
  assert.equal(index.summary.parserFailureCount, 1);
  assert.equal(index.summary.excludedFileCount, 1);
  assert.equal(index.summary.visibleByDefaultViewCount, 1);
  assert.equal(index.summary.hiddenByDefaultViewCount, 5);
  assert.equal(index.nodesById.has("external:unused"), false);

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
    index.calleesByNodeId.get("service")?.map((relation) => relation.kind),
    ["external", "function", "unresolved"]
  );
  assert.deepEqual(
    index.callersByNodeId.get("utility")?.map((relation) => relation.nodeId),
    ["entry", "service"]
  );
});

test("createFunctionIndex returns stable top-level Function Flows rows", () => {
  const index = createFunctionIndex(createFunctionIndexFixtureGraph(), { inventoryLimit: 20 });

  assert.deepEqual(
    index.flowsRows.map((row) => row.label),
    ["Entrypoints", "Hotspots", "Unresolved / External", "All Functions"]
  );
  assert.deepEqual(
    index.flowsRows.map((row) => row.id),
    [
      "function-flows:entrypoints",
      "function-flows:hotspots",
      "function-flows:unresolved-external",
      "function-flows:all-functions"
    ]
  );
});

test("FunctionIndexProjector reuses graph-wide identities and returns independent rows", () => {
  const graph = createFunctionIndexFixtureGraph();
  const projector = createFunctionIndexProjector(graph);
  const collapsed = projector.project({
    includeInventoryRows: false,
    inventoryLimit: 2
  });
  const expanded = projector.project({
    expandedTreeIds: [
      "function-flows:entrypoints",
      "function-flows:entrypoints:entrypoint:entry",
      "function-flows:all-functions"
    ],
    inventoryLimit: 3
  });

  assert.equal(projector.graphVersion, graph.version);
  assert.strictEqual(expanded.nodes, collapsed.nodes);
  assert.strictEqual(expanded.nodesById, collapsed.nodesById);
  assert.strictEqual(expanded.callersByNodeId, collapsed.callersByNodeId);
  assert.strictEqual(expanded.calleesByNodeId, collapsed.calleesByNodeId);
  assert.strictEqual(expanded.metricsByNodeId, collapsed.metricsByNodeId);
  assert.strictEqual(expanded.summary, collapsed.summary);
  assert.notStrictEqual(expanded.flowsRows, collapsed.flowsRows);
  assert.notStrictEqual(expanded.flowsRows[0], collapsed.flowsRows[0]);
  assert.notStrictEqual(expanded.inventoryRows, collapsed.inventoryRows);
  assert.deepEqual(collapsed.inventoryRows, []);
  assert.equal(
    collapsed.flowsRows.some((row) => row.id.includes(":callee:")),
    false
  );
  assert.equal(
    expanded.flowsRows.some((row) => row.id.includes(":callee:")),
    true
  );
  assert.equal(expanded.inventoryRows.length, 3);

  // Mutating request-local presentation output cannot contaminate a later
  // expansion projection from the same graph-wide core.
  collapsed.flowsRows[0].label = "mutated row";
  const repeated = projector.project({ inventoryLimit: 1 });
  assert.equal(repeated.flowsRows[0]?.label, "Entrypoints");
  assert.equal(repeated.inventoryRows.length, 1);
  assert.strictEqual(repeated.nodesById, collapsed.nodesById);
});

test("createFunctionIndex remains projection-compatible with the reusable API", () => {
  const graph = createFunctionIndexFixtureGraph();
  const options = {
    expandedTreeIds: [
      "function-flows:hotspots",
      "function-flows:unresolved-external"
    ],
    inventoryLimit: 4
  };
  const legacy = createFunctionIndex(graph, options);
  const projected = createFunctionIndexProjector(graph).project(options);

  assert.deepEqual(projected.flowsRows, legacy.flowsRows);
  assert.deepEqual(projected.inventoryRows, legacy.inventoryRows);
  assert.deepEqual(projected.nodes, legacy.nodes);
  assert.deepEqual(projected.summary, legacy.summary);
  assert.deepEqual(
    [...projected.callersByNodeId.entries()],
    [...legacy.callersByNodeId.entries()]
  );
});

test("createFunctionIndex expands entrypoints to direct callees without recursion", () => {
  const index = createFunctionIndex(createFunctionIndexFixtureGraph(), {
    expandedTreeIds: ["function-flows:entrypoints", "function-flows:entrypoints:entrypoint:entry"],
    inventoryLimit: 20
  });
  const entrypoint = requireRow(index.flowsRows, "function-flows:entrypoints:entrypoint:entry");
  const callees = index.flowsRows.filter((row) => (
    row.id.startsWith("function-flows:entrypoints:entrypoint:entry:callee:")
  ));

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

test("createFunctionIndex expands hotspots and unresolved/external groups", () => {
  const index = createFunctionIndex(createFunctionIndexFixtureGraph(), {
    expandedTreeIds: [
      "function-flows:hotspots",
      "function-flows:unresolved-external",
      "function-flows:unresolved-external:unresolved",
      "function-flows:unresolved-external:external"
    ],
    inventoryLimit: 20
  });
  const hotspotRows = index.flowsRows.filter((row) => row.id.startsWith("function-flows:hotspots:hotspot:"));
  const section = requireRow(index.flowsRows, "function-flows:unresolved-external");
  const unresolved = requireRow(index.flowsRows, "function-flows:unresolved-external:unresolved");
  const external = requireRow(index.flowsRows, "function-flows:unresolved-external:external");

  assert.ok(hotspotRows.length > 0);
  assert.equal(hotspotRows[0]?.nodeId, "service");
  assert.match(hotspotRows[0]?.detail ?? "", /high fan-out/);
  assert.match(hotspotRows[0]?.detail ?? "", /distinct callees 3/);
  assert.ok(hotspotRows.some((row) => row.nodeId === "utility"));

  assert.match(section.detail, /1 unresolved/);
  assert.match(section.detail, /1 external/);
  assert.equal(unresolved.detail, "1 calls / 1 targets");
  assert.equal(external.detail, "1 calls / 1 targets");
  assert.ok(index.flowsRows.some((row) => row.label === "Service.handle -> missingCall"));
  assert.ok(index.flowsRows.some((row) => row.label === "Service.handle -> pkg.call"));
});

test("createFunctionIndex does not promote repeated call sites as distinct hotspots", () => {
  const nodes = [
    createTestNode("source", "function", 0, "source", "source"),
    createTestNode("target", "function", 10, "target", "target")
  ];
  const graph: ProjectGraph = {
    workspaceRoot: "/workspace",
    version: "repeated-call-sites",
    generatedAt: "2026-07-13T00:00:00.000Z",
    nodes,
    edges: Array.from({ length: 6 }, (_, index) =>
      createCallEdge(`repeated-${index}`, "source", "target")
    ),
    diagnostics: [],
    metadata: {
      languages: ["typescript"],
      fileCount: 1,
      symbolCount: nodes.length,
      edgeCount: 6
    }
  };
  const index = createFunctionIndex(graph, {
    expandedTreeIds: ["function-flows:hotspots"],
    inventoryLimit: 20
  });
  const hotspotSection = requireRow(index.flowsRows, "function-flows:hotspots");

  assert.equal(index.nodesById.get("source")?.metrics.directCalleeCount, 1);
  assert.equal(index.nodesById.get("target")?.metrics.directCallerCount, 1);
  assert.equal(hotspotSection.hasChildren, false);
  assert.equal(
    index.flowsRows.filter((row) => row.id.startsWith("function-flows:hotspots:hotspot:")).length,
    0
  );
});

test("createFunctionIndex indexes a wide call neighborhood without losing distinct targets", () => {
  const targetCount = 2_000;
  const source = createTestNode("wide-source", "function", 0, "wideSource", "wideSource");
  const targets = Array.from({ length: targetCount }, (_, index) =>
    createTestNode(`wide-target-${index}`, "function", index + 1)
  );
  const graph: ProjectGraph = {
    workspaceRoot: "/workspace",
    version: "wide-relations",
    generatedAt: "2026-07-13T00:00:00.000Z",
    nodes: [source, ...targets],
    edges: targets.map((target, index) =>
      createCallEdge(`wide-call-${index}`, source.id, target.id)
    ),
    diagnostics: [],
    metadata: {
      languages: ["typescript"],
      fileCount: 1,
      symbolCount: targetCount + 1,
      edgeCount: targetCount
    }
  };

  const index = createFunctionIndex(graph, { includeInventoryRows: false });

  assert.equal(index.nodesById.get(source.id)?.metrics.directCalleeCount, targetCount);
  assert.equal(index.calleesByNodeId.get(source.id)?.length, targetCount);
  assert.equal(index.summary.callEdgeCount, targetCount);
});

test("createFunctionIndex classifies unresolved-confidence placeholders as unresolved", () => {
  const source = createTestNode("source", "function", 0, "source", "source");
  const placeholder = createTestNode(
    "external:ghost",
    "external",
    4,
    "ghostCall",
    "ghostCall"
  );
  const graph: ProjectGraph = {
    workspaceRoot: "/workspace",
    version: "unresolved-placeholder",
    generatedAt: "2026-07-13T00:00:00.000Z",
    nodes: [source, placeholder],
    edges: [createCallEdge(
      "source-ghost",
      source.id,
      placeholder.id,
      "unresolved"
    )],
    diagnostics: [],
    metadata: {
      languages: ["typescript"],
      fileCount: 1,
      symbolCount: 2,
      edgeCount: 1
    }
  };
  const index = createFunctionIndex(graph, {
    expandedTreeIds: [
      "function-flows:unresolved-external",
      "function-flows:unresolved-external:unresolved"
    ]
  });

  assert.equal(index.summary.externalCallableCount, 0);
  assert.equal(index.summary.unresolvedCallableCount, 1);
  assert.equal(index.summary.externalCallEdgeCount, 0);
  assert.equal(index.summary.unresolvedCallEdgeCount, 1);
  assert.equal(index.nodesById.get(source.id)?.metrics.unresolvedCallCount, 1);
  assert.equal(index.nodesById.get(source.id)?.metrics.externalCallCount, 0);
  assert.deepEqual(index.calleesByNodeId.get(source.id)?.map((relation) => relation.kind), [
    "unresolved"
  ]);
  assert.ok(index.flowsRows.some((row) => row.label === "source -> ghostCall"));
});

test("createFunctionIndex returns bounded All Functions inventory rows", () => {
  const fullIndex = createFunctionIndex(createFunctionIndexFixtureGraph(), {
    expandedTreeIds: ["function-flows:all-functions"],
    inventoryLimit: 20
  });
  const limitedIndex = createFunctionIndex(createFunctionIndexFixtureGraph(), { inventoryLimit: 2 });
  const omittedIndex = createFunctionIndex(createFunctionIndexFixtureGraph(), {
    includeInventoryRows: false,
    inventoryLimit: 20
  });
  const flowInventoryRows = fullIndex.flowsRows.filter((row) => (
    row.id.startsWith("function-flows:all-functions:function:")
  ));

  assert.equal(fullIndex.inventoryRows.length, fullIndex.summary.callableNodeCount);
  assert.equal(flowInventoryRows.length, fullIndex.summary.callableNodeCount);
  assert.ok(fullIndex.inventoryRows.some((row) => row.id === "function-inventory:external:pkg.call"));
  assert.ok(fullIndex.inventoryRows.some((row) => row.id === "function-inventory:unresolved:missing-call-target"));
  assert.equal(limitedIndex.inventoryRows.length, 2);
  assert.deepEqual(omittedIndex.inventoryRows, []);
});

/** Creates a graph with entrypoints, hotspots, external calls, and unresolved calls. */
function createFunctionIndexFixtureGraph(): ProjectGraph {
  const nodes = [
    createTestNode("entry", "function", 0, "main", "main"),
    createTestNode("service", "method", 10, "handle", "Service.handle"),
    createTestNode("utility", "function", 20, "formatResult", "formatResult"),
    createTestNode("ctor", "constructor", 30, "Example", "Example.constructor"),
    createTestNode("external:pkg.call", "external", 0, "pkg.call", "pkg.call", ""),
    createTestNode("external:unused", "external", 0, "unused", "unused", "")
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
    version: "function-index-test",
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

/** Creates a minimal symbol node for Function Index tests. */
function createTestNode(
  id: string,
  kind: SymbolKind,
  startLine: number,
  name = id,
  qualifiedName = id,
  filePath = "/workspace/src/app.ts"
): SymbolNode {
  const range = createRange(startLine);

  return {
    id,
    kind,
    name,
    qualifiedName,
    filePath,
    range,
    selectionRange: range,
    language: kind === "external" ? "external" : "typescript"
  };
}

/** Creates a calls edge with optional confidence and metadata. */
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

/** Creates a compact source range at one line. */
function createRange(startLine: number): SourceRange {
  return {
    startLine,
    startCharacter: 0,
    endLine: startLine,
    endCharacter: 1
  };
}

/** Reads one index node and fails with a clear assertion if it is absent. */
function requireIndexNode(
  index: ReturnType<typeof createFunctionIndex>,
  nodeId: string
): ReturnType<typeof createFunctionIndex>["nodes"][number] {
  const node = index.nodesById.get(nodeId);

  assert.ok(node, `Expected Function Index node ${nodeId}`);
  return node;
}

/** Reads one row and fails with a clear assertion if it is absent. */
function requireRow(
  rows: ReturnType<typeof createFunctionIndex>["flowsRows"],
  rowId: string
): ReturnType<typeof createFunctionIndex>["flowsRows"][number] {
  const row = rows.find((candidate) => candidate.id === rowId);

  assert.ok(row, `Expected row ${rowId}`);
  return row;
}
