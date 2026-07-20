/**
 * Generated-browser tests for the dedicated Function Visualizer tab. They cover
 * single-canvas child attachment, serialized requests, collapse, cycles, and evidence.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionVisualizerHtml } from "../../webview/functionVisualizer/functionVisualizerHtml";
import { installSidebarWebviewRuntime } from "./helpers/sidebarWebviewRuntime";

const graphVersion = "sidebar-snapshot:function-panel:1";
const rootToken = "source-node:1111111111111111111111111111111111111111111111111111111111111111";
const childToken = "source-node:2222222222222222222222222222222222222222222222222222222222222222";
const siblingToken = "source-node:3333333333333333333333333333333333333333333333333333333333333333";
const evidenceToken = "code-evidence:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

type TestCallee = {
  sourceToken: string;
  name: string;
  qualifiedName: string;
  sourceLocation: string;
  confidence: string;
  callsiteCount: number;
};

type TestValueChange = {
  target: string;
  targetKind: "variable" | "property" | "receiver";
  operation: "initialize" | "assign" | "update" | "delete" | "iterate" | "mutate";
  operator: string;
  value?: string;
  confidence: "exact" | "inferred";
};

test("requests a child attachment when the function call belongs to an if box", () => {
  const runtime = installSidebarWebviewRuntime();

  try {
    new Function(requireFunctionVisualizerScript())();
    runtime.dispatchMessage(createSessionMessage());
    runtime.dispatchMessage(createFunctionDetail("Root.run", rootToken, {
      sourceToken: childToken,
      name: "isReady",
      qualifiedName: "Guard.isReady",
      sourceLocation: "src/guard.ts:4",
      confidence: "inferred",
      callsiteCount: 1
    }, "condition"));

    runtime.clickByTitle("Expand called function · Guard.isReady");
    assert.deepEqual(latestPayload(runtime.messages, "codeFlow/selectSource"), {
      graphVersion,
      sourceToken: childToken
    });
  } finally {
    runtime.restore();
  }
});

test("keeps the callsite fixed in the viewport while attached child nodes animate in", () => {
  const runtime = installSidebarWebviewRuntime();
  const expandTitle = "Expand called function · Child.load";
  const collapseTitle = "Collapse called function · Child.load";

  try {
    new Function(requireFunctionVisualizerScript())();
    runtime.dispatchMessage(createSessionMessage());
    runtime.dispatchMessage(createFunctionDetail("Root.run", rootToken, {
      sourceToken: childToken,
      name: "load",
      qualifiedName: "Child.load",
      sourceLocation: "src/child.ts:4",
      confidence: "resolved",
      callsiteCount: 1
    }));
    runtime.setRenderedScrollByClass(
      "flow-steps",
      "logic-graph-viewport",
      { left: 18, top: 24 }
    );
    const before = renderedViewportPosition(runtime, expandTitle);

    runtime.clickByTitle(expandTitle);
    assert.deepEqual(renderedViewportPosition(runtime, collapseTitle), before);
    assert.equal(runtime.countRenderedByClass("flow-steps", "logic-node-entering"), 1);
    assert.equal(runtime.countRenderedByClass("flow-steps", "logic-edge-entering"), 1);

    const loadingPosition = renderedViewportPosition(runtime, collapseTitle);
    runtime.dispatchMessage(createFunctionDetail("Child.load", childToken));
    assert.deepEqual(renderedViewportPosition(runtime, collapseTitle), loadingPosition);
    assert.equal(runtime.countRenderedByClass("flow-steps", "logic-node-entering"), 1);
    assert.equal(runtime.countRenderedByClass("flow-steps", "logic-edge-entering"), 1);
  } finally {
    runtime.restore();
  }
});

test("routes attached function edges through rank gaps without crossing unrelated boxes", () => {
  const runtime = installSidebarWebviewRuntime();
  const exposedBuilder = "__projectAnalyzerAttachedSceneBuilder";

  try {
    new Function(
      requireFunctionVisualizerScript()
        + `\nglobalThis.${exposedBuilder} = createAttachedFunctionGraphScene;`
    )();
    const createScene = Reflect.get(globalThis, exposedBuilder) as AttachedSceneBuilder;
    const rootLogic = createBranchingRootTestLogic();
    const childLogic = createLayeredTestLogic("child", "operation");
    const siblingLogic = createLayeredTestLogic("sibling", "operation");
    const scene = createScene(rootLogic, "root-scope", "Root.run", [{
      id: "attached-function:1",
      parentScopeId: "root-scope",
      anchorBlockId: "root-middle",
      target: {
        sourceToken: childToken,
        name: "load",
        qualifiedName: "Child.load",
        sourceLocation: "src/child.ts:4",
        confidence: "resolved",
        callsiteCount: 1
      },
      depth: 1,
      status: "loaded",
      detail: { title: "Child.load", logic: childLogic }
    }, {
      id: "attached-function:2",
      parentScopeId: "root-scope",
      anchorBlockId: "root-middle",
      target: {
        sourceToken: siblingToken,
        name: "save",
        qualifiedName: "Sibling.save",
        sourceLocation: "src/sibling.ts:8",
        confidence: "resolved",
        callsiteCount: 1
      },
      depth: 1,
      status: "loaded",
      detail: { title: "Sibling.save", logic: siblingLogic }
    }]);

    assert.equal(scene.attachedFunctionCount, 2);
    assert.equal(scene.logic.blocks.length, 11);
    assert.equal(scene.logic.blocks.filter((block) => block.functionLabel === "Child.load").length, 3);
    assert.equal(scene.logic.blocks.filter((block) => block.functionLabel === "Sibling.save").length, 3);
    assert.equal(scene.logic.edges.filter((edge) => edge.relation === "call").length, 2);
    assert.equal(scene.logic.edges.filter((edge) => edge.relation === "callReturn").length, 2);

    const resume = scene.logic.blocks.find((block) => block.id.startsWith("compound-resume:"));
    assert.ok(resume, "the caller continuation must become an explicit resume gateway");
    const callerBranches = scene.logic.edges.filter((edge) =>
      edge.targetId.endsWith(":root-true-exit")
        || edge.targetId.endsWith(":root-false-exit")
    );
    assert.equal(callerBranches.length, 2);
    assert.ok(callerBranches.every((edge) => edge.sourceId === resume.id));
    assert.ok(scene.logic.edges
      .filter((edge) => edge.relation === "callReturn")
      .every((edge) => edge.targetId === resume.id));

    assertChildFlowPrecedesCallerContinuation(scene.logic, resume.id);
    assertCompoundEdgesAvoidBoxes(scene.logic);
    assertCompoundEdgesDoNotOverlap(scene.logic);
  } finally {
    Reflect.deleteProperty(globalThis, exposedBuilder);
    runtime.restore();
  }
});

test("keeps complete child and resume labels while expanding compound boxes", () => {
  const runtime = installSidebarWebviewRuntime();
  const exposedBuilder = "__projectAnalyzerAttachedSceneBuilder";

  try {
    new Function(
      requireFunctionVisualizerScript()
        + `\nglobalThis.${exposedBuilder} = createAttachedFunctionGraphScene;`
    )();
    const createScene = Reflect.get(globalThis, exposedBuilder) as AttachedSceneBuilder;
    const rootLogic = createBranchingRootTestLogic();
    const callerTail = "caller_resume_tail";
    const callerLabel = `${"if completeCallerCondition(input, context) && ".repeat(12)}${callerTail}`;
    const anchor = rootLogic.blocks.find((block) => block.id === "root-middle");
    assert.ok(anchor);
    anchor.label = callerLabel;
    const childLogic = createLayeredTestLogic("complete-child", "operation");
    const functionTail = "completeChildFunction";
    const completeFunctionTitle = `Child.${"LongNamespaceSegment.".repeat(18)}${functionTail}`;
    const scene = createScene(rootLogic, "root-scope", "Root.run", [{
      id: "attached-function:complete-text",
      parentScopeId: "root-scope",
      anchorBlockId: "root-middle",
      target: {
        sourceToken: childToken,
        name: functionTail,
        qualifiedName: completeFunctionTitle,
        sourceLocation: "src/child.ts:4",
        confidence: "resolved",
        callsiteCount: 1
      },
      depth: 1,
      status: "loaded",
      detail: { title: completeFunctionTitle, logic: childLogic }
    }]);
    const childBlock = scene.logic.blocks.find((block) =>
      block.sourceBlockId === "complete-child-entry"
    );
    const childNode = scene.logic.layout.nodes.find((node) =>
      node.blockId === childBlock?.id
    );
    const sourceChildNode = childLogic.layout.nodes.find((node) =>
      node.blockId === "complete-child-entry"
    );
    const resume = scene.logic.blocks.find((block) =>
      block.id.startsWith("compound-resume:")
    );
    const resumeNode = scene.logic.layout.nodes.find((node) =>
      node.blockId === resume?.id
    );

    assert.ok(childBlock && childNode && sourceChildNode && resume && resumeNode);
    assert.equal(childBlock.functionLabel, completeFunctionTitle);
    assert.ok(childBlock.functionLabel);
    assert.ok(childBlock.functionLabel.endsWith(functionTail));
    assert.equal(resume.label, `Resume · ${callerLabel}`);
    assert.ok(resume.label.endsWith(callerTail));
    assert.doesNotMatch(
      JSON.stringify(scene.logic.blocks.map((block) => ({
        label: block.label,
        functionLabel: block.functionLabel
      }))),
      /…/u
    );
    assert.ok(childNode.height > sourceChildNode.height);
    assert.ok(resumeNode.height > 76);
    assertCompoundEdgesAvoidBoxes(scene.logic);
  } finally {
    Reflect.deleteProperty(globalThis, exposedBuilder);
    runtime.restore();
  }
});

test("places a post-loop statement below the loop-back ring in the compound canvas", () => {
  const runtime = installSidebarWebviewRuntime();
  const exposedBuilder = "__projectAnalyzerAttachedSceneBuilder";

  try {
    new Function(
      requireFunctionVisualizerScript()
        + `\nglobalThis.${exposedBuilder} = createAttachedFunctionGraphScene;`
    )();
    const createScene = Reflect.get(globalThis, exposedBuilder) as AttachedSceneBuilder;
    const scene = createScene(
      createLoopThenStatementTestLogic(),
      "root-scope",
      "Root.run",
      []
    );
    const bodyBlock = scene.logic.blocks.find((block) => block.sourceBlockId === "loop-body");
    const afterBlock = scene.logic.blocks.find((block) => block.sourceBlockId === "after-loop");
    const repeatEdge = scene.logic.edges.find((edge) => edge.kind === "repeat");
    assert.ok(bodyBlock);
    assert.ok(afterBlock);
    assert.ok(repeatEdge);

    const nodeByBlockId = new Map(scene.logic.layout.nodes.map((node) => [node.blockId, node]));
    const bodyNode = nodeByBlockId.get(bodyBlock.id);
    const afterNode = nodeByBlockId.get(afterBlock.id);
    const repeatRoute = scene.logic.layout.edges.find((edge) =>
      edge.edgeId === repeatEdge.id
    );
    assert.ok(bodyNode);
    assert.ok(afterNode);
    assert.ok(repeatRoute);
    assert.ok(afterNode.rank > bodyNode.rank);
    assert.ok(afterNode.y > Math.max(...repeatRoute.points.map((point) => point.y)));
    assertCompoundEdgesAvoidBoxes(scene.logic);
  } finally {
    Reflect.deleteProperty(globalThis, exposedBuilder);
    runtime.restore();
  }
});

test("attaches a called function to the original graph canvas and collapses its branch", () => {
  const runtime = installSidebarWebviewRuntime();

  try {
    new Function(requireFunctionVisualizerScript())();
    runtime.dispatchMessage(createSessionMessage());
    runtime.dispatchMessage(createFunctionDetail("Root.run", rootToken, {
      sourceToken: childToken,
      name: "load",
      qualifiedName: "Child.load",
      sourceLocation: "src/child.ts:4",
      confidence: "resolved",
      callsiteCount: 1
    }));

    runtime.clickByTitle("Expand called function · Child.load");
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

    const attachedText = runtime.getRenderedText("flow-steps");
    assert.equal(runtime.countRenderedByClass("flow-steps", "logic-graph"), 1);
    assert.equal(runtime.countRenderedByClass("flow-steps", "logic-graph-viewport"), 1);
    assert.equal(runtime.countRenderedByClass("flow-steps", "logic-graph-node"), 2);
    assert.equal(runtime.countRenderedByClass("flow-steps", "logic-node-function"), 1);
    assert.ok(attachedText.includes("Control paths · 2 functions in one graph"));
    assert.ok(attachedText.includes("Child.load"));
    assert.ok(!attachedText.includes("Functions appended to this flow"));
    assert.ok(runtime.getRenderedText("function-title").includes("Root.run"));

    const requestCount = runtime.messages.filter((message) =>
      message.type === "codeFlow/selectSource"
    ).length;
    runtime.clickByTitle("Expand called function · Root.run");
    assert.equal(runtime.messages.filter((message) =>
      message.type === "codeFlow/selectSource"
    ).length, requestCount);
    assert.equal(runtime.countRenderedByClass("flow-steps", "logic-graph"), 1);
    assert.equal(runtime.countRenderedByClass("flow-steps", "logic-graph-node"), 3);
    assert.ok(runtime.getRenderedText("flow-steps").includes("Call cycle · Root.run"));

    runtime.clickByTitle("Collapse called function · Child.load");
    assert.equal(runtime.countRenderedByClass("flow-steps", "logic-graph-node"), 1);
    assert.equal(runtime.countRenderedByClass("flow-steps", "logic-node-function"), 0);
  } finally {
    runtime.restore();
  }
});

test("keeps the parent canvas visible when an attached child analysis fails", () => {
  const runtime = installSidebarWebviewRuntime();

  try {
    new Function(requireFunctionVisualizerScript())();
    runtime.dispatchMessage(createSessionMessage());
    runtime.dispatchMessage(createFunctionDetail("Root.run", rootToken, {
      sourceToken: childToken,
      name: "load",
      qualifiedName: "Child.load",
      sourceLocation: "src/child.ts:4",
      confidence: "resolved",
      callsiteCount: 1
    }));

    runtime.clickByTitle("Expand called function · Child.load");
    runtime.dispatchMessage({
      type: "codeFlow/detailFailed",
      payload: {
        graphVersion,
        code: "sourceNotFound",
        message: "The called function changed before it could be analyzed."
      }
    });

    assert.ok(runtime.getRenderedText("function-title").includes("Root.run"));
    assert.equal(runtime.countRenderedByClass("flow-steps", "logic-graph"), 1);
    assert.equal(runtime.countRenderedByClass("flow-steps", "logic-graph-node"), 2);
    assert.ok(runtime.getRenderedText("flow-steps").includes(
      "The called function changed before it could be analyzed."
    ));
  } finally {
    runtime.restore();
  }
});

test("serializes every concrete function attached to the same call box", () => {
  const runtime = installSidebarWebviewRuntime();
  const sibling: TestCallee = {
    sourceToken: siblingToken,
    name: "save",
    qualifiedName: "Sibling.save",
    sourceLocation: "src/sibling.ts:8",
    confidence: "resolved",
    callsiteCount: 1
  };

  try {
    new Function(requireFunctionVisualizerScript())();
    runtime.dispatchMessage(createSessionMessage());
    runtime.dispatchMessage(createFunctionDetail("Root.run", rootToken, [{
      sourceToken: childToken,
      name: "load",
      qualifiedName: "Child.load",
      sourceLocation: "src/child.ts:4",
      confidence: "resolved",
      callsiteCount: 1
    }, sibling]));

    runtime.clickByTitle("Expand called function · Child.load, Sibling.save");
    runtime.dispatchMessage(createFunctionDetail("Child.load", childToken));
    const requests = runtime.messages.filter((message) =>
      message.type === "codeFlow/selectSource"
    );
    assert.deepEqual(requests.map((message) =>
      (message.payload as { sourceToken: string }).sourceToken
    ), [childToken, siblingToken]);

    runtime.dispatchMessage(createFunctionDetail("Sibling.save", siblingToken));
    const attachedText = runtime.getRenderedText("flow-steps");
    assert.equal(runtime.countRenderedByClass("flow-steps", "logic-graph"), 1);
    assert.equal(runtime.countRenderedByClass("flow-steps", "logic-graph-node"), 3);
    assert.ok(attachedText.includes("Child.load"));
    assert.ok(attachedText.includes("Sibling.save"));
  } finally {
    runtime.restore();
  }
});

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
    assert.ok(
      rootText.includes(
        "2 branch decisions can change the path. "
          + "Select a true, false, or case label to follow one scenario."
      ),
      `missing decision guidance in: ${rootText}`
    );
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

test("renders variable and receiver changes inside the graph node and selection", () => {
  const runtime = installSidebarWebviewRuntime();
  const valueChanges: TestValueChange[] = [{
    target: "total",
    targetKind: "variable",
    operation: "update",
    operator: "+=",
    value: "item.price",
    confidence: "exact"
  }, {
    target: "items",
    targetKind: "receiver",
    operation: "mutate",
    operator: "push()",
    value: "item",
    confidence: "inferred"
  }];

  try {
    new Function(requireFunctionVisualizerScript())();
    runtime.dispatchMessage(createSessionMessage());
    runtime.dispatchMessage(createFunctionDetail(
      "Root.run",
      rootToken,
      undefined,
      "mutation",
      valueChanges
    ));

    const rendered = runtime.getRenderedText("flow-steps");
    const summary = runtime.getRenderedText("function-summary");
    assert.ok(
      summary.some((text) => text.includes("2 value changes")),
      summary.join(" · ")
    );
    assert.ok(rendered.includes("VAR · CHANGES"));
    assert.ok(rendered.includes("Control & value flow"));
    assert.ok(rendered.includes("total += item.price"));
    assert.ok(rendered.includes("RECEIVER · MAY CHANGE"));
    assert.ok(rendered.includes("items push() item"));
    assert.ok(rendered.includes("Values changed here"));
    assert.equal(runtime.countRenderedByClass("flow-steps", "logic-value-change"), 4);
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
  callee?: TestCallee | TestCallee[],
  blockKind: "call" | "condition" | "mutation" = "call",
  valueChanges: TestValueChange[] = []
): unknown {
  const callees = callee ? (Array.isArray(callee) ? callee : [callee]) : [];
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
          kind: blockKind,
          label: callees.length > 0
            ? (blockKind === "condition" ? "if " : "")
              + callees.map((target) => target.qualifiedName + "();").join(" ")
            : valueChanges.length > 0
              ? "total += item.price; items.push(item);"
            : "return true;",
          detail: callees.length > 0
            ? "Calls concrete child definitions."
            : "Returns from this function.",
          depth: 0,
          confidence: "exact",
          sourceLocation: location,
          evidenceToken,
          drillTargets: callees.length > 0 ? callees : undefined,
          valueChanges: valueChanges.length > 0 ? valueChanges : undefined
        }],
        edges: [],
        layout: {
          width: 300,
          height: valueChanges.length > 0 ? 176 : 130,
          nodes: [{
            blockId,
            x: 58,
            y: 20,
            width: 184,
            height: valueChanges.length > 0 ? 128 : 72,
            rank: 0,
            lane: 0
          }],
          edges: []
        },
        summary: {
          blockCount: 1,
          branchCount: title === "Root.run" ? 2 : 0,
          loopCount: 0,
          callCount: callees.length,
          effectCount: 0,
          mutationCount: blockKind === "mutation" ? 1 : 0,
          valueChangeCount: valueChanges.length,
          exitCount: 1
        },
        callees,
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

/** Measures one rendered node relative to the current graph viewport scroll. */
function renderedViewportPosition(
  runtime: ReturnType<typeof installSidebarWebviewRuntime>,
  title: string
): { left: number; top: number } {
  const position = runtime.getRenderedPositionByTitle("flow-steps", title);
  const scroll = runtime.getRenderedScrollByClass("flow-steps", "logic-graph-viewport");
  return {
    left: position.left - scroll.left,
    top: position.top - scroll.top
  };
}

