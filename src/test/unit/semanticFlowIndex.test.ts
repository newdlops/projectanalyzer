/**
 * Unit tests for route-centered semantic-flow indexing.
 *
 * Fixtures cover the four initial backend frameworks plus conservative
 * ambiguity, missing-handler, duplicate-edge, and ordering behavior.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createSemanticFlowIndex, type SemanticFlow } from "../../insights/semanticFlow";
import type {
  EdgeConfidence,
  FrameworkUnit,
  FrameworkUnitEdge,
  GraphEdge,
  ProjectGraph,
  SourceRange,
  SymbolKind,
  SymbolNode
} from "../../shared/types";

test("FastAPI and Nest routes prefer direct callable bindings over routesTo targets", () => {
  const fastApiRoute = createUnit("opaque-fast-route", "FastAPI", "route", "GET /users", "fast/routes.py", 10);
  const fastApiController = createUnit(
    "opaque-fast-controller",
    "FastAPI",
    "controller",
    "list_users_controller",
    "fast/controllers.py",
    30
  );
  const nestRoute = createUnit("opaque-nest-route", "NestJS", "route", "GET /orders", "nest/orders.ts", 20);
  const nestController = createUnit(
    "opaque-nest-controller",
    "NestJS",
    "controller",
    "OrdersController.list",
    "nest/orders.controller.ts",
    40
  );
  const graph = createGraph(
    [
      fastApiRoute,
      fastApiController,
      nestRoute,
      nestController
    ],
    [
      createNode("fast-direct", "list_users", "fast/routes.py", 10, "python"),
      createNode("fast-fallback", "list_users_controller", "fast/controllers.py", 30, "python"),
      createNode("nest-direct", "list", "nest/orders.ts", 20, "typescript"),
      createNode("nest-fallback", "list", "nest/orders.controller.ts", 40, "typescript")
    ],
    [
      createRouteEdge(fastApiRoute, fastApiController, "exact"),
      createRouteEdge(nestRoute, nestController, "exact")
    ]
  );

  const index = createSemanticFlowIndex(graph);

  assert.equal(index.summary.routeCount, 2);
  assert.equal(requireHandler(requireFlow(index.flows, fastApiRoute.id)).functionId, "fast-direct");
  assert.equal(requireHandler(requireFlow(index.flows, nestRoute.id)).functionId, "nest-direct");
  assert.deepEqual(
    requireFlow(index.flows, fastApiRoute.id).evidence.map((evidence) => evidence.kind),
    ["directCallable"]
  );
});

test("Django and Express routes fall back to routesTo target callables", () => {
  const djangoRoute = createUnit("route-a", "Django", "route", "books/", "books/urls.py", 5, {
    functionId: "metadata-must-not-be-used"
  });
  const djangoView = createUnit("view-a", "Django", "view", "book_list", "books/views.py", 12);
  const expressRoute = createUnit("route-b", "Express", "route", "GET /orders", "routes/orders.ts", 7);
  const expressController = createUnit(
    "controller-b",
    "Express",
    "controller",
    "listOrders",
    "controllers/orders.ts",
    18
  );
  expressController.range = {
    startLine: 18,
    startCharacter: 0,
    endLine: 22,
    endCharacter: 1
  };
  const graph = createGraph(
    [djangoRoute, djangoView, expressRoute, expressController],
    [
      createNode("django-handler", "book_list", "books/views.py", 12, "python"),
      createNode("express-handler", "listOrders", "controllers/orders.ts", 22, "typescript")
    ],
    [
      createRouteEdge(djangoRoute, djangoView, "inferred", { functionId: "edge-metadata-decoy" }),
      createRouteEdge(expressRoute, expressController, "exact")
    ]
  );

  const index = createSemanticFlowIndex(graph);
  const djangoFlow = requireFlow(index.flows, djangoRoute.id);
  const expressFlow = requireFlow(index.flows, expressRoute.id);

  assert.equal(requireHandler(djangoFlow).functionId, "django-handler");
  assert.equal(djangoFlow.confidence, "inferred");
  assert.deepEqual(djangoFlow.evidence.map((evidence) => evidence.kind), ["routesTo", "targetCallable"]);
  assert.equal(requireHandler(expressFlow).functionId, "express-handler");
  assert.equal(requireHandler(expressFlow).range?.startLine, 22);
  assert.equal(expressFlow.confidence, "exact");
  assert.equal(index.summary.mappedHandlerCount, 2);
});

test("an unmapped routesTo target remains a handler step with a coverage gap", () => {
  const route = createUnit("unmapped-route", "Django", "route", "reports/", "reports/urls.py", 3);
  const target = createUnit("unmapped-view", "Django", "view", "report_list", "reports/views.py", 20);
  const noTargetRoute = createUnit("missing-edge-route", "Express", "route", "GET /missing", "routes.ts", 50);
  const graph = createGraph(
    [route, target, noTargetRoute],
    [],
    [createRouteEdge(route, target, "resolved")]
  );

  const index = createSemanticFlowIndex(graph);
  const targetFlow = requireFlow(index.flows, route.id);
  const targetHandler = requireHandler(targetFlow);
  const noTargetFlow = requireFlow(index.flows, noTargetRoute.id);

  assert.equal(targetHandler.frameworkUnitId, target.id);
  assert.equal(targetHandler.functionId, undefined);
  assert.equal(targetFlow.confidence, "resolved");
  assert.equal(targetFlow.coverageGaps[0]?.reason, "handlerNotMapped");
  assert.deepEqual(targetFlow.coverageGaps[0]?.targetFrameworkUnitIds, [target.id]);
  assert.equal(noTargetFlow.steps.length, 1);
  assert.equal(noTargetFlow.confidence, undefined);
  assert.equal(noTargetFlow.coverageGaps[0]?.reason, "handlerNotMapped");
  assert.equal(index.summary.handlerNotMappedCount, 2);
});

test("equally trusted distinct callables produce an ambiguous gap", () => {
  const route = createUnit("ambiguous-route", "FastAPI", "route", "GET /search", "search.py", 14);
  const graph = createGraph(
    [route],
    [
      createNode("handler-z", "search", "search.py", 14, "python"),
      createNode("handler-a", "search_alias", "search.py", 14, "python")
    ],
    []
  );

  const flow = requireFlow(createSemanticFlowIndex(graph).flows, route.id);

  assert.equal(flow.steps.length, 1);
  assert.equal(flow.steps.some((step) => step.kind === "handler"), false);
  assert.equal(flow.coverageGaps[0]?.reason, "ambiguous");
  assert.deepEqual(flow.coverageGaps[0]?.candidateFunctionIds, ["handler-a", "handler-z"]);
  assert.equal(flow.confidence, "exact");
});

test("GraphQL operations map directly to resolver callables and preserve HTTP indexes", () => {
  const route = createUnit("http-route", "Express", "route", "GET /health", "server.ts", 3);
  const operation = createUnit("graphql-user", "GraphQL", "operation", "user", "resolvers.ts", 10);
  operation.qualifiedName = "Query.user";
  const routeHandler = createNode("health-handler", "health", "server.ts", 3, "typescript");
  const resolver = createNode("user-resolver", "user", "resolvers.ts", 10, "typescript", "method");
  const service = createNode("user-service", "loadUser", "service.ts", 20, "typescript", "method");
  const index = createSemanticFlowIndex(createGraph(
    [operation, route],
    [resolver, routeHandler, service],
    [],
    [createGraphEdge("resolver-service", "calls", resolver.id, service.id, "resolved")]
  ));
  const operationFlow = index.flowsByEntrypointUnitId.get(operation.id)?.[0];

  assert.ok(operationFlow);
  assert.equal(operationFlow.entrypointKind, "graphqlOperation");
  assert.equal(operationFlow.entrypointUnitId, operation.id);
  assert.equal(operationFlow.routeUnitId, undefined);
  assert.equal(operationFlow.rootPath, "/workspace");
  assert.equal(operationFlow.steps[0]?.kind, "operation");
  assert.equal(requireHandler(operationFlow).functionId, resolver.id);
  assert.equal(requireHandler(operationFlow).role, "resolver");
  assert.deepEqual(requireCalls(operationFlow).map((step) => step.functionId), [service.id]);
  assert.equal(index.summary.entrypointCount, 2);
  assert.equal(index.summary.routeCount, 1);
  assert.equal(index.summary.operationCount, 1);
  assert.equal(index.flowsByRouteUnitId.has(operation.id), false);
  assert.equal(index.flowsByRouteUnitId.has(route.id), true);
});

test("GraphQL operation ambiguity and missing resolvers remain explicit coverage gaps", () => {
  const ambiguous = createUnit("graphql-search", "GraphQL", "operation", "search", "search.ts", 7);
  ambiguous.qualifiedName = "Query.search";
  const unmapped = createUnit("graphql-update", "GraphQL", "operation", "updateUser", "mutation.ts", 12);
  unmapped.qualifiedName = "Mutation.updateUser";
  const index = createSemanticFlowIndex(createGraph(
    [unmapped, ambiguous],
    [
      createNode("search-a", "search", "search.ts", 7, "typescript"),
      createNode("search-b", "searchAlias", "search.ts", 7, "typescript")
    ],
    []
  ));
  const ambiguousFlow = index.flowsByEntrypointUnitId.get(ambiguous.id)?.[0];
  const unmappedFlow = index.flowsByEntrypointUnitId.get(unmapped.id)?.[0];

  assert.ok(ambiguousFlow);
  assert.ok(unmappedFlow);
  assert.equal(ambiguousFlow.coverageGaps[0]?.reason, "ambiguous");
  assert.deepEqual(ambiguousFlow.coverageGaps[0]?.candidateFunctionIds, ["search-a", "search-b"]);
  assert.equal(ambiguousFlow.coverageGaps[0]?.entrypointUnitId, ambiguous.id);
  assert.equal(ambiguousFlow.coverageGaps[0]?.routeUnitId, undefined);
  assert.equal(unmappedFlow.coverageGaps[0]?.reason, "handlerNotMapped");
  assert.equal(index.coverageGapsByEntrypointUnitId.has(unmapped.id), true);
  assert.equal(index.coverageGapsByRouteUnitId.size, 0);
  assert.equal(index.summary.ambiguousEntrypointCount, 1);
  assert.equal(index.summary.ambiguousRouteCount, 0);
  assert.equal(index.summary.ambiguousOperationCount, 1);
});

test("duplicate edges are deduplicated and shuffled input has deterministic output", () => {
  const earlyRoute = createUnit("early-route", "Express", "route", "GET /early", "routes.ts", 2);
  const earlyTarget = createUnit("early-target", "Express", "controller", "early", "controllers.ts", 20);
  const lateRoute = createUnit("late-route", "Django", "route", "late/", "urls.py", 30);
  const lateTarget = createUnit("late-target", "Django", "view", "late", "views.py", 40);
  const units = [lateTarget, earlyRoute, lateRoute, earlyTarget];
  const nodes = [
    createNode("late-handler", "late", "views.py", 40, "python"),
    createNode("early-handler", "early", "controllers.ts", 20, "typescript")
  ];
  const edges = [
    createRouteEdge(lateRoute, lateTarget, "resolved"),
    createRouteEdge(earlyRoute, earlyTarget, "inferred"),
    createRouteEdge(earlyRoute, earlyTarget, "exact"),
    createRouteEdge(earlyRoute, earlyTarget, "exact")
  ];
  const forward = createSemanticFlowIndex(createGraph(units, nodes, edges));
  const reversed = createSemanticFlowIndex(createGraph([...units].reverse(), [...nodes].reverse(), [...edges].reverse()));

  assert.deepEqual(toSerializableIndex(forward), toSerializableIndex(reversed));
  assert.deepEqual(forward.flows.map((flow) => flow.routeUnitId), ["late-route", "early-route"]);
  const earlyFlow = requireFlow(forward.flows, earlyRoute.id);
  assert.equal(earlyFlow.confidence, "exact");
  assert.equal(earlyFlow.evidence.length, 2);
  assert.equal(earlyFlow.coverageGaps.length, 0);
});

test("downstream flow follows calls only and assigns roles from reliable callable bindings", () => {
  const route = createUnit("flow-route", "Express", "route", "GET /users", "routes.ts", 1);
  const serviceUnit = createUnit("service-unit", "NestJS", "service", "loadUsers", "service.ts", 30);
  const broadModelUnit = createUnit("model-unit", "Django", "model", "UserModel", "model.ts", 0);
  broadModelUnit.range = {
    startLine: 0,
    startCharacter: 0,
    endLine: 100,
    endCharacter: 80
  };
  const injectedUnit = createUnit("dependency-unit", "FastAPI", "dependency", "session", "deps.py", 5);
  const handler = createNode("handler", "handleUsers", "routes.ts", 1, "typescript");
  const service = createNode("service", "loadUsers", "service.ts", 10, "typescript", "method");
  const model = createNode("model-call", "persistUsers", "model.ts", 20, "typescript", "method");
  const constructor = createNode("constructor", "UserResult", "result.ts", 30, "typescript", "constructor");
  const ignored = createNode("ignored", "notExecuted", "ignored.ts", 40, "typescript");
  const graph = createGraph(
    [route, serviceUnit, broadModelUnit, injectedUnit],
    [handler, service, model, constructor, ignored],
    [
      {
        kind: "injects",
        sourceId: route.id,
        targetId: injectedUnit.id,
        confidence: "exact"
      },
      {
        kind: "usesModel",
        sourceId: route.id,
        targetId: broadModelUnit.id,
        confidence: "exact"
      }
    ],
    [
      createGraphEdge("handler-service", "calls", handler.id, service.id, "exact"),
      createGraphEdge("service-model", "calls", service.id, model.id, "resolved"),
      createGraphEdge("model-constructor", "calls", model.id, constructor.id, "exact"),
      createGraphEdge("handler-ignored", "references", handler.id, ignored.id, "exact")
    ]
  );

  const flow = requireFlow(createSemanticFlowIndex(graph).flows, route.id);
  const calls = requireCalls(flow);

  assert.deepEqual(calls.map((step) => step.functionId), [service.id, model.id, constructor.id]);
  assert.deepEqual(calls.map((step) => step.depth), [2, 3, 4]);
  assert.equal(calls[0]?.parentFunctionId, handler.id);
  assert.equal(calls[0]?.relation, "calls");
  assert.equal(calls[0]?.role, "service");
  assert.equal(calls[0]?.confidence, "resolved");
  assert.equal(calls[1]?.role, "unknown");
  assert.equal(calls.some((step) => step.functionId === ignored.id), false);
  assert.equal(calls.some((step) => step.functionId === injectedUnit.id), false);
});

test("cycles, duplicate call edges, and converging targets produce one deterministic step", () => {
  const route = createUnit("cycle-route", "FastAPI", "route", "GET /cycle", "cycle.ts", 1);
  const handler = createNode("cycle-handler", "handleCycle", "cycle.ts", 1, "typescript");
  const left = createNode("left", "left", "flow.ts", 10, "typescript", "method");
  const right = createNode("right", "right", "flow.ts", 20, "typescript", "function");
  const shared = createNode("shared", "shared", "flow.ts", 30, "typescript", "constructor");
  const edges = [
    createGraphEdge("handler-left-resolved", "calls", handler.id, left.id, "resolved"),
    createGraphEdge("handler-left-exact", "calls", handler.id, left.id, "exact"),
    createGraphEdge("handler-right", "calls", handler.id, right.id, "exact"),
    createGraphEdge("left-shared", "calls", left.id, shared.id, "exact"),
    createGraphEdge("right-shared", "calls", right.id, shared.id, "exact"),
    createGraphEdge("shared-handler", "calls", shared.id, handler.id, "exact")
  ];
  const forwardGraph = createGraph([route], [handler, left, right, shared], [], edges);
  const reversedGraph = createGraph(
    [route],
    [handler, left, right, shared].reverse(),
    [],
    [...edges].reverse()
  );
  const forward = createSemanticFlowIndex(forwardGraph);
  const reversed = createSemanticFlowIndex(reversedGraph);
  const calls = requireCalls(requireFlow(forward.flows, route.id));

  assert.deepEqual(calls.map((step) => step.functionId), [left.id, right.id, shared.id]);
  assert.equal(calls.filter((step) => step.functionId === shared.id).length, 1);
  assert.equal(calls[0]?.callEdgeId, "handler-left-exact");
  assert.equal(calls.some((step) => step.functionId === handler.id), false);
  assert.deepEqual(toSerializableIndex(forward), toSerializableIndex(reversed));
});

test("maxDepth reports the first omitted call frontier without traversing it", () => {
  const route = createUnit("depth-route", "Express", "route", "GET /depth", "depth.ts", 1);
  const handler = createNode("depth-handler", "handleDepth", "depth.ts", 1, "typescript");
  const first = createNode("depth-first", "first", "depth-flow.ts", 10, "typescript");
  const second = createNode("depth-second", "second", "depth-flow.ts", 20, "typescript");
  const graph = createGraph(
    [route],
    [handler, first, second],
    [],
    [
      createGraphEdge("depth-1", "calls", handler.id, first.id, "exact"),
      createGraphEdge("depth-2", "calls", first.id, second.id, "exact")
    ]
  );

  const flow = requireFlow(createSemanticFlowIndex(graph, { maxDepth: 1, maxSteps: 10 }).flows, route.id);

  assert.deepEqual(requireCalls(flow).map((step) => step.functionId), [first.id]);
  assert.equal(flow.coverageGaps[0]?.reason, "depthLimit");
  assert.equal(flow.coverageGaps[0]?.sourceFunctionId, first.id);
  assert.equal(flow.coverageGaps[0]?.limit, 1);
  assert.deepEqual(flow.coverageGaps[0]?.omittedFunctionIds, [second.id]);
});

test("maxSteps bounds wide flows and reports deterministic omitted targets", () => {
  const route = createUnit("step-route", "Express", "route", "GET /steps", "steps.ts", 1);
  const handler = createNode("step-handler", "handleSteps", "steps.ts", 1, "typescript");
  const first = createNode("step-first", "first", "targets.ts", 10, "typescript");
  const second = createNode("step-second", "second", "targets.ts", 20, "typescript");
  const third = createNode("step-third", "third", "targets.ts", 30, "typescript");
  const graph = createGraph(
    [route],
    [handler, first, second, third],
    [],
    [
      createGraphEdge("step-3", "calls", handler.id, third.id, "exact"),
      createGraphEdge("step-1", "calls", handler.id, first.id, "exact"),
      createGraphEdge("step-2", "calls", handler.id, second.id, "exact")
    ]
  );

  const flow = requireFlow(createSemanticFlowIndex(graph, { maxDepth: 3, maxSteps: 2 }).flows, route.id);

  assert.deepEqual(requireCalls(flow).map((step) => step.functionId), [first.id, second.id]);
  assert.equal(flow.coverageGaps[0]?.reason, "stepLimit");
  assert.equal(flow.coverageGaps[0]?.sourceFunctionId, handler.id);
  assert.equal(flow.coverageGaps[0]?.limit, 2);
  assert.deepEqual(flow.coverageGaps[0]?.omittedFunctionIds, [third.id]);
});

test("concrete, external, and unresolved calls preserve their authoritative locations", () => {
  const route = createUnit("resolution-route", "FastAPI", "route", "GET /resolve", "resolve.ts", 1);
  const handler = createNode("resolution-handler", "handleResolve", "resolve.ts", 1, "typescript");
  const concrete = createNode("concrete", "localCall", "local.ts", 50, "typescript", "method");
  const unresolvedPlaceholder = createNode(
    "unresolved-placeholder",
    "client.fetch",
    "first-seen.ts",
    90,
    "typescript",
    "external"
  );
  const external = createNode("external", "sdk.send", "external-node.ts", 100, "typescript", "external");
  const graph = createGraph(
    [route],
    [handler, concrete, unresolvedPlaceholder, external],
    [],
    [
      createGraphEdge("to-concrete", "calls", handler.id, concrete.id, "exact", "resolve.ts", 10),
      createGraphEdge(
        "to-unresolved-placeholder",
        "calls",
        handler.id,
        unresolvedPlaceholder.id,
        "unresolved",
        "resolve.ts",
        11
      ),
      createGraphEdge("to-external", "calls", handler.id, external.id, "resolved", "resolve.ts", 12),
      createGraphEdge(
        "to-missing",
        "calls",
        handler.id,
        "missing-target",
        "unresolved",
        "resolve.ts",
        13,
        { calleeName: "dynamicLookup" }
      )
    ]
  );

  const calls = requireCalls(requireFlow(createSemanticFlowIndex(graph).flows, route.id));
  const concreteStep = requireCall(calls, concrete.id);
  const unresolvedStep = requireCall(calls, unresolvedPlaceholder.id);
  const externalStep = requireCall(calls, external.id);
  const missingStep = requireCall(calls, "missing-target");

  assert.equal(concreteStep.resolution, "concrete");
  assert.equal(concreteStep.filePath, concrete.filePath);
  assert.equal(concreteStep.range?.startLine, concrete.range.startLine);
  assert.equal(unresolvedStep.resolution, "unresolved");
  assert.equal(unresolvedStep.role, "unknown");
  assert.equal(unresolvedStep.filePath, "resolve.ts");
  assert.equal(unresolvedStep.range?.startLine, 11);
  assert.equal(unresolvedStep.confidence, "unresolved");
  assert.equal(externalStep.resolution, "external");
  assert.equal(externalStep.role, "external");
  assert.equal(externalStep.filePath, "resolve.ts");
  assert.equal(externalStep.range?.startLine, 12);
  assert.equal(missingStep.resolution, "unresolved");
  assert.equal(missingStep.name, "dynamicLookup");
  assert.equal(missingStep.filePath, "resolve.ts");
  assert.equal(missingStep.range?.startLine, 13);
});

/** Creates a minimal graph with framework semantic records. */
function createGraph(
  frameworkUnits: FrameworkUnit[],
  nodes: SymbolNode[],
  frameworkUnitEdges: FrameworkUnitEdge[],
  graphEdges: GraphEdge[] = []
): ProjectGraph {
  return {
    workspaceRoot: "/workspace",
    version: "semantic-flow-test",
    generatedAt: "2026-07-13T00:00:00.000Z",
    nodes,
    edges: graphEdges,
    diagnostics: [],
    metadata: {
      languages: ["python", "typescript"],
      frameworkUnits,
      frameworkUnitEdges,
      fileCount: new Set([...frameworkUnits.map((unit) => unit.filePath), ...nodes.map((node) => node.filePath)]).size,
      symbolCount: nodes.length,
      edgeCount: graphEdges.length
    }
  };
}

