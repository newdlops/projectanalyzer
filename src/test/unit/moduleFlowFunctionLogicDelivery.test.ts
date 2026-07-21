/**
 * Host-delivery tests for source-backed Function Logic inside Module Flow. The
 * fixture exercises issued-card authorization, analyzer reuse, edge budgets,
 * and opaque statement evidence without loading VS Code.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { ModuleFlowProjectionService } from "../../application/moduleFlow";
import type { ModuleFlowFunctionNodePayload } from "../../protocol/moduleFlow";
import type { ProjectGraph, SourceRange } from "../../shared/types";
import { CodeFlowEvidenceTokenRegistry } from "../../webview/codeFlow";
import { ModuleFlowFunctionLogicDelivery } from "../../webview/moduleVisualizer/moduleFlowFunctionLogicDelivery";
import { WebviewGraphDelivery } from "../../webview/sidebarGraphDelivery";
import { SourceNodeTokenRegistry } from "../../webview/sourceNavigation";

const RANGE: SourceRange = {
  startLine: 0,
  startCharacter: 0,
  endLine: 5,
  endCharacter: 1
};

test("projects bounded function logic for an issued same-canvas function card", async () => {
  const graph = createGraph();
  const graphDelivery = new WebviewGraphDelivery();
  const activation = graphDelivery.activate(graph);
  const sourceNodeTokens = new SourceNodeTokenRegistry();
  const evidenceTokens = new CodeFlowEvidenceTokenRegistry();
  sourceNodeTokens.activate(activation.snapshot.version, graph);
  evidenceTokens.activate(activation.snapshot.version, graph);
  const projection = new ModuleFlowProjectionService({
    createSourceToken: (nodeId) => sourceNodeTokens.createToken(nodeId),
    createEvidenceToken: () => undefined
  });
  projection.activate(activation.snapshot.version, graph);
  const scene = projection.projectList({
    graphVersion: activation.snapshot.version,
    requestId: 1,
    mode: "execution",
    moduleLimit: 8,
    edgeLimit: 8
  });
  const module = scene.nodes.find((node) => node.expandable.boundaryFunctions);
  assert.ok(module);
  const functions = projection.projectExpansion({
    graphVersion: activation.snapshot.version,
    requestId: 2,
    moduleId: module.id,
    expansion: "boundaryFunctions",
    direction: "both",
    nodeLimit: 4,
    edgeLimit: 8
  });
  assert.ok(functions);
  const functionNode = functions.nodes.find((node): node is ModuleFlowFunctionNodePayload =>
    node.kind === "function"
  );
  assert.ok(functionNode);

  const delivery = new ModuleFlowFunctionLogicDelivery({
    graphDelivery,
    projection,
    sourceNodeTokens,
    evidenceTokens,
    readSourceText: async () => [
      "export function processOrder(approved: boolean) {",
      "  const state = approved ? 'ready' : 'held';",
      "  if (state === 'ready') notify(state);",
      "  return state;",
      "}",
      ""
    ].join("\n")
  });
  const payload = await delivery.project({
    graphVersion: activation.snapshot.version,
    requestId: 3,
    functionId: functionNode.id,
    blockLimit: 12,
    edgeLimit: 1
  });

  assert.ok(payload);
  assert.equal(payload.anchorFunctionId, functionNode.id);
  assert.equal(payload.requestId, 3);
  assert.ok(payload.logic.blocks.length <= 12);
  assert.ok(payload.logic.edges.length <= 1);
  assert.ok(payload.logic.layout.edges.length <= 1);
  assert.equal(
    payload.summary.visibleEdgeCount + payload.summary.omittedEdgeCount > 1,
    true
  );
  assert.ok(payload.logic.blocks.some((block) =>
    /^code-evidence:[0-9a-f]{64}$/u.test(block.evidenceToken ?? "")
  ));

  delivery.clear();
});

test("rejects a canvas function identity that was never issued", async () => {
  const graph = createGraph();
  const graphDelivery = new WebviewGraphDelivery();
  const activation = graphDelivery.activate(graph);
  const sourceNodeTokens = new SourceNodeTokenRegistry();
  const evidenceTokens = new CodeFlowEvidenceTokenRegistry();
  sourceNodeTokens.activate(activation.snapshot.version, graph);
  evidenceTokens.activate(activation.snapshot.version, graph);
  const projection = new ModuleFlowProjectionService({
    createSourceToken: (nodeId) => sourceNodeTokens.createToken(nodeId),
    createEvidenceToken: () => undefined
  });
  projection.activate(activation.snapshot.version, graph);
  const delivery = new ModuleFlowFunctionLogicDelivery({
    graphDelivery,
    projection,
    sourceNodeTokens,
    evidenceTokens,
    readSourceText: async () => ""
  });

  const payload = await delivery.project({
    graphVersion: activation.snapshot.version,
    requestId: 4,
    functionId: "module-flow-function:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    blockLimit: 4,
    edgeLimit: 4
  });
  assert.equal(payload, undefined);
});

/** Creates one workspace package containing a source-backed callable. */
function createGraph(): ProjectGraph {
  const filePath = "/workspace/src/orders.ts";
  return {
    workspaceRoot: "/workspace",
    version: "module-flow-function-logic-v1",
    generatedAt: "2026-07-21T00:00:00.000Z",
    nodes: [{
      id: "file:orders",
      kind: "file",
      name: "orders.ts",
      qualifiedName: "src/orders.ts",
      filePath,
      range: RANGE,
      selectionRange: RANGE,
      language: "typescript"
    }, {
      id: "function:processOrder",
      kind: "function",
      name: "processOrder",
      qualifiedName: "processOrder",
      filePath,
      range: RANGE,
      selectionRange: {
        startLine: 0,
        startCharacter: 16,
        endLine: 0,
        endCharacter: 28
      },
      language: "typescript"
    }],
    edges: [],
    diagnostics: [],
    metadata: {
      languages: ["typescript"],
      projectPackageRoots: [{
        rootPath: ".",
        manifestPaths: ["package.json"],
        ecosystems: ["javascript"]
      }],
      fileCount: 1,
      symbolCount: 2,
      edgeCount: 0
    }
  };
}
