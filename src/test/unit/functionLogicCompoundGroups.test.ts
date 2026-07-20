/**
 * Function Logic compound-body tests. They verify exact nested bounds, scoped
 * parent identities after child attachment, and pointer-safe rendering layers.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionLogicBrowserSource } from "../../webview/codeFlow/functionLogicBrowserSource";
import { getFunctionLogicCompoundGroupBrowserSource } from "../../webview/codeFlow/functionLogicCompoundGroupBrowserSource";
import { getFunctionLogicGraphStyles } from "../../webview/codeFlow/functionLogicGraphStyles";
import { getCompoundFunctionLogicGraphSource } from "../../webview/functionVisualizer/compoundFunctionLogicGraphSource";
import { getFunctionVisualizerHtml } from "../../webview/functionVisualizer/functionVisualizerHtml";
import { installSidebarWebviewRuntime } from "./helpers/sidebarWebviewRuntime";

type TestBlock = {
  id: string;
  kind: string;
  label: string;
  detail: string;
  depth: number;
  parentBlockId?: string;
  confidence: string;
  sourceBlockId?: string;
  functionLabel?: string;
};

type TestNodeLayout = {
  blockId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rank: number;
  lane: number;
};

type TestEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  kind: string;
  label?: string;
  relation?: "call" | "callReturn" | "event";
  confidence: string;
};

type TestLogic = {
  blocks: TestBlock[];
  edges: TestEdge[];
  layout: {
    width: number;
    height: number;
    nodes: TestNodeLayout[];
    edges: Array<{
      edgeId: string;
      points: Array<{ x: number; y: number }>;
      labelX: number;
      labelY: number;
      route: "forward" | "long" | "back";
    }>;
  };
};

type CompoundGroup = {
  ownerBlockId: string;
  memberBlockIds: string[];
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
};

type CompoundRuntime = {
  createLogicCompoundGroups(
    blocks: TestBlock[],
    nodeLayoutsByBlockId: Map<string, TestNodeLayout>
  ): CompoundGroup[];
  createAttachedFunctionGraphScene(
    rootLogic: TestLogic,
    rootScopeId: string,
    rootTitle: string,
    expansions: unknown[]
  ): { logic: TestLogic };
};

test("wraps each body owner and descendants without swallowing its continuation", () => {
  const runtime = loadCompoundRuntime();
  const blocks = [
    block("if", "condition", 1),
    block("if-work", "operation", 2, "if"),
    block("loop", "loop", 2, "if"),
    block("loop-work", "operation", 3, "loop"),
    block("after", "operation", 1)
  ];
  const layouts = new Map<string, TestNodeLayout>([
    ["if", node("if", 180, 24, 0)],
    ["if-work", node("if-work", 70, 150, 1)],
    ["loop", node("loop", 290, 150, 1)],
    ["loop-work", node("loop-work", 290, 276, 2)],
    ["after", node("after", 180, 430, 3)]
  ]);
  const groups = runtime.createLogicCompoundGroups(blocks, layouts);
  const outer = groups.find((group) => group.ownerBlockId === "if");
  const nested = groups.find((group) => group.ownerBlockId === "loop");

  assert.ok(outer && nested);
  assert.deepEqual(new Set(outer.memberBlockIds), new Set([
    "if", "if-work", "loop", "loop-work"
  ]));
  assert.deepEqual(new Set(nested.memberBlockIds), new Set(["loop", "loop-work"]));
  assert.equal(outer.memberBlockIds.includes("after"), false);
  assert.ok(nested.x >= outer.x);
  assert.ok(nested.y >= outer.y);
  assert.ok(nested.x + nested.width <= outer.x + outer.width);
  assert.ok(nested.y + nested.height <= outer.y + outer.height);
  assert.ok(outer.y + outer.height < (layouts.get("after")?.y ?? 0));
});

test("namespaces structural parents independently in attached function scopes", () => {
  const runtime = loadCompoundRuntime();
  const rootLogic = createOwnedBodyLogic();
  const childLogic = createOwnedBodyLogic();
  const scene = runtime.createAttachedFunctionGraphScene(
    rootLogic,
    "root-scope",
    "Root.render",
    [{
      id: "attached:child",
      parentScopeId: "root-scope",
      anchorBlockId: "body",
      target: {
        sourceToken: "source-node:child",
        name: "Child",
        qualifiedName: "Child",
        confidence: "resolved",
        callsiteCount: 1
      },
      depth: 1,
      status: "loaded",
      detail: { title: "Child", logic: childLogic }
    }]
  );
  const rootOwner = scene.logic.blocks.find((candidate) =>
    candidate.sourceBlockId === "owner" && !candidate.functionLabel
  );
  const rootBody = scene.logic.blocks.find((candidate) =>
    candidate.sourceBlockId === "body" && !candidate.functionLabel
  );
  const childOwner = scene.logic.blocks.find((candidate) =>
    candidate.sourceBlockId === "owner" && candidate.functionLabel === "Child"
  );
  const childBody = scene.logic.blocks.find((candidate) =>
    candidate.sourceBlockId === "body" && candidate.functionLabel === "Child"
  );

  assert.ok(rootOwner && rootBody && childOwner && childBody);
  assert.equal(rootBody.parentBlockId, rootOwner.id);
  assert.equal(childBody.parentBlockId, childOwner.id);
  assert.notEqual(rootOwner.id, childOwner.id);
  assert.notEqual(rootBody.parentBlockId, childBody.parentBlockId);

  const layouts = new Map(scene.logic.layout.nodes.map((layout) => [layout.blockId, layout]));
  const groups = runtime.createLogicCompoundGroups(scene.logic.blocks, layouts);
  assert.ok(groups.some((group) => group.ownerBlockId === rootOwner.id));
  assert.ok(groups.some((group) => group.ownerBlockId === childOwner.id));
});

test("attaches event handlers without rerouting or returning into registration flow", () => {
  const runtime = loadCompoundRuntime();
  const rootLogic = createOwnedBodyLogic();
  const handlerLogic = createOwnedBodyLogic();
  const scene = runtime.createAttachedFunctionGraphScene(
    rootLogic,
    "root-scope",
    "setupEventHandlers",
    [{
      id: "attached:event-handler",
      parentScopeId: "root-scope",
      anchorBlockId: "body",
      target: {
        sourceToken: "source-node:event-handler",
        name: "handleClick",
        qualifiedName: "handleClick",
        confidence: "resolved",
        callsiteCount: 1,
        relation: "event"
      },
      depth: 1,
      status: "loaded",
      detail: { title: "handleClick", logic: handlerLogic }
    }]
  );
  const rootBinding = scene.logic.blocks.find((candidate) =>
    candidate.sourceBlockId === "body" && !candidate.functionLabel
  );
  const rootContinuation = scene.logic.blocks.find((candidate) =>
    candidate.sourceBlockId === "after" && !candidate.functionLabel
  );
  assert.ok(rootBinding && rootContinuation);

  const dispatchEdge = scene.logic.edges.find((edge) => edge.relation === "event");
  const originalContinuation = scene.logic.edges.find((edge) =>
    edge.id.includes("leave-body")
  );
  assert.ok(dispatchEdge && originalContinuation);
  assert.equal(dispatchEdge.sourceId, rootBinding.id);
  assert.match(dispatchEdge.label ?? "", /event handler handleClick/u);
  assert.equal(originalContinuation.sourceId, rootBinding.id);
  assert.equal(originalContinuation.targetId, rootContinuation.id);
  assert.equal(scene.logic.edges.some((edge) => edge.relation === "callReturn"), false);
  assert.equal(scene.logic.blocks.some((candidate) =>
    candidate.id.startsWith("compound-resume:")
  ), false);
});

test("renders compound frames behind routes and keeps them pointer-transparent", () => {
  const program = getFunctionLogicBrowserSource();
  const styles = getFunctionLogicGraphStyles();

  assert.match(program, /createLogicCompoundGroups\(\s*logic\.blocks/u);
  assert.match(program, /canvas\.append\(compoundGroupLayer, edgeRendering\.svg\)/u);
  assert.match(program, /logic-node-body-owner/u);
  assert.match(styles, /\.logic-compound-group-layer[\s\S]*?z-index: 0/u);
  assert.match(styles, /\.logic-compound-group-layer[\s\S]*?pointer-events: none/u);
  assert.match(styles, /\.logic-edge-layer[\s\S]*?z-index: 1/u);
  assert.match(styles, /\.logic-graph-node[\s\S]*?z-index: 2/u);
});

test("renders one interactive owner inside a decorative compound body frame", () => {
  const runtime = installSidebarWebviewRuntime();
  const graphVersion = "compound-body-runtime";
  const sourceToken = "source-node:compound-body";

  try {
    new Function(requireFunctionVisualizerScript())();
    runtime.dispatchMessage({
      type: "functionVisualizer/sessionLoaded",
      payload: {
        graphVersion,
        root: { sourceToken, label: "Root.render" }
      }
    });
    runtime.dispatchMessage(createCompoundDetailMessage(graphVersion));

    assert.equal(runtime.countRenderedByClass("flow-steps", "logic-compound-group"), 1);
    assert.equal(runtime.countRenderedByClass("flow-steps", "logic-node-body-owner"), 1);
    assert.ok(runtime.getRenderedText("flow-steps").includes("IF BODY"));
    assert.equal(runtime.countRenderedByClass("flow-steps", "logic-graph-node"), 3);
  } finally {
    runtime.restore();
  }
});

/** Loads only pure browser helpers; no DOM is needed for geometry assertions. */
function loadCompoundRuntime(): CompoundRuntime {
  return new Function(
    `${getFunctionLogicCompoundGroupBrowserSource()}\n`
      + `${getCompoundFunctionLogicGraphSource()}\n`
      + "return { createLogicCompoundGroups, createAttachedFunctionGraphScene };"
  )() as CompoundRuntime;
}

