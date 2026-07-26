/**
 * Unit tests for graph payload projection before data crosses into the Webview.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  projectGraphForSidebar,
  projectGraphForSidebarShell,
  projectGraphForView,
  summarizeFileImportGraph
} from "../../webview/graphProjection";
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

  assert.deepEqual(projected.nodes.map((node) => node.id).sort(), ["external-react", "file-a", "file-b"]);
  assert.deepEqual(projected.edges.map((edge) => edge.kind), ["imports", "imports"]);
  assert.equal(projected.metadata.symbolCount, 3);
  assert.equal(projected.metadata.edgeCount, 2);
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

test("projectGraphForView bounds transport before a large file graph reaches the Webview", () => {
  const fileCount = 2_000;
  const nodes = Array.from({ length: fileCount }, (_, index) =>
    createNode(
      `file-${index}`,
      "file",
      index === 0 ? "main.ts" : `file-${index}.ts`,
      index === 0 ? "/workspace/src/main.ts" : `/workspace/src/file-${index}.ts`
    )
  );
  const edges = Array.from({ length: fileCount - 1 }, (_, index) =>
    createEdge("imports", `file-${index}`, `file-${index + 1}`)
  );
  const graph = createProjectionFixture(nodes, edges);
  graph.metadata.fileCount = fileCount;

  const projected = projectGraphForView(graph, "file", { maxNodes: 120 });

  assert.equal(projected.nodes.length, 120);
  assert.ok(projected.nodes.some((node) => node.id === "file-0"));
  assert.equal(projected.edges.length, 119);
  assert.deepEqual(projected.metadata.visualProjection, {
    mode: "file",
    maximumNodes: 120,
    sourceNodeCount: fileCount,
    sourceEdgeCount: fileCount - 1,
    omittedNodeCount: fileCount - 120,
    omittedEdgeCount: fileCount - 120
  });
  assert.ok(Buffer.byteLength(JSON.stringify(projected), "utf8") < 100 * 1024);
});

test("bounded graph projection keeps an explicitly focused node and its neighborhood", () => {
  const nodes = Array.from({ length: 30 }, (_, index) =>
    createNode(`function-${index}`, "function", `function${index}`, "/workspace/source.ts")
  );
  const edges = Array.from({ length: nodes.length - 1 }, (_, index) =>
    createEdge("calls", `function-${index}`, `function-${index + 1}`)
  );
  const graph = createProjectionFixture(nodes, edges);

  const projected = projectGraphForView(graph, "call", {
    maxNodes: 5,
    rootNodeId: "function-20"
  });

  assert.equal(projected.nodes.length, 5);
  assert.ok(projected.nodes.some((node) => node.id === "function-20"));
  assert.ok(projected.nodes.some((node) => node.id === "function-19"));
  assert.ok(projected.nodes.some((node) => node.id === "function-21"));
});

test("bounded graph projection is stable when source arrays are reversed", () => {
  const graph = createProjectionFixture();
  const reversed = createProjectionFixture([...graph.nodes].reverse(), [...graph.edges].reverse());
  const first = projectGraphForView(graph, "file", { maxNodes: 2 });
  const second = projectGraphForView(reversed, "file", { maxNodes: 2 });

  assert.deepEqual(first.nodes.map((node) => node.id).sort(), second.nodes.map((node) => node.id).sort());
  assert.deepEqual(first.edges.map((edge) => edge.id).sort(), second.edges.map((edge) => edge.id).sort());
});

test("projectGraphForSidebar keeps callables and call edges in the Extension Host", () => {
  const graph = createProjectionFixture();
  const projected = projectGraphForSidebar(graph);

  assert.deepEqual(projected.nodes.map((node) => node.id).sort(), [
    "external-react",
    "file-a",
    "file-b"
  ]);
  assert.deepEqual(projected.edges.map((edge) => edge.kind).sort(), ["imports", "imports"]);
  assert.equal(projected.metadata.symbolCount, graph.metadata.symbolCount);
  assert.equal(projected.metadata.edgeCount, graph.metadata.edgeCount);
});

test("projectGraphForSidebar remains small when the host graph has thousands of calls", () => {
  const functionCount = 5_000;
  const fileNodes = [
    createNode("file-a", "file", "a.ts", "/workspace/a.ts"),
    createNode("file-b", "file", "b.ts", "/workspace/b.ts")
  ];
  const callableNodes = Array.from({ length: functionCount }, (_, index) =>
    createNode(`function-${index}`, "function", `function${index}`, "/workspace/a.ts")
  );
  const callEdges = Array.from({ length: functionCount - 1 }, (_, index) =>
    createEdge("calls", `function-${index}`, `function-${index + 1}`)
  );
  const graph = createProjectionFixture(
    fileNodes.concat(callableNodes),
    [createEdge("imports", "file-a", "file-b"), ...callEdges]
  );
  graph.diagnostics = Array.from({ length: 1_000 }, (_, index) => ({
    severity: "warning" as const,
    code: "analysis.warning",
    message: `warning-${index}`
  }));

  const projected = projectGraphForSidebar(graph);

  assert.deepEqual(projected.nodes.map((node) => node.id), ["file-a", "file-b"]);
  assert.deepEqual(projected.edges.map((edge) => edge.kind), ["imports"]);
  assert.deepEqual(projected.diagnostics, []);
  assert.equal(projected.metadata.symbolCount, graph.metadata.symbolCount);
  assert.ok(Buffer.byteLength(JSON.stringify(projected), "utf8") < 10 * 1024);
});

test("projectGraphForSidebarShell stays constant-size with ten thousand file imports", () => {
  const fileCount = 10_000;
  const nodes = Array.from({ length: fileCount }, (_, index) =>
    createNode(`file-${index}`, "file", `file-${index}.ts`, `/workspace/src/file-${index}.ts`)
  );
  const edges = Array.from({ length: fileCount - 1 }, (_, index) =>
    createEdge("imports", `file-${index}`, `file-${index + 1}`)
  );
  const graph = createProjectionFixture(nodes, edges);
  graph.metadata.fileCount = fileCount;
  const shell = projectGraphForSidebarShell(graph);

  assert.deepEqual(shell.nodes, []);
  assert.deepEqual(shell.edges, []);
  assert.deepEqual(shell.diagnostics, []);
  assert.equal(shell.workspaceRoot, ".");
  assert.doesNotMatch(JSON.stringify(shell), /\/workspace/u);
  assert.equal(shell.metadata.fileCount, fileCount);
  assert.ok(Buffer.byteLength(JSON.stringify(shell), "utf8") < 1024);
});

test("summarizeFileImportGraph reports entry roots and import coverage", () => {
  const graph = createProjectionFixture();

  assert.deepEqual(summarizeFileImportGraph(graph), {
    applicationEntrypoints: 1,
    applicationEntrypointFiles: ["a.ts"],
    entryRoots: 1,
    entryRootDirectories: [{ count: 1, path: "." }],
    externalImports: 1,
    fileNodes: 2,
    importedFiles: 1,
    importerFiles: 1,
    importEdges: 2
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
    createNode("class-a", "class", "A", "/workspace/a.ts"),
    createNode("external-react", "external", "react", "/workspace/a.ts")
  ],
  edges: GraphEdge[] = [
    createEdge("imports", "file-a", "file-b"),
    createEdge("imports", "file-a", "external-react"),
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
