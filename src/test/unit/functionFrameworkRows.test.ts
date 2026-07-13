/**
 * Unit tests for the framework handler Function Explorer row adapter.
 *
 * Most tests mock the framework semantics module so row projection stays
 * isolated. One integration-style case uses the real matcher output to guard
 * the adapter contract between the two graph modules.
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { type TestContext } from "node:test";
import {
  createFrameworkHandlerRows,
  FRAMEWORK_HANDLER_ROWS_ROOT_ID
} from "../../graph/functionFrameworkRows";
import type { FrameworkUnit, ProjectGraph, SourceRange, SymbolNode } from "../../shared/types";
import type { FunctionExplorerRow } from "../../protocol/functionExplorer";

type SemanticMatch = {
  functionId: string;
  frameworkUnitId: string;
  framework: string;
  unitKind: string;
  role: string;
  tags: string[];
  evidence: unknown[];
  confidence?: string;
};

const requireForTests = createRequire(__filename);

test("createFrameworkHandlerRows returns a collapsed framework handlers section", (t) => {
  mockSemanticMatches(t, createSemanticMatches());

  const result = createFrameworkHandlerRows(createFrameworkRowsGraph());
  const section = requireRow(result.rows, FRAMEWORK_HANDLER_ROWS_ROOT_ID);

  assert.equal(result.visibleRowCount, 1);
  assert.equal(result.totalRowCount, 1);
  assert.equal(section.sectionId, "frameworkHandlers");
  assert.equal(section.kind, "section");
  assert.equal(section.label, "Framework Handlers");
  assert.equal(section.hasChildren, true);
  assert.equal(section.expanded, false);
  assert.match(section.detail ?? "", /3 handlers/);
  assert.match(section.detail ?? "", /3 framework units/);
  assert.match(section.detail ?? "", /2 frameworks/);
});

test("createFrameworkHandlerRows expands deterministic framework and unit groups", (t) => {
  mockSemanticMatches(t, createSemanticMatches());

  const expressId = getFrameworkRowId("Express");
  const routeId = getUnitKindRowId(expressId, "route");
  const result = createFrameworkHandlerRows(createFrameworkRowsGraph(), {
    expandedRowIds: [FRAMEWORK_HANDLER_ROWS_ROOT_ID, expressId, routeId]
  });
  const frameworkRows = result.rows.filter((row) => row.depth === 1);
  const expressRow = requireRow(result.rows, expressId);
  const middlewareRow = requireRow(result.rows, getUnitKindRowId(expressId, "middleware"));
  const routeRow = requireRow(result.rows, routeId);
  const routeFunctionRow = requireRow(result.rows, getFunctionRowId(routeId, "express:users", "route-handler"));

  assert.deepEqual(frameworkRows.map((row) => row.id), [
    getFrameworkRowId("Django"),
    expressId
  ]);
  assert.equal(expressRow.kind, "bucket");
  assert.equal(expressRow.parentId, FRAMEWORK_HANDLER_ROWS_ROOT_ID);
  assert.equal(expressRow.detail, "2 handlers / 2 framework units");
  assert.equal(middlewareRow.depth, 2);
  assert.equal(middlewareRow.expanded, false);
  assert.equal(routeRow.depth, 2);
  assert.equal(routeRow.parentId, expressId);
  assert.equal(routeRow.expanded, true);
  assert.equal(routeFunctionRow.depth, 3);
  assert.equal(routeFunctionRow.parentId, routeId);
});

test("createFrameworkHandlerRows includes function metadata and stable ids", (t) => {
  mockSemanticMatches(t, createSemanticMatches());

  const expressId = getFrameworkRowId("Express");
  const routeId = getUnitKindRowId(expressId, "route");
  const routeFunctionId = getFunctionRowId(routeId, "express:users", "route-handler");
  const result = createFrameworkHandlerRows(createFrameworkRowsGraph(), {
    expandedRowIds: [FRAMEWORK_HANDLER_ROWS_ROOT_ID, expressId, routeId]
  });
  const row = requireRow(result.rows, routeFunctionId);

  assert.equal(row.id, "function-flows:framework-handlers:framework:Express:unit-kind:route:function:express%3Ausers:route-handler");
  assert.equal(row.kind, "function");
  assert.equal(row.functionId, "route-handler");
  assert.equal(row.symbolId, "route-handler");
  assert.equal(row.filePath, "/workspace/src/routes.ts");
  assert.deepEqual(row.range, createRange(3));
  assert.equal(row.functionKind, "function");
  assert.equal(row.role, "routeHandler");
  assert.deepEqual(row.tags, ["frameworkDispatch", "network"]);
  assert.equal(row.confidence, "exact");
  assert.equal(row.metadata?.framework, "Express");
  assert.equal(row.metadata?.frameworkUnitId, "express:users");
  assert.equal(row.metadata?.frameworkUnitKind, "route");
  assert.equal(row.metadata?.frameworkUnitLabel, "GET /users");
  assert.deepEqual(row.metadata?.evidence, ["app.get('/users', listUsers)"]);
});

test("createFrameworkHandlerRows reports omitted rows when a limit is applied", (t) => {
  mockSemanticMatches(t, createSemanticMatches());

  const djangoId = getFrameworkRowId("Django");
  const expressId = getFrameworkRowId("Express");
  const result = createFrameworkHandlerRows(createFrameworkRowsGraph(), {
    expandedRowIds: [
      FRAMEWORK_HANDLER_ROWS_ROOT_ID,
      djangoId,
      getUnitKindRowId(djangoId, "command"),
      expressId,
      getUnitKindRowId(expressId, "middleware"),
      getUnitKindRowId(expressId, "route")
    ],
    limit: 5
  });
  const section = requireRow(result.rows, FRAMEWORK_HANDLER_ROWS_ROOT_ID);

  assert.equal(result.visibleRowCount, 5);
  assert.equal(result.totalRowCount, 9);
  assert.equal(result.rows.length, 5);
  assert.match(section.detail ?? "", /4 rows omitted by limit/);
});

test("createFrameworkHandlerRows reads real framework semantics output", () => {
  const djangoId = getFrameworkRowId("Django");
  const routeId = getUnitKindRowId(djangoId, "route");
  const result = createFrameworkHandlerRows(createRealSemanticsGraph(), {
    expandedRowIds: [FRAMEWORK_HANDLER_ROWS_ROOT_ID, djangoId, routeId]
  });
  const row = requireRow(result.rows, getFunctionRowId(routeId, "django:book-list", "django-route"));

  assert.equal(row.sectionId, "frameworkHandlers");
  assert.equal(row.functionId, "django-route");
  assert.equal(row.role, "routeHandler");
  assert.deepEqual(row.tags, ["frameworkDispatch"]);
  assert.equal(row.metadata?.frameworkUnitId, "django:book-list");
});

/** Replaces the semantic matcher export for one test case. */
function mockSemanticMatches(t: TestContext, matches: SemanticMatch[]): void {
  const semanticsModule = requireForTests("../../graph/functionFrameworkSemantics") as typeof import("../../graph/functionFrameworkSemantics");
  const implementation = (() => ({ records: matches })) as unknown as typeof semanticsModule.createFunctionFrameworkSemantics;

  t.mock.method(semanticsModule, "createFunctionFrameworkSemantics", implementation);
}

