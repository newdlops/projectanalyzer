/**
 * Unit tests for the analyzer pipeline. The fixture verifies that TypeScript AST
 * symbols are normalized into file, class, method, and function graph nodes.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { AnalyzerPipeline } from "../../analyzer/core/analyzerPipeline";
import type { WorkspaceFileSystem } from "../../analyzer/core/workspaceScanner";
import { TypeScriptAnalyzer } from "../../analyzer/languages/typescript";
import { createContentHash } from "../../shared/hash";
import type { SourceFile } from "../../shared/types";

test("AnalyzerPipeline builds file and TypeScript symbol nodes", async () => {
  const content = [
    "export class Service {",
    "  public run(): void {",
    "    helper();",
    "  }",
    "}",
    "",
    "function helper(): void {}"
  ].join("\n");
  const file = createTestSourceFile("/workspace/src/service.ts", content);
  const pipeline = new AnalyzerPipeline(new TestWorkspaceFileSystem([file]), [
    new TypeScriptAnalyzer()
  ]);

  const result = await pipeline.analyzeWorkspace();
  const nodesByName = new Map(result.graph.nodes.map((node) => [node.name, node]));
  const classNode = nodesByName.get("Service");
  const methodNode = nodesByName.get("run");
  const helperNode = nodesByName.get("helper");

  assert.equal(result.graph.metadata.fileCount, 1);
  assert.equal(result.graph.nodes.some((node) => node.kind === "file"), true);
  assert.equal(classNode?.kind, "class");
  assert.equal(methodNode?.kind, "method");
  assert.equal(helperNode?.kind, "function");
  assert.equal(methodNode?.parentId, classNode?.id);
  assert.equal(result.graph.edges.filter((edge) => edge.kind === "contains").length >= 3, true);
});

test("AnalyzerPipeline builds TypeScript file import edges", async () => {
  const files = [
    createTestSourceFile("/workspace/src/main.ts", [
      "import { service } from './service';",
      "service();"
    ].join("\n")),
    createTestSourceFile("/workspace/src/service.ts", [
      "export { helper } from './util';",
      "export function service(): void {}"
    ].join("\n")),
    createTestSourceFile("/workspace/src/util.ts", "export function helper(): void {}")
  ];
  const pipeline = new AnalyzerPipeline(new TestWorkspaceFileSystem(files), [
    new TypeScriptAnalyzer()
  ]);

  const result = await pipeline.analyzeWorkspace();
  const fileNodesByPath = new Map(
    result.graph.nodes
      .filter((node) => node.kind === "file")
      .map((node) => [node.filePath, node])
  );
  const mainNode = fileNodesByPath.get("/workspace/src/main.ts");
  const serviceNode = fileNodesByPath.get("/workspace/src/service.ts");
  const utilNode = fileNodesByPath.get("/workspace/src/util.ts");
  const importEdge = result.graph.edges.find((edge) =>
    edge.kind === "imports" &&
    edge.sourceId === mainNode?.id &&
    edge.targetId === serviceNode?.id
  );
  const exportEdge = result.graph.edges.find((edge) =>
    edge.kind === "exports" &&
    edge.sourceId === serviceNode?.id &&
    edge.targetId === utilNode?.id
  );

  assert.ok(importEdge);
  assert.equal(importEdge.confidence, "resolved");
  assert.equal(importEdge.metadata?.moduleSpecifier, "./service");
  assert.ok(exportEdge);
});

/**
 * Minimal workspace file system port for analyzer pipeline tests.
 */
class TestWorkspaceFileSystem implements WorkspaceFileSystem {
  public constructor(private readonly files: SourceFile[]) {}

  /**
   * Returns the fixture workspace root.
   */
  public getWorkspaceRoot(): string {
    return "/workspace";
  }

  /**
   * Returns the fixture source files.
   */
  public async findSourceFiles(): Promise<SourceFile[]> {
    return this.files;
  }
}

/**
 * Creates a TypeScript source file fixture.
 */
function createTestSourceFile(path: string, content: string): SourceFile {
  return {
    path,
    languageId: "typescript",
    content,
    sizeBytes: Buffer.byteLength(content, "utf8"),
    contentHash: createContentHash(content)
  };
}
