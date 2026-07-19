/**
 * Generated-browser tests for the Code Flow Reader. The fake DOM validates the
 * real inline program without requiring a VS Code integration-test process.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { getExplorerHtml } from "../../webview/webviewHtml";
import { installSidebarWebviewRuntime } from "./helpers/sidebarWebviewRuntime";

const graphVersion = "sidebar-snapshot:webview:1";
const flowId = "code-flow:0123456789abcdef0123456789abcdef";
const routeToken = "source-node:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const functionToken = "source-node:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
const evidenceToken = "code-evidence:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

test("entrypoint selection renders evidence and opens only its source token", () => {
  const runtime = installSidebarWebviewRuntime();

  try {
    new Function(requireSidebarScript())();
    assert.deepEqual(runtime.messages.map((message) => message.type), ["ui/ready"]);

    runtime.dispatchMessage(createGraphMessage(graphVersion));
    runtime.dispatchMessage(createCatalogMessage(graphVersion, 0, "", "GET /orders"));
    assert.ok(runtime.getRenderedText("flow-results").includes("GET /orders"));

    runtime.clickByTitle("Trace GET /orders");
    assert.deepEqual(latestPayload(runtime.messages, "codeFlow/select"), {
      graphVersion,
      flowId
    });
    assert.equal(runtime.isHidden("flow-reader"), false);

    runtime.dispatchMessage(createDetailMessage(graphVersion));
    const renderedSteps = runtime.getRenderedText("flow-steps");
    assert.ok(renderedSteps.includes("GET /orders"));
    assert.ok(renderedSteps.includes("OrdersService.place"));
    assert.ok(renderedSteps.includes("Static calls edge · resolved · definition resolved"));

    runtime.clickByTitle("src/routes.ts:8");
    assert.deepEqual(latestPayload(runtime.messages, "node/openSource"), { nodeId: routeToken });
    runtime.clickByTitle("Inspect logic · OrdersService.place");
    assert.deepEqual(latestPayload(runtime.messages, "codeFlow/selectSource"), {
      graphVersion,
      sourceToken: functionToken
    });
  } finally {
    runtime.restore();
  }
});

test("catalog correlation rejects an older response for the same graph", () => {
  const runtime = installSidebarWebviewRuntime();

  try {
    new Function(requireSidebarScript())();
    runtime.dispatchMessage(createGraphMessage(graphVersion));
    runtime.dispatchMessage(createCatalogMessage(graphVersion, 0, "", "Initial route"));
    runtime.setValue("flow-search-input", "orders");
    runtime.submit("flow-search-form");

    assert.deepEqual(latestPayload(runtime.messages, "codeFlow/catalog"), {
      graphVersion,
      requestId: 1,
      query: "orders",
      limit: 24
    });
    runtime.dispatchMessage(createCatalogMessage(graphVersion, 0, "", "Stale route"));
    assert.ok(!runtime.getRenderedText("flow-results").includes("Stale route"));

    runtime.dispatchMessage(createCatalogMessage(graphVersion, 1, "orders", "Current route"));
    assert.ok(runtime.getRenderedText("flow-results").includes("Current route"));
    assert.ok(!runtime.getRenderedText("flow-results").includes("Initial route"));
  } finally {
    runtime.restore();
  }
});

test("function mode searches concrete definitions and requests tokenized context", () => {
  const runtime = installSidebarWebviewRuntime();

  try {
    new Function(requireSidebarScript())();
    runtime.dispatchMessage(createGraphMessage(graphVersion));
    runtime.dispatchMessage(createCatalogMessage(graphVersion, 0, "", "GET /orders"));
    runtime.click("mode-functions");

    assert.deepEqual(latestPayload(runtime.messages, "function/search"), {
      graphVersion,
      requestId: 1,
      query: "",
      limit: 30,
      cursor: undefined,
      filters: { includeExternal: false, includeUnresolved: false }
    });
    runtime.dispatchMessage({
      type: "function/searchLoaded",
      payload: {
        graphVersion,
        requestId: 1,
        query: "",
        rows: [{
          id: "function-row:1",
          sectionId: "allFunctions",
          kind: "function",
          label: "OrdersService.place",
          depth: 0,
          hasChildren: false,
          expanded: false,
          sourceToken: functionToken,
          functionKind: "method",
          confidence: "resolved",
          detail: "src/application/ordersService.ts:14"
        }],
        totalMatchCount: 1
      }
    });

    runtime.clickByTitle("Trace OrdersService.place");
    assert.deepEqual(latestPayload(runtime.messages, "codeFlow/selectSource"), {
      graphVersion,
      sourceToken: functionToken
    });
  } finally {
    runtime.restore();
  }
});

test("function detail renders internal branches and opens exact statement evidence", () => {
  const runtime = installSidebarWebviewRuntime();

  try {
    new Function(requireSidebarScript())();
    runtime.dispatchMessage(createGraphMessage(graphVersion));
    runtime.dispatchMessage(createFunctionLogicDetailMessage(graphVersion));

    const rendered = runtime.getRenderedText("flow-steps");
    assert.ok(rendered.includes("function place(order: Order)"));
    assert.ok(rendered.includes("if order.valid"));
    assert.ok(rendered.includes("true → repository.save(order);"));
    runtime.clickByTitle("Zoom out function graph");
    runtime.clickByTitle("Reset function graph zoom");
    runtime.clickByTitle("Zoom in function graph");
    assert.ok(runtime.getRenderedText("flow-steps").includes("Control paths"));
    runtime.clickByTitle("Select logic · repository.save(order);");
    assert.ok(runtime.getRenderedText("flow-steps").includes("return → END"));
    assert.ok(runtime.getRenderedText("flow-reader-kicker").includes("FUNCTION LOGIC · POSSIBLE CONTROL PATHS"));
    assert.ok(runtime.getRenderedText("flow-semantics-note").some((text) => text.includes("current source syntax")));

    runtime.clickByTitle("Open statement · src/application/ordersService.ts:15");
    assert.deepEqual(latestPayload(runtime.messages, "codeFlow/openEvidence"), {
      graphVersion,
      evidenceToken
    });
  } finally {
    runtime.restore();
  }
});

test("a new graph removes old flow DOM and rejects late detail", () => {
  const runtime = installSidebarWebviewRuntime();

  try {
    new Function(requireSidebarScript())();
    runtime.dispatchMessage(createGraphMessage(graphVersion));
    runtime.dispatchMessage(createCatalogMessage(graphVersion, 0, "", "GET /orders"));
    runtime.clickByTitle("Trace GET /orders");
    runtime.dispatchMessage(createDetailMessage(graphVersion));
    assert.ok(runtime.getRenderedText("flow-steps").includes("OrdersService.place"));

    const nextVersion = "sidebar-snapshot:webview:2";
    runtime.dispatchMessage(createGraphMessage(nextVersion));
    runtime.dispatchMessage(createDetailMessage(graphVersion));
    assert.equal(runtime.isHidden("flow-reader"), true);
    assert.deepEqual(runtime.getRenderedText("flow-steps"), []);
  } finally {
    runtime.restore();
  }
});

/** Extracts the exact generated sidebar program. */
function requireSidebarScript(): string {
  const html = getExplorerHtml({
    webview: { cspSource: "vscode-webview:" } as never,
    extensionUri: {} as never,
    nonce: "browser-test-nonce",
    defaultDepth: 2,
    maxRenderedNodes: 50,
    initialMode: "file",
    surface: "sidebar"
  });
  const match = html.match(/<script nonce="browser-test-nonce">([\s\S]*)<\/script>/u);
  assert.ok(match);
  return match[1];
}