/** Creates semantic matches returned by the mocked framework semantics adapter. */
function createSemanticMatches(): SemanticMatch[] {
  return [
    {
      functionId: "route-handler",
      frameworkUnitId: "express:users",
      framework: "Express",
      unitKind: "route",
      role: "routeHandler",
      tags: ["network"],
      evidence: ["app.get('/users', listUsers)"],
      confidence: "exact"
    },
    {
      functionId: "middleware-handler",
      frameworkUnitId: "express:auth",
      framework: "Express",
      unitKind: "middleware",
      role: "adapter",
      tags: ["network"],
      evidence: ["app.use(authMiddleware)"],
      confidence: "resolved"
    },
    {
      functionId: "command-handler",
      frameworkUnitId: "django:command",
      framework: "Django",
      unitKind: "command",
      role: "cliCommand",
      tags: ["filesystem"],
      evidence: [{ kind: "managementCommand", name: "sync_users" }],
      confidence: "inferred"
    }
  ];
}

/** Creates a compact graph with framework units and callable handler nodes. */
function createFrameworkRowsGraph(): ProjectGraph {
  const nodes = [
    createNode("route-handler", "listUsers", "function", "/workspace/src/routes.ts", 3),
    createNode("middleware-handler", "authMiddleware", "function", "/workspace/src/routes.ts", 12),
    createNode("command-handler", "Command.handle", "method", "/workspace/manage.py", 30)
  ];
  const frameworkUnits: FrameworkUnit[] = [
    createFrameworkUnit("express:users", "Express", "route", "GET /users", "/workspace/src/routes.ts", 2),
    createFrameworkUnit("express:auth", "Express", "middleware", "auth middleware", "/workspace/src/routes.ts", 11),
    createFrameworkUnit("django:command", "Django", "command", "sync_users", "/workspace/manage.py", 29)
  ];

  return {
    workspaceRoot: "/workspace",
    version: "framework-rows-test",
    generatedAt: "2026-06-21T00:00:00.000Z",
    nodes,
    edges: [],
    diagnostics: [],
    metadata: {
      languages: ["typescript", "python"],
      frameworks: [
        {
          name: "Express",
          ecosystem: "node",
          category: "backend",
          confidence: "high",
          evidence: ["package.json"]
        },
        {
          name: "Django",
          ecosystem: "python",
          category: "backend",
          confidence: "high",
          evidence: ["manage.py"]
        }
      ],
      frameworkUnits,
      frameworkUnitEdges: [],
      fileCount: 2,
      symbolCount: nodes.length,
      edgeCount: 0
    }
  };
}

