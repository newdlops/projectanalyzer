/**
 * Current-function graph adaptation tests. They verify analyzed-node reuse and
 * exact AST-backed augmentation, including anonymous Function Logic analysis.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeFunctionLogic,
  findFunctionAtPosition,
  type FunctionCursorTarget
} from "../../analyzer/functionLogic";
import { resolveCurrentFunctionGraph } from "../../extension/currentFunctionVisualization/currentFunctionGraph";
import type { ProjectGraph, SymbolNode } from "../../shared/types";

test("reuses an analyzed callable anchored to the same source selection", () => {
  const target = createTarget("run", 4, 11);
  const analyzedNode = createNode("method", "run", 4, 11);
  const graph = createGraph([createFileNode(), analyzedNode]);
  const resolution = resolveCurrentFunctionGraph(graph, target);

  assert.equal(resolution.graph, graph);
  assert.equal(resolution.node, analyzedNode);
  assert.equal(resolution.augmented, false);
});

test("adds an exact callable when analysis only modeled a non-callable property", () => {
  const target = createTarget("handler", 2, 8);
  const property = createNode("property", "handler", 2, 8);
  const graph = createGraph([createFileNode(), property]);
  const resolution = resolveCurrentFunctionGraph(graph, target);

  assert.equal(resolution.augmented, true);
  assert.equal(resolution.graph.nodes.length, 3);
  assert.equal(resolution.node.kind, "function");
  assert.equal(resolution.node.metadata?.cursorResolved, true);
  assert.equal(resolution.node.parentId, "file:source");
  assert.ok(resolution.graph.edges.some((edge) =>
    edge.kind === "contains" && edge.targetId === resolution.node.id
  ));
  assert.equal(resolution.graph.metadata.symbolCount, 2);
  assert.equal(resolution.graph.metadata.edgeCount, 1);
});

test("an anonymous cursor node can drive Function Logic by exact source position", () => {
  const source = [
    "export function collect(items: number[]) {",
    "  return items.map((item) => {",
    "    if (item < 0) throw new Error('negative');",
    "    return item * 2;",
    "  });",
    "}"
  ].join("\n");
  const target = findFunctionAtPosition({
    filePath: "/workspace/source.ts",
    languageId: "typescript",
    sourceText: source,
    position: { line: 2, character: 8 }
  });
  assert.ok(target);
  const resolution = resolveCurrentFunctionGraph(createGraph([createFileNode()]), target);
  const analysis = analyzeFunctionLogic({
    functionNode: resolution.node,
    sourceText: source
  });

  assert.equal(resolution.node.metadata?.anonymous, true);
  assert.deepEqual(analysis.blocks.map((block) => block.kind), [
    "entry",
    "condition",
    "throw",
    "return",
    "exit"
  ]);
  assert.equal(analysis.gaps.some((gap) => gap.code === "functionNotFound"), false);
});

/** Creates one exact editor target for analyzed-node matching tests. */
function createTarget(name: string, line: number, character: number): FunctionCursorTarget {
  const selectionRange = {
    startLine: line,
    startCharacter: character,
    endLine: line,
    endCharacter: character + name.length
  };
  return {
    kind: "function",
    name,
    qualifiedName: name,
    filePath: "/workspace/source.ts",
    language: "typescript",
    range: selectionRange,
    selectionRange,
    anonymous: false
  };
}

/** Creates a graph node with the selection identity used by the cursor adapter. */
function createNode(
  kind: SymbolNode["kind"],
  name: string,
  line: number,
  character: number
): SymbolNode {
  const selectionRange = {
    startLine: line,
    startCharacter: character,
    endLine: line,
    endCharacter: character + name.length
  };
  return {
    id: `${kind}:${name}`,
    kind,
    name,
    qualifiedName: name,
    filePath: "/workspace/source.ts",
    range: selectionRange,
    selectionRange,
    language: "typescript",
    parentId: "file:source"
  };
}

/** Creates the source file node that owns cursor-synthesized callables. */
function createFileNode(): SymbolNode {
  const range = { startLine: 0, startCharacter: 0, endLine: 20, endCharacter: 0 };
  return {
    id: "file:source",
    kind: "file",
    name: "source.ts",
    qualifiedName: "source.ts",
    filePath: "/workspace/source.ts",
    range,
    selectionRange: range,
    language: "typescript"
  };
}

/** Creates the smallest valid graph fixture needed by CodeFlow projections. */
function createGraph(nodes: SymbolNode[]): ProjectGraph {
  return {
    workspaceRoot: "/workspace",
    version: "1",
    generatedAt: "2026-07-19T00:00:00.000Z",
    nodes,
    edges: [],
    diagnostics: [],
    metadata: {
      languages: ["typescript"],
      fileCount: 1,
      symbolCount: nodes.filter((node) => node.kind !== "file").length,
      edgeCount: 0
    }
  };
}
