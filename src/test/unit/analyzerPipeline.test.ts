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
  const file: SourceFile = {
    path: "/workspace/src/service.ts",
    languageId: "typescript",
    content,
    sizeBytes: Buffer.byteLength(content, "utf8"),
    contentHash: createContentHash(content)
  };
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
