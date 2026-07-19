/** Unit tests for aggregate Module Flow Webview scene resource budgets. */

import assert from "node:assert/strict";
import test from "node:test";
import {
  ModuleFlowExpansionStore,
  type ModuleFlowExpansionScene
} from "../../webview/moduleVisualizer/moduleFlowExpansionStore";

/** Creates one compact expansion with stable structural identities. */
function expansion(
  nodeIds: readonly string[],
  edgeIds: readonly string[],
  replacedEdgeIds: readonly string[] = []
): ModuleFlowExpansionScene {
  return {
    nodes: nodeIds.map((id) => ({ id })),
    edges: edgeIds.map((id) => ({ id })),
    replacedEdgeIds
  };
}

test("evicts oldest expansions when the complete merged canvas reaches its budget", () => {
  const store = new ModuleFlowExpansionStore<ModuleFlowExpansionScene>(4, 4);
  const baseNodes = new Map([["base", {}]]);
  const baseEdges = new Map([["base-edge", {}]]);

  assert.equal(
    store.retain("first", expansion(["a", "b"], ["ea", "eb"]), baseNodes.keys(), baseEdges.keys()).accepted,
    true
  );
  const second = store.retain(
    "second",
    expansion(["c", "d"], ["ec", "ed"]),
    baseNodes.keys(),
    baseEdges.keys()
  );

  assert.equal(second.accepted, true);
  assert.deepEqual(second.evictedKeys, ["first"]);
  assert.equal(second.nodeCount, 3);
  assert.equal(second.edgeCount, 3);
  assert.equal(store.has("first"), false);
  assert.equal(store.has("second"), true);
});

test("counts duplicate identities and replaced base edges exactly", () => {
  const store = new ModuleFlowExpansionStore<ModuleFlowExpansionScene>(3, 2);
  const result = store.retain(
    "branch",
    expansion(["base", "child"], ["replacement"], ["base-edge"]),
    ["base"],
    ["base-edge"]
  );

  assert.deepEqual(result, {
    accepted: true,
    evictedKeys: [],
    nodeCount: 2,
    edgeCount: 1
  });
});

test("rejects an incoming branch that cannot fit with the base scene alone", () => {
  const store = new ModuleFlowExpansionStore<ModuleFlowExpansionScene>(2, 2);
  const result = store.retain(
    "oversized",
    expansion(["a", "b"], ["ea", "eb"]),
    ["base"],
    ["base-edge"]
  );

  assert.equal(result.accepted, false);
  assert.equal(store.size, 0);
  assert.equal(result.nodeCount, 1);
  assert.equal(result.edgeCount, 1);
});

test("deleting and clearing branches releases their payload references", () => {
  const store = new ModuleFlowExpansionStore<ModuleFlowExpansionScene>(10, 10);
  store.retain("one", expansion(["a"], ["ea"]), [], []);
  store.retain("two", expansion(["b"], ["eb"]), [], []);

  assert.equal(store.delete("one"), true);
  assert.deepEqual([...store.keys()], ["two"]);
  store.clear();
  assert.equal(store.size, 0);
  assert.deepEqual([...store.values()], []);
});
