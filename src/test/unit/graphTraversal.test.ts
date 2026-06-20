/**
 * Unit tests for iterative graph traversal. The fixture includes a cycle so the
 * visited set behavior is covered from the first scaffold.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyProjectGraph } from "../../graph/emptyGraph";
import { InMemoryGraphStore } from "../../graph/graphStore";
import { traverseGraph } from "../../graph/graphTraversal";
import type { GraphEdge, SymbolNode } from "../../shared/types";

test("traverseGraph expands callees with a depth limit and cycle guard", () => {
  const store = new InMemoryGraphStore(createEmptyProjectGraph("/workspace"));
  const nodes = [
    createTestNode("a"),
    createTestNode("b"),
    createTestNode("c")
  ];
  const edges = [
    createTestEdge("a-b", "a", "b"),
    createTestEdge("b-c", "b", "c"),
    createTestEdge("c-a", "c", "a")
  ];

  for (const node of nodes) {
    store.addNode(node);
  }

  for (const edge of edges) {
    store.addEdge(edge);
  }

  const result = traverseGraph(store, {
    rootNodeId: "a",
    direction: "outgoing",
    maxDepth: 2,
    edgeKinds: ["calls"]
  });

  assert.deepEqual(
    result.nodes.map((node) => node.id),
    ["a", "b", "c"]
  );
  assert.deepEqual(
    result.edges.map((edge) => edge.id),
    ["a-b", "b-c"]
  );
});

/**
 * Creates a minimal symbol node for traversal tests.
 */
function createTestNode(id: string): SymbolNode {
  return {
    id,
    kind: "function",
    name: id,
    qualifiedName: id,
    filePath: "/workspace/test.ts",
    language: "typescript",
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
    }
  };
}

/**
 * Creates a minimal calls edge for traversal tests.
 */
function createTestEdge(id: string, sourceId: string, targetId: string): GraphEdge {
  return {
    id,
    kind: "calls",
    sourceId,
    targetId,
    filePath: "/workspace/test.ts",
    confidence: "exact"
  };
}
