/**
 * Generated-browser tests for the dedicated Function Visualizer tab. They cover
 * easy-reading cues, lazy child requests, breadcrumbs, cycle reuse, and evidence.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionVisualizerHtml } from "../../webview/functionVisualizer/functionVisualizerHtml";
import { installSidebarWebviewRuntime } from "./helpers/sidebarWebviewRuntime";

const graphVersion = "sidebar-snapshot:function-panel:1";
const rootToken = "source-node:1111111111111111111111111111111111111111111111111111111111111111";
const childToken = "source-node:2222222222222222222222222222222222222222222222222222222222222222";
const evidenceToken = "code-evidence:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

test("drills into a child and reuses history when a call cycle returns to root", () => {
  const runtime = installSidebarWebviewRuntime();

  try {
    new Function(requireFunctionVisualizerScript())();
    assert.deepEqual(runtime.messages.map((message) => message.type), ["ui/ready"]);

    runtime.dispatchMessage(createSessionMessage());
    runtime.dispatchMessage(createFunctionDetail("Root.run", rootToken, {
      sourceToken: childToken,
      name: "load",
      qualifiedName: "Child.load",
      sourceLocation: "src/child.ts:4",
      confidence: "resolved",
      callsiteCount: 1
    }));

    const rootText = runtime.getRenderedText("flow-steps");
    assert.ok(rootText.includes("Understand this function in four passes"));
    assert.ok(rootText.includes("2 branch decisions can change the path."));
    assert.ok(rootText.includes("Go deeper into called functions"));
    assert.ok(rootText.includes("Child.load"));

    runtime.clickByTitle("Open child function · Child.load");
    assert.deepEqual(latestPayload(runtime.messages, "codeFlow/selectSource"), {
      graphVersion,
      sourceToken: childToken
    });
    runtime.dispatchMessage(createFunctionDetail("Child.load", childToken, {
      sourceToken: rootToken,
      name: "run",
      qualifiedName: "Root.run",
      sourceLocation: "src/root.ts:2",
      confidence: "resolved",
      callsiteCount: 1
    }));

    assert.ok(runtime.getRenderedText("function-breadcrumbs").includes("Root.run"));
    assert.ok(runtime.getRenderedText("function-breadcrumbs").includes("Child.load"));
    assert.equal(runtime.isDisabled("function-back"), false);

    const requestCount = runtime.messages.filter((message) =>
      message.type === "codeFlow/selectSource"
    ).length;
    runtime.clickByTitle("Open child function · Root.run");
    assert.equal(runtime.messages.filter((message) =>
      message.type === "codeFlow/selectSource"
    ).length, requestCount);
    assert.ok(runtime.getRenderedText("function-title").includes("Root.run"));

    runtime.clickByTitle("Go back to function · Child.load");
    assert.ok(runtime.getRenderedText("function-title").includes("Child.load"));
  } finally {
    runtime.restore();
  }
});

test("opens only Host-issued statement evidence from the active session", () => {
  const runtime = installSidebarWebviewRuntime();

  try {
    new Function(requireFunctionVisualizerScript())();
    runtime.dispatchMessage(createSessionMessage());
    runtime.dispatchMessage(createFunctionDetail("Root.run", rootToken));

    runtime.clickByTitle("Open statement · src/root.ts:2");
    assert.deepEqual(latestPayload(runtime.messages, "codeFlow/openEvidence"), {
      graphVersion,
      evidenceToken
    });
  } finally {
    runtime.restore();
  }
});

/** Extracts the exact generated panel program from its nonce-protected HTML. */
function requireFunctionVisualizerScript(): string {
  const html = getFunctionVisualizerHtml({
    webview: { cspSource: "vscode-webview:" } as never,
    nonce: "function-visualizer-test-nonce"
  });
  const match = html.match(
    /<script nonce="function-visualizer-test-nonce">([\s\S]*)<\/script>/u
  );
  assert.ok(match);
  return match[1];
}

/** Starts one root navigation session without exposing an analyzer identity. */
function createSessionMessage(): unknown {
  return {
    type: "functionVisualizer/sessionLoaded",
    payload: {
      graphVersion,
      root: { sourceToken: rootToken, label: "Root.run" }
    }
  };
}

/** Creates a one-block Function Logic detail with an optional direct callee. */
function createFunctionDetail(
  title: string,
  _currentToken: string,
  callee?: {
    sourceToken: string;
    name: string;
    qualifiedName: string;
    sourceLocation: string;
    confidence: string;
    callsiteCount: number;
  }
): unknown {
  const blockId = title === "Root.run"
    ? "function-logic-block:11111111111111111111111111111111"
    : "function-logic-block:22222222222222222222222222222222";
  const location = title === "Root.run" ? "src/root.ts:2" : "src/child.ts:4";
  return {
    type: "codeFlow/detailLoaded",
    payload: {
      graphVersion,
      id: "code-flow:0123456789abcdef0123456789abcdef",
      kind: "functionLogic",
      title,
      subtitle: "Function logic · " + location,
      semantics: "static",
      focusStepId: blockId,
      steps: [],
      logic: {
        language: "typescript",
        signature: "function " + title + "()",
        blocks: [{
          id: blockId,
          kind: "call",
          label: callee ? callee.qualifiedName + "();" : "return true;",
          detail: callee ? "Calls a concrete child definition." : "Returns from this function.",
          depth: 0,
          confidence: "exact",
          sourceLocation: location,
          evidenceToken,
          drillTargets: callee ? [callee] : undefined
        }],
        edges: [],
        layout: {
          width: 300,
          height: 130,
          nodes: [{ blockId, x: 58, y: 20, width: 184, height: 72, rank: 0, lane: 0 }],
          edges: []
        },
        summary: {
          blockCount: 1,
          branchCount: title === "Root.run" ? 2 : 0,
          loopCount: 0,
          callCount: callee ? 1 : 0,
          effectCount: 0,
          mutationCount: 0,
          exitCount: 1
        },
        callees: callee ? [callee] : [],
        omittedCalleeCount: 0
      },
      origins: [],
      gaps: [],
      summary: {
        stepCount: 1,
        concreteStepCount: 1,
        decisionStepCount: 0,
        effectStepCount: 0,
        unknownStepCount: 0,
        gapCount: 0
      }
    }
  };
}

/** Returns the most recent payload emitted under one request discriminator. */
function latestPayload(
  messages: Array<{ type: string; payload: unknown }>,
  type: string
): unknown {
  const message = [...messages].reverse().find((candidate) => candidate.type === type);
  assert.ok(message, `missing ${type} request`);
  return message.payload;
}
