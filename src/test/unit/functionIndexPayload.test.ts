/**
 * Unit tests for projecting the host-side Function Index into the Webview
 * protocol payload. These tests guard the JSON-facing boundary separately from
 * the richer Map-backed index internals.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultSemanticFlowExpandedRowIds,
  createSemanticFlowRows,
  REQUEST_FLOW_ROWS_ROOT_ID
} from "../../application/functionExplorer/semanticFlowRows";
import { FRAMEWORK_HANDLER_ROWS_ROOT_ID } from "../../graph/functionFrameworkRows";
import { createFunctionIndex } from "../../graph/functionIndex";
import { createFunctionExplorerPayload } from "../../graph/functionIndexPayload";
import { createSemanticFlowIndex } from "../../insights/semanticFlow";
import type { FrameworkUnit, GraphEdge, ProjectGraph, SourceRange, SymbolNode } from "../../shared/types";

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
    "frameworkHandlers",
    "entrypoints",
    "hotspots",
    "unresolvedExternal",
    "allFunctions"
  ]);
  assert.ok(payload.sections.some((section) => section.id === "entrypoints" && section.visibleRowCount > 0));
  assert.ok(payload.sections.some((section) => section.id === "frameworkHandlers" && section.totalRowCount > 0));
  assert.ok(payload.rows.some((row) => row.id === FRAMEWORK_HANDLER_ROWS_ROOT_ID));
  assert.ok(payload.rows.some((row) => row.sectionId === "entrypoints" && row.functionId === "entry"));
  assert.ok(payload.rows.some((row) => row.kind === "call" && row.sectionId === "entrypoints"));
});

test("createFunctionExplorerPayload expands framework handler rows from framework units", () => {
  const graph = createPayloadGraph();
  const frameworkRowId = FRAMEWORK_HANDLER_ROWS_ROOT_ID + ":framework:Django";
  const routeRowId = frameworkRowId + ":unit-kind:route";
  const index = createFunctionIndex(graph, { inventoryLimit: 20 });
  const payload = createFunctionExplorerPayload(graph, index, {
    initialRowLimit: 50,
    expandedRowIds: [FRAMEWORK_HANDLER_ROWS_ROOT_ID, frameworkRowId, routeRowId]
  });
  const handlerRow = payload.rows.find((row) => row.id === routeRowId + ":function:django%3Aentry:entry");

  assert.ok(handlerRow);
  assert.equal(handlerRow.sectionId, "frameworkHandlers");
  assert.equal(handlerRow.functionId, "entry");
  assert.equal(handlerRow.role, "routeHandler");
  assert.deepEqual(handlerRow.tags, ["frameworkDispatch"]);
  assert.equal(handlerRow.metadata?.framework, "Django");
  assert.equal(handlerRow.metadata?.frameworkUnitId, "django:entry");
});

test("createFunctionExplorerPayload places semantic request flows before generic entrypoints", () => {
  const graph = createPayloadGraph();
  const index = createFunctionIndex(graph, {
    expandedTreeIds: ["function-flows:entrypoints"],
    inventoryLimit: 20
  });
  const semanticFlows = createSemanticFlowIndex(graph);
  const expandedRowIds = createDefaultSemanticFlowExpandedRowIds(semanticFlows);
  const payload = createFunctionExplorerPayload(graph, index, {
    initialRowLimit: 50,
    expandedRowIds,
    semanticFlowRows: createSemanticFlowRows(semanticFlows, { expandedRowIds })
  });

  assert.equal(payload.rows[0]?.id, REQUEST_FLOW_ROWS_ROOT_ID);
  assert.equal(payload.rows[0]?.label, "Request Flows");
  assert.equal(payload.sections[0]?.id, "frameworkHandlers");
  assert.equal(payload.sections[0]?.title, "Request Flows");
  assert.ok(payload.rows.findIndex((row) => row.sectionId === "entrypoints") > 0);
});

test("createFunctionExplorerPayload places selected change impact before request flows", () => {
  const graph = createPayloadGraph();
  const index = createFunctionIndex(graph, { inventoryLimit: 20 });
  const payload = createFunctionExplorerPayload(graph, index, {
    initialRowLimit: 50,
    selectedFunctionId: "service",
    changeImpactRows: [{
      id: "function-flows:selected",
      sectionId: "selected",
      kind: "section",
      label: "Affected Request Flows · Service.handle",
      depth: 0,
      hasChildren: false,
      expanded: false,
      functionId: "service",
      symbolId: "service"
    }]
  });

  assert.equal(payload.rows[0]?.sectionId, "selected");
  assert.equal(payload.sections[0]?.id, "selected");
  assert.equal(payload.sections[0]?.title, "Change Impact");
  assert.equal(payload.options.requestedSections[0], "selected");
  assert.equal(payload.options.selectedFunctionId, "service");
  assert.ok(payload.rows.findIndex((row) => row.sectionId === "frameworkHandlers") > 0);
  assert.doesNotThrow(() => JSON.stringify(payload));
});

test("createFunctionExplorerPayload keeps every section header beside a huge expanded flow", () => {
  const graph = createPayloadGraph();
  const index = createFunctionIndex(graph, { includeInventoryRows: false });
  const semanticFlowRows = Array.from({ length: 1_001 }, (_, rowIndex) => ({
    id: rowIndex === 0 ? REQUEST_FLOW_ROWS_ROOT_ID : `request-flow:operation:${rowIndex}`,
    sectionId: "frameworkHandlers" as const,
    kind: rowIndex === 0 ? "section" as const : "function" as const,
    label: rowIndex === 0 ? "Request Flows" : `Query.operation${rowIndex}`,
    depth: rowIndex === 0 ? 0 : 1,
    hasChildren: rowIndex === 0,
    expanded: rowIndex === 0
  }));
  const payload = createFunctionExplorerPayload(graph, index, {
    initialRowLimit: 10,
    semanticFlowRows
  });

  assert.equal(payload.rows.length, 10);
  assert.equal(payload.nextCursor, undefined);
  assert.ok(payload.sections.every((section) => section.visibleRowCount > 0));
  assert.deepEqual(
    payload.rows.filter((row) => row.depth === 0).map((row) => row.sectionId),
    ["frameworkHandlers", "entrypoints", "hotspots", "unresolvedExternal", "allFunctions"]
  );
  assert.ok(payload.sections.find((section) => section.id === "frameworkHandlers")?.hasMore);
  assert.ok(payload.rows.some((row) =>
    row.sectionId === "frameworkHandlers"
    && row.kind === "more"
    && row.label.endsWith("more rows not loaded")
  ));
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
  const frameworkUnits: FrameworkUnit[] = [
    {
      id: "django:entry",
      framework: "Django",
      rootPath: "/workspace",
      kind: "route",
      name: "main",
      qualifiedName: "main",
      filePath: "/workspace/src/main.ts",
      range: createRange(0)
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
      frameworks: [
        {
          name: "Django",
          ecosystem: "python",
          category: "backend",
          confidence: "high",
          evidence: ["urls.py"]
        }
      ],
      frameworkUnits,
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