type TestLogicBlock = {
  id: string;
  kind: string;
  label: string;
  detail: string;
  depth: number;
  confidence: string;
  functionLabel?: string;
  functionScopeId?: string;
  sourceBlockId?: string;
};

type TestLogicEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  kind: string;
  confidence: string;
  relation?: string;
};

type TestLogicLayout = {
  width: number;
  height: number;
  nodes: Array<{
    blockId: string;
    x: number;
    y: number;
    width: number;
    height: number;
    rank: number;
    lane: number;
  }>;
  edges: Array<{
    edgeId: string;
    points: Array<{ x: number; y: number }>;
    labelX: number;
    labelY: number;
    route: string;
  }>;
};

type TestFunctionLogic = {
  blocks: TestLogicBlock[];
  edges: TestLogicEdge[];
  layout: TestLogicLayout;
  [key: string]: unknown;
};

type AttachedSceneBuilder = (
  rootLogic: TestFunctionLogic,
  rootScopeId: string,
  rootTitle: string,
  expansions: unknown[]
) => {
  attachedFunctionCount: number;
  logic: TestFunctionLogic;
};

/** Creates a three-rank function fragment with stable variable-size node dimensions. */
function createLayeredTestLogic(prefix: string, middleKind: string): TestFunctionLogic {
  const blocks: TestLogicBlock[] = [{
    id: `${prefix}-entry`,
    kind: "entry",
    label: `Start ${prefix}`,
    detail: "Entry",
    depth: 0,
    confidence: "exact"
  }, {
    id: `${prefix}-middle`,
    kind: middleKind,
    label: `${prefix} middle`,
    detail: "Middle operation",
    depth: 0,
    confidence: "exact"
  }, {
    id: `${prefix}-exit`,
    kind: "exit",
    label: `End ${prefix}`,
    detail: "Exit",
    depth: 0,
    confidence: "exact"
  }];
  const edges: TestLogicEdge[] = [{
    id: `${prefix}-edge-1`,
    sourceId: `${prefix}-entry`,
    targetId: `${prefix}-middle`,
    kind: "next",
    confidence: "exact"
  }, {
    id: `${prefix}-edge-2`,
    sourceId: `${prefix}-middle`,
    targetId: `${prefix}-exit`,
    kind: "next",
    confidence: "exact"
  }];
  return {
    blocks,
    edges,
    layout: {
      width: 320,
      height: 390,
      nodes: blocks.map((block, index) => ({
        blockId: block.id,
        x: 58,
        y: 20 + index * 118,
        width: index === 1 ? 220 : 184,
        height: index === 1 ? 84 : 72,
        rank: index,
        lane: 0
      })),
      edges: edges.map((edge) => ({
        edgeId: edge.id,
        points: [],
        labelX: 0,
        labelY: 0,
        route: "forward"
      }))
    }
  };
}

