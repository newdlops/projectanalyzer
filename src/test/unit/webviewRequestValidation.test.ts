/**
 * Runtime validation tests for the Webview-to-extension request boundary. The
 * fixtures cover every request discriminator plus malformed nested payloads.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { FunctionExplorerFilters } from "../../protocol/functionExplorer";
import type { WebviewRequest } from "../../protocol/messages";
import {
  isWebviewRequest,
  validateWebviewRequest
} from "../../protocol/webviewRequestValidation";

test("accepts every current WebviewRequest variant", () => {
  const requests = createValidRequests();

  for (const request of requests) {
    const result = validateWebviewRequest(request);
    assert.equal(result.ok, true, `expected ${request.type} to pass validation`);
    assert.equal(isWebviewRequest(request), true);
  }

  assert.deepEqual(
    requests.map((request) => request.type),
    [
      "ui/ready",
      "graph/load",
      "graph/openPanel",
      "graph/showWorkspaceScope",
      "graph/focusNode",
      "graph/expand",
      "analysis/run",
      "analysis/cancel",
      "cache/clear",
      "node/openSource",
      "node/showRelationship",
      "search/query",
      "export/run",
      "function/index",
      "function/sectionRows",
      "function/expand",
      "function/search",
      "function/select",
      "function/inventory",
      "telemetry/log"
    ]
  );
});

test("accepts optional Function Explorer filters, options, and traversal controls", () => {
  const sharedFilters = {
    query: "handler",
    filePath: "/workspace/src/handler.ts",
    roles: ["routeHandler", "resolver", "service"],
    frameworks: ["express", "nestjs"],
    confidences: ["exact", "resolved", "inferred", "unresolved"],
    tags: ["async", "network", "unresolvedCall"],
    includeExternal: true,
    includeUnresolved: true,
    includeInferred: false,
    includeTests: false,
    includeGenerated: false,
    includeMigrations: false
  } satisfies FunctionExplorerFilters;
  const request = {
    type: "function/index",
    payload: {
      graphVersion: "graph:v2",
      options: {
        requestedSections: ["entrypoints", "frameworkHandlers", "allFunctions"],
        initialRowLimit: 100,
        expandedRowIds: ["row:1"],
        filters: sharedFilters,
        sortBy: "fan-out",
        selectedFunctionId: "fn:handler"
      }
    }
  } satisfies WebviewRequest;
  const expandRequest = {
    type: "function/expand",
    payload: {
      graphVersion: "graph:v2",
      sectionId: "selected",
      rowId: "row:1",
      options: {
        direction: "both",
        maxDepth: 0,
        maxRows: 250,
        includeExternal: true,
        includeUnresolved: true,
        includeInferred: true,
        includeTests: false,
        stopAtFrameworkBoundary: true,
        stopAtExternal: false
      }
    }
  } satisfies WebviewRequest;

  assert.equal(validateWebviewRequest(request).ok, true);
  assert.equal(validateWebviewRequest(expandRequest).ok, true);
});

test("rejects malformed top-level values and signal payloads", () => {
  const malformed: unknown[] = [
    null,
    undefined,
    [],
    "ui/ready",
    {},
    { type: 1, payload: {} },
    { type: "unknown/request", payload: {} },
    { type: "ui/ready" },
    { type: "ui/ready", payload: { unexpected: true } },
    { type: "analysis/cancel", payload: [] },
    { type: "cache/clear", payload: null }
  ];

  for (const value of malformed) {
    assert.equal(validateWebviewRequest(value).ok, false);
    assert.equal(isWebviewRequest(value), false);
  }
});

test("rejects malformed graph, analysis, node, search, and export payloads", () => {
  const malformed: unknown[] = [
    { type: "graph/load", payload: { mode: "dependency", depth: 1 } },
    { type: "graph/load", payload: { mode: "file", depth: -1 } },
    { type: "graph/load", payload: { mode: "file", depth: 1.5 } },
    { type: "graph/load", payload: { mode: "file", depth: 1, rootNodeId: 42 } },
    { type: "graph/focusNode", payload: { nodeId: 42 } },
    { type: "graph/expand", payload: { nodeId: "node:1", depth: Number.NaN } },
    { type: "analysis/run", payload: { scope: "folder" } },
    { type: "node/openSource", payload: {} },
    { type: "node/showRelationship", payload: { nodeId: "node:1", direction: "both" } },
    { type: "search/query", payload: { query: false } },
    { type: "export/run", payload: { format: "xml" } }
  ];

  for (const value of malformed) {
    assert.equal(validateWebviewRequest(value).ok, false);
  }
});

test("rejects malformed Function Explorer nested values", () => {
  const malformed: unknown[] = [
    { type: "function/index", payload: { graphVersion: 1 } },
    {
      type: "function/index",
      payload: { options: { requestedSections: ["entrypoints", "missing"] } }
    },
    {
      type: "function/index",
      payload: { options: { filters: { roles: ["service", "admin"] } } }
    },
    {
      type: "function/index",
      payload: { options: { filters: { confidences: ["exact", "probable"] } } }
    },
    {
      type: "function/index",
      payload: { options: { filters: { tags: ["async", 1] } } }
    },
    {
      type: "function/sectionRows",
      payload: { graphVersion: "v1", sectionId: "entrypoints", limit: -1 }
    },
    {
      type: "function/sectionRows",
      payload: { graphVersion: "v1", sectionId: "entrypoints", limit: 10, expandedRowIds: "row:1" }
    },
    {
      type: "function/expand",
      payload: {
        graphVersion: "v1",
        sectionId: "allFunctions",
        rowId: "row:1",
        options: { direction: "downstream", maxDepth: 2, maxRows: 20 }
      }
    },
    {
      type: "function/expand",
      payload: {
        graphVersion: "v1",
        sectionId: "allFunctions",
        rowId: "row:1",
        options: { direction: "callees", maxDepth: 2, maxRows: Number.POSITIVE_INFINITY }
      }
    },
    { type: "function/search", payload: { graphVersion: "v1", query: "main", limit: "20" } },
    { type: "function/select", payload: { graphVersion: "v1", functionId: 99 } },
    { type: "function/inventory", payload: { graphVersion: "v1", limit: 20, sortBy: "size" } }
  ];

  for (const value of malformed) {
    assert.equal(validateWebviewRequest(value).ok, false);
  }
});

test("rejects telemetry with arbitrary levels, sources, or fields", () => {
  const malformed: unknown[] = [
    {
      type: "telemetry/log",
      payload: { level: "trace", message: "message", source: "sidebar" }
    },
    {
      type: "telemetry/log",
      payload: { level: "info", message: "message", source: "iframe" }
    },
    {
      type: "telemetry/log",
      payload: { level: "info", message: 42, source: "sidebar" }
    },
    {
      type: "telemetry/log",
      payload: { fields: [], level: "info", message: "message", source: "sidebar" }
    }
  ];

  for (const value of malformed) {
    const result = validateWebviewRequest(value);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.receivedType, "telemetry/log");
    }
  }
});

test("contains exceptions from unreadable request objects", () => {
  const unreadableRequest = new Proxy(
    {},
    {
      get(): never {
        throw new Error("untrusted getter");
      }
    }
  );
  const unreadableTelemetryPayload = new Proxy(
    {},
    {
      get(): never {
        throw new Error("untrusted telemetry getter");
      }
    }
  );

  assert.doesNotThrow(() => validateWebviewRequest(unreadableRequest));
  assert.equal(validateWebviewRequest(unreadableRequest).ok, false);
  assert.doesNotThrow(() =>
    validateWebviewRequest({ type: "telemetry/log", payload: unreadableTelemetryPayload })
  );
  assert.equal(
    validateWebviewRequest({ type: "telemetry/log", payload: unreadableTelemetryPayload }).ok,
    false
  );
});

/** Creates one representative request for every WebviewRequest discriminator. */
function createValidRequests(): WebviewRequest[] {
  return [
    { type: "ui/ready", payload: {} },
    { type: "graph/load", payload: { mode: "call", rootNodeId: "node:root", depth: 2 } },
    { type: "graph/openPanel", payload: {} },
    { type: "graph/showWorkspaceScope", payload: {} },
    { type: "graph/focusNode", payload: { nodeId: "node:focus" } },
    { type: "graph/expand", payload: { nodeId: "node:expand", depth: 0 } },
    { type: "analysis/run", payload: { scope: "currentFile" } },
    { type: "analysis/cancel", payload: {} },
    { type: "cache/clear", payload: {} },
    { type: "node/openSource", payload: { nodeId: "node:source" } },
    { type: "node/showRelationship", payload: { nodeId: "node:1", direction: "callers" } },
    { type: "search/query", payload: { query: "handler" } },
    { type: "export/run", payload: { format: "markdown" } },
    { type: "function/index", payload: {} },
    {
      type: "function/sectionRows",
      payload: { graphVersion: "v1", sectionId: "hotspots", limit: 25 }
    },
    {
      type: "function/expand",
      payload: { graphVersion: "v1", sectionId: "selected", rowId: "row:1" }
    },
    { type: "function/search", payload: { graphVersion: "v1", query: "handler", limit: 10 } },
    { type: "function/select", payload: { graphVersion: "v1", functionId: "fn:1" } },
    { type: "function/inventory", payload: { graphVersion: "v1", limit: 50 } },
    {
      type: "telemetry/log",
      payload: {
        fields: { renderDurationMs: 12 },
        level: "debug",
        message: "render complete",
        source: "graphPanel"
      }
    }
  ] satisfies WebviewRequest[];
}