/** Creates a graph whose real framework semantics result should produce one handler row. */
function createRealSemanticsGraph(): ProjectGraph {
  const nodes = [
    createNode("django-route", "books.views.book_list", "function", "/workspace/books/views.py", 10)
  ];
  const frameworkUnits: FrameworkUnit[] = [
    createFrameworkUnit("django:book-list", "Django", "route", "book_list", "/workspace/books/views.py", 10)
  ];

  return {
    workspaceRoot: "/workspace",
    version: "framework-rows-real-semantics-test",
    generatedAt: "2026-06-21T00:00:00.000Z",
    nodes,
    edges: [],
    diagnostics: [],
    metadata: {
      languages: ["python"],
      frameworkUnits,
      fileCount: 1,
      symbolCount: nodes.length,
      edgeCount: 0
    }
  };
}

/** Creates a minimal callable symbol node for framework row tests. */
function createNode(
  id: string,
  qualifiedName: string,
  kind: SymbolNode["kind"],
  filePath: string,
  startLine: number
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
    language: filePath.endsWith(".py") ? "python" : "typescript"
  };
}

/** Creates a compact framework unit for handler grouping tests. */
function createFrameworkUnit(
  id: string,
  framework: string,
  kind: FrameworkUnit["kind"],
  name: string,
  filePath: string,
  startLine: number
): FrameworkUnit {
  return {
    id,
    framework,
    rootPath: "/workspace",
    kind,
    name,
    filePath,
    range: createRange(startLine)
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

/** Finds one row and fails with a focused assertion if it is absent. */
function requireRow(rows: FunctionExplorerRow[], rowId: string): FunctionExplorerRow {
  const row = rows.find((candidate) => candidate.id === rowId);

  assert.ok(row, `Expected row ${rowId}`);
  return row;
}

function getFrameworkRowId(framework: string): string {
  return FRAMEWORK_HANDLER_ROWS_ROOT_ID + ":framework:" + encodeURIComponent(framework);
}

function getUnitKindRowId(parentRowId: string, unitKind: string): string {
  return parentRowId + ":unit-kind:" + encodeURIComponent(unitKind);
}

function getFunctionRowId(parentRowId: string, frameworkUnitId: string, functionId: string): string {
  return parentRowId + ":function:" + encodeURIComponent(frameworkUnitId) + ":" + encodeURIComponent(functionId);
}
