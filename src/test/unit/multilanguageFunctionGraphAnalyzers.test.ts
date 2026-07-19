/**
 * Python/Java graph-adapter tests. They verify callable symbols, lexical calls,
 * cross-file Java resolution, and file-only Rust graph supplementation.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { PythonAnalyzer } from "../../analyzer/languages/python";
import { JavaAnalyzer } from "../../analyzer/languages/java";
import { mergeSupplementalLanguageGraph } from "../../analyzer/rust/supplementalLanguageGraph";
import { createContentHash } from "../../shared/hash";
import type { ProjectGraph, SourceFile } from "../../shared/types";

test("Python fallback extracts methods and resolves a self call", async () => {
  const file = createSourceFile("/workspace/service.py", "python", [
    "class Service:",
    "    def helper(self, value):",
    "        return value",
    "",
    "    def run(self, value):",
    "        return self.helper(value)"
  ].join("\n"));
  const analyzer = new PythonAnalyzer();
  const parsed = await analyzer.parse(file);
  const symbols = await analyzer.extractSymbols(parsed);
  const edges = await analyzer.extractEdges(parsed, {
    sourceFiles: [file],
    workspaceRoot: "/workspace"
  });

  assert.ok(symbols.some((node) =>
    node.kind === "class" && node.qualifiedName === "Service"
  ));
  const helper = symbols.find((node) => node.qualifiedName === "Service.helper");
  const run = symbols.find((node) => node.qualifiedName === "Service.run");
  assert.ok(helper && run);
  assert.ok(edges.some((edge) =>
    edge.kind === "calls"
      && edge.sourceId === run.id
      && edge.targetId === helper.id
      && edge.confidence === "resolved"
  ));
});

test("Java fallback resolves owner, constructor, and unique workspace calls", async () => {
  const service = createSourceFile("/workspace/Service.java", "java", [
    "class Service {",
    "  Service() {}",
    "  int helper(int value) { return value; }",
    "  int run(int value) { return helper(value); }",
    "}"
  ].join("\n"));
  const application = createSourceFile("/workspace/Application.java", "java", [
    "class Application {",
    "  int start(int value) {",
    "    Service service = new Service();",
    "    return service.run(value);",
    "  }",
    "}"
  ].join("\n"));
  const analyzer = new JavaAnalyzer();
  const parsedService = await analyzer.parse(service);
  const parsedApplication = await analyzer.parse(application);
  const context = {
    sourceFiles: [service, application],
    workspaceRoot: "/workspace"
  };
  const symbols = [
    ...await analyzer.extractSymbols(parsedService),
    ...await analyzer.extractSymbols(parsedApplication)
  ];
  const edges = [
    ...await analyzer.extractEdges(parsedService, context),
    ...await analyzer.extractEdges(parsedApplication, context)
  ];
  const byName = new Map(symbols.map((node) => [node.qualifiedName, node]));
  const helper = byName.get("Service.helper");
  const run = byName.get("Service.run");
  const constructor = byName.get("Service.Service");
  const start = byName.get("Application.start");
  assert.ok(helper && run && constructor && start);
  assert.ok(edges.some((edge) =>
    edge.sourceId === run.id && edge.targetId === helper.id && edge.confidence === "resolved"
  ));
  assert.ok(edges.some((edge) =>
    edge.sourceId === start.id && edge.targetId === constructor.id
  ));
  assert.ok(edges.some((edge) =>
    edge.sourceId === start.id && edge.targetId === run.id && edge.confidence === "inferred"
  ));
});

test("nested lambdas retain their Python and Java lexical class owners", async () => {
  const pythonFile = createSourceFile("/workspace/callbacks.py", "python", [
    "class Service:",
    "    def helper(self, value):",
    "        return value",
    "",
    "    def run(self):",
    "        callback = lambda value: self.helper(value)",
    "        return callback",
    "",
    "class Other:",
    "    def helper(self, value):",
    "        return value"
  ].join("\n"));
  const javaFile = createSourceFile("/workspace/Callbacks.java", "java", [
    "class Service {",
    "  int helper(int value) { return value; }",
    "  Object run() {",
    "    Function<Integer, Integer> callback = value -> this.helper(value);",
    "    return callback;",
    "  }",
    "}",
    "class Other { int helper(int value) { return value; } }"
  ].join("\n"));
  const python = new PythonAnalyzer();
  const java = new JavaAnalyzer();
  const parsedPython = await python.parse(pythonFile);
  const parsedJava = await java.parse(javaFile);
  const pythonSymbols = await python.extractSymbols(parsedPython);
  const javaSymbols = await java.extractSymbols(parsedJava);
  const pythonEdges = await python.extractEdges(parsedPython, {
    sourceFiles: [pythonFile],
    workspaceRoot: "/workspace"
  });
  const javaEdges = await java.extractEdges(parsedJava, {
    sourceFiles: [javaFile],
    workspaceRoot: "/workspace"
  });

  assertLexicalLambdaOwner(pythonSymbols, pythonEdges, "Service.run.callback", "Service.helper");
  assertLexicalLambdaOwner(javaSymbols, javaEdges, "Service.run.callback", "Service.helper");
});

test("supplement merge adds only selected-language nodes and edges", () => {
  const base = createGraph([createFileNode("/workspace/App.java", "java")], []);
  const javaMethod = {
    ...createFileNode("/workspace/App.java", "java"),
    id: "java-method",
    kind: "method" as const,
    name: "run",
    qualifiedName: "App.run",
    parentId: "file::/workspace/App.java"
  };
  const typescriptMethod = {
    ...javaMethod,
    id: "typescript-method",
    filePath: "/workspace/app.ts",
    language: "typescript",
    qualifiedName: "App.start"
  };
  const supplemental = createGraph(
    [createFileNode("/workspace/App.java", "java"), javaMethod, typescriptMethod],
    [{
      id: "java-contains",
      kind: "contains",
      sourceId: "file::/workspace/App.java",
      targetId: javaMethod.id,
      filePath: "/workspace/App.java",
      confidence: "exact"
    }, {
      id: "typescript-edge",
      kind: "calls",
      sourceId: typescriptMethod.id,
      targetId: javaMethod.id,
      filePath: "/workspace/app.ts",
      confidence: "inferred"
    }]
  );
  const merged = mergeSupplementalLanguageGraph(base, supplemental, new Set(["java"]));

  assert.ok(merged.nodes.some((node) => node.id === javaMethod.id));
  assert.ok(!merged.nodes.some((node) => node.id === typescriptMethod.id));
  assert.ok(merged.edges.some((edge) => edge.id === "java-contains"));
  assert.ok(!merged.edges.some((edge) => edge.id === "typescript-edge"));
});

/** Creates one immutable analyzer source fixture. */
function createSourceFile(path: string, languageId: string, content: string): SourceFile {
  return {
    path,
    languageId,
    content,
    sizeBytes: Buffer.byteLength(content, "utf8"),
    contentHash: createContentHash(content)
  };
}

