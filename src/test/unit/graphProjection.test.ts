/**
 * Unit tests for graph payload projection before data crosses into the Webview.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { projectGraphForView, summarizeFileImportGraph } from "../../webview/graphProjection";
import type { GraphEdge, ProjectGraph, SourceRange, SymbolKind, SymbolNode } from "../../shared/types";

const emptyRange: SourceRange = {
  startLine: 0,
  startCharacter: 0,
  endLine: 0,
  endCharacter: 0
};

test("projectGraphForView keeps only file import graph data in file mode", () => {
  const graph = createProjectionFixture();
  const projected = projectGraphForView(graph, "file");

  assert.deepEqual(projected.nodes.map((node) => node.id).sort(), ["file-a", "file-b"]);
  assert.deepEqual(projected.edges.map((edge) => edge.kind), ["imports"]);
  assert.equal(projected.metadata.symbolCount, 2);
  assert.equal(projected.metadata.edgeCount, 1);
});

test("projectGraphForView keeps source containers and call edges in call mode", () => {
  const graph = createProjectionFixture();
  const projected = projectGraphForView(graph, "call");

  assert.deepEqual(projected.nodes.map((node) => node.id).sort(), [
    "file-a",
    "file-b",
    "function-a",
    "function-b"
  ]);
  assert.deepEqual(projected.edges.map((edge) => edge.kind).sort(), ["calls", "contains", "contains"]);
});

test("summarizeFileImportGraph reports entry roots and import coverage", () => {
  const graph = createProjectionFixture();

  assert.deepEqual(summarizeFileImportGraph(graph), {
    applicationEntrypoints: 1,
    applicationEntrypointFiles: ["a.ts"],
    entryRoots: 1,
    entryRootDirectories: [{ count: 1, path: "." }],
    fileNodes: 2,
    importedFiles: 1,
    importerFiles: 1,
    importEdges: 1
  });
});

test("summarizeFileImportGraph separates app entrypoints from many import roots", () => {
  const graph = createProjectionFixture([
    createNode("main", "file", "main.tsx", "/workspace/apps/web/src/main.tsx"),
    createNode("app", "file", "app.tsx", "/workspace/apps/web/src/app.tsx"),
    createNode("page-a", "file", "page-a.tsx", "/workspace/apps/web/src/legal/example-page/page-a.tsx"),
    createNode("story", "file", "button.stories.tsx", "/workspace/apps/web/stories/button.stories.tsx")
  ], [
    createEdge("imports", "main", "app"),
    createEdge("imports", "page-a", "app"),
    createEdge("imports", "story", "app")
  ]);

  const summary = summarizeFileImportGraph(graph);

  assert.equal(summary.entryRoots, 3);
  assert.deepEqual(summary.applicationEntrypointFiles, ["apps/web/src/main.tsx"]);
  assert.equal(summary.applicationEntrypoints, 1);
});

function createProjectionFixture(
  nodes: SymbolNode[] = [
    createNode("file-a", "file", "a.ts", "/workspace/a.ts"),
    createNode("file-b", "file", "b.ts", "/workspace/b.ts"),
    createNode("function-a", "function", "a", "/workspace/a.ts"),
    createNode("function-b", "function", "b", "/workspace/b.ts"),
    createNode("class-a", "class", "A", "/workspace/a.ts")
  ],
  edges: GraphEdge[] = [
    createEdge("imports", "file-a", "file-b"),
    createEdge("contains", "file-a", "function-a"),
    createEdge("contains", "file-b", "function-b"),
    createEdge("contains", "file-a", "class-a"),
    createEdge("calls", "function-a", "function-b"),
    createEdge("extends", "class-a", "function-b")
  ]
): ProjectGraph {
  return {
    workspaceRoot: "/workspace",
    version: "test",
    generatedAt: "2026-06-20T00:00:00.000Z",
    nodes,
    edges,
    diagnostics: [],
    metadata: {
      languages: ["typescript"],
      fileCount: 2,
      symbolCount: nodes.length,
      edgeCount: edges.length
    }
  };
}

function createNode(id: string, kind: SymbolKind, name: string, filePath: string): SymbolNode {
  return {
    id,
    kind,
    name,
    qualifiedName: name,
    filePath,
    range: emptyRange,
    selectionRange: emptyRange,
    language: "typescript"
  };
}

function createEdge(kind: GraphEdge["kind"], sourceId: string, targetId: string): GraphEdge {
  return {
    id: `${kind}:${sourceId}:${targetId}`,
    kind,
    sourceId,
    targetId,
    filePath: "/workspace/a.ts",
    confidence: "exact"
  };
}