/** Creates a caller whose true/false branches must resume only after child flows. */
function createBranchingRootTestLogic(): TestFunctionLogic {
  const blocks: TestLogicBlock[] = [{
    id: "root-entry",
    kind: "entry",
    label: "Start root",
    detail: "Entry",
    depth: 0,
    confidence: "exact"
  }, {
    id: "root-middle",
    kind: "condition",
    label: "if Child.load() or Sibling.save()",
    detail: "Calls two concrete child definitions before branching.",
    depth: 0,
    confidence: "exact"
  }, {
    id: "root-true-exit",
    kind: "exit",
    label: "Return success",
    detail: "True exit",
    depth: 0,
    confidence: "exact"
  }, {
    id: "root-false-exit",
    kind: "exit",
    label: "Return failure",
    detail: "False exit",
    depth: 0,
    confidence: "exact"
  }];
  const edges: TestLogicEdge[] = [{
    id: "root-edge-entry",
    sourceId: "root-entry",
    targetId: "root-middle",
    kind: "next",
    confidence: "exact"
  }, {
    id: "root-edge-true",
    sourceId: "root-middle",
    targetId: "root-true-exit",
    kind: "true",
    confidence: "exact"
  }, {
    id: "root-edge-false",
    sourceId: "root-middle",
    targetId: "root-false-exit",
    kind: "false",
    confidence: "exact"
  }];
  return {
    blocks,
    edges,
    layout: {
      width: 560,
      height: 390,
      nodes: [{
        blockId: "root-entry", x: 188, y: 20, width: 184, height: 72, rank: 0, lane: 0
      }, {
        blockId: "root-middle", x: 158, y: 138, width: 244, height: 84, rank: 1, lane: 0
      }, {
        blockId: "root-true-exit", x: 58, y: 276, width: 184, height: 72, rank: 2, lane: 0
      }, {
        blockId: "root-false-exit", x: 318, y: 276, width: 184, height: 72, rank: 2, lane: 1
      }],
      edges: edges.map((edge) => ({
        edgeId: edge.id,
        points: [],
        labelX: 0,
        labelY: 0,
        route: "forward"
      }))
    }
  };
}

