/**
 * Application projection tests for the selected-function Logic Reader. They
 * verify opaque block/evidence identities, source-safe locations, and origins.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { analyzeFunctionLogic } from "../../analyzer/functionLogic";
import { createFunctionLogicCodeFlowDetail } from "../../application/codeFlow";
import type { CodeFlowEvidenceToken } from "../../protocol/functionLogic";
import type { SourceNodeToken } from "../../protocol/sourceNavigation";
import { createContentHash } from "../../shared/hash";
import type { SymbolNode } from "../../shared/types";
import {
  createFlowIndex,
  createGraph,
  createMappedFlow
} from "./helpers/projectReadingGuideFixtures";

test("projects internal logic with opaque evidence and known entrypoint origins", () => {
  const filePath = "/workspace/src/orders.ts";
  const node = createHandlerNode(filePath);
  const graph = createGraph({ files: [filePath], callables: [node] });
  const flow = createMappedFlow("GET /orders", "Express", "/workspace", "httpRoute", undefined);
  const analysis = analyzeFunctionLogic({
    functionNode: node,
    sourceText: [
      "export function handler(order: Order) {",
      "  if (!order.valid) return false;",
      "  order.status = 'saving';",
      "  repository.save(order);",
      "  return true;",
      "}"
    ].join("\n")
  });
  const detail = createFunctionLogicCodeFlowDetail(
    graph,
    createFlowIndex(graph.version, [flow]),
    node,
    analysis,
    "sidebar-snapshot:logic:1",
    (path, range) => `code-evidence:${createContentHash(`${path}:${range.startLine}`)}` as CodeFlowEvidenceToken,
    (nodeId) => `source-node:${createContentHash(nodeId)}` as SourceNodeToken
  );

  assert.equal(detail.kind, "functionLogic");
  assert.equal(detail.steps.length, 0);
  assert.equal(detail.logic?.blocks.length, analysis.blocks.length);
  assert.ok(detail.logic?.blocks.some((block) => block.kind === "condition"));
  assert.ok(detail.logic?.blocks.some((block) => block.kind === "effect"));
  assert.deepEqual(
    detail.logic?.blocks.flatMap((block) => block.valueChanges ?? [])[0],
    {
      target: "order.status",
      targetKind: "property",
      operation: "assign",
      operator: "=",
      value: "'saving'",
      confidence: "exact"
    }
  );
  assert.equal(detail.logic?.summary.valueChangeCount, 1);
  assert.ok(detail.logic?.edges.some((edge) => edge.kind === "true"));
  assert.equal(detail.logic?.layout.nodes.length, detail.logic?.blocks.length);
  assert.equal(detail.logic?.layout.edges.length, detail.logic?.edges.length);
  assert.ok((detail.logic?.layout.height ?? 0) > 0);
  assert.ok(detail.logic?.blocks.every((block) => /^function-logic-block:[0-9a-f]{32}$/u.test(block.id)));
  assert.ok(detail.logic?.blocks.every((block) => /^code-evidence:[0-9a-f]{64}$/u.test(block.evidenceToken ?? "")));
  assert.equal(detail.origins[0]?.name, "GET /orders");
  assert.deepEqual(detail.logic?.callees, []);
  assert.equal(detail.logic?.omittedCalleeCount, 0);
  assert.match(detail.subtitle, /src\/orders\.ts:1/u);
  assert.doesNotMatch(JSON.stringify(detail), /\/workspace/u);
});

test("projects complete graph-box text and sizes its node for wrapped content", () => {
  const filePath = "/workspace/src/orders.ts";
  const completeTitle = `Orders.${"CompleteNamespaceSegment.".repeat(12)}handler`;
  const node = {
    ...createHandlerNode(filePath),
    qualifiedName: completeTitle
  };
  const graph = createGraph({ files: [filePath], callables: [node] });
  const literal = `"${"complete-source-value-".repeat(22)}projection_tail"`;
  const analysis = analyzeFunctionLogic({
    functionNode: node,
    sourceText: `export function handler(order: Order) { order.snapshot = ${literal}; }`
  });
  const detail = createFunctionLogicCodeFlowDetail(
    graph,
    createFlowIndex(graph.version, []),
    node,
    analysis,
    "sidebar-snapshot:logic:complete-text",
    (path, range) => `code-evidence:${createContentHash(`${path}:${range.startLine}`)}` as CodeFlowEvidenceToken,
    (nodeId) => `source-node:${createContentHash(nodeId)}` as SourceNodeToken
  );
  const mutation = detail.logic?.blocks.find((block) => block.kind === "mutation");
  const mutationLayout = detail.logic?.layout.nodes.find((layout) =>
    layout.blockId === mutation?.id
  );
  const entry = detail.logic?.blocks.find((block) => block.kind === "entry");
  const entryLayout = detail.logic?.layout.nodes.find((layout) =>
    layout.blockId === entry?.id
  );

  assert.ok(mutation && mutationLayout && entryLayout);
  assert.equal(detail.title, completeTitle);
  assert.ok(mutation.label.endsWith(`${literal};`));
  assert.equal(mutation.valueChanges?.[0]?.value, literal);
  assert.doesNotMatch(JSON.stringify(mutation), /…/u);
  assert.ok(mutationLayout.height > entryLayout.height);
});

test("projects an inferred drill target onto an if block without a graph call edge", () => {
  const filePath = "/workspace/src/guard.ts";
  const caller = createCallableNode("run", filePath, 1);
  const helper = createCallableNode("isReady", filePath, 0);
  const graph = createGraph({ files: [filePath], callables: [caller, helper] });
  const analysis = analyzeFunctionLogic({
    functionNode: caller,
    sourceText: [
      "function isReady() { return true; }",
      "function run(",
      "  value: number",
      ") {",
      "  if (isReady()) return value;",
      "  return 0;",
      "}"
    ].join("\n")
  });
  const detail = createFunctionLogicCodeFlowDetail(
    graph,
    createFlowIndex(graph.version, []),
    caller,
    analysis,
    "sidebar-snapshot:logic:condition",
    (path, range) => `code-evidence:${createContentHash(`${path}:${range.startLine}`)}` as CodeFlowEvidenceToken,
    (nodeId) => `source-node:${createContentHash(nodeId)}` as SourceNodeToken
  );
  const condition = detail.logic?.blocks.find((block) => block.kind === "condition");

  assert.equal(condition?.drillTargets?.[0]?.qualifiedName, "isReady");
  assert.equal(condition?.drillTargets?.[0]?.confidence, "inferred");
  assert.equal(detail.logic?.callees[0]?.qualifiedName, "isReady");
});

test("remaps structural parents to opaque block IDs without relying on block order", () => {
  const filePath = "/workspace/src/nested.ts";
  const node = createCallableNode("run", filePath, 0);
  const graph = createGraph({ files: [filePath], callables: [node] });
  const analysis = analyzeFunctionLogic({
    functionNode: node,
    sourceText: [
      "function run(items) {",
      "  if (ready()) {",
      "    for (const item of items) {",
      "      consume(item);",
      "    }",
      "  }",
      "  finish();",
      "}"
    ].join("\n")
  });
  const condition = analysis.blocks.find((block) => block.kind === "condition");
  const loop = analysis.blocks.find((block) => block.kind === "loop");
  const body = analysis.blocks.find((block) => block.label.includes("consume(item)"));
  assert.ok(condition && loop && body);

  // Put both children before their owners to prove that projection resolves
  // parents from a complete identity map rather than source-order side effects.
  const reorderedAnalysis = {
    ...analysis,
    blocks: [
      body,
      loop,
      condition,
      ...analysis.blocks.filter((block) =>
        block.id !== body.id && block.id !== loop.id && block.id !== condition.id
      )
    ]
  };
  const detail = createFunctionLogicCodeFlowDetail(
    graph,
    createFlowIndex(graph.version, []),
    node,
    reorderedAnalysis,
    "sidebar-snapshot:logic:parents",
    (path, range) => `code-evidence:${createContentHash(`${path}:${range.startLine}`)}` as CodeFlowEvidenceToken,
    (nodeId) => `source-node:${createContentHash(nodeId)}` as SourceNodeToken
  );
  const projectedCondition = detail.logic?.blocks.find((block) => block.kind === "condition");
  const projectedLoop = detail.logic?.blocks.find((block) => block.kind === "loop");
  const projectedBody = detail.logic?.blocks.find((block) =>
    block.label.includes("consume(item)")
  );

  assert.ok(projectedCondition && projectedLoop && projectedBody);
  assert.equal(projectedLoop.parentBlockId, projectedCondition.id);
  assert.equal(projectedBody.parentBlockId, projectedLoop.id);
  assert.ok(/^function-logic-block:[0-9a-f]{32}$/u.test(projectedLoop.parentBlockId));
  assert.equal(JSON.stringify(detail).includes(condition.id), false);
  assert.equal(JSON.stringify(detail).includes(loop.id), false);
});

/** Creates a graph identity whose ID matches the semantic handler fixture. */
function createHandlerNode(filePath: string): SymbolNode {
  const range = { startLine: 0, startCharacter: 16, endLine: 0, endCharacter: 23 };
  return {
    id: "GET /orders:handler",
    kind: "function",
    name: "handler",
    qualifiedName: "handler",
    filePath,
    range,
    selectionRange: range,
    language: "typescript"
  };
}

/** Creates one same-file callable used by AST-only callee recovery fixtures. */
function createCallableNode(name: string, filePath: string, line: number): SymbolNode {
  const range = { startLine: line, startCharacter: 9, endLine: line, endCharacter: 9 + name.length };
  return {
    id: `function:${name}`,
    kind: "function",
    name,
    qualifiedName: name,
    filePath,
    range,
    selectionRange: range,
    language: "typescript"
  };
}
