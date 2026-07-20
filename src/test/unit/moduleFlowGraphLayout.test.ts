/**
 * Module Flow layout tests cover SCC grouping, canonical ordering, complete
 * text measurement, obstacle-free orthogonal routes, browser parity, and an
 * iterative large-graph path that would overflow a recursive implementation.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  createModuleFlowGraphLayout,
  getModuleFlowGraphLayoutBrowserSource,
  type ModuleFlowGraphEdgeInput,
  type ModuleFlowGraphLayout,
  type ModuleFlowGraphNodeInput
} from "../../application/moduleFlow/moduleFlowGraphLayout";

test("groups a dependency cycle and gives every cycle edge a unique outer track", () => {
  const nodes = ["entry", "a", "b", "c", "exit"].map(createNode);
  const edges = [
    createEdge("entry-a", "entry", "a"),
    createEdge("a-b", "a", "b"),
    createEdge("b-c", "b", "c"),
    createEdge("c-a", "c", "a"),
    createEdge("c-exit", "c", "exit")
  ];
  const layout = createModuleFlowGraphLayout(nodes, edges);
  const nodesById = new Map(layout.nodes.map((node) => [node.nodeId, node]));
  const cycleGroup = layout.cycleGroups[0];
  const cycleEdges = layout.edges.filter((edge) => edge.route === "cycle");

  assert.ok(cycleGroup);
  assert.deepEqual(cycleGroup.nodeIds, ["a", "b", "c"]);
  assert.equal(cycleEdges.length, 3);
  assert.equal(new Set(cycleEdges.map((edge) => edge.outerTrack)).size, 3);
  assert.ok(requireNode(nodesById, "entry").rank < requireNode(nodesById, "a").rank);
  assert.ok(requireNode(nodesById, "a").rank < requireNode(nodesById, "exit").rank);
  for (const nodeId of cycleGroup.nodeIds) {
    const node = requireNode(nodesById, nodeId);
    assert.ok(node.x >= cycleGroup.x && node.x + node.width <= cycleGroup.x + cycleGroup.width);
    assert.ok(node.y >= cycleGroup.y && node.y + node.height <= cycleGroup.y + cycleGroup.height);
  }
  const contentRight = Math.max(...layout.nodes.map((node) => node.x + node.width));
  for (const edge of cycleEdges) {
    assert.ok(Math.max(...edge.points.map((point) => point.x)) > contentRight);
  }
  assertNoNodeOverlap(layout.nodes);
  assertEdgesAvoidUnrelatedNodes(layout, edges);
});

test("produces identical geometry for reversed and duplicate input order", () => {
  const nodes = [
    createNode("root"),
    createNode("left"),
    createNode("right"),
    createNode("sink"),
    { ...createNode("left"), title: "Z duplicate presentation" }
  ];
  const edges = [
    createEdge("root-left", "root", "left"),
    createEdge("root-right", "root", "right"),
    createEdge("left-sink", "left", "sink"),
    createEdge("right-sink", "right", "sink"),
    { ...createEdge("root-left", "right", "sink"), label: "duplicate id" }
  ];

  const forward = createModuleFlowGraphLayout(nodes, edges);
  const reversed = createModuleFlowGraphLayout([...nodes].reverse(), [...edges].reverse());

  assert.deepEqual(reversed, forward);
  assert.equal(forward.nodes.length, 4);
  assert.equal(forward.edges.length, 4);
  assertNoNodeOverlap(forward.nodes);
  assertEdgesAvoidUnrelatedNodes(forward, edges.filter((_, index) => index < 4));
});

test("grows node height for complete long labels, details, metrics, and badges", () => {
  const sharedPrefix = "resolve workspace ownership and aggregate boundary evidence ".repeat(5);
  const shortNode: ModuleFlowGraphNodeInput = {
    ...createNode("short"),
    title: sharedPrefix,
    badges: ["typescript", "exact"],
    metricLines: ["12 files · 44 callables"],
    detailLines: ["src/features/orders"]
  };
  const longNode: ModuleFlowGraphNodeInput = {
    ...createNode("long"),
    title: `${sharedPrefix}${"without dropping source-backed context ".repeat(18)}title-tail`,
    subtitle: `${"Cross-module execution evidence ".repeat(12)}subtitle-tail`,
    badges: [
      `${"framework-boundary-".repeat(16)}badge-tail`,
      "inferred"
    ],
    metricLines: Array.from({ length: 12 }, (_, index) =>
      `metric ${index}: ${"complete evidence count ".repeat(4)}metric-tail-${index}`
    ),
    detailLines: Array.from({ length: 14 }, (_, index) =>
      `detail ${index}: ${"workspace relative source path ".repeat(5)}detail-tail-${index}`
    )
  };
  const shortLayout = createModuleFlowGraphLayout([shortNode], []);
  const longLayout = createModuleFlowGraphLayout([longNode], []);
  const shortGeometry = shortLayout.nodes[0];
  const longGeometry = longLayout.nodes[0];

  assert.ok(shortGeometry && longGeometry);
  assert.ok(longGeometry.width >= shortGeometry.width);
  assert.ok(longGeometry.height > shortGeometry.height + 700);
  assert.ok(longGeometry.height < longLayout.height);
});

test("routes diamond and long-forward edges outside every unrelated node box", () => {
  const nodes = ["entry", "left", "right", "merge", "tail"].map(createNode);
  const edges = [
    createEdge("entry-left", "entry", "left"),
    createEdge("entry-right", "entry", "right"),
    createEdge("left-merge", "left", "merge"),
    createEdge("right-merge", "right", "merge"),
    createEdge("merge-tail", "merge", "tail"),
    createEdge("entry-tail", "entry", "tail")
  ];
  const layout = createModuleFlowGraphLayout(nodes, edges);
  const longEdge = layout.edges.find((edge) => edge.edgeId === "entry-tail");

  assert.ok(longEdge);
  assert.equal(longEdge.route, "long");
  assert.equal(typeof longEdge.outerTrack, "number");
  assert.equal(longEdge.bridges?.length, 2);
  assert.equal(
    longEdge.bridges?.reduce((count, bridge) => count + bridge.crossingCount, 0),
    2
  );
  assertNoNodeOverlap(layout.nodes);
  assertEdgesAvoidUnrelatedNodes(layout, edges);
});

test("exports the same self-contained layout implementation for a browser script", () => {
  const nodes = ["root", "service", "store"].map(createNode);
  const edges = [
    createEdge("root-service", "root", "service"),
    createEdge("service-store", "service", "store"),
    createEdge("store-service", "store", "service")
  ];
  const source = getModuleFlowGraphLayoutBrowserSource();
  const browserLayout = new Function(
    `${source}\nreturn createModuleFlowGraphLayout;`
  )() as typeof createModuleFlowGraphLayout;

  assert.match(source, /function createModuleFlowSccIndex/u);
  assert.match(source, /function routeModuleFlowGraphEdges/u);
  assert.match(source, /function createModuleFlowEdgeBridges/u);
  assert.match(source, /function createModuleFlowGraphLayout/u);
  assert.deepEqual(browserLayout(nodes, edges), createModuleFlowGraphLayout(nodes, edges));
});

test("lays out a large dependency chain iteratively", () => {
  const nodeCount = 6_000;
  const nodes = Array.from({ length: nodeCount }, (_, index) =>
    createNode(`node-${index.toString().padStart(5, "0")}`)
  );
  const edges = Array.from({ length: nodeCount - 1 }, (_, index) =>
    createEdge(
      `edge-${index.toString().padStart(5, "0")}`,
      nodes[index].id,
      nodes[index + 1].id
    )
  );

  const layout = createModuleFlowGraphLayout(nodes, edges);

  assert.equal(layout.nodes.length, nodeCount);
  assert.equal(layout.edges.length, nodeCount - 1);
  assert.equal(layout.cycleGroups.length, 0);
  assert.equal(layout.nodes[0]?.rank, 0);
  assert.equal(layout.nodes.at(-1)?.rank, nodeCount - 1);
  assert.ok(Number.isFinite(layout.width));
  assert.ok(Number.isFinite(layout.height));
});

/** Creates a concise presentation node with a stable identity. */
function createNode(id: string): ModuleFlowGraphNodeInput {
  return {
    id,
    kind: "module",
    title: id,
    subtitle: `Module ${id}`,
    badges: ["typescript"],
    metricLines: ["1 file · 1 callable"],
    detailLines: [`src/${id}`]
  };
}

