/**
 * Unit tests for directional Module Flow focus filtering, including sibling
 * exclusion, cycles, depth limits, duplicate routes, and unresolved endpoints.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  createModuleFlowLineageScene,
  getModuleFlowLineageFocusBrowserSource,
  type ModuleFlowLineageEdge,
  type ModuleFlowLineageNode
} from "../../webview/moduleVisualizer/moduleFlowLineageFocus";

/** Creates one stable node payload. */
function node(id: string): ModuleFlowLineageNode {
  return { id };
}

/** Creates one stable directed edge payload. */
function edge(id: string, sourceId: string, targetId: string): ModuleFlowLineageEdge {
  return { id, sourceId, targetId };
}

/** Creates identity-indexed maps matching the browser scene contract. */
function scene(
  nodeIds: readonly string[],
  edges: readonly ModuleFlowLineageEdge[]
): {
  nodes: Map<string, ModuleFlowLineageNode>;
  edges: Map<string, ModuleFlowLineageEdge>;
} {
  return {
    nodes: new Map(nodeIds.map((id) => [id, node(id)])),
    edges: new Map(edges.map((value) => [value.id, value]))
  };
}

test("retains directed ancestors and descendants without leaking sibling branches", () => {
  const graph = scene(
    ["root", "focus", "child", "sink", "sibling", "unrelated"],
    [
      edge("root-focus", "root", "focus"),
      edge("root-sibling", "root", "sibling"),
      edge("focus-child", "focus", "child"),
      edge("child-sink", "child", "sink"),
      edge("sibling-sink", "sibling", "sink")
    ]
  );

  const focused = createModuleFlowLineageScene(
    graph.nodes,
    graph.edges,
    "focus",
    graph.nodes.size - 1
  );

  assert.deepEqual([...focused.nodes.keys()], ["root", "focus", "child", "sink"]);
  assert.deepEqual([...focused.edges.keys()], ["root-focus", "focus-child", "child-sink"]);
});

test("bounds cyclic lineage independently in each direction", () => {
  const graph = scene(
    ["grand-parent", "parent", "focus", "child", "grand-child"],
    [
      edge("grand-parent-parent", "grand-parent", "parent"),
      edge("parent-focus", "parent", "focus"),
      edge("focus-child", "focus", "child"),
      edge("child-focus", "child", "focus"),
      edge("focus-child-duplicate", "focus", "child"),
      edge("child-grand-child", "child", "grand-child"),
      edge("unresolved-source", "missing", "focus"),
      edge("unresolved-target", "focus", "missing")
    ]
  );

  const focused = createModuleFlowLineageScene(graph.nodes, graph.edges, "focus", 1);

  assert.deepEqual([...focused.nodes.keys()], ["parent", "focus", "child"]);
  assert.deepEqual([...focused.edges.keys()], [
    "parent-focus",
    "focus-child",
    "child-focus",
    "focus-child-duplicate"
  ]);
});

test("returns an empty bounded scene for a stale anchor", () => {
  const graph = scene(["a", "b"], [edge("a-b", "a", "b")]);
  const focused = createModuleFlowLineageScene(graph.nodes, graph.edges, "missing", 2);

  assert.equal(focused.nodes.size, 0);
  assert.equal(focused.edges.size, 0);
});

test("serializes a dependency-free iterative browser traversal", () => {
  const source = getModuleFlowLineageFocusBrowserSource();

  assert.match(source, /function createModuleFlowLineageScene\(/u);
  assert.match(source, /while \(cursor < queue\.length\)/u);
  assert.match(source, /current\.depth >= boundedDepth/u);
  assert.equal(source.match(/createModuleFlowLineageScene/gu)?.length, 1);
  assert.doesNotThrow(() => new Function(source));
});
