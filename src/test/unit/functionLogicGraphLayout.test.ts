/**
 * Function Logic graph-layout tests. They cover sibling branch lanes, forward
 * rank progression, loop back-edge routing, non-overlap, and determinism.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createFunctionLogicGraphLayout } from "../../application/codeFlow";
import type {
  FunctionLogicBlockPayload,
  FunctionLogicEdgePayload
} from "../../protocol/functionLogic";

test("lays out branches side-by-side and routes repeat edges through an outer channel", () => {
  const blocks = createBlocks();
  const edges = createEdges();
  const layout = createFunctionLogicGraphLayout(blocks, edges);
  const nodesById = new Map(layout.nodes.map((node) => [node.blockId, node]));
  const trueNode = nodesById.get("true-call");
  const falseNode = nodesById.get("false-call");
  const entryNode = nodesById.get("entry");
  const conditionNode = nodesById.get("condition");
  const repeatLayout = layout.edges.find((edge) => edge.edgeId === "repeat");
  const longReturnLayout = layout.edges.find((edge) => edge.edgeId === "early-return");

  assert.equal(layout.nodes.length, blocks.length);
  assert.equal(layout.edges.length, edges.length);
  assert.ok(entryNode && conditionNode && trueNode && falseNode && repeatLayout && longReturnLayout);
  assert.ok(conditionNode.rank > entryNode.rank);
  assert.equal(trueNode.rank, falseNode.rank);
  assert.notEqual(trueNode.x, falseNode.x);
  assert.equal(repeatLayout.route, "back");
  assert.equal(longReturnLayout.route, "long");
  assert.equal(repeatLayout.points.length, 4);
  assert.ok(repeatLayout.points[1]?.x > Math.max(...layout.nodes.map((node) => node.x + node.width)));
  assertNoNodeOverlap(layout.nodes);
  assert.deepEqual(createFunctionLogicGraphLayout(blocks, edges), layout);
});

test("returns an empty finite canvas for an unavailable function body", () => {
  assert.deepEqual(createFunctionLogicGraphLayout([], []), {
    width: 0,
    height: 0,
    nodes: [],
    edges: []
  });
});

test("keeps a maximum-size linear function iterative and finite", () => {
  const blocks = Array.from({ length: 300 }, (_, index) =>
    createBlock(`block-${index}`, index === 0 ? "entry" : index === 299 ? "exit" : "operation", `step ${index}`)
  );
  const edges = Array.from({ length: 299 }, (_, index) =>
    createEdge(`edge-${index}`, `block-${index}`, `block-${index + 1}`, "next")
  );
  const layout = createFunctionLogicGraphLayout(blocks, edges);

  assert.equal(layout.nodes.length, 300);
  assert.equal(layout.edges.length, 299);
  assert.ok(Number.isFinite(layout.width) && layout.width > 0);
  assert.ok(Number.isFinite(layout.height) && layout.height > 0);
  assert.ok(layout.edges.every((edge) =>
    edge.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
  ));
});

/** Creates a small branch-merge-loop fixture in source presentation order. */
function createBlocks(): FunctionLogicBlockPayload[] {
  return [
    createBlock("entry", "entry", "Enter handler"),
    createBlock("condition", "condition", "if order.valid"),
    createBlock("true-call", "call", "validate(order)", "true"),
    createBlock("false-call", "effect", "repository.save(order)", "false"),
    createBlock("loop", "loop", "while pending.length"),
    createBlock("mutation", "mutation", "pending.shift()", "iterate"),
    createBlock("exit", "exit", "Exit handler")
  ];
}

/** Creates forward branch edges plus one explicit loop back edge. */
function createEdges(): FunctionLogicEdgePayload[] {
  return [
    createEdge("entry-condition", "entry", "condition", "next"),
    createEdge("true", "condition", "true-call", "true"),
    createEdge("false", "condition", "false-call", "false"),
    createEdge("true-merge", "true-call", "loop", "next"),
    createEdge("early-return", "true-call", "exit", "return"),
    createEdge("false-merge", "false-call", "loop", "next"),
    createEdge("iterate", "loop", "mutation", "iterate"),
    createEdge("leave", "loop", "exit", "exit"),
    createEdge("repeat", "mutation", "loop", "repeat")
  ];
}

/** Creates one display-safe logic block without source authority. */
function createBlock(
  id: string,
  kind: FunctionLogicBlockPayload["kind"],
  label: string,
  branchLabel?: string
): FunctionLogicBlockPayload {
  return {
    id,
    kind,
    label,
    detail: label,
    depth: branchLabel ? 2 : 1,
    branchLabel,
    confidence: kind === "effect" ? "inferred" : "exact"
  };
}

/** Creates one exact structured transfer. */
function createEdge(
  id: string,
  sourceId: string,
  targetId: string,
  kind: FunctionLogicEdgePayload["kind"]
): FunctionLogicEdgePayload {
  return { id, sourceId, targetId, kind, label: kind, confidence: "exact" };
}

/** Ensures fixed-size nodes never collide within a graph rank. */
function assertNoNodeOverlap(
  nodes: ReturnType<typeof createFunctionLogicGraphLayout>["nodes"]
): void {
  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      const left = nodes[leftIndex];
      const right = nodes[rightIndex];
      const overlaps = left.x < right.x + right.width
        && left.x + left.width > right.x
        && left.y < right.y + right.height
        && left.y + left.height > right.y;
      assert.equal(overlaps, false, `${left.blockId} overlaps ${right.blockId}`);
    }
  }
}