/** Creates one exact directed presentation edge. */
function createEdge(id: string, sourceId: string, targetId: string): ModuleFlowGraphEdgeInput {
  return { id, sourceId, targetId, kind: "execution", label: "calls" };
}

/** Requires one positioned identity without weakening later assertions. */
function requireNode(
  nodesById: ReadonlyMap<string, ModuleFlowGraphLayout["nodes"][number]>,
  nodeId: string
): ModuleFlowGraphLayout["nodes"][number] {
  const node = nodesById.get(nodeId);
  assert.ok(node, `missing layout node ${nodeId}`);
  return node;
}

/** Ensures variable-size node rectangles never collide. */
function assertNoNodeOverlap(nodes: ModuleFlowGraphLayout["nodes"]): void {
  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      const left = nodes[leftIndex];
      const right = nodes[rightIndex];
      const overlaps = left.x < right.x + right.width
        && left.x + left.width > right.x
        && left.y < right.y + right.height
        && left.y + left.height > right.y;
      assert.equal(overlaps, false, `${left.nodeId} overlaps ${right.nodeId}`);
    }
  }
}

/** Ensures routed orthogonal segments avoid every non-endpoint box. */
function assertEdgesAvoidUnrelatedNodes(
  layout: ModuleFlowGraphLayout,
  edges: readonly ModuleFlowGraphEdgeInput[]
): void {
  const edgeById = new Map(edges.map((edge) => [edge.id, edge]));
  for (const routedEdge of layout.edges) {
    const edge = edgeById.get(routedEdge.edgeId);
    assert.ok(edge, `missing input edge ${routedEdge.edgeId}`);
    for (const point of routedEdge.points) {
      assert.ok(point.x >= 0 && point.x <= layout.width, `${routedEdge.edgeId} exceeds width`);
      assert.ok(point.y >= 0 && point.y <= layout.height, `${routedEdge.edgeId} exceeds height`);
    }
    for (let index = 1; index < routedEdge.points.length; index += 1) {
      const start = routedEdge.points[index - 1];
      const end = routedEdge.points[index];
      assert.ok(start.x === end.x || start.y === end.y, `${routedEdge.edgeId} is not orthogonal`);
      for (const node of layout.nodes) {
        if (node.nodeId === edge.sourceId || node.nodeId === edge.targetId) {
          continue;
        }
        assert.equal(
          segmentCrossesNodeInterior(start, end, node),
          false,
          `${routedEdge.edgeId} crosses ${node.nodeId}`
        );
      }
    }
  }
}

/** Detects an axis-aligned segment crossing the open interior of one node. */
function segmentCrossesNodeInterior(
  start: { x: number; y: number },
  end: { x: number; y: number },
  node: ModuleFlowGraphLayout["nodes"][number]
): boolean {
  const nodeRight = node.x + node.width;
  const nodeBottom = node.y + node.height;
  if (start.x === end.x) {
    return start.x > node.x
      && start.x < nodeRight
      && Math.max(start.y, end.y) > node.y
      && Math.min(start.y, end.y) < nodeBottom;
  }
  return start.y > node.y
    && start.y < nodeBottom
    && Math.max(start.x, end.x) > node.x
    && Math.min(start.x, end.x) < nodeRight;
}
