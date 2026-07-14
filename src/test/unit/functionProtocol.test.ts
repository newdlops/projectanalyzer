/**
 * Compile-focused fixtures for the Function Explorer protocol. These tests keep
 * the Phase 2 message contracts assignable to WebviewRequest and
 * ExtensionResponse while checking that payload fixtures stay JSON-shaped.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type {
  FunctionExplorerInventoryRequest,
  FunctionExplorerPayload,
  FunctionExplorerRow,
  FunctionExplorerSearchPayload,
  FunctionExplorerSearchRequest,
  FunctionExplorerSectionRowsRequest
} from "../../protocol/functionExplorer";
import type { ExtensionResponse, WebviewRequest } from "../../protocol/messages";

test("function/indexLoaded accepts a JSON-serializable Function Explorer payload", () => {
  const payload = createFunctionExplorerPayloadFixture();
  const response = { type: "function/indexLoaded", payload } satisfies ExtensionResponse;

  assert.equal(response.payload.summary.callableNodeCount, 2);
  assert.equal(response.payload.sections[0]?.id, "entrypoints");
  assert.equal(response.payload.rows[1]?.functionId, "fn:service");
  assert.deepEqual(response.payload.options.requestedSections, ["entrypoints", "allFunctions"]);
  assertJsonProtocolValue(response);
});

test("function/searchLoaded accepts a bounded JSON search page", () => {
  const payload = {
    graphVersion: "sidebar-snapshot:4",
    requestId: 7,
    query: "service",
    rows: [{
      id: "function-search:service",
      sectionId: "allFunctions",
      kind: "function",
      label: "Service.handle",
      depth: 0,
      hasChildren: false,
      expanded: false,
      sourceToken: "source-node:opaque",
      functionKind: "method",
      role: "service"
    }],
    totalMatchCount: 3,
    nextCursor: "function-search:opaque"
  } satisfies FunctionExplorerSearchPayload;
  const response = { type: "function/searchLoaded", payload } satisfies ExtensionResponse;

  assert.equal(response.payload.rows[0]?.sourceToken, "source-node:opaque");
  assert.equal(response.payload.totalMatchCount, 3);
  assertJsonProtocolValue(response);
});

test("function/searchFailed keeps request correlation JSON-shaped", () => {
  const response = {
    type: "function/searchFailed",
    payload: {
      graphVersion: "sidebar-snapshot:4",
      requestId: 8,
      query: "service",
      message: "Function search failed; try again"
    }
  } satisfies ExtensionResponse;

  assert.equal(response.payload.requestId, 8);
  assertJsonProtocolValue(response);
});

test("Function Explorer request fixtures compile as WebviewRequest variants", () => {
  const sectionPayload = {
    graphVersion: "graph:v1",
    sectionId: "entrypoints",
    limit: 25,
    expandedRowIds: ["function:entry"],
    filters: {
      includeExternal: true,
      includeUnresolved: true,
      includeInferred: false,
      roles: ["entrypoint", "service"]
    }
  } satisfies FunctionExplorerSectionRowsRequest;
  const inventoryPayload = {
    graphVersion: "graph:v1",
    limit: 50,
    cursor: "inventory:50",
    sortBy: "fan-out",
    filters: {
      query: "handle",
      confidences: ["exact", "resolved"],
      includeExternal: false,
      includeUnresolved: true
    }
  } satisfies FunctionExplorerInventoryRequest;
  const searchPayload = {
    graphVersion: "graph:v1",
    requestId: 7,
    query: "handle",
    limit: 25,
    cursor: "function-search:opaque",
    filters: {
      includeExternal: false,
      includeUnresolved: true
    }
  } satisfies FunctionExplorerSearchRequest;
  const requests = [
    { type: "function/index", payload: { graphVersion: "graph:v1" } },
    { type: "function/sectionRows", payload: sectionPayload },
    { type: "function/search", payload: searchPayload },
    { type: "function/inventory", payload: inventoryPayload }
  ] satisfies WebviewRequest[];

  assert.deepEqual(
    requests.map((request) => request.type),
    ["function/index", "function/sectionRows", "function/search", "function/inventory"]
  );
  assertJsonProtocolValue(requests);
});

/** Creates a representative initial Function Explorer payload fixture. */
function createFunctionExplorerPayloadFixture(): FunctionExplorerPayload {
  const rows = [
    {
      id: "function:entry",
      sectionId: "entrypoints",
      kind: "function",
      label: "main",
      depth: 1,
      hasChildren: true,
      expanded: false,
      functionId: "fn:entry",
      symbolId: "sym:entry",
      edgeIds: ["edge:entry-service"],
      filePath: "/workspace/src/main.ts",
      range: createRange(0),
      functionKind: "function",
      role: "entrypoint",
      tags: ["exported"],
      metrics: createMetrics({ directCalleeCount: 1, reachableEntrypointCount: 1 }),
      confidence: "exact",
      childCursor: "entry:children",
      metadata: {
        framework: "node",
        evidence: ["exported main"]
      }
    },
    {
      id: "function:service",
      sectionId: "allFunctions",
      kind: "function",
      label: "Service.handle",
      depth: 0,
      hasChildren: false,
      expanded: false,
      functionId: "fn:service",
      symbolId: "sym:service",
      filePath: "/workspace/src/service.ts",
      range: createRange(12),
      functionKind: "method",
      role: "service",
      tags: ["database", "unresolvedCall"],
      metrics: createMetrics({
        directCallerCount: 1,
        unresolvedCallCount: 1,
        externalCallCount: 1
      }),
      confidence: "resolved"
    }
  ] satisfies FunctionExplorerRow[];

  return {
    graphVersion: "graph:v1",
    workspaceRoot: "/workspace",
    summary: {
      graphVersion: "graph:v1",
      generatedAt: "2026-06-21T00:00:00.000Z",
      analyzedFileCount: 2,
      skippedFileCount: 1,
      parserFailureCount: 0,
      excludedFileCount: 1,
      callableNodeCount: 2,
      callEdgeCount: 3,
      externalCallableCount: 1,
      unresolvedCallableCount: 1,
      externalCallEdgeCount: 1,
      unresolvedCallEdgeCount: 1,
      inferredCallEdgeCount: 0,
      visibleByDefaultViewCount: 1,
      hiddenByDefaultViewCount: 1,
      hiddenByCollapsedBranchCount: 1,
      hiddenByActiveFilterCount: 0
    },
    sections: [
      {
        id: "entrypoints",
        title: "Entrypoints",
        totalRowCount: 1,
        visibleRowCount: 1,
        hiddenRowCount: 0,
        hasMore: false
      },
      {
        id: "allFunctions",
        title: "All Functions",
        totalRowCount: 2,
        visibleRowCount: 1,
        hiddenRowCount: 1,
        hasMore: true,
        nextCursor: "inventory:1"
      }
    ],
    rows,
    options: {
      requestedSections: ["entrypoints", "allFunctions"],
      initialRowLimit: 25,
      sortBy: "relevance",
      filters: {
        includeExternal: true,
        includeUnresolved: true,
        includeInferred: true
      }
    },
    nextCursor: "payload:next"
  };
}

