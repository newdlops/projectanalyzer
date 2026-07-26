/**
 * Value-flow routing tests cover sequential use hops, branch preservation,
 * bounded cyclic traversal, semantic fallback, and quadratic SVG geometry.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  createFunctionLogicValueFlowHopPath,
  createFunctionLogicValueFlowHops,
  getFunctionLogicValueFlowRoutingBrowserSource,
  type FunctionLogicValueFlowRoute
} from "../../webview/codeFlow/dataFlow";

test("replaces long definition-to-use rays with declaration-use-sink hops", () => {
  const flows = [
    createFlow("definition", "consume-1", "consume"),
    createFlow("definition", "consume-2", "consume"),
    createFlow("definition", "sink", "sink")
  ];
  const hops = createFunctionLogicValueFlowHops(flows, [
    { sourceId: "definition", targetId: "consume-1" },
    { sourceId: "consume-1", targetId: "consume-2" },
    { sourceId: "consume-2", targetId: "sink" }
  ]);

  assert.deepEqual(hops.map((hop) => [
    hop.sourceBlockId,
    hop.targetBlockId,
    hop.targetUsage
  ]), [
    ["definition", "consume-1", "consume"],
    ["consume-1", "consume-2", "consume"],
    ["consume-2", "sink", "sink"]
  ]);
});

test("keeps branch uses separate and reconnects both branches at their join", () => {
  const flows = [
    createFlow("definition", "left-use", "consume"),
    createFlow("definition", "right-use", "consume"),
    createFlow("definition", "joined-sink", "sink")
  ];
  const hops = createFunctionLogicValueFlowHops(flows, [
    { sourceId: "definition", targetId: "left-use" },
    { sourceId: "definition", targetId: "right-use" },
    { sourceId: "left-use", targetId: "joined-sink" },
    { sourceId: "right-use", targetId: "joined-sink" }
  ]);
  const endpoints = hops.map((hop) => `${hop.sourceBlockId}->${hop.targetBlockId}`);

  assert.deepEqual(endpoints, [
    "definition->left-use",
    "definition->right-use",
    "left-use->joined-sink",
    "right-use->joined-sink"
  ]);
  assert.ok(!endpoints.includes("left-use->right-use"));
  assert.ok(!endpoints.includes("right-use->left-use"));
});

test("terminates cyclic control flow and honors the explicit hop bound", () => {
  const flows = [
    createFlow("definition", "loop-use-1", "consume"),
    createFlow("definition", "loop-use-2", "sink")
  ];
  const hops = createFunctionLogicValueFlowHops(flows, [
    { sourceId: "definition", targetId: "loop-use-1" },
    { sourceId: "loop-use-1", targetId: "loop-use-2" },
    { sourceId: "loop-use-2", targetId: "loop-use-1" }
  ], 20, 2);

  assert.equal(hops.length, 2);
  assert.equal(new Set(hops.map((hop) => hop.id)).size, 2);
});

test("falls back to the semantic source when a pruned graph has no control path", () => {
  const hops = createFunctionLogicValueFlowHops([
    createFlow("hidden-definition", "visible-sink", "sink")
  ], []);

  assert.deepEqual(hops.map((hop) => [hop.sourceBlockId, hop.targetBlockId]), [
    ["hidden-definition", "visible-sink"]
  ]);
});

test("routes vertical, horizontal, and same-node hops as true quadratic curves", () => {
  const verticalSource = { blockId: "source", x: 100, y: 10, width: 120, height: 60 };
  const verticalTarget = { blockId: "target", x: 100, y: 210, width: 120, height: 60 };
  const horizontalTarget = { blockId: "side", x: 420, y: 10, width: 120, height: 60 };
  const rightCurve = createFunctionLogicValueFlowHopPath(verticalSource, verticalTarget, 0);
  const leftCurve = createFunctionLogicValueFlowHopPath(verticalSource, verticalTarget, 1);
  const horizontalCurve = createFunctionLogicValueFlowHopPath(
    verticalSource,
    horizontalTarget,
    0
  );
  const selfCurve = createFunctionLogicValueFlowHopPath(verticalSource, verticalSource, 0);

  for (const path of [rightCurve, leftCurve, horizontalCurve, selfCurve]) {
    assert.match(path, /^M [-\d.]+ [-\d.]+ Q [-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+$/u);
    assert.doesNotMatch(path, /\sC\s/u);
  }
  assert.notEqual(rightCurve, leftCurve);
});

test("serializes the tested hop planner and quadratic geometry for the Webview", () => {
  const source = getFunctionLogicValueFlowRoutingBrowserSource();

  assert.match(source, /function createFunctionLogicValueFlowHops/u);
  assert.match(source, /while \(cursor < pending\.length\)/u);
  assert.match(source, /new Set\(\[targetBlockId\]\)/u);
  assert.match(source, /function createFunctionLogicValueFlowHopPath/u);
  assert.match(source, / Q /u);
});

/** Creates one semantic definition-to-use relation for concise fixtures. */
function createFlow(
  sourceBlockId: string,
  targetBlockId: string,
  targetUsage: "consume" | "sink"
): FunctionLogicValueFlowRoute {
  return {
    id: `flow:${sourceBlockId}:${targetBlockId}:${targetUsage}`,
    bindingId: "binding:order",
    sourceBlockId,
    targetBlockId,
    targetAccess: "read",
    targetUsage,
    confidence: "exact"
  };
}
