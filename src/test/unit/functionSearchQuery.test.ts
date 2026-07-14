/**
 * Unit tests for bounded server-side Function Index search.
 *
 * Fixtures cover case-insensitive fields, completeness filters, deterministic
 * ranking, opaque pagination, cached-core reuse, and large-index payload caps.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  FUNCTION_SEARCH_MAX_PAGE_SIZE,
  FunctionExplorerProjectionService,
  searchFunctionIndex
} from "../../application/functionExplorer";
import type { FunctionIndexNode } from "../../graph/functionIndex";
import type { FunctionExplorerSearchRequest } from "../../protocol/functionExplorer";
import type { SourceNodeToken } from "../../protocol/sourceNavigation";
import { createContentHash } from "../../shared/hash";
import type { ProjectGraph, SourceRange, SymbolNode } from "../../shared/types";

test("searches name, qualified name, and file path without case sensitivity", () => {
  const nodes = [
    createIndexNode("load-user", {
      name: "LoadUser",
      qualifiedName: "UserService.loadUser",
      filePath: "/workspace/src/users/UserService.ts",
      range: createRange(11)
    }),
    createIndexNode("external", {
      kind: "external",
      name: "loadRemote",
      qualifiedName: "remote.loadRemote",
      filePath: "/workspace/src/callsite.ts",
      role: "external",
      confidence: "resolved"
    }),
    createIndexNode("unresolved", {
      kind: "unresolved",
      name: "loadMystery",
      qualifiedName: "unresolved:loadMystery",
      filePath: "/workspace/src/callsite.ts",
      role: "unresolved",
      confidence: "unresolved"
    })
  ];

  const namePayload = query(nodes, { query: "LOADUSER" });
  const qualifiedPayload = query(nodes, { query: "userservice.LOAD" });
  const pathPayload = query(nodes, { query: "SRC\\USERS\\userservice.TS" });
  const allLoadRows = query(nodes, { query: "load" }).rows;
  const concreteRow = namePayload.rows[0];
  const externalRow = allLoadRows.find((row) => row.functionKind === "external");
  const unresolvedRow = allLoadRows.find((row) => row.functionKind === "unresolved");

  assert.equal(namePayload.totalMatchCount, 1);
  assert.equal(qualifiedPayload.totalMatchCount, 1);
  assert.equal(pathPayload.totalMatchCount, 1);
  assert.equal(concreteRow?.sourceToken, createSourceToken("load-user"));
  assert.equal(concreteRow?.functionId, undefined);
  assert.equal(concreteRow?.symbolId, undefined);
  assert.equal(concreteRow?.filePath, undefined);
  assert.deepEqual(concreteRow?.range, createRange(11));
  assert.match(concreteRow?.detail ?? "", /^src\/users\/UserService\.ts:12 ·/u);

  assert.ok(externalRow);
  assert.equal(externalRow.functionId, undefined);
  assert.equal(externalRow.symbolId, undefined);
  assert.equal(externalRow.filePath, undefined);
  assert.equal(externalRow.range, undefined);
  assert.ok(unresolvedRow);
  assert.equal(unresolvedRow.functionId, undefined);
  assert.equal(unresolvedRow.symbolId, undefined);
  assert.equal(unresolvedRow.filePath, undefined);
  assert.equal(unresolvedRow.range, undefined);
});

test("does not expose absolute host paths for sources outside the workspace", () => {
  const privateNodeId = "symbol::/Users/private-owner/secrets/outside.ts::function::outsideHandler::4::0";
  const payload = query([
    createIndexNode(privateNodeId, {
      name: "outsideHandler",
      qualifiedName: privateNodeId,
      filePath: "/Users/private-owner/secrets/outside.ts",
      range: createRange(4)
    })
  ], { query: "outside" });
  const serialized = JSON.stringify(payload);

  assert.equal(payload.rows[0]?.filePath, undefined);
  assert.match(payload.rows[0]?.sourceToken ?? "", /^source-node:[0-9a-f]{64}$/u);
  assert.equal(payload.rows[0]?.functionId, undefined);
  assert.equal(payload.rows[0]?.symbolId, undefined);
  assert.equal(payload.rows[0]?.label, "outsideHandler");
  assert.match(payload.rows[0]?.detail ?? "", /^outside\.ts:5 ·/u);
  assert.doesNotMatch(serialized, /Users|private-owner|secrets/u);
});

test("applies external and unresolved filters while retaining exact totals", () => {
  const nodes = [
    createIndexNode("concrete"),
    createIndexNode("external", { kind: "external", role: "external" }),
    createIndexNode("unresolved", { kind: "unresolved", role: "unresolved" })
  ];

  assert.equal(query(nodes).totalMatchCount, 3);
  assert.deepEqual(
    query(nodes, {
      filters: { includeExternal: false, includeUnresolved: false }
    }).rows.map((row) => row.functionKind),
    ["function"]
  );
  assert.equal(query(nodes, { filters: { includeExternal: false } }).totalMatchCount, 2);
  assert.equal(query(nodes, { filters: { includeUnresolved: false } }).totalMatchCount, 2);
});

test("returns an exact terminal empty page when no callable matches", () => {
  const payload = query([createIndexNode("handler")], { query: "missing-name" });

  assert.equal(payload.totalMatchCount, 0);
  assert.deepEqual(payload.rows, []);
  assert.equal(payload.nextCursor, undefined);
});

test("orders by textual relevance, graph relevance, then stable source path", () => {
  const nodes = [
    createIndexNode("path", {
      name: "other",
      qualifiedName: "Other.run",
      filePath: "/workspace/src/handler/path.ts"
    }),
    createIndexNode("qualified", {
      name: "other",
      qualifiedName: "Handler.other",
      filePath: "/workspace/src/c-qualified.ts"
    }),
    createIndexNode("exact-b", {
      name: "handler",
      qualifiedName: "B.handler",
      filePath: "/workspace/src/b.ts"
    }),
    createIndexNode("exact-a", {
      name: "handler",
      qualifiedName: "A.handler",
      filePath: "/workspace/src/a.ts"
    }),
    createIndexNode("exact-entry", {
      name: "handler",
      qualifiedName: "Z.handler",
      filePath: "/workspace/src/z.ts",
      role: "entrypoint",
      metrics: createMetrics({ directCalleeCount: 2 })
    })
  ];
  const expected = ["exact-entry", "exact-a", "exact-b", "qualified", "path"];
  const forward = query(nodes, { query: "handler" }).rows.map((row) => row.sourceToken);
  const shuffled = query([...nodes].reverse(), { query: "handler" }).rows.map((row) => row.sourceToken);

  assert.deepEqual(forward, expected.map(createSourceToken));
  assert.deepEqual(shuffled, expected.map(createSourceToken));
});

test("opaque cursors return every deterministic page without duplicates", () => {
  const nodes = Array.from({ length: 7 }, (_, index) => createIndexNode(`item-${index}`, {
    name: `item${index}`,
    qualifiedName: `Items.item${index}`,
    filePath: `/workspace/src/item-${String(index).padStart(2, "0")}.ts`
  }));
  const seen: string[] = [];
  let cursor: string | undefined;

  do {
    const payload = query(nodes, { query: "ITEM", limit: 2, cursor });
    assert.equal(payload.totalMatchCount, 7);
    seen.push(...payload.rows.map((row) => row.sourceToken ?? ""));
    cursor = payload.nextCursor;
  } while (cursor);

  assert.equal(seen.length, 7);
  assert.equal(new Set(seen).size, 7);
  assert.deepEqual(seen, nodes.map((node) => createSourceToken(node.id)));

  const first = query(nodes, { query: "item", limit: 2 });
  assert.match(first.nextCursor ?? "", /^function-search:[A-Za-z0-9_-]+$/u);
  assert.equal(first.nextCursor?.includes("item"), false);

  const cursorValue = first.nextCursor ?? "";
  const replacement = cursorValue.endsWith("a") ? "b" : "a";
  const tampered = `${cursorValue.slice(0, -1)}${replacement}`;
  const rejected = query(nodes, { query: "item", limit: 2, cursor: tampered });
  assert.equal(rejected.totalMatchCount, 7);
  assert.deepEqual(rejected.rows, []);
  assert.equal(rejected.nextCursor, undefined);
});

test("caps ten-thousand-match pages while preserving exact counts", () => {
  const nodes = Array.from({ length: 10_000 }, (_, index) => createIndexNode(`handler-${index}`, {
    name: `handler${String(index).padStart(5, "0")}`,
    qualifiedName: `Handlers.handler${String(index).padStart(5, "0")}`,
    filePath: `/workspace/src/generated/handler-${String(index).padStart(5, "0")}.ts`
  }));
  const first = query(nodes, { query: "handler", limit: 10_000 });
  const second = query(nodes, {
    query: "handler",
    limit: 10_000,
    cursor: first.nextCursor
  });

  assert.equal(first.totalMatchCount, 10_000);
  assert.equal(first.rows.length, FUNCTION_SEARCH_MAX_PAGE_SIZE);
  assert.equal(second.rows.length, FUNCTION_SEARCH_MAX_PAGE_SIZE);
  assert.ok(first.nextCursor);
  assert.equal(
    first.rows.some((row) => second.rows.some((candidate) => candidate.id === row.id)),
    false
  );
  assert.ok(Buffer.byteLength(JSON.stringify(first), "utf8") < 128 * 1024);
});

test("FunctionExplorerProjectionService reuses and clears its cached core", () => {
  const graph = createGraph([createSymbolNode("first")]);
  const service = new FunctionExplorerProjectionService();
  const request = createRequest({ query: "", limit: 100 });

  assert.equal(service.search(graph, request).totalMatchCount, 1);

  // Graph objects are immutable in production. Mutating this fixture makes a
  // rebuilt index observable without exposing cache implementation details.
  graph.nodes.push(createSymbolNode("second"));
  assert.equal(service.search(graph, request).totalMatchCount, 1);

  service.clear();
  assert.equal(service.search(graph, request).totalMatchCount, 2);
});

/** Runs the pure query with stable workspace and snapshot defaults. */
function query(
  nodes: readonly FunctionIndexNode[],
  overrides: Partial<FunctionExplorerSearchRequest> = {}
) {
  return searchFunctionIndex({
    workspaceRoot: "/workspace",
    nodes,
    request: createRequest(overrides),
    createSourceToken
  });
}

