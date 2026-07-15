/**
 * Generated-Webview tests for the Guide-first POC. They exercise the real
 * injected browser state machine so source visits cannot advance on clicks or
 * stale Host acknowledgments.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { getExplorerHtml } from "../../webview/webviewHtml";
import { installSidebarWebviewRuntime } from "./helpers/sidebarWebviewRuntime";

test("sidebar exposes accessible Guide and Explore tabpanels with Guide selected", () => {
  const html = getSidebarHtml();
  const script = getSidebarScript(html);

  assert.match(html, /role="tablist" aria-label="Project learning surface"/u);
  assert.match(html, /id="surface-guide-tab"[\s\S]*role="tab"[\s\S]*aria-selected="true"/u);
  assert.match(html, /id="surface-explore-tab"[\s\S]*aria-selected="false"/u);
  assert.match(html, /id="guided-tour-surface"[\s\S]*role="tabpanel"/u);
  assert.match(html, /id="explore-surface"[\s\S]*role="tabpanel"[\s\S]*hidden/u);
  assert.match(html, /id="explore-surface"[\s\S]*id="project-guide"/u);
  assert.match(html, /id="explore-surface"[\s\S]*class="accordion"/u);
  assert.match(script, /project\/guidedTourOpenSource/u);
  assert.match(script, /project\/guidedTourSourceOpened/u);
  assert.match(script, /project\/guidedTourSourceOpenFailed/u);
  assert.doesNotThrow(() => new Function("acquireVsCodeApi", script));
});

test("Guide renders one current stop and Explore preserves the Reading Plan", () => {
  const runtime = installSidebarWebviewRuntime();

  try {
    new Function(getSidebarScript())();
    assert.equal(runtime.isHidden("guided-tour-surface"), false);
    assert.equal(runtime.isHidden("explore-surface"), true);
    assert.equal(runtime.getAttribute("surface-guide-tab", "aria-selected"), "true");
    assert.equal(runtime.getAttribute("surface-explore-tab", "aria-selected"), "false");

    runtime.dispatchMessage(createGraphLoaded("guide-v1"));
    runtime.dispatchMessage(createReadingGuideLoaded("guide-v1"));
    runtime.dispatchMessage(createGuidedTourLoaded("guide-v1"));

    const guideText = runtime.getRenderedText("guided-tour-content");
    assert.ok(guideText.includes("Trace POST /orders to its effect boundary"));
    assert.ok(guideText.includes("OrdersController.create"));
    assert.ok(!guideText.includes("PlaceOrderService.execute"));
    assert.equal(countMessages(runtime.messages, "project/readingGuideScope"), 0);

    runtime.click("surface-explore-tab");
    assert.equal(runtime.isHidden("guided-tour-surface"), true);
    assert.equal(runtime.isHidden("explore-surface"), false);
    runtime.clickByTitle("Inspect apps/api");
    assert.deepEqual(runtime.messages.at(-1), {
      type: "project/readingGuideScope",
      payload: { graphVersion: "guide-v1", scopeId: "reading-scope:api" }
    });

    runtime.keydown("surface-explore-tab", "ArrowLeft");
    assert.equal(runtime.isHidden("guided-tour-surface"), false);
    assert.equal(runtime.isHidden("explore-surface"), true);
    assert.equal(runtime.getAttribute("surface-guide-tab", "aria-selected"), "true");
  } finally {
    runtime.restore();
  }
});

test("current stop advances only after the matching source-open acknowledgment", () => {
  const runtime = installSidebarWebviewRuntime();

  try {
    new Function(getSidebarScript())();
    runtime.dispatchMessage(createGraphLoaded("guide-ack"));
    runtime.dispatchMessage(createGuidedTourLoaded("guide-ack"));

    runtime.clickByTitle("Open current stop: OrdersController.create");
    const focusedAfterOpen = runtime.getFocusedElementId();
    assert.ok(focusedAfterOpen);
    assert.equal(runtime.getAttribute(focusedAfterOpen, "aria-current"), "step");
    const firstRequest = latestMessage(runtime.messages, "project/guidedTourOpenSource");
    assert.deepEqual(firstRequest, {
      type: "project/guidedTourOpenSource",
      payload: {
        graphVersion: "guide-ack",
        missionId: "guided-mission:orders",
        stopId: "guided-stop:handler",
        sourceToken: SOURCE_TOKEN_A,
        requestId: 1
      }
    });
    assert.ok(runtime.getRenderedText("guided-tour-content").includes("Opening source..."));
    assert.ok(!runtime.getRenderedText("guided-tour-content").includes("Next stop"));

    runtime.dispatchMessage(createSourceOpened("guide-ack", "guided-stop:handler", SOURCE_TOKEN_A, 99));
    assert.ok(!runtime.getRenderedText("guided-tour-content").includes("Next stop"));

    runtime.dispatchMessage(createSourceFailed(
      "guide-ack",
      "guided-stop:handler",
      SOURCE_TOKEN_A,
      1,
      "Editor refused the source"
    ));
    assert.ok(runtime.getRenderedText("guided-tour-content").includes("Retry source"));
    assert.ok(runtime.getRenderedText("guided-tour-content").includes("Editor refused the source"));

    runtime.clickByTitle("Retry current stop: OrdersController.create");
    const retryRequest = latestMessage(runtime.messages, "project/guidedTourOpenSource");
    assert.equal((retryRequest?.payload as { requestId?: number } | undefined)?.requestId, 2);

    runtime.dispatchMessage(createSourceOpened("guide-ack", "guided-stop:handler", SOURCE_TOKEN_A, 1));
    assert.ok(!runtime.getRenderedText("guided-tour-content").includes("Next stop"));
    runtime.dispatchMessage(createSourceOpened("guide-ack", "guided-stop:handler", SOURCE_TOKEN_A, 2));
    assert.ok(runtime.getRenderedText("guided-tour-content").includes("Next stop"));
    assert.ok(runtime.getRenderedText("guided-tour-content").includes(
      "Name the application collaborator that receives control."
    ));

    runtime.clickByTitle("Move to the next stop");
    const secondStopText = runtime.getRenderedText("guided-tour-content");
    assert.ok(secondStopText.includes("PlaceOrderService.execute"));
    assert.ok(!secondStopText.includes("OrdersController.create"));
    assert.ok(secondStopText.includes("Back"));
    assert.ok(!secondStopText.includes("Exposed source stops visited"));

    runtime.clickByTitle("Open current stop: PlaceOrderService.execute");
    runtime.dispatchMessage(createSourceOpened(
      "guide-ack",
      "guided-stop:decision",
      SOURCE_TOKEN_B,
      3
    ));
    const finalText = runtime.getRenderedText("guided-tour-content");
    assert.ok(finalText.includes("Exposed source stops visited · explain them back in your own words"));
    assert.ok(finalText.includes("Explain the exposed path without claiming runtime completeness."));
    assert.ok(finalText.some((value) => value.includes(
      "they do not measure comprehension or readiness."
    )));
    assert.ok(!finalText.some((value) => /completed|mastered/iu.test(value)));
  } finally {
    runtime.restore();
  }
});

test("new graph resets the Guide and ignores old mission payloads", () => {
  const runtime = installSidebarWebviewRuntime();

  try {
    new Function(getSidebarScript())();
    runtime.dispatchMessage(createGraphLoaded("guide-old"));
    runtime.dispatchMessage(createGuidedTourLoaded("guide-old"));
    runtime.click("surface-explore-tab");

    runtime.dispatchMessage(createGraphLoaded("guide-new"));
    assert.equal(runtime.isHidden("guided-tour-surface"), false);
    assert.ok(runtime.getRenderedText("guided-tour-content").includes(
      "Building one source-backed learning mission..."
    ));

    runtime.dispatchMessage(createGuidedTourLoaded("guide-old"));
    assert.ok(!runtime.getRenderedText("guided-tour-content").includes(
      "Trace POST /orders to its effect boundary"
    ));
  } finally {
    runtime.restore();
  }
});

test("same mission publication preserves the current ACK-backed stop", () => {
  const runtime = installSidebarWebviewRuntime();

  try {
    new Function(getSidebarScript())();
    runtime.dispatchMessage(createGraphLoaded("guide-repeat"));
    const loaded = createGuidedTourLoaded("guide-repeat");
    runtime.dispatchMessage(loaded);
    runtime.clickByTitle("Open current stop: OrdersController.create");
    runtime.dispatchMessage(createSourceOpened(
      "guide-repeat",
      "guided-stop:handler",
      SOURCE_TOKEN_A,
      1
    ));
    runtime.clickByTitle("Move to the next stop");

    runtime.dispatchMessage(loaded);

    const text = runtime.getRenderedText("guided-tour-content");
    assert.ok(text.includes("PlaceOrderService.execute"));
    assert.ok(!text.includes("OrdersController.create"));
  } finally {
    runtime.restore();
  }
});

test("analysis running state describes mission discovery instead of asking to analyze", () => {
  const runtime = installSidebarWebviewRuntime();

  try {
    new Function(getSidebarScript())();
    runtime.dispatchMessage({
      type: "analysis/status",
      payload: { state: "running", message: "Analyzing workspace" }
    });

    const text = runtime.getRenderedText("guided-tour-content");
    assert.ok(text.includes("Finding one source-backed learning mission..."));
    assert.ok(!text.includes("Analyze a workspace to start a project-specific guide."));
  } finally {
    runtime.restore();
  }
});

test("unavailable Guide offers one explicit transition to Explore evidence", () => {
  const runtime = installSidebarWebviewRuntime();

  try {
    new Function(getSidebarScript())();
    runtime.dispatchMessage(createGraphLoaded("guide-unavailable"));
    runtime.dispatchMessage({
      type: "project/guidedTourLoaded",
      payload: {
        graphVersion: "guide-unavailable",
        availability: "unavailable",
        unavailable: {
          reason: "handlerNotMapped",
          explanation: "A route was detected, but no concrete handler mapping was available.",
          observedEvidence: ["1 HTTP route", "0 mapped handlers"]
        }
      }
    });

    const unavailableText = runtime.getRenderedText("guided-tour-content");
    assert.ok(unavailableText.includes("No source-backed mission is available"));
    assert.ok(unavailableText.includes("Explore evidence"));
    runtime.clickByTitle("Open Explore evidence");
    assert.equal(runtime.isHidden("guided-tour-surface"), true);
    assert.equal(runtime.isHidden("explore-surface"), false);
  } finally {
    runtime.restore();
  }
});

const SOURCE_TOKEN_A = `source-node:${"a".repeat(64)}`;
const SOURCE_TOKEN_B = `source-node:${"b".repeat(64)}`;

/** Builds one sidebar document for static and executable assertions. */
function getSidebarHtml(): string {
  return getExplorerHtml({
    webview: { cspSource: "vscode-webview:" } as never,
    extensionUri: {} as never,
    nonce: "guided-tour-nonce",
    defaultDepth: 2,
    maxRenderedNodes: 500,
    initialMode: "file",
    surface: "sidebar"
  });
}