/** Extracts the generated editor-tab program for one realistic DOM smoke test. */
function requireFunctionVisualizerScript(): string {
  const html = getFunctionVisualizerHtml({
    webview: { cspSource: "vscode-webview:" } as never,
    nonce: "compound-body-test-nonce"
  });
  const match = html.match(/<script nonce="compound-body-test-nonce">([\s\S]*)<\/script>/u);
  assert.ok(match);
  return match[1];
}

/** Creates a projected control owner, owned body statement, and continuation. */
function createCompoundDetailMessage(graphVersion: string): unknown {
  const logic = createOwnedBodyLogic();
  return {
    type: "codeFlow/detailLoaded",
    payload: {
      graphVersion,
      id: "code-flow:compound-body",
      kind: "functionLogic",
      title: "Root.render",
      subtitle: "Function logic",
      semantics: "static",
      focusStepId: "owner",
      steps: [],
      logic: {
        ...logic,
        language: "typescript",
        signature: "function render()",
        summary: {
          blockCount: 3,
          branchCount: 1,
          loopCount: 0,
          callCount: 1,
          effectCount: 0,
          mutationCount: 0,
          valueChangeCount: 0,
          exitCount: 1
        },
        callees: [],
        omittedCalleeCount: 0
      },
      origins: [],
      gaps: [],
      summary: {
        stepCount: 3,
        concreteStepCount: 3,
        decisionStepCount: 1,
        effectStepCount: 0,
        unknownStepCount: 0,
        gapCount: 0
      }
    }
  };
}