/** Creates the formerly ambiguous layout where body and continuation shared a rank. */
function createLoopThenStatementTestLogic(): TestFunctionLogic {
  const blocks: TestLogicBlock[] = [{
    id: "loop-entry",
    kind: "entry",
    label: "Start root",
    detail: "Entry",
    depth: 0,
    confidence: "exact"
  }, {
    id: "loop-header",
    kind: "loop",
    label: "while hasNext()",
    detail: "Checks whether another item exists.",
    depth: 0,
    confidence: "exact"
  }, {
    id: "loop-body",
    kind: "operation",
    label: "consume(item)",
    detail: "Consumes one item before repeating.",
    depth: 1,
    confidence: "exact"
  }, {
    id: "after-loop",
    kind: "operation",
    label: "publishSummary()",
    detail: "Runs only after the loop finishes.",
    depth: 0,
    confidence: "exact"
  }, {
    id: "loop-exit",
    kind: "exit",
    label: "End root",
    detail: "Exit",
    depth: 0,
    confidence: "exact"
  }];
  const edges: TestLogicEdge[] = [{
    id: "loop-edge-entry",
    sourceId: "loop-entry",
    targetId: "loop-header",
    kind: "next",
    confidence: "exact"
  }, {
    id: "loop-edge-iterate",
    sourceId: "loop-header",
    targetId: "loop-body",
    kind: "iterate",
    confidence: "exact"
  }, {
    id: "loop-edge-repeat",
    sourceId: "loop-body",
    targetId: "loop-header",
    kind: "repeat",
    confidence: "exact"
  }, {
    id: "loop-edge-finished",
    sourceId: "loop-header",
    targetId: "after-loop",
    kind: "exit",
    confidence: "exact"
  }, {
    id: "loop-edge-exit",
    sourceId: "after-loop",
    targetId: "loop-exit",
    kind: "next",
    confidence: "exact"
  }];
  const rankByBlockId = new Map([
    ["loop-entry", 0],
    ["loop-header", 1],
    ["loop-body", 2],
    ["after-loop", 2],
    ["loop-exit", 3]
  ]);
  return {
    blocks,
    edges,
    layout: {
      width: 560,
      height: 510,
      nodes: blocks.map((block, index) => ({
        blockId: block.id,
        x: block.id === "after-loop" ? 298 : 58,
        y: 20 + (rankByBlockId.get(block.id) ?? index) * 118,
        width: 204,
        height: 76,
        rank: rankByBlockId.get(block.id) ?? index,
        lane: block.id === "after-loop" ? 1 : 0
      })),
      edges: edges.map((edge) => ({
        edgeId: edge.id,
        points: [],
        labelX: 0,
        labelY: 0,
        route: edge.kind === "repeat" ? "back" : "forward"
      }))
    }
  };
}

