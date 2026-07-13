/**
 * Unit tests for projecting change-impact results into JSON-safe Function
 * Explorer rows without fabricating unavailable graph-edge evidence.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  CHANGE_IMPACT_ROWS_ROOT_ID,
  createChangeImpactRows
} from "../../application/functionExplorer/changeImpactRows";
import type { ChangeImpactAnalysis } from "../../insights/changeImpact";
import type { ProjectGraph, SourceRange, SymbolNode } from "../../shared/types";

test("projects a selected summary and flat handler-navigable affected routes", () => {
  const graph = createGraph([
    createNode("target", "UserRepository.save", "repository.ts", 20),
    createNode("handler", "postUser", "routes.ts", 5)
  ]);
  const analysis = createAnalysis({
    affectedFlows: [{
      flowId: "flow:post-user",
      entrypointKind: "httpRoute",
      entrypointUnitId: "route:post-user",
      routeUnitId: "route:post-user",
      framework: "FastAPI",
      name: "POST /users",
      handlerFunctionId: "handler",
      impactDepth: 2,
      pathFunctionIds: ["handler", "service", "target"],
      confidence: "inferred"
    }],
    summary: {
      callerCount: 2,
      directCallerCount: 1,
      indirectCallerCount: 1,
      affectedFlowCount: 1,
      truncated: false
    }
  });

  const rows = createChangeImpactRows(graph, analysis);
  const summary = rows[0];
  const route = rows[1];

  assert.equal(summary?.id, CHANGE_IMPACT_ROWS_ROOT_ID);
  assert.equal(summary?.sectionId, "selected");
  assert.equal(summary?.symbolId, "target");
  assert.match(summary?.detail ?? "", /1 affected entrypoints/);
  assert.equal(route?.relation, "entrypointPath");
  assert.equal(route?.symbolId, "handler");
  assert.equal(route?.functionId, "handler");
  assert.equal(route?.confidence, "inferred");
  assert.equal(route?.edgeIds, undefined);
  assert.deepEqual(route?.metadata?.pathFunctionIds, ["handler", "service", "target"]);
  assert.equal(route?.metadata?.impactDepth, 2);
  assert.equal(route?.metadata?.confidence, "inferred");
  assert.doesNotThrow(() => JSON.stringify(rows));
});

test("shows bounded traversal diagnostics with deterministic omission metadata", () => {
  const graph = createGraph([createNode("target", "save", "model.ts", 10)]);
  const analysis = createAnalysis({
    diagnostics: [{
      reason: "depthLimit",
      message: "Callers of service exceed max depth 1",
      sourceFunctionId: "service",
      omittedFunctionIds: ["handler-b", "handler-a"],
      limit: 1
    }],
    summary: {
      callerCount: 1,
      directCallerCount: 1,
      indirectCallerCount: 0,
      affectedFlowCount: 0,
      truncated: true
    }
  });

  const rows = createChangeImpactRows(graph, analysis);
  const diagnostic = rows[1];

  assert.equal(rows[0]?.confidence, "unresolved");
  assert.equal(diagnostic?.kind, "diagnostic");
  assert.equal(diagnostic?.label, "Impact depth limit reached");
  assert.equal(diagnostic?.metadata?.limit, 1);
  assert.deepEqual(diagnostic?.metadata?.omittedFunctionIds, ["handler-b", "handler-a"]);
});

test("projects affected GraphQL operations as resolver entrypoints", () => {
  const graph = createGraph([
    createNode("target", "UserService.load", "service.ts", 20),
    createNode("resolver", "UserResolver.user", "resolvers.ts", 5)
  ]);
  const analysis = createAnalysis({
    affectedFlows: [{
      flowId: "graphql:user",
      entrypointKind: "graphqlOperation",
      entrypointUnitId: "graphql:user",
      framework: "GraphQL",
      name: "user",
      handlerFunctionId: "resolver",
      impactDepth: 1,
      pathFunctionIds: ["resolver", "target"],
      confidence: "exact"
    }],
    summary: {
      callerCount: 1,
      directCallerCount: 1,
      indirectCallerCount: 0,
      affectedFlowCount: 1,
      truncated: false
    }
  });
  const operation = createChangeImpactRows(graph, analysis)[1];

  assert.equal(operation?.role, "resolver");
  assert.equal(operation?.metadata?.entrypointKind, "graphqlOperation");
  assert.equal(operation?.metadata?.routeUnitId, null);
});

/** Creates one complete result while allowing test-specific projections. */
function createAnalysis(
  overrides: Partial<ChangeImpactAnalysis> & Pick<ChangeImpactAnalysis, "summary">
): ChangeImpactAnalysis {
  return {
    graphVersion: "impact-rows-test",
    targetFunctionId: "target",
    targetFound: true,
    callers: [],
    directCallers: [],
    indirectCallers: [],
    affectedFlows: [],
    diagnostics: [],
    ...overrides
  };
}

/** Creates a compact graph containing only symbols needed for navigation. */
function createGraph(nodes: SymbolNode[]): ProjectGraph {
  return {
    workspaceRoot: "/workspace",
    version: "impact-rows-test",
    generatedAt: "2026-07-13T00:00:00.000Z",
    nodes,
    edges: [],
    diagnostics: [],
    metadata: {
      languages: ["typescript"],
      fileCount: nodes.length,
      symbolCount: nodes.length,
      edgeCount: 0
    }
  };
}

/** Creates one concrete function symbol at a stable source location. */
function createNode(id: string, qualifiedName: string, fileName: string, line: number): SymbolNode {
  const range = createRange(line);

  return {
    id,
    kind: "function",
    name: qualifiedName.split(".").pop() ?? qualifiedName,
    qualifiedName,
    filePath: `/workspace/src/${fileName}`,
    range,
    selectionRange: range,
    language: "typescript"
  };
}

/** Creates a compact single-line source range. */
function createRange(line: number): SourceRange {
  return {
    startLine: line,
    startCharacter: 0,
    endLine: line,
    endCharacter: 1
  };
}