/** Creates an opaque framework unit whose identity carries no semantic hints. */
function createUnit(
  id: string,
  framework: string,
  kind: FrameworkUnit["kind"],
  name: string,
  filePath: string,
  startLine: number,
  metadata?: Record<string, unknown>
): FrameworkUnit {
  return {
    id,
    framework,
    rootPath: "/workspace",
    kind,
    name,
    qualifiedName: name,
    filePath,
    range: createRange(startLine),
    metadata
  };
}

/** Creates a callable node precisely contained by a fixture unit range. */
function createNode(
  id: string,
  name: string,
  filePath: string,
  startLine: number,
  language: string,
  kind: SymbolKind = "function",
  qualifiedName = name
): SymbolNode {
  const range = createRange(startLine);

  return {
    id,
    kind,
    name,
    qualifiedName,
    filePath,
    range,
    selectionRange: range,
    language
  };
}

/** Creates one graph edge used to distinguish calls from non-execution links. */
function createGraphEdge(
  id: string,
  kind: GraphEdge["kind"],
  sourceId: string,
  targetId: string,
  confidence: EdgeConfidence,
  filePath = "routes.ts",
  startLine = 0,
  metadata?: Record<string, unknown>
): GraphEdge {
  return {
    id,
    kind,
    sourceId,
    targetId,
    filePath,
    range: createRange(startLine),
    confidence,
    metadata
  };
}