/** Confirms child ranks sit between the callsite and the caller's resume gateway. */
function assertChildFlowPrecedesCallerContinuation(
  logic: TestFunctionLogic,
  resumeId: string
): void {
  const nodeByBlockId = new Map(logic.layout.nodes.map((node) => [node.blockId, node]));
  const callsite = logic.blocks.find((block) => block.sourceBlockId === "root-middle");
  assert.ok(callsite);
  const callsiteRank = nodeByBlockId.get(callsite.id)?.rank;
  const resumeRank = nodeByBlockId.get(resumeId)?.rank;
  assert.notEqual(callsiteRank, undefined);
  assert.notEqual(resumeRank, undefined);
  assert.ok((callsiteRank as number) < (resumeRank as number));

  for (const functionLabel of ["Child.load", "Sibling.save"]) {
    const childNodes = logic.blocks
      .filter((block) => block.functionLabel === functionLabel)
      .map((block) => nodeByBlockId.get(block.id))
      .filter((node): node is NonNullable<typeof node> => Boolean(node));
    assert.equal(childNodes.length, 3);
    assert.ok(childNodes.every((node) =>
      node.rank > (callsiteRank as number) && node.rank < (resumeRank as number)
    ));
  }
}

/** Ensures every compound route is orthogonal and avoids non-endpoint boxes. */
function assertCompoundEdgesAvoidBoxes(logic: TestFunctionLogic): void {
  const edgeById = new Map(logic.edges.map((edge) => [edge.id, edge]));
  for (const routedEdge of logic.layout.edges) {
    const edge = edgeById.get(routedEdge.edgeId);
    assert.ok(edge, `missing compound edge ${routedEdge.edgeId}`);
    for (let pointIndex = 1; pointIndex < routedEdge.points.length; pointIndex += 1) {
      const start = routedEdge.points[pointIndex - 1];
      const end = routedEdge.points[pointIndex];
      assert.ok(start.x === end.x || start.y === end.y, `${routedEdge.edgeId} is not orthogonal`);
      for (const node of logic.layout.nodes) {
        if (node.blockId === edge.sourceId || node.blockId === edge.targetId) continue;
        assert.equal(
          segmentCrossesBoxInterior(start, end, node),
          false,
          `${routedEdge.edgeId} crosses ${node.blockId}`
        );
      }
    }
  }
}