/** Creates zero-based source range data for protocol row fixtures. */
function createRange(startLine: number) {
  return {
    startLine,
    startCharacter: 0,
    endLine: startLine,
    endCharacter: 10
  };
}

/** Creates complete metric objects while keeping each fixture row focused. */
function createMetrics(overrides: Partial<FunctionExplorerRow["metrics"]>) {
  return {
    directCallerCount: 0,
    directCalleeCount: 0,
    reachableEntrypointCount: 0,
    unresolvedCallCount: 0,
    externalCallCount: 0,
    ...overrides
  };
}

/** Verifies protocol fixtures only contain plain JSON values using an explicit stack. */
function assertJsonProtocolValue(value: unknown): void {
  const stack: unknown[] = [value];
  const visited = new Set<object>();

  while (stack.length > 0) {
    const next = stack.pop();

    if (next === null) {
      continue;
    }

    const valueType = typeof next;
    if (valueType === "string" || valueType === "number" || valueType === "boolean") {
      continue;
    }

    if (valueType !== "object") {
      assert.fail(`Expected JSON protocol value, received ${valueType}`);
    }

    const objectValue = next as object;
    if (visited.has(objectValue)) {
      continue;
    }
    visited.add(objectValue);

    if (next instanceof Map || next instanceof Set || next instanceof Date) {
      assert.fail("Function Explorer protocol fixtures must not contain Map, Set, or Date values");
    }

    if (Array.isArray(next)) {
      stack.push(...next);
      continue;
    }

    for (const [key, child] of Object.entries(next as Record<string, unknown>)) {
      assert.notEqual(child, undefined, `Property ${key} must be omitted instead of set to undefined`);
      stack.push(child);
    }
  }

  assert.doesNotThrow(() => JSON.stringify(value));
}