/** Creates a route edge with optional metadata that the index must ignore. */
function createRouteEdge(
  source: FrameworkUnit,
  target: FrameworkUnit,
  confidence: EdgeConfidence,
  metadata?: Record<string, unknown>
): FrameworkUnitEdge {
  return {
    kind: "routesTo",
    sourceId: source.id,
    targetId: target.id,
    filePath: source.filePath,
    range: source.range,
    confidence,
    metadata
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

/** Retrieves one route flow with an assertion-friendly failure. */
function requireFlow(flows: SemanticFlow[], routeUnitId: string): SemanticFlow {
  const flow = flows.find((candidate) => candidate.routeUnitId === routeUnitId);

  assert.ok(flow, `Expected semantic flow for ${routeUnitId}`);
  return flow;
}

/** Retrieves the handler step, including target-only unmapped handlers. */
function requireHandler(flow: SemanticFlow): SemanticFlow["steps"][number] {
  const handler = flow.steps.find((step) => step.kind === "handler");

  assert.ok(handler, `Expected handler step for ${flow.routeUnitId}`);
  return handler;
}

/** Retrieves every downstream execution step in deterministic flow order. */
function requireCalls(flow: SemanticFlow): SemanticFlow["steps"] {
  return flow.steps.filter((step) => step.kind === "call");
}

/** Retrieves one downstream target by its preserved graph identity. */
function requireCall(
  calls: SemanticFlow["steps"],
  functionId: string
): SemanticFlow["steps"][number] {
  const call = calls.find((step) => step.functionId === functionId);

  assert.ok(call, `Expected downstream call step for ${functionId}`);
  return call;
}

/** Removes Map indexes so deterministic public arrays can be compared directly. */
function toSerializableIndex(index: ReturnType<typeof createSemanticFlowIndex>): unknown {
  return {
    graphVersion: index.graphVersion,
    flows: index.flows,
    coverageGaps: index.coverageGaps,
    summary: index.summary
  };
}