/** Creates the bounded graph shell sent before the catalog. */
function createGraphMessage(version: string): unknown {
  return {
    type: "graph/loaded",
    payload: {
      workspaceRoot: "",
      version,
      generatedAt: "2026-07-19T00:00:00.000Z",
      nodes: [],
      edges: [],
      diagnostics: [],
      metadata: { languages: ["typescript"], fileCount: 4, symbolCount: 8, edgeCount: 6 }
    }
  };
}

/** Creates one correlated entrypoint result page. */
function createCatalogMessage(
  version: string,
  requestId: number,
  query: string,
  name: string
): unknown {
  return {
    type: "codeFlow/catalogLoaded",
    payload: {
      graphVersion: version,
      requestId,
      query,
      items: [{
        id: flowId,
        kind: "httpRoute",
        name,
        framework: "Express",
        detail: "HTTP · handler mapped",
        confidence: "resolved",
        mapped: true,
        gapCount: 0
      }],
      totalMatchCount: 1,
      omittedMatchCount: 0,
      summary: { entrypointCount: 1, routeCount: 1, operationCount: 0, mappedCount: 1, gapCount: 0 }
    }
  };
}

/** Creates a small source-backed static flow for renderer assertions. */
function createDetailMessage(version: string): unknown {
  return {
    type: "codeFlow/detailLoaded",
    payload: {
      graphVersion: version,
      id: flowId,
      kind: "entrypoint",
      title: "GET /orders",
      subtitle: "Express · HTTP entrypoint · static path",
      semantics: "static",
      focusStepId: "step:boundary",
      steps: [
        {
          id: "step:boundary",
          stage: "boundary",
          label: "GET /orders",
          detail: "Entrypoint · src/routes.ts:8",
          depth: 0,
          relation: "starts",
          confidence: "resolved",
          resolution: "concrete",
          sourceToken: routeToken,
          sourceLocation: "src/routes.ts:8",
          evidenceLabel: "Framework entrypoint evidence"
        },
        {
          id: "step:decision",
          parentId: "step:boundary",
          stage: "decision",
          label: "OrdersService.place",
          detail: "Application · src/application/ordersService.ts:14",
          depth: 1,
          relation: "calls",
          confidence: "resolved",
          resolution: "concrete",
          sourceToken: functionToken,
          sourceLocation: "src/application/ordersService.ts:14",
          evidenceLabel: "Static calls edge · resolved · definition resolved"
        }
      ],
      origins: [],
      gaps: [],
      summary: {
        stepCount: 2,
        concreteStepCount: 2,
        decisionStepCount: 1,
        effectStepCount: 0,
        unknownStepCount: 0,
        gapCount: 0
      }
    }
  };
}