/** Creates one file node with stable ranges for graph-merge fixtures. */
function createFileNode(filePath: string, language: string) {
  const range = { startLine: 0, startCharacter: 0, endLine: 5, endCharacter: 0 };
  return {
    id: `file::${filePath}`,
    kind: "file" as const,
    name: filePath.split("/").at(-1) ?? filePath,
    qualifiedName: filePath,
    filePath,
    range,
    selectionRange: range,
    language
  };
}

/** Creates the smallest graph shape required by the pure supplement merger. */
function createGraph(
  nodes: ProjectGraph["nodes"],
  edges: ProjectGraph["edges"]
): ProjectGraph {
  return {
    workspaceRoot: "/workspace",
    version: "test",
    generatedAt: "2026-07-19T00:00:00.000Z",
    nodes,
    edges,
    diagnostics: [],
    metadata: {
      languages: [...new Set(nodes.map((node) => node.language))],
      fileCount: nodes.filter((node) => node.kind === "file").length,
      symbolCount: nodes.length,
      edgeCount: edges.length
    }
  };
}

/** Verifies that one lambda's instance-member call selects its lexical type. */
function assertLexicalLambdaOwner(
  nodes: ProjectGraph["nodes"],
  edges: ProjectGraph["edges"],
  callerName: string,
  targetName: string
): void {
  const caller = nodes.find((node) => node.qualifiedName === callerName);
  const target = nodes.find((node) => node.qualifiedName === targetName);
  assert.ok(caller && target);
  assert.ok(edges.some((edge) =>
    edge.sourceId === caller.id
      && edge.targetId === target.id
      && edge.confidence === "resolved"
  ));
}
