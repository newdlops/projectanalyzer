/**
 * Runtime validation tests for the Webview-to-extension request boundary. The
 * fixtures cover every request discriminator plus malformed nested payloads.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { FunctionExplorerFilters } from "../../protocol/functionExplorer";
import type { WebviewRequest } from "../../protocol/messages";
import {
  MODULE_FLOW_DETAIL_MAX_EVIDENCE,
  MODULE_FLOW_DETAIL_MAX_RELATIONS,
  MODULE_FLOW_EXPAND_MAX_EDGES,
  MODULE_FLOW_EXPAND_MAX_NODES,
  MODULE_FLOW_LIST_MAX_EDGES,
  MODULE_FLOW_LIST_MAX_MODULES
} from "../../protocol/moduleFlow";
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
      "codeFlow/catalog",
      "codeFlow/select",
      "codeFlow/selectSource",
      "codeFlow/openEvidence",
      "moduleFlow/open",
      "moduleFlow/list",
      "moduleFlow/detail",
      "moduleFlow/expand",
      "moduleFlow/openSource",
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
    { type: "cache/clear", payload: null },
    { type: "moduleFlow/open", payload: { graphVersion: "not-allowed" } }
  ];

  for (const value of malformed) {
    assert.equal(validateWebviewRequest(value).ok, false);
    assert.equal(isWebviewRequest(value), false);
  }
});

test("rejects retired guide, dashboard, and structure request routes", () => {
  const retiredRequests: unknown[] = [
    { type: "graph/loadStructure", payload: { graphVersion: "v1" } },
    { type: "project/loadOverview", payload: { graphVersion: "v1" } },
    {
      type: "project/readingGuideScope",
      payload: { graphVersion: "v1", scopeId: "reading-scope:0123456789abcdef01234567" }
    },
    {
      type: "project/guidedTourOpenSource",
      payload: {
        graphVersion: "v1",
        missionId: "guided-mission:0123456789abcdef01234567",
        stopId: "guided-stop:0123456789abcdef01234567",
        sourceToken: `source-node:${"a".repeat(64)}`,
        requestId: 1
      }
    }
  ];

  for (const request of retiredRequests) {
    assert.equal(validateWebviewRequest(request).ok, false);
  }
});

test("rejects malformed graph, analysis, node, search, and export payloads", () => {
  const malformed: unknown[] = [
    { type: "graph/load", payload: { mode: "dependency", depth: 1 } },
    { type: "graph/load", payload: { mode: "file", depth: -1 } },
    { type: "graph/load", payload: { mode: "file", depth: 1.5 } },
    { type: "graph/load", payload: { mode: "file", depth: 1, rootNodeId: 42 } },
    { type: "graph/loadStructure", payload: {} },
    { type: "graph/focusNode", payload: { nodeId: 42 } },
    { type: "graph/expand", payload: { nodeId: "node:1", depth: Number.NaN } },
    { type: "analysis/run", payload: { scope: "folder" } },
    { type: "node/openSource", payload: {} },
    { type: "node/showRelationship", payload: { nodeId: "node:1", direction: "both" } },
    { type: "project/readingGuideScope", payload: { graphVersion: "v1" } },
    { type: "project/readingGuideScope", payload: { graphVersion: 1, scopeId: "scope:api" } },
    { type: "project/readingGuideScope", payload: { graphVersion: "v1", scopeId: "scope:api" } },
    { type: "project/loadOverview", payload: { graphVersion: 1 } },
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

test("bounds Function Explorer search query and cursor text", () => {
  const boundary = "x".repeat(512);
  const oversized = "x".repeat(513);

  assert.equal(validateWebviewRequest({
    type: "function/search",
    payload: { graphVersion: "v1", requestId: 1, query: boundary, limit: 20, cursor: boundary }
  }).ok, true);
  assert.equal(validateWebviewRequest({
    type: "function/search",
    payload: { graphVersion: "v1", requestId: 2, query: oversized, limit: 20 }
  }).ok, false);
  assert.equal(validateWebviewRequest({
    type: "function/search",
    payload: { graphVersion: "v1", requestId: 3, query: "handler", limit: 20, cursor: oversized }
  }).ok, false);
});

test("bounds CodeFlow search and accepts only opaque snapshot references", () => {
  const graphVersion = "sidebar-snapshot:validation:1";
  const flowId = "code-flow:0123456789abcdef0123456789abcdef";
  const sourceToken = `source-node:${"a".repeat(64)}`;
  const evidenceToken = `code-evidence:${"b".repeat(64)}`;

  assert.equal(validateWebviewRequest({
    type: "codeFlow/catalog",
    payload: { graphVersion, requestId: 0, query: "x".repeat(512), limit: 24 }
  }).ok, true);
  assert.equal(validateWebviewRequest({
    type: "codeFlow/catalog",
    payload: { graphVersion, requestId: 1, query: "x".repeat(513), limit: 24 }
  }).ok, false);
  assert.equal(validateWebviewRequest({
    type: "codeFlow/select",
    payload: { graphVersion, flowId }
  }).ok, true);
  assert.equal(validateWebviewRequest({
    type: "codeFlow/select",
    payload: { graphVersion, flowId: "GET /orders" }
  }).ok, false);
  assert.equal(validateWebviewRequest({
    type: "codeFlow/selectSource",
    payload: { graphVersion, sourceToken }
  }).ok, true);
  assert.equal(validateWebviewRequest({
    type: "codeFlow/selectSource",
    payload: { graphVersion, sourceToken: "source-node:root" }
  }).ok, false);
  assert.equal(validateWebviewRequest({
    type: "codeFlow/openEvidence",
    payload: { graphVersion, evidenceToken }
  }).ok, true);
  assert.equal(validateWebviewRequest({
    type: "codeFlow/openEvidence",
    payload: { graphVersion, evidenceToken: "code-evidence:/workspace/src/orders.ts:12" }
  }).ok, false);
});

test("accepts bounded Module Flow requests with strict opaque identities", () => {
  const graphVersion = "sidebar-snapshot:validation:2";
  const moduleId = `module-flow-module:${"a".repeat(32)}`;
  const edgeId = `module-flow-edge:${"b".repeat(32)}`;
  const sourceToken = `source-node:${"c".repeat(64)}`;
  const evidenceToken = `module-flow-evidence:${"d".repeat(64)}`;
  const requests: unknown[] = [
    {
      type: "moduleFlow/list",
      payload: {
        graphVersion,
        requestId: 1,
        mode: "execution",
        moduleLimit: MODULE_FLOW_LIST_MAX_MODULES,
        edgeLimit: MODULE_FLOW_LIST_MAX_EDGES,
        includeExternal: true,
        includeInferred: false
      }
    },
    {
      type: "moduleFlow/detail",
      payload: {
        graphVersion,
        requestId: 2,
        target: { kind: "module", id: moduleId },
        relationLimit: MODULE_FLOW_DETAIL_MAX_RELATIONS,
        evidenceLimit: MODULE_FLOW_DETAIL_MAX_EVIDENCE
      }
    },
    {
      type: "moduleFlow/detail",
      payload: {
        graphVersion,
        requestId: 3,
        target: { kind: "edge", id: edgeId },
        relationLimit: 1,
        evidenceLimit: 1
      }
    },
    {
      type: "moduleFlow/expand",
      payload: {
        graphVersion,
        requestId: 4,
        moduleId,
        expansion: "boundaryFunctions",
        direction: "both",
        nodeLimit: MODULE_FLOW_EXPAND_MAX_NODES,
        edgeLimit: MODULE_FLOW_EXPAND_MAX_EDGES
      }
    },
    {
      type: "moduleFlow/openSource",
      payload: {
        graphVersion,
        requestId: 5,
        target: { kind: "node", sourceToken }
      }
    },
    {
      type: "moduleFlow/openSource",
      payload: {
        graphVersion,
        requestId: 6,
        target: { kind: "evidence", evidenceToken }
      }
    }
  ];

  for (const request of requests) {
    assert.equal(validateWebviewRequest(request).ok, true);
  }
});

test("rejects unbounded or path-bearing Module Flow requests", () => {
  const graphVersion = "sidebar-snapshot:validation:2";
  const moduleId = `module-flow-module:${"a".repeat(32)}`;
  const edgeId = `module-flow-edge:${"b".repeat(32)}`;
  const sourceToken = `source-node:${"c".repeat(64)}`;
  const malformed: unknown[] = [
    {
      type: "moduleFlow/list",
      payload: {
        graphVersion: "",
        requestId: 1,
        mode: "execution",
        moduleLimit: 1,
        edgeLimit: 1
      }
    },
    {
      type: "moduleFlow/list",
      payload: {
        graphVersion: "x".repeat(129),
        requestId: 1,
        mode: "execution",
        moduleLimit: 1,
        edgeLimit: 1
      }
    },
    {
      type: "moduleFlow/list",
      payload: {
        graphVersion,
        requestId: 1,
        mode: "all",
        moduleLimit: 1,
        edgeLimit: 1
      }
    },
    {
      type: "moduleFlow/list",
      payload: {
        graphVersion,
        requestId: 1,
        mode: "execution",
        moduleLimit: 0,
        edgeLimit: 1
      }
    },
    {
      type: "moduleFlow/list",
      payload: {
        graphVersion,
        requestId: 1,
        mode: "execution",
        moduleLimit: MODULE_FLOW_LIST_MAX_MODULES + 1,
        edgeLimit: 1
      }
    },
    {
      type: "moduleFlow/list",
      payload: {
        graphVersion,
        requestId: 1,
        mode: "execution",
        moduleLimit: 1,
        edgeLimit: MODULE_FLOW_LIST_MAX_EDGES + 1,
        rootPath: "/workspace/packages/api"
      }
    },
    {
      type: "moduleFlow/detail",
      payload: {
        graphVersion,
        requestId: 2,
        target: { kind: "module", id: "project-module:/workspace/packages/api" },
        relationLimit: 1,
        evidenceLimit: 1
      }
    },
    {
      type: "moduleFlow/detail",
      payload: {
        graphVersion,
        requestId: 2,
        target: { kind: "edge", id: edgeId, edgeIds: ["raw-edge"] },
        relationLimit: 1,
        evidenceLimit: 1
      }
    },
    {
      type: "moduleFlow/detail",
      payload: {
        graphVersion,
        requestId: 2,
        target: { kind: "module", id: moduleId },
        relationLimit: MODULE_FLOW_DETAIL_MAX_RELATIONS + 1,
        evidenceLimit: 1
      }
    },
    {
      type: "moduleFlow/detail",
      payload: {
        graphVersion,
        requestId: 2,
        target: { kind: "module", id: moduleId },
        relationLimit: 1,
        evidenceLimit: MODULE_FLOW_DETAIL_MAX_EVIDENCE + 1
      }
    },
    {
      type: "moduleFlow/expand",
      payload: {
        graphVersion,
        requestId: 3,
        moduleId,
        expansion: "recursive",
        direction: "both",
        nodeLimit: 1,
        edgeLimit: 1
      }
    },
    {
      type: "moduleFlow/expand",
      payload: {
        graphVersion,
        requestId: 3,
        moduleId,
        expansion: "childModules",
        direction: "downstream",
        nodeLimit: MODULE_FLOW_EXPAND_MAX_NODES + 1,
        edgeLimit: MODULE_FLOW_EXPAND_MAX_EDGES + 1
      }
    },
    {
      type: "moduleFlow/openSource",
      payload: {
        graphVersion,
        requestId: 4,
        target: { kind: "node", sourceToken: "/workspace/src/index.ts" }
      }
    },
    {
      type: "moduleFlow/openSource",
      payload: {
        graphVersion,
        requestId: 4,
        target: {
          kind: "node",
          sourceToken,
          evidenceToken: `module-flow-evidence:${"d".repeat(64)}`
        }
      }
    },
    {
      type: "moduleFlow/openSource",
      payload: {
        graphVersion,
        requestId: -1,
        target: { kind: "evidence", evidenceToken: "module-flow-evidence:callsite" }
      }
    }
  ];

  for (const request of malformed) {
    assert.equal(validateWebviewRequest(request).ok, false);
  }
});

test("accepts only filters implemented by Function Explorer search", () => {
  const base = {
    graphVersion: "v1",
    requestId: 1,
    query: "handler",
    limit: 20
  };

  assert.equal(validateWebviewRequest({
    type: "function/search",
    payload: { ...base, filters: { includeExternal: false, includeUnresolved: true } }
  }).ok, true);
  assert.equal(validateWebviewRequest({
    type: "function/search",
    payload: { ...base, filters: { roles: ["service"] } }
  }).ok, false);
  assert.equal(validateWebviewRequest({
    type: "function/search",
    payload: { ...base, filters: { includeTests: false } }
  }).ok, false);
  assert.equal(validateWebviewRequest({
    type: "function/search",
    payload: { graphVersion: "v1", query: "handler", limit: 20 }
  }).ok, false);
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
    {
      type: "codeFlow/catalog",
      payload: { graphVersion: "v1", requestId: 1, query: "orders", limit: 24 }
    },
    {
      type: "codeFlow/select",
      payload: { graphVersion: "v1", flowId: "code-flow:0123456789abcdef0123456789abcdef" }
    },
    {
      type: "codeFlow/selectSource",
      payload: {
        graphVersion: "v1",
        sourceToken: "source-node:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
      }
    },
    {
      type: "codeFlow/openEvidence",
      payload: {
        graphVersion: "v1",
        evidenceToken: "code-evidence:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      }
    },
    { type: "moduleFlow/open", payload: {} },
    {
      type: "moduleFlow/list",
      payload: {
        graphVersion: "v1",
        requestId: 1,
        mode: "execution",
        moduleLimit: 32,
        edgeLimit: 64,
        includeExternal: true,
        includeInferred: false
      }
    },
    {
      type: "moduleFlow/detail",
      payload: {
        graphVersion: "v1",
        requestId: 2,
        target: {
          kind: "module",
          id: "module-flow-module:0123456789abcdef0123456789abcdef"
        },
        relationLimit: 20,
        evidenceLimit: 5
      }
    },
    {
      type: "moduleFlow/expand",
      payload: {
        graphVersion: "v1",
        requestId: 3,
        moduleId: "module-flow-module:0123456789abcdef0123456789abcdef",
        expansion: "boundaryFunctions",
        direction: "both",
        nodeLimit: 24,
        edgeLimit: 48
      }
    },
    {
      type: "moduleFlow/openSource",
      payload: {
        graphVersion: "v1",
        requestId: 4,
        target: {
          kind: "node",
          sourceToken: "source-node:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
        }
      }
    },
    { type: "function/index", payload: {} },
    {
      type: "function/sectionRows",
      payload: { graphVersion: "v1", sectionId: "hotspots", limit: 25 }
    },
    {
      type: "function/expand",
      payload: { graphVersion: "v1", sectionId: "selected", rowId: "row:1" }
    },
    { type: "function/search", payload: { graphVersion: "v1", requestId: 1, query: "handler", limit: 10 } },
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