/** Creates the minimum block identity required by grouping and compound layout. */
function block(
  id: string,
  kind: string,
  depth: number,
  parentBlockId?: string
): TestBlock {
  return {
    id,
    kind,
    label: id,
    detail: id,
    depth,
    parentBlockId,
    confidence: "exact"
  };
}

/** Creates one stable node rectangle for body-bound calculations. */
function node(blockId: string, x: number, y: number, rank: number): TestNodeLayout {
  return { blockId, x, y, width: 180, height: 76, rank, lane: 0 };
}

/** Builds a reusable owner/body/continuation graph with source layout hints. */
function createOwnedBodyLogic(): TestLogic {
  const blocks = [
    block("owner", "condition", 1),
    block("body", "call", 2, "owner"),
    block("after", "exit", 0)
  ];
  const edges: TestEdge[] = [{
    id: "enter-body",
    sourceId: "owner",
    targetId: "body",
    kind: "true",
    confidence: "exact"
  }, {
    id: "leave-body",
    sourceId: "body",
    targetId: "after",
    kind: "next",
    confidence: "exact"
  }];
  return {
    blocks,
    edges,
    layout: {
      width: 420,
      height: 370,
      nodes: [
        node("owner", 120, 24, 0),
        node("body", 120, 146, 1),
        node("after", 120, 268, 2)
      ],
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
