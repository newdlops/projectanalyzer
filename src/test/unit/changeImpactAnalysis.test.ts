/**
 * Unit tests for bounded reverse-call change-impact analysis.
 *
 * Fixtures cover direct and indirect route impact, unresolved call evidence,
 * cycle guards, deterministic dedupe, and both public traversal limits.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeChangeImpact,
  type ChangeImpactAnalysis
} from "../../insights/changeImpact";
import type { SemanticFlow, SemanticFlowIndex } from "../../insights/semanticFlow";
import type {
  EdgeConfidence,
  GraphEdge,
  ProjectGraph,
  SourceRange,
  SymbolKind,
  SymbolNode
} from "../../shared/types";

test("finds direct and indirect callers plus every affected route handler", () => {
  const target = createNode("target", "saveUser", "model.ts", 50, "method");
  const service = createNode("service", "createUser", "service.ts", 30, "method");
  const indirectHandler = createNode("handler-indirect", "postUser", "routes.ts", 10);
  const directHandler = createNode("handler-direct", "putUser", "routes.ts", 20);
  const unrelatedHandler = createNode("handler-other", "health", "health.ts", 1);
  const graph = createGraph(
    [target, service, indirectHandler, directHandler, unrelatedHandler],
    [
      createEdge("service-target", service.id, target.id, "resolved"),
      createEdge("indirect-service", indirectHandler.id, service.id, "exact"),
      createEdge("direct-target", directHandler.id, target.id, "inferred")
    ]
  );
  const flowIndex = createFlowIndex(graph.version, [
    createFlow("route-target", target.id, "Target route", "exact"),
    createFlow("route-direct", directHandler.id, "Direct route", "exact"),
    createFlow("route-indirect", indirectHandler.id, "Indirect route", "inferred"),
    createFlow("route-other", unrelatedHandler.id, "Other route", "exact"),
    createFlow("route-unresolved-handler", service.id, "Unresolved handler route", "unresolved", "unresolved")
  ]);

  const impact = analyzeChangeImpact(graph, flowIndex, target.id);

  assert.deepEqual(impact.directCallers.map((caller) => caller.functionId), [directHandler.id, service.id]);
  assert.deepEqual(impact.indirectCallers.map((caller) => caller.functionId), [indirectHandler.id]);
  assert.deepEqual(impact.callers.map((caller) => caller.depth), [1, 1, 2]);
  assert.deepEqual(
    impact.indirectCallers[0]?.pathFunctionIds,
    [indirectHandler.id, service.id, target.id]
  );
  assert.equal(impact.indirectCallers[0]?.confidence, "resolved");
  assert.deepEqual(
    impact.affectedFlows.map((flow) => [flow.routeUnitId, flow.impactDepth]),
    [
      ["route-target", 0],
      ["route-direct", 1],
      ["route-indirect", 2]
    ]
  );
  assert.equal(impact.affectedFlows[1]?.confidence, "inferred");
  assert.equal(impact.affectedFlows[2]?.confidence, "inferred");
  assert.equal(
    impact.affectedFlows.some((flow) => flow.routeUnitId === "route-unresolved-handler"),
    false
  );
  assert.deepEqual(impact.summary, {
    callerCount: 3,
    directCallerCount: 2,
    indirectCallerCount: 1,
    affectedFlowCount: 3,
    truncated: false
  });
});

test("includes unresolved graph calls from concrete sources and excludes semantic or non-call edges", () => {
  const target = createNode("target", "dynamicTarget", "target.ts", 50);
  const unresolvedCaller = createNode("unresolved-caller", "invokeDynamic", "caller.ts", 10);
  const referenceSource = createNode("reference-source", "readOnly", "reference.ts", 20);
  const externalSource = createNode("external-source", "package.fn", "external.ts", 30, "external");
  const classSource = createNode("class-source", "Facade", "facade.ts", 40, "class");
  const graph = createGraph(
    [target, unresolvedCaller, referenceSource, externalSource, classSource],
    [
      createEdge("unresolved-call", unresolvedCaller.id, target.id, "unresolved"),
      createEdge("reference", referenceSource.id, target.id, "exact", "references"),
      createEdge("external-call", externalSource.id, target.id, "exact"),
      createEdge("class-call", classSource.id, target.id, "exact"),
      createEdge("missing-call", "missing-source", target.id, "unresolved")
    ],
    [{ kind: "calls", sourceId: "framework-handler", targetId: target.id, confidence: "exact" }]
  );
  const flowIndex = createFlowIndex(graph.version, [
    createFlow("route-unresolved", unresolvedCaller.id, "Dynamic route", "exact")
  ]);

  const impact = analyzeChangeImpact(graph, flowIndex, target.id);

  assert.deepEqual(impact.callers.map((caller) => caller.functionId), [unresolvedCaller.id]);
  assert.equal(impact.callers[0]?.edgeConfidence, "unresolved");
  assert.equal(impact.callers[0]?.confidence, "unresolved");
  assert.equal(impact.affectedFlows[0]?.routeUnitId, "route-unresolved");
  assert.equal(impact.affectedFlows[0]?.confidence, "unresolved");
});

test("reports affected GraphQL operations through the canonical entrypoint identity", () => {
  const target = createNode("target", "loadUser", "service.ts", 20, "method");
  const resolver = createNode("resolver", "user", "resolvers.ts", 5, "method");
  const graph = createGraph(
    [target, resolver],
    [createEdge("resolver-target", resolver.id, target.id, "exact")]
  );
  const operation = createFlow(
    "graphql:user",
    resolver.id,
    "user",
    "exact",
    "concrete",
    "graphqlOperation"
  );
  const impact = analyzeChangeImpact(graph, createFlowIndex(graph.version, [operation]), target.id);

  assert.equal(impact.affectedFlows[0]?.entrypointKind, "graphqlOperation");
  assert.equal(impact.affectedFlows[0]?.entrypointUnitId, "graphql:user");
  assert.equal(impact.affectedFlows[0]?.routeUnitId, undefined);
  assert.equal(impact.affectedFlows[0]?.impactDepth, 1);
});

test("cycles, duplicate edges, and converging paths produce deterministic unique callers", () => {
  const target = createNode("target", "target", "flow.ts", 50);
  const left = createNode("left", "left", "flow.ts", 10);
  const right = createNode("right", "right", "flow.ts", 20);
  const shared = createNode("shared", "shared", "flow.ts", 1);
  const edges = [
    createEdge("left-target-resolved", left.id, target.id, "resolved"),
    createEdge("left-target-exact", left.id, target.id, "exact"),
    createEdge("right-target", right.id, target.id, "exact"),
    createEdge("shared-left", shared.id, left.id, "exact"),
    createEdge("shared-right", shared.id, right.id, "exact"),
    createEdge("target-shared", target.id, shared.id, "exact")
  ];
  const forwardGraph = createGraph([target, left, right, shared], edges);
  const reversedGraph = createGraph(
    [target, left, right, shared].reverse(),
    [...edges].reverse()
  );
  const forward = analyzeChangeImpact(
    forwardGraph,
    createFlowIndex(forwardGraph.version, []),
    target.id
  );
  const reversed = analyzeChangeImpact(
    reversedGraph,
    createFlowIndex(reversedGraph.version, []),
    target.id
  );

  assert.deepEqual(forward.callers.map((caller) => caller.functionId), [left.id, right.id, shared.id]);
  assert.equal(forward.callers.filter((caller) => caller.functionId === shared.id).length, 1);
  assert.equal(forward.callers[0]?.callEdgeId, "left-target-exact");
  assert.deepEqual(forward.callers[2]?.pathFunctionIds, [shared.id, left.id, target.id]);
  assert.equal(forward.callers.some((caller) => caller.functionId === target.id), false);
  assert.deepEqual(toSerializableResult(forward), toSerializableResult(reversed));
});

test("maxDepth reports the first omitted reverse-call frontier", () => {
  const target = createNode("target", "target", "depth.ts", 30);
  const service = createNode("service", "service", "depth.ts", 20);
  const handler = createNode("handler", "handler", "depth.ts", 10);
  const graph = createGraph(
    [target, service, handler],
    [
      createEdge("service-target", service.id, target.id, "exact"),
      createEdge("handler-service", handler.id, service.id, "exact")
    ]
  );
  const impact = analyzeChangeImpact(
    graph,
    createFlowIndex(graph.version, [createFlow("route", handler.id, "Depth route", "exact")]),
    target.id,
    { maxDepth: 1, maxSteps: 10 }
  );

  assert.deepEqual(impact.callers.map((caller) => caller.functionId), [service.id]);
  assert.equal(impact.affectedFlows.length, 0);
  assert.deepEqual(impact.diagnostics, [{
    reason: "depthLimit",
    message: "Callers of service exceed max depth 1",
    sourceFunctionId: service.id,
    omittedFunctionIds: [handler.id],
    limit: 1
  }]);
  assert.equal(impact.summary.truncated, true);
});

test("maxSteps bounds wide reverse impact and reports deterministic omissions", () => {
  const target = createNode("target", "target", "target.ts", 50);
  const first = createNode("first", "first", "callers.ts", 10);
  const second = createNode("second", "second", "callers.ts", 20);
  const third = createNode("third", "third", "callers.ts", 30);
  const graph = createGraph(
    [target, third, first, second],
    [
      createEdge("third-target", third.id, target.id, "exact"),
      createEdge("first-target", first.id, target.id, "exact"),
      createEdge("second-target", second.id, target.id, "exact")
    ]
  );
  const impact = analyzeChangeImpact(
    graph,
    createFlowIndex(graph.version, []),
    target.id,
    { maxDepth: 3, maxSteps: 2 }
  );

  assert.deepEqual(impact.callers.map((caller) => caller.functionId), [first.id, second.id]);
  assert.deepEqual(impact.diagnostics, [{
    reason: "stepLimit",
    message: "Reverse call impact exceeds max step count 2",
    sourceFunctionId: target.id,
    omittedFunctionIds: [third.id],
    limit: 2
  }]);
});

/** Creates a minimal graph whose framework edges are traversal decoys only. */
function createGraph(
  nodes: SymbolNode[],
  edges: GraphEdge[],
  frameworkUnitEdges: NonNullable<ProjectGraph["metadata"]["frameworkUnitEdges"]> = []
): ProjectGraph {
  return {
    workspaceRoot: "/workspace",
    version: "change-impact-test",
    generatedAt: "2026-07-13T00:00:00.000Z",
    nodes,
    edges,
    diagnostics: [],
    metadata: {
      languages: ["typescript"],
      frameworkUnits: [],
      frameworkUnitEdges,
      fileCount: new Set(nodes.map((node) => node.filePath)).size,
      symbolCount: nodes.length,
      edgeCount: edges.length
    }
  };
}