/** Creates one valid search request while allowing focused test overrides. */
function createRequest(
  overrides: Partial<FunctionExplorerSearchRequest> = {}
): FunctionExplorerSearchRequest {
  return {
    graphVersion: "sidebar-snapshot:1",
    requestId: 1,
    query: "",
    limit: 100,
    ...overrides
  };
}

/** Creates deterministic opaque fixtures without echoing analyzer identities. */
function createSourceToken(nodeId: string): SourceNodeToken {
  return `source-node:${createContentHash(`test-salt\0${nodeId}`)}`;
}

/** Creates one host-side callable record without building a graph fixture. */
function createIndexNode(
  id: string,
  overrides: Partial<FunctionIndexNode> = {}
): FunctionIndexNode {
  return {
    id,
    symbolId: id,
    kind: "function",
    name: id,
    qualifiedName: `Fixture.${id}`,
    filePath: `/workspace/src/${id}.ts`,
    range: createRange(0),
    role: "unknown",
    tags: [],
    metrics: createMetrics(),
    confidence: "exact",
    ...overrides
  };
}

/** Creates complete direct metrics with focused overrides. */
function createMetrics(overrides: Partial<FunctionIndexNode["metrics"]> = {}) {
  return {
    directCallerCount: 0,
    directCalleeCount: 0,
    reachableEntrypointCount: 0,
    unresolvedCallCount: 0,
    externalCallCount: 0,
    ...overrides
  };
}

/** Creates zero-based source coordinates used by protocol rows. */
function createRange(startLine: number): SourceRange {
  return {
    startLine,
    startCharacter: 0,
    endLine: startLine,
    endCharacter: 10
  };
}

/** Creates one concrete graph symbol for the cache lifecycle fixture. */
function createSymbolNode(id: string): SymbolNode {
  return {
    id,
    kind: "function",
    name: id,
    qualifiedName: `Fixture.${id}`,
    filePath: `/workspace/src/${id}.ts`,
    range: createRange(0),
    selectionRange: createRange(0),
    language: "typescript"
  };
}

/** Creates the minimum immutable graph consumed by the host projection service. */
function createGraph(nodes: SymbolNode[]): ProjectGraph {
  return {
    workspaceRoot: "/workspace",
    version: "engine-v1",
    generatedAt: "2026-07-14T00:00:00.000Z",
    nodes,
    edges: [],
    diagnostics: [],
    metadata: {
      languages: ["typescript"],
      fileCount: nodes.length,
      symbolCount: nodes.length,
      edgeCount: 0
    }
  };
}
