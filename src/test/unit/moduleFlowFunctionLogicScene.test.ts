/**
 * Pure scene-adapter tests for attaching Function Logic below a Module Flow
 * function card. They cover continuity, bounded animation order, and endpoint
 * filtering without a DOM or VS Code runtime.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { ModuleFlowFunctionLogicPayload } from "../../protocol/moduleFlow";
import {
  createModuleFlowFunctionLogicScene,
  getModuleFlowFunctionLogicSceneBrowserSource
} from "../../webview/moduleVisualizer/moduleFlowFunctionLogicScene";

const FUNCTION_ID = "module-flow-function:0123456789abcdef0123456789abcdef" as const;

test("connects the function anchor to its entry and preserves control semantics", () => {
  const payload = createPayload();
  const scene = createModuleFlowFunctionLogicScene(payload);

  assert.equal(scene.anchorFunctionId, FUNCTION_ID);
  assert.equal(scene.expansion, "functionLogic");
  assert.deepEqual(scene.nodes.map((node) => node.blockKind), ["entry", "condition", "return"]);
  assert.ok(scene.edges.some((edge) =>
    edge.presentationKind === "functionEntry"
      && edge.sourceId === FUNCTION_ID
      && edge.targetId === "function-logic-block:entry"
  ));
  assert.ok(scene.edges.some((edge) =>
    edge.presentationKind === "controlFlow"
      && edge.controlKind === "true"
      && edge.controlLabel === "approved"
  ));
  assert.equal(
    scene.edges.some((edge) => edge.id === "function-logic-edge:unknown-endpoint"),
    false
  );
  assert.equal(scene.nodes[1]?.valueAccesses[0]?.name, "approved");
  assert.equal(scene.summary.visibleNodeCount, 3);
  assert.equal(scene.summary.visibleEdgeCount, 3);
  assert.equal(scene.summary.candidateEdgeCount, 5);
  assert.equal(scene.summary.omittedEdgeCount, 2);
});

test("serializes a dependency-free iterative browser adapter", () => {
  const source = getModuleFlowFunctionLogicSceneBrowserSource();

  assert.match(source, /^function createModuleFlowFunctionLogicScene\(/u);
  assert.match(source, /for \(let index = 0;/u);
  assert.match(source, /Math\.min\(index, 12\)/u);
  assert.doesNotMatch(source, /\b(?:require|import)\b/u);
  assert.doesNotThrow(() => new Function(`${source}; return createModuleFlowFunctionLogicScene;`));
});

/** Creates three visible blocks plus one intentionally invalid control edge. */
function createPayload(): ModuleFlowFunctionLogicPayload {
  const blocks: ModuleFlowFunctionLogicPayload["logic"]["blocks"] = [{
    id: "function-logic-block:entry",
    kind: "entry",
    label: "Enter processOrder",
    detail: "Function entry",
    depth: 0,
    confidence: "exact"
  }, {
    id: "function-logic-block:condition",
    kind: "condition",
    label: "approved?",
    detail: "if (approved)",
    depth: 0,
    confidence: "exact",
    valueAccesses: [{
      bindingId: "function-logic-binding:approved",
      name: "approved",
      bindingKind: "parameter",
      access: "read",
      confidence: "exact"
    }]
  }, {
    id: "function-logic-block:return",
    kind: "return",
    label: "return order",
    detail: "Return value",
    depth: 1,
    confidence: "exact"
  }];
  return {
    graphVersion: "sidebar-snapshot:test:1",
    requestId: 9,
    anchorFunctionId: FUNCTION_ID,
    title: "processOrder",
    subtitle: "Function logic",
    logic: {
      language: "typescript",
      signature: "processOrder(approved)",
      blocks,
      edges: [{
        id: "function-logic-edge:next",
        sourceId: blocks[0].id,
        targetId: blocks[1].id,
        kind: "next",
        confidence: "exact"
      }, {
        id: "function-logic-edge:true",
        sourceId: blocks[1].id,
        targetId: blocks[2].id,
        kind: "true",
        label: "approved",
        confidence: "exact"
      }, {
        id: "function-logic-edge:unknown-endpoint",
        sourceId: blocks[1].id,
        targetId: "function-logic-block:missing",
        kind: "false",
        confidence: "inferred"
      }],
      valueBindings: [],
      valueFlows: [],
      layout: { width: 0, height: 0, nodes: [], edges: [] },
      summary: {
        blockCount: 3,
        branchCount: 1,
        loopCount: 0,
        callCount: 0,
        effectCount: 0,
        mutationCount: 0,
        valueChangeCount: 0,
        exitCount: 1
      },
      callees: [],
      omittedCalleeCount: 0
    },
    gaps: [],
    summary: {
      visibleBlockCount: 3,
      visibleEdgeCount: 3,
      omittedEdgeCount: 2,
      gapCount: 0
    }
  };
}