/** Rejects positive-length collinear overlap between any two routed edges. */
function assertCompoundEdgesDoNotOverlap(logic: TestFunctionLogic): void {
  for (let leftIndex = 0; leftIndex < logic.layout.edges.length; leftIndex += 1) {
    const left = logic.layout.edges[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < logic.layout.edges.length; rightIndex += 1) {
      const right = logic.layout.edges[rightIndex];
      for (let leftPoint = 1; leftPoint < left.points.length; leftPoint += 1) {
        for (let rightPoint = 1; rightPoint < right.points.length; rightPoint += 1) {
          assert.equal(
            segmentsOverlap(
              left.points[leftPoint - 1],
              left.points[leftPoint],
              right.points[rightPoint - 1],
              right.points[rightPoint]
            ),
            false,
            `${left.edgeId} overlaps ${right.edgeId}`
          );
        }
      }
    }
  }
}

/** Detects only shared line length; a single shared endpoint is not overlap. */
function segmentsOverlap(
  firstStart: { x: number; y: number },
  firstEnd: { x: number; y: number },
  secondStart: { x: number; y: number },
  secondEnd: { x: number; y: number }
): boolean {
  if (firstStart.x === firstEnd.x
    && secondStart.x === secondEnd.x
    && firstStart.x === secondStart.x) {
    return intervalOverlapLength(
      firstStart.y,
      firstEnd.y,
      secondStart.y,
      secondEnd.y
    ) > 0;
  }
  if (firstStart.y === firstEnd.y
    && secondStart.y === secondEnd.y
    && firstStart.y === secondStart.y) {
    return intervalOverlapLength(
      firstStart.x,
      firstEnd.x,
      secondStart.x,
      secondEnd.x
    ) > 0;
  }
  return false;
}

/** Returns the positive shared length of two scalar intervals. */
function intervalOverlapLength(
  firstStart: number,
  firstEnd: number,
  secondStart: number,
  secondEnd: number
): number {
  return Math.min(
    Math.max(firstStart, firstEnd),
    Math.max(secondStart, secondEnd)
  ) - Math.max(
    Math.min(firstStart, firstEnd),
    Math.min(secondStart, secondEnd)
  );
}

/** Tests an orthogonal segment against the strict interior of one graph box. */
function segmentCrossesBoxInterior(
  start: { x: number; y: number },
  end: { x: number; y: number },
  box: { x: number; y: number; width: number; height: number }
): boolean {
  const left = box.x;
  const right = box.x + box.width;
  const top = box.y;
  const bottom = box.y + box.height;
  if (start.x === end.x) {
    const segmentTop = Math.min(start.y, end.y);
    const segmentBottom = Math.max(start.y, end.y);
    return start.x > left && start.x < right
      && segmentBottom > top && segmentTop < bottom;
  }
  const segmentLeft = Math.min(start.x, end.x);
  const segmentRight = Math.max(start.x, end.x);
  return start.y > top && start.y < bottom
    && segmentRight > left && segmentLeft < right;
}