/** Creates one concrete callable or deliberately non-callable fixture node. */
function createNode(
  id: string,
  name: string,
  filePath: string,
  startLine: number,
  kind: SymbolKind = "function"
): SymbolNode {
  const range = createRange(startLine);

  return {
    id,
    kind,
    name,
    qualifiedName: name,
    filePath,
    range,
    selectionRange: range,
    language: "typescript"
  };
}

/** Creates one graph edge with a stable call-site location. */
function createEdge(
  id: string,
  sourceId: string,
  targetId: string,
  confidence: EdgeConfidence,
  kind: GraphEdge["kind"] = "calls"
): GraphEdge {
  return {
    id,
    kind,
    sourceId,
    targetId,
    filePath: "call-site.ts",
    range: createRange(1),
    confidence
  };
}

/** Creates a selected route-handler flow without invoking analyzer heuristics. */
function createFlow(
  routeUnitId: string,
  handlerFunctionId: string,
  name: string,
  confidence: EdgeConfidence,
  handlerResolution: SemanticFlow["steps"][number]["resolution"] = "concrete",
  entrypointKind: SemanticFlow["entrypointKind"] = "httpRoute"
): SemanticFlow {
  const graphql = entrypointKind === "graphqlOperation";

  return {
    id: routeUnitId,
    entrypointKind,
    entrypointUnitId: routeUnitId,
    routeUnitId: graphql ? undefined : routeUnitId,
    framework: graphql ? "GraphQL" : "TestFramework",
    rootPath: "/workspace",
    name,
    confidence,
    evidence: [],
    coverageGaps: [],
    steps: [
      {
        kind: graphql ? "operation" : "route",
        depth: 0,
        role: graphql ? "resolver" : "routeHandler",
        resolution: "concrete",
        frameworkUnitId: routeUnitId,
        framework: graphql ? "GraphQL" : "TestFramework",
        unitKind: graphql ? "operation" : "route",
        name,
        filePath: "routes.ts",
        range: createRange(1)
      },
      {
        kind: "handler",
        depth: 1,
        role: graphql ? "resolver" : "routeHandler",
        resolution: handlerResolution,
        functionId: handlerFunctionId,
        name: handlerFunctionId,
        functionName: handlerFunctionId,
        filePath: "handlers.ts",
        range: createRange(5)
      }
    ]
  };
}