/** Creates syntax-backed blocks and transfers for the Function Logic renderer. */
function createFunctionLogicDetailMessage(version: string): unknown {
  const conditionId = "function-logic-block:11111111111111111111111111111111";
  const effectId = "function-logic-block:22222222222222222222222222222222";
  const exitId = "function-logic-block:33333333333333333333333333333333";
  return {
    type: "codeFlow/detailLoaded",
    payload: {
      graphVersion: version,
      id: flowId,
      kind: "functionLogic",
      title: "OrdersService.place",
      subtitle: "Function logic · src/application/ordersService.ts:14",
      semantics: "static",
      focusStepId: conditionId,
      steps: [],
      logic: {
        language: "typescript",
        signature: "function place(order: Order)",
        blocks: [
          {
            id: conditionId,
            kind: "condition",
            label: "if order.valid",
            detail: "Chooses the true or false branch from this condition.",
            depth: 1,
            confidence: "exact",
            sourceLocation: "src/application/ordersService.ts:14",
            evidenceToken
          },
          {
            id: effectId,
            kind: "effect",
            label: "repository.save(order);",
            detail: "Possible state or external effect.",
            depth: 2,
            branchLabel: "true",
            confidence: "inferred",
            sourceLocation: "src/application/ordersService.ts:15",
            evidenceToken
          },
          {
            id: exitId,
            kind: "exit",
            label: "Exit place",
            detail: "All paths finish here.",
            depth: 0,
            confidence: "exact",
            sourceLocation: "src/application/ordersService.ts:18",
            evidenceToken
          }
        ],
        edges: [
          {
            id: "function-logic-edge:11111111111111111111111111111111",
            sourceId: conditionId,
            targetId: effectId,
            kind: "true",
            label: "true",
            confidence: "exact"
          },
          {
            id: "function-logic-edge:22222222222222222222222222222222",
            sourceId: effectId,
            targetId: exitId,
            kind: "return",
            label: "return",
            confidence: "exact"
          }
        ],
        layout: {
          width: 300,
          height: 360,
          nodes: [
            { blockId: conditionId, x: 58, y: 20, width: 184, height: 72, rank: 0, lane: 0 },
            { blockId: effectId, x: 58, y: 144, width: 184, height: 72, rank: 1, lane: 0 },
            { blockId: exitId, x: 58, y: 268, width: 184, height: 72, rank: 2, lane: 0 }
          ],
          edges: [
            {
              edgeId: "function-logic-edge:11111111111111111111111111111111",
              points: [{ x: 150, y: 92 }, { x: 150, y: 144 }],
              labelX: 155,
              labelY: 118,
              route: "forward"
            },
            {
              edgeId: "function-logic-edge:22222222222222222222222222222222",
              points: [{ x: 150, y: 216 }, { x: 150, y: 268 }],
              labelX: 155,
              labelY: 242,
              route: "forward"
            }
          ]
        },
        summary: {
          blockCount: 3,
          branchCount: 1,
          loopCount: 0,
          callCount: 1,
          effectCount: 1,
          mutationCount: 0,
          exitCount: 1
        }
      },
      origins: [],
      gaps: [],
      summary: {
        stepCount: 3,
        concreteStepCount: 3,
        decisionStepCount: 1,
        effectStepCount: 1,
        unknownStepCount: 0,
        gapCount: 0
      }
    }
  };
}

/** Returns the most recent payload for one emitted request discriminator. */
function latestPayload(
  messages: Array<{ type: string; payload: unknown }>,
  type: string
): unknown {
  const message = [...messages].reverse().find((candidate) => candidate.type === type);
  assert.ok(message, `missing ${type} request`);
  return message.payload;
}
