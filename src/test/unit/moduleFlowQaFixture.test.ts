/**
 * End-to-end guard for the committed Module Flow desktop-QA source workspace.
 * It sends the exact fixture source snapshots through Rust's stdin manifest
 * path, then verifies the bounded TypeScript projection without graph fixtures.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { ModuleFlowProjectionService } from "../../application/moduleFlow";
import { createWorkspaceSourceManifest } from "../../analyzer/rust/workspaceSourceManifest";
import type { ModuleFlowFunctionNodePayload } from "../../protocol/moduleFlow";
import type { ProjectGraph, SourceFile } from "../../shared/types";

const projectRoot = resolve(__dirname, "../../..");
const fixtureRoot = resolve(projectRoot, "src/test/fixtures/moduleFlowQaWorkspace");
const engineManifest = resolve(projectRoot, "engine/analyzer/Cargo.toml");
const SNAPSHOT = "module-flow-qa-fixture-v1";

test("committed multi-package workspace completes an expandable bounded Module Flow", () => {
  const graph = analyzeFixtureWorkspace();
  assert.deepEqual(
    graph.metadata.projectPackageRoots?.map((root) => root.rootPath).sort(),
    ["apps/console", "packages/contracts", "packages/core"]
  );

  const projection = new ModuleFlowProjectionService({
    createSourceToken: () => undefined,
    createEvidenceToken: () => undefined
  });
  projection.activate(SNAPSHOT, graph);
  const scene = projection.projectList({
    graphVersion: SNAPSHOT,
    requestId: 1,
    mode: "execution",
    moduleLimit: 8,
    edgeLimit: 16,
    includeExternal: false,
    includeInferred: true
  });

  assert.ok(scene.nodes.length >= 3, "expected all manifest-backed modules in the bounded scene");
  assert.ok(scene.nodes.length <= 8);
  assert.ok(scene.edges.length > 0, "expected cross-module execution/dependency evidence");
  const expandable = scene.nodes.find((node) => node.expandable.boundaryFunctions);
  assert.ok(expandable, "expected a module with an expandable boundary-function path");

  const expansion = projection.projectExpansion({
    graphVersion: SNAPSHOT,
    requestId: 2,
    moduleId: expandable.id,
    expansion: "boundaryFunctions",
    direction: "both",
    nodeLimit: 8,
    edgeLimit: 16
  });
  assert.ok(expansion);
  assert.ok(expansion.nodes.some((node): node is ModuleFlowFunctionNodePayload => node.kind === "function"));
});

/** Reads only the fixture TypeScript sources that the fixture settings include. */
function readFixtureSources(): SourceFile[] {
  const paths = collectTypeScriptPaths(fixtureRoot);
  return paths.map((path) => {
    const content = readFileSync(path, "utf8");
    return {
      path,
      languageId: "typescript",
      content,
      sizeBytes: Buffer.byteLength(content, "utf8"),
      contentHash: "module-flow-qa-fixture"
    };
  });
}

/** Performs an iterative directory walk so fixture selection remains explicit. */
function collectTypeScriptPaths(root: string): string[] {
  const paths: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) continue;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile() && path.endsWith(".ts")) paths.push(path);
    }
  }
  return paths.sort();
}

/** Invokes Rust through the same source-manifest stdin protocol as the extension. */
function analyzeFixtureWorkspace(): ProjectGraph {
  const childEnvironment = { ...process.env };
  // Local debugger/port-manager injection must not change the native analyzer contract.
  delete childEnvironment.DYLD_INSERT_LIBRARIES;
  const output = execFileSync(
    "cargo",
    [
      "run",
      "--quiet",
      "--manifest-path",
      engineManifest,
      "--",
      "analyze-workspace",
      "--workspace",
      fixtureRoot,
      "--source-manifest-stdin",
      "--max-file-size-kb",
      "1024"
    ],
    {
      cwd: projectRoot,
      encoding: "utf8",
      env: childEnvironment,
      input: createWorkspaceSourceManifest(readFixtureSources()),
      maxBuffer: 20 * 1024 * 1024
    }
  );
  return JSON.parse(output) as ProjectGraph;
}
