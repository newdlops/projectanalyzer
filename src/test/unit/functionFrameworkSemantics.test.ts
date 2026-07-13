/**
 * Unit tests for linking framework semantic units to callable graph nodes.
 * Fixtures stay small so each case isolates matching evidence, role/tag
 * inference, and conservative broad-unit behavior.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  createFunctionFrameworkSemantics,
  type FunctionFrameworkSemantic
} from "../../graph/functionFrameworkSemantics";
import type {
  FrameworkUnit,
  FrameworkUnitKind,
  ProjectGraph,
  SourceRange,
  SymbolKind,
  SymbolNode
} from "../../shared/types";

test("createFunctionFrameworkSemantics links range-matched route and model callables", () => {
  const graph = createGraph({
    nodes: [
      createNode("route-handler", "function", "/workspace/books/views.py", "book_list", "books.views.book_list", 10),
      createNode("model-constructor", "constructor", "/workspace/books/models.py", "Book", "books.models.Book", 4),
      createNode("external-book-list", "external", "/workspace/books/views.py", "book_list", "book_list", 10)
    ],
    frameworkUnits: [
      createUnit("route-unit", "route", "/workspace/books/views.py", "book_list", 10, "books.views.book_list"),
      createUnit("model-unit", "model", "/workspace/books/models.py", "Book", 4, "books.models.Book")
    ]
  });

  const semantics = createFunctionFrameworkSemantics(graph);
  const route = requireSemantic(semantics.semanticsByFunctionId.get("route-handler"), "route-unit");
  const model = requireSemantic(semantics.semanticsByFunctionId.get("model-constructor"), "model-unit");

  assert.equal(semantics.summary.callableNodeCount, 2);
  assert.equal(semantics.summary.semanticLinkCount, 2);
  assert.equal(route.role, "routeHandler");
  assert.deepEqual(route.tags, ["frameworkDispatch"]);
  assert.equal(route.confidence, "exact");
  assert.ok(route.evidence.some((evidence) => evidence.kind === "rangeInside"));
  assert.equal(model.role, "modelOperation");
  assert.deepEqual(model.tags, ["database"]);
  assert.equal(semantics.semanticsByFunctionId.has("external-book-list"), false);
});

test("createFunctionFrameworkSemantics supports same-file name matching without a unit range", () => {
  const graph = createGraph({
    nodes: [
      createNode("sync-orders", "function", "/workspace/orders/services.py", "sync_orders", "orders.services.sync_orders", 12),
      createNode("helper", "function", "/workspace/orders/services.py", "format_order", "orders.services.format_order", 30)
    ],
    frameworkUnits: [
      createUnit("service-unit", "service", "/workspace/orders/services.py", "sync_orders", undefined, "orders.services.sync_orders")
    ]
  });

  const semantics = createFunctionFrameworkSemantics(graph);
  const service = requireSemantic(semantics.semanticsByFunctionId.get("sync-orders"), "service-unit");

  assert.equal(semantics.summary.semanticLinkCount, 1);
  assert.equal(service.role, "service");
  assert.deepEqual(service.tags, ["businessLogic"]);
  assert.equal(service.confidence, "resolved");
  assert.ok(service.evidence.some((evidence) => evidence.kind === "nameMatch" || evidence.kind === "qualifiedNameMatch"));
  assert.equal(semantics.semanticsByFunctionId.has("helper"), false);
});

test("createFunctionFrameworkSemantics links qualified unit names to callable containers", () => {
  const graph = createGraph({
    nodes: [
      createNode("get-method", "method", "/workspace/blog/views.py", "get", "blog.views.ArticleView.get", 22),
      createNode("post-method", "method", "/workspace/blog/views.py", "post", "blog.views.ArticleView.post", 34)
    ],
    frameworkUnits: [
      createUnit("view-unit", "view", "/workspace/blog/views.py", "ArticleView", undefined, "blog.views.ArticleView")
    ]
  });

  const semantics = createFunctionFrameworkSemantics(graph);

  assert.equal(semantics.summary.semanticLinkCount, 2);
  assert.deepEqual(
    semantics.semanticsByFrameworkUnitId.get("view-unit")?.map((semantic) => semantic.functionId),
    ["get-method", "post-method"]
  );
});

test("createFunctionFrameworkSemantics avoids broad app and module range false positives", () => {
  const graph = createGraph({
    nodes: [
      createNode("startup", "function", "/workspace/billing/apps.py", "ready", "billing.apps.ready", 20),
      createNode("helper", "function", "/workspace/billing/apps.py", "helper", "billing.apps.helper", 40)
    ],
    frameworkUnits: [
      createUnit("app-unit", "app", "/workspace/billing/apps.py", "billing", 0, "billing"),
      createUnit("module-unit", "module", "/workspace/billing/apps.py", "billing.apps", 0, "billing.apps")
    ]
  });

  const semantics = createFunctionFrameworkSemantics(graph);

  assert.equal(semantics.summary.semanticLinkCount, 0);
  assert.equal(semantics.summary.unmatchedFrameworkUnitCount, 2);
});

type GraphFixture = {
  nodes: SymbolNode[];
  frameworkUnits: FrameworkUnit[];
};

/** Creates a minimal ProjectGraph with framework units for semantic-link tests. */
function createGraph(fixture: GraphFixture): ProjectGraph {
  return {
    workspaceRoot: "/workspace",
    version: "function-framework-semantics-test",
    generatedAt: "2026-06-21T00:00:00.000Z",
    nodes: fixture.nodes,
    edges: [],
    diagnostics: [],
    metadata: {
      languages: ["python"],
      frameworkUnits: fixture.frameworkUnits,
      fileCount: new Set(fixture.nodes.map((node) => node.filePath)).size,
      symbolCount: fixture.nodes.length,
      edgeCount: 0
    }
  };
}

/** Creates a symbol node with a compact single-line source range. */
function createNode(
  id: string,
  kind: SymbolKind,
  filePath: string,
  name: string,
  qualifiedName: string,
  startLine: number
): SymbolNode {
  const range = createRange(startLine, 0, startLine, 20);

  return {
    id,
    kind,
    name,
    qualifiedName,
    filePath,
    range,
    selectionRange: range,
    language: kind === "external" ? "external" : "python"
  };
}

/** Creates a framework unit with an optional source range. */
function createUnit(
  id: string,
  kind: FrameworkUnitKind,
  filePath: string,
  name: string,
  startLine?: number,
  qualifiedName?: string
): FrameworkUnit {
  return {
    id,
    framework: "Django",
    rootPath: ".",
    kind,
    name,
    qualifiedName,
    filePath,
    range: startLine === undefined ? undefined : createRange(startLine, 0, startLine + 100, 80)
  };
}

/** Creates a zero-based range for fixture nodes and units. */
function createRange(
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number
): SourceRange {
  return {
    startLine,
    startCharacter,
    endLine,
    endCharacter
  };
}

/** Reads one semantic link and fails with a clear assertion if it is absent. */
function requireSemantic(
  records: FunctionFrameworkSemantic[] | undefined,
  frameworkUnitId: string
): FunctionFrameworkSemantic {
  const record = records?.find((semantic) => semantic.frameworkUnitId === frameworkUnitId);

  assert.ok(record, `Expected semantic link for framework unit ${frameworkUnitId}`);
  return record;
}
