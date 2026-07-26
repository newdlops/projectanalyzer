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

test("starting-point controls expose their selected mode as pressed buttons", () => {
  const runtime = installSidebarWebviewRuntime();

  try {
    new Function(requireSidebarScript())();
    assert.equal(runtime.getAttribute("mode-entrypoints", "aria-pressed"), "true");
    assert.equal(runtime.getAttribute("mode-functions", "aria-pressed"), "false");

    runtime.click("mode-functions");

    assert.equal(runtime.getAttribute("mode-entrypoints", "aria-pressed"), "false");
    assert.equal(runtime.getAttribute("mode-functions", "aria-pressed"), "true");
  } finally {
    runtime.restore();
  }
});

test("function detail renders internal branches and opens exact statement evidence explicitly", () => {
  const runtime = installSidebarWebviewRuntime();

  try {
    new Function(requireSidebarScript())();
    runtime.dispatchMessage(createGraphMessage(graphVersion));
    runtime.dispatchMessage(createFunctionLogicDetailMessage(graphVersion));

    const rendered = runtime.getRenderedText("flow-steps");
    assert.equal(runtime.countRenderedByClass("flow-steps", "logic-depth-0"), 1);
    assert.equal(runtime.countRenderedByClass("flow-steps", "logic-depth-1"), 1);
    assert.equal(runtime.countRenderedByClass("flow-steps", "logic-depth-2"), 1);
    assert.ok(rendered.includes("function place(order: Order)"));
    assert.ok(rendered.includes("if order.valid"));
    assert.ok(rendered.includes("Condition cases"));
    assert.ok(rendered.includes("order.valid"));
    assert.ok(rendered.includes("Choose true → repository.save(order);"));
    assert.ok(rendered.includes("Choose false → END"));
    runtime.clickByTitle("Choose path · true → repository.save(order);");
    assert.ok(runtime.getRenderedText("flow-steps").includes(
      "1 branch choice selected · reachable continuation highlighted"
    ));
    assert.ok(runtime.getRenderedText("flow-steps").includes(
      "Selected true → repository.save(order);"
    ));
    runtime.clickByTitle("Clear all selected branch choices");
    assert.ok(runtime.getRenderedText("flow-steps").includes(
      "Choose true → repository.save(order);"
    ));
    runtime.clickByTitle("Apply condition case · order.valid");
    assert.ok(runtime.getRenderedText("flow-steps").includes(
      "1 branch choice selected · reachable continuation highlighted"
    ));
    runtime.clickByTitle("Clear condition case · order.valid");
    assert.ok(runtime.getRenderedText("flow-steps").includes(
      "Choose true → repository.save(order);"
    ));
    runtime.clickByTitle("Choose path · false → END");
    assert.ok(runtime.getRenderedText("flow-steps").includes("Selected false → END"));
    runtime.clickByTitle("Clear all selected branch choices");
    runtime.clickByTitle("Zoom out function graph");
    runtime.clickByTitle("Reset function graph zoom to 100%; current zoom 80%");
    runtime.clickByTitle("Zoom in function graph");
    assert.ok(runtime.getRenderedText("flow-steps").includes("Control paths"));
    const messagesBeforeSelection = runtime.messages.length;
    runtime.clickByTitle("Select logic · repository.save(order);");
    assert.equal(runtime.messages.length, messagesBeforeSelection);
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

test("function graph nodes render complete wrapped labels and value changes", () => {
  const runtime = installSidebarWebviewRuntime();

  try {
    new Function(requireSidebarScript())();
    const message = createFunctionLogicDetailMessage(graphVersion) as {
      payload: {
        logic: {
          blocks: Array<Record<string, unknown>>;
        };
      };
    };
    const completeLabel = `${"order.snapshot = deriveCompleteValue(input, context) + ".repeat(9)}render_label_tail;`;
    const completeValue = `${"fallbackValue + ".repeat(18)}render_value_tail`;
    const block = message.payload.logic.blocks[1];
    assert.ok(block);
    block.label = completeLabel;
    block.depth = 99;
    block.valueChanges = [{
      target: "order.snapshot.with.complete.path",
      targetKind: "property",
      operation: "assign",
      operator: "=",
      value: completeValue,
      confidence: "exact"
    }];

    runtime.dispatchMessage(createGraphMessage(graphVersion));
    runtime.dispatchMessage(message);
    const rendered = runtime.getRenderedText("flow-steps").join("");

    assert.equal(runtime.countRenderedByClass("flow-steps", "logic-depth-5"), 1);
    assert.ok(rendered.includes(completeLabel));
    assert.ok(rendered.includes("order.snapshot.with.complete.path"));
    assert.ok(rendered.includes(completeValue));
  } finally {
    runtime.restore();
  }
});

test("Function Guide explains codebase context through an accessible disclosure control", () => {
  const runtime = installSidebarWebviewRuntime();
  try {
    new Function(requireSidebarScript())();
    const message = createFunctionLogicDetailMessage(graphVersion) as { payload: { logic: Record<string, unknown> } };
    message.payload.logic.tutor = createTutorFixture();
    runtime.dispatchMessage(createGraphMessage(graphVersion));
    runtime.dispatchMessage(message);
    runtime.clickByTitle("Open a source-backed guide to this function and its codebase context");
    const rendered = runtime.getRenderedText("flow-steps").join("\n");
    assert.ok(rendered.includes("Understand This Function"));
    assert.ok(rendered.includes("Where Does It Fit?"));
    assert.ok(rendered.includes("Static Input Cases"));
    assert.equal(runtime.getRenderedAttributeByTitle("flow-steps", "Open a source-backed guide to this function and its codebase context", "aria-expanded"), "true");
    assert.equal(runtime.getRenderedAttributeByClass("flow-steps", "logic-inspector-toggle", "aria-expanded"), "false");
    runtime.clickByTitle("Open a source-backed guide to this function and its codebase context");
    assert.equal(runtime.getRenderedAttributeByClass("flow-steps", "logic-inspector-drawer", "aria-hidden"), "true");
    assert.equal(runtime.getRenderedAttributeByTitle("flow-steps", "Open a source-backed guide to this function and its codebase context", "aria-expanded"), "false");
    runtime.dispatchRenderedEventByClass("flow-steps", "logic-inspector-toggle", "click");
    assert.equal(runtime.getRenderedAttributeByClass("flow-steps", "logic-inspector-drawer", "aria-hidden"), "false");
    assert.equal(runtime.getRenderedAttributeByClass("flow-steps", "logic-inspector-toggle", "aria-expanded"), "true");
  } finally {
    runtime.restore();
  }
});

test("function graph traces parameter, local, and constant definition-use flow", () => {
  const runtime = installSidebarWebviewRuntime();

  try {
    new Function(requireSidebarScript())();
    const message = createFunctionLogicDetailMessage(graphVersion) as {
      payload: {
        logic: {
          blocks: Array<Record<string, unknown>>;
          valueBindings?: Array<Record<string, unknown>>;
          valueFlows?: Array<Record<string, unknown>>;
        };
      };
    };
    const source = message.payload.logic.blocks[0];
    const target = message.payload.logic.blocks[1];
    assert.ok(source && target);
    const sourceId = String(source.id);
    const targetId = String(target.id);
    const bindingId = "function-logic-binding:11111111111111111111111111111111";
    source.valueAccesses = [{
      bindingId,
      name: "order",
      bindingKind: "parameter",
      access: "define",
      confidence: "exact"
    }];
    target.valueAccesses = [{
      bindingId,
      name: "order",
      bindingKind: "parameter",
      access: "read",
      usage: "consume",
      confidence: "exact"
    }];
    message.payload.logic.valueBindings = [{
      id: bindingId,
      name: "order",
      kind: "parameter",
      definitionBlockId: sourceId,
      confidence: "exact"
    }];
    message.payload.logic.valueFlows = [{
      id: "function-logic-value-flow:11111111111111111111111111111111",
      bindingId,
      sourceBlockId: sourceId,
      targetBlockId: targetId,
      targetAccess: "read",
      targetUsage: "consume",
      confidence: "exact"
    }];

    runtime.dispatchMessage(createGraphMessage(graphVersion));
    runtime.dispatchMessage(message);
    const rendered = runtime.getRenderedText("flow-steps").join("\n");

    assert.ok(rendered.includes("Values in this function"));
    assert.ok(rendered.includes("PARAM order · 1 access"));
    assert.ok(rendered.includes("PARAM · DEFINE"));
    assert.ok(rendered.includes("PARAM · CONSUME"));
    assert.ok(rendered.includes("○ CONSUME"));
    assert.ok(rendered.includes("◎ SINK"));
    assert.equal(runtime.countRenderedByClass("flow-steps", "logic-data-flow-edge"), 1);
    assert.equal(runtime.countRenderedByClass("flow-steps", "logic-value-access"), 3);
    assert.equal(runtime.countRenderedByClass("flow-steps", "logic-scenario-trace"), 1);
    runtime.clickByTitle("Trace parameter order");
    runtime.clickByTitle("Trace parameter order");
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
            evidenceToken,
            conditionTable: {
              expression: "order.valid",
              columns: [{ blockId: conditionId, expression: "order.valid" }],
              rows: [
                {
                  id: "function-logic-condition-case:11111111111111111111111111111111",
                  values: ["true"],
                  result: "true",
                  choiceEdgeIds: ["function-logic-edge:11111111111111111111111111111111"],
                  targetBlockId: effectId,
                  targetLabel: "repository.save(order);"
                },
                {
                  id: "function-logic-condition-case:22222222222222222222222222222222",
                  values: ["false"],
                  result: "false",
                  choiceEdgeIds: ["function-logic-edge:44444444444444444444444444444444"],
                  targetBlockId: exitId,
                  targetLabel: "Exit place"
                }
              ],
              omittedCaseCount: 0
            }
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
          },
          {
            id: "function-logic-edge:44444444444444444444444444444444",
            sourceId: conditionId,
            targetId: exitId,
            kind: "false",
            label: "false",
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
            },
            {
              edgeId: "function-logic-edge:44444444444444444444444444444444",
              points: [
                { x: 242, y: 56 },
                { x: 270, y: 56 },
                { x: 270, y: 304 },
                { x: 242, y: 304 }
              ],
              labelX: 265,
              labelY: 180,
              route: "long"
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
          valueChangeCount: 0,
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

/** Supplies opaque-only Tutor data for the generated Webview integration test. */
function createTutorFixture(): Record<string, unknown> {
  const conditionId = "function-logic-block:11111111111111111111111111111111";
  const effectId = "function-logic-block:22222222222222222222222222222222";
  const exitId = "function-logic-block:33333333333333333333333333333333";
  const amountId = "function-tutor-parameter:11111111111111111111111111111111";
  const amountBinding = "function-logic-binding:11111111111111111111111111111111";
  return {
    version: 2, fingerprint: "tutor-fingerprint", functionId: flowId, executionKind: "sync", availability: "ready",
    context: {
      documentation: { kind: "jsdoc", summary: "Calculates a bounded amount.", tags: [], truncated: false, evidenceTokens: [] },
      owners: [], architecture: { layer: "application", confidence: "medium", businessLogic: "applicationWorkflowCandidate", conflicted: false, alternatives: [], evidence: [] },
      entrypoints: [], callers: [], callees: [], counts: { totalEntrypointCount: 0, omittedEntrypointCount: 0, totalCallerCount: 0, omittedCallerCount: 0, totalLocalCalleeCount: 0, totalExternalCalleeCount: 0, totalUnresolvedCalleeCount: 0, omittedCalleeCount: 0 }
    },
    guide: {
      initialChapterId: "function-tutor-chapter:place", summary: { readyChapterCount: 5, partialChapterCount: 0, unavailableChapterCount: 0 },
      chapters: [
        { id: "function-tutor-chapter:place", ordinal: 1, kind: "place", question: "Where Does It Fit?", status: "ready", answer: { text: "The current graph provides source-backed placement facts.", counts: { factCount: 1 } }, facts: [{ id: "function-tutor-fact:place", kind: "documentation", label: "Source documentation", detail: "Calculates a bounded amount.", certainty: "exact", blockIds: [], edgeIds: [], evidenceTokens: [] }], preferredLens: "calls", attentionBlockIds: [], attentionEdgeIds: [], gapIds: [] },
        { id: "function-tutor-chapter:inputs", ordinal: 2, kind: "inputs", question: "What Comes In?", status: "ready", answer: { text: "One input is declared.", counts: { factCount: 1 } }, facts: [], preferredLens: "values", primaryBlockId: conditionId, attentionBlockIds: [conditionId], attentionEdgeIds: [], gapIds: [] },
        { id: "function-tutor-chapter:decisions", ordinal: 3, kind: "decisions", question: "What Changes the Path?", status: "ready", answer: { text: "One decision is visible.", counts: { factCount: 1 } }, facts: [], preferredLens: "flow", primaryBlockId: conditionId, attentionBlockIds: [conditionId], attentionEdgeIds: [], gapIds: [] },
        { id: "function-tutor-chapter:work", ordinal: 4, kind: "work", question: "What Does It Change or Call?", status: "ready", answer: { text: "One value change is visible.", counts: { factCount: 1 } }, facts: [], preferredLens: "values", primaryBlockId: effectId, attentionBlockIds: [effectId], attentionEdgeIds: [], gapIds: [] },
        { id: "function-tutor-chapter:outcomes", ordinal: 5, kind: "outcomes", question: "How Can It Finish?", status: "ready", answer: { text: "One return is visible.", counts: { factCount: 1 } }, facts: [], preferredLens: "effects", primaryBlockId: effectId, attentionBlockIds: [effectId], attentionEdgeIds: [], gapIds: [] }
      ]
    },
    parameters: [{ id: amountId, bindingId: amountBinding, name: "amount", index: 0, typeKind: "number", optional: false, rest: false }],
    seeds: [{ id: "function-tutor-seed:11111111111111111111111111111111", ordinal: 1, title: "Default amount", source: "default", certainty: "exact", inputs: [{ parameterId: amountId, value: { kind: "number", value: 10 }, omitted: false, certainty: "exact", evidenceTokens: [] }], objectiveIds: [], evidenceTokens: [], gapIds: [] }],
    program: {
      entryBlockId: conditionId,
      blocks: [{ blockId: conditionId, kind: "condition", label: "if amount", operations: [], decision: { expression: { kind: "literal", value: { kind: "boolean", value: true } }, outcomes: [{ edgeId: "function-logic-edge:11111111111111111111111111111111", label: "true", matches: "true" }] } }, { blockId: effectId, kind: "effect", label: "add", operations: [{ kind: "define", bindingId: "function-logic-binding:22222222222222222222222222222222", value: { kind: "binary", operator: "add", left: { kind: "binding", bindingId: amountBinding }, right: { kind: "literal", value: { kind: "number", value: 5 } } } }], terminal: { kind: "return", value: { kind: "binding", bindingId: "function-logic-binding:22222222222222222222222222222222" } } }, { blockId: exitId, kind: "exit", label: "exit", operations: [] }],
      edges: [{ edgeId: "function-logic-edge:11111111111111111111111111111111", sourceBlockId: conditionId, targetBlockId: effectId, kind: "true", certainty: "exact" }],
      bindings: [{ bindingId: amountBinding, parameterId: amountId, name: "amount", kind: "parameter", certainty: "exact" }, { bindingId: "function-logic-binding:22222222222222222222222222222222", name: "total", kind: "local", certainty: "exact" }]
    },
    evidence: [], gaps: [], summary: { inferredScenarioCount: 1, exactCallsiteTupleCount: 0, plannedCoverageCount: 0, totalObjectiveCount: 0, limited: false }
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