function getSidebarScript(html = getSidebarHtml()): string {
  const match = html.match(/<script nonce="guided-tour-nonce">([\s\S]*)<\/script>/u);
  assert.ok(match, "missing generated sidebar script");
  return match[1];
}

function createGraphLoaded(version: string): Record<string, unknown> {
  return {
    type: "graph/loaded",
    payload: {
      workspaceRoot: "/workspace",
      version,
      generatedAt: "2026-07-14T00:00:00.000Z",
      nodes: [],
      edges: [],
      diagnostics: [],
      metadata: {
        languages: ["typescript"],
        frameworks: [],
        frameworkUnits: [],
        frameworkUnitEdges: [],
        fileCount: 4,
        symbolCount: 8,
        edgeCount: 3
      }
    }
  };
}

function createGuidedTourLoaded(graphVersion: string): Record<string, unknown> {
  return {
    type: "project/guidedTourLoaded",
    payload: {
      graphVersion,
      availability: "ready",
      mission: {
        id: "guided-mission:orders",
        scopeLabel: "apps/api",
        title: "Trace POST /orders to its effect boundary",
        trigger: "POST /orders",
        objective: "Follow request control from its handler to the first decision candidate.",
        selectionReasons: ["This mapped path reaches an application workflow candidate."],
        unknowns: ["Runtime importance is not established."],
        stops: [
          createStop(
            "guided-stop:handler",
            0,
            "handler",
            "OrdersController.create",
            "src/orders.controller.ts:12",
            SOURCE_TOKEN_A,
            "interface",
            "notBusinessLogic",
            "Name the application collaborator that receives control."
          ),
          createStop(
            "guided-stop:decision",
            1,
            "decisionCandidate",
            "PlaceOrderService.execute",
            "src/place-order.service.ts:18",
            SOURCE_TOKEN_B,
            "application",
            "applicationWorkflowCandidate",
            "Explain which condition belongs to workflow orchestration."
          )
        ],
        omittedStopCount: 0,
        limitations: [],
        explainBack: [
          "Name the request trigger.",
          "Name the first handler.",
          "Describe the decision candidate and remaining unknowns."
        ],
        exitCriteria: "Explain the exposed path without claiming runtime completeness."
      }
    }
  };
}