/** Creates the public semantic-flow indexes expected by domain consumers. */
function createFlowIndex(graphVersion: string, flows: SemanticFlow[]): SemanticFlowIndex {
  const flowsByEntrypointUnitId = new Map<string, SemanticFlow[]>();
  const flowsByRouteUnitId = new Map<string, SemanticFlow[]>();

  for (const flow of flows) {
    flowsByEntrypointUnitId.set(flow.entrypointUnitId, [flow]);

    if (flow.routeUnitId) {
      flowsByRouteUnitId.set(flow.routeUnitId, [flow]);
    }
  }

  return {
    graphVersion,
    flows,
    flowsByEntrypointUnitId,
    flowsByRouteUnitId,
    coverageGaps: [],
    coverageGapsByEntrypointUnitId: new Map(),
    coverageGapsByRouteUnitId: new Map(),
    summary: {
      graphVersion,
      entrypointCount: flows.length,
      routeCount: flows.filter((flow) => flow.entrypointKind === "httpRoute").length,
      operationCount: flows.filter((flow) => flow.entrypointKind === "graphqlOperation").length,
      mappedHandlerCount: flows.length,
      ambiguousEntrypointCount: 0,
      ambiguousRouteCount: 0,
      ambiguousOperationCount: 0,
      handlerNotMappedCount: 0
    }
  };
}

/** Creates one compact single-line range. */
function createRange(startLine: number): SourceRange {
  return {
    startLine,
    startCharacter: 0,
    endLine: startLine,
    endCharacter: 80
  };
}

/** Removes only graph-version variation before shuffled-input comparison. */
function toSerializableResult(result: ChangeImpactAnalysis): unknown {
  return {
    ...result,
    graphVersion: "stable"
  };
}
