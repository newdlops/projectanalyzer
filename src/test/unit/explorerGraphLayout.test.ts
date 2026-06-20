/**
 * Unit tests for the graph browser scene layout. These tests keep core visual
 * decisions deterministic without needing a VS Code Webview runtime.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createGraphScene } from "../../webview/explorerGraphLayout";
import type { GraphEdge, ProjectGraph, SymbolNode } from "../../shared/types";

test("createGraphScene places callers left and callees right of a selected call node", () => {
  const graph = createLayoutGraph([
    createTestNode("caller"),
    createTestNode("root"),
    createTestNode("callee")
  ], [
    createCallEdge("caller-root", "caller", "root"),
    createCallEdge("root-callee", "root", "callee")
  ]);

  const scene = createGraphScene(graph, {
    mode: "call",
    query: "",
    selectedNodeId: "root",
    maxNodes: 10,
    width: 320,
    height: 220
  });
  const root = requireSceneNode(scene, "root");
  const caller = requireSceneNode(scene, "caller");
  const callee = requireSceneNode(scene, "callee");

  assert.equal(scene.edges.length, 2);
  assert.ok(caller.x < root.x);
  assert.ok(callee.x > root.x);
});

test("createGraphScene keeps the selected node inside a capped scene", () => {
  const graph = createLayoutGraph([
    createTestNode("a"),
    createTestNode("b"),
    createTestNode("selected")
  ], [
    createCallEdge("a-b", "a", "b")
  ]);

  const scene = createGraphScene(graph, {
    mode: "call",
    query: "",
    selectedNodeId: "selected",
    maxNodes: 1,
    width: 320,
    height: 220
  });

  assert.deepEqual(scene.nodes.map((node) => node.id), ["selected"]);
  assert.equal(scene.selectionInScene, true);
  assert.equal(scene.omittedNodeCount, 2);
});

test("createGraphScene layers unselected directed graphs instead of stacking one column", () => {
  const graph = createLayoutGraph([
    createTestNode("entry"),
    createTestNode("service"),
    createTestNode("repo"),
    createTestNode("view")
  ], [
    createCallEdge("entry-service", "entry", "service"),
    createCallEdge("service-repo", "service", "repo"),
    createCallEdge("entry-view", "entry", "view")
  ]);

  const scene = createGraphScene(graph, {
    mode: "call",
    query: "",
    maxNodes: 10,
    width: 960,
    height: 560
  });
  const entry = requireSceneNode(scene, "entry");
  const service = requireSceneNode(scene, "service");
  const repo = requireSceneNode(scene, "repo");
  const uniqueColumns = new Set(scene.nodes.map((node) => Math.round(node.x)));

  assert.ok(uniqueColumns.size >= 3);
  assert.ok(entry.x < service.x);
  assert.ok(service.x < repo.x);
  assert.ok(scene.edges.every((edge) => edge.path.startsWith("M ")));
});

/**
 * Creates a minimal graph payload for layout tests.
 */
function createLayoutGraph(nodes: SymbolNode[], edges: GraphEdge[]): ProjectGraph {
  return {
    workspaceRoot: "/workspace",
    version: "test",
    generatedAt: "2026-06-20T00:00:00.000Z",
    nodes,
    edges,
    diagnostics: [],
    metadata: {
      languages: ["typescript"],
      fileCount: 1,
      symbolCount: nodes.length,
      edgeCount: edges.length
    }
  };
}

/**
 * Creates a function node suitable for call graph layout tests.
 */
function createTestNode(id: string): SymbolNode {
  return {
    id,
    kind: "function",
    name: id,
    qualifiedName: id,
    filePath: "/workspace/test.ts",
    range: {
      startLine: 0,
      startCharacter: 0,
      endLine: 0,
      endCharacter: 1
    },
    selectionRange: {
      startLine: 0,
      startCharacter: 0,
      endLine: 0,
      endCharacter: 1
    },
    language: "typescript"
  };
}

/**
 * Creates a minimal calls edge suitable for layout tests.
 */
function createCallEdge(id: string, sourceId: string, targetId: string): GraphEdge {
  return {
    id,
    kind: "calls",
    sourceId,
    targetId,
    filePath: "/workspace/test.ts",
    confidence: "exact"
  };
}

/**
 * Returns a scene node by ID or fails the test with a useful message.
 */
function requireSceneNode(
  scene: ReturnType<typeof createGraphScene>,
  nodeId: string
): { x: number; y: number } {
  const node = scene.nodes.find((candidate) => candidate.id === nodeId);

  assert.ok(node, `missing scene node ${nodeId}`);
  return node;
}