function createStop(
  id: string,
  order: number,
  kind: string,
  label: string,
  sourceLocation: string,
  sourceToken: string,
  layer: string,
  businessLogic: string,
  moveOnWhen: string
): Record<string, unknown> {
  return {
    id,
    order,
    kind,
    label,
    sourceLocation,
    sourceToken,
    architecture: {
      layer,
      confidence: "medium",
      businessLogic,
      purity: "unknown",
      evidence: ["Source-backed test evidence"],
      alternatives: [],
      conflicted: false
    },
    whyNow: order === 0
      ? "Start at the concrete framework handler."
      : "The handler delegates control to this collaborator.",
    lookFor: ["Find the next concrete call.", "Separate validation from a decision."],
    question: "What responsibility does this function own?",
    moveOnWhen,
    evidence: ["The callable has a concrete definition."],
    unknowns: ["Static analysis does not prove runtime ownership."]
  };
}

function createReadingGuideLoaded(graphVersion: string): Record<string, unknown> {
  return {
    type: "project/readingGuideLoaded",
    payload: {
      graphVersion,
      headline: "NestJS",
      detail: "4 analyzed files · 1 HTTP entrypoint · 1 scope",
      scopes: [{
        id: "reading-scope:api",
        displayPath: "apps/api",
        basis: "application",
        frameworks: ["NestJS"],
        frameworkCount: 1,
        omittedFrameworkCount: 0,
        analyzedFileCount: 4,
        callableCount: 8,
        execution: {
          entrypointCount: 1,
          mappedCount: 1,
          mappingGapCount: 0,
          httpRouteCount: 1,
          graphqlQueryCount: 0,
          graphqlMutationCount: 0,
          graphqlSubscriptionCount: 0,
          graphqlOtherCount: 0
        }
      }],
      candidateScopeCount: 1,
      omittedScopeCount: 0
    }
  };
}

function createSourceOpened(
  graphVersion: string,
  stopId: string,
  sourceToken: string,
  requestId: number
): Record<string, unknown> {
  return {
    type: "project/guidedTourSourceOpened",
    payload: {
      graphVersion,
      missionId: "guided-mission:orders",
      stopId,
      sourceToken,
      requestId
    }
  };
}

function createSourceFailed(
  graphVersion: string,
  stopId: string,
  sourceToken: string,
  requestId: number,
  message: string
): Record<string, unknown> {
  return {
    type: "project/guidedTourSourceOpenFailed",
    payload: {
      graphVersion,
      missionId: "guided-mission:orders",
      stopId,
      sourceToken,
      requestId,
      message
    }
  };
}

function latestMessage(
  messages: Array<{ type: string; payload: unknown }>,
  type: string
): { type: string; payload: unknown } | undefined {
  return messages.filter((message) => message.type === type).at(-1);
}

function countMessages(messages: Array<{ type: string }>, type: string): number {
  return messages.filter((message) => message.type === type).length;
}
