/**
 * Unit tests for projecting route-centered semantic flows into the existing
 * Function Explorer tree protocol.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultSemanticFlowExpandedRowIds,
  createSemanticFlowRows,
  REQUEST_FLOW_ROWS_ROOT_ID
} from "../../application/functionExplorer/semanticFlowRows";
import type { SemanticFlow, SemanticFlowIndex } from "../../insights/semanticFlow";

test("default request-flow expansion keeps framework buckets collapsed", () => {
  const index = createFlowIndex();
  const expandedRowIds = createDefaultSemanticFlowExpandedRowIds(index);
  const rows = createSemanticFlowRows(index, { expandedRowIds });
  const section = requireRow(rows, REQUEST_FLOW_ROWS_ROOT_ID);
  const express = requireRow(rows, `${REQUEST_FLOW_ROWS_ROOT_ID}:framework:Express`);
  const routeId = createRouteRowId("Express", "express:route");

  assert.deepEqual(expandedRowIds, [REQUEST_FLOW_ROWS_ROOT_ID]);
  assert.equal(section.label, "Request Flows");
  assert.equal(section.detail, "2 entrypoints (2 routes, 0 operations) / 1 handlers / 1 gaps");
  assert.equal(express.expanded, false);
  assert.equal(rows.some((row) => row.id === routeId), false);
  assert.equal(rows.every((row) => row.depth <= 1), true);
});

test("GraphQL operations stay collapsed under Query, Mutation, and Subscription summaries", () => {
  const index = createGraphQLFlowIndex();
  const frameworkId = createFrameworkRowId("GraphQL");
  const queryBucketId = `${frameworkId}:graphql:query`;
  const operationId = `${queryBucketId}:operation:graphql%3Auser`;
  const collapsedRows = createSemanticFlowRows(index, {
    expandedRowIds: [REQUEST_FLOW_ROWS_ROOT_ID, frameworkId]
  });

  assert.equal(requireRow(collapsedRows, queryBucketId).detail, "1 operations");
  assert.equal(requireRow(collapsedRows, `${frameworkId}:graphql:mutation`).expanded, false);
  assert.equal(requireRow(collapsedRows, `${frameworkId}:graphql:subscription`).expanded, false);
  assert.equal(collapsedRows.some((row) => row.id === operationId), false);

  const expandedRows = createSemanticFlowRows(index, {
    expandedRowIds: [REQUEST_FLOW_ROWS_ROOT_ID, frameworkId, queryBucketId]
  });
  const operation = requireRow(expandedRows, operationId);

  assert.equal(operation.label, "user");
  assert.equal(operation.role, "resolver");
  assert.equal(operation.functionId, "resolver:user");
  assert.equal(operation.filePath, "/workspace/graphql/resolvers.ts");
  assert.equal(operation.metadata?.entrypointKind, "graphqlOperation");
  assert.equal(operation.metadata?.entrypointUnitId, "graphql:user");
});

test("GraphQL operations from multiple analyzer roots remain in separate scope buckets", () => {
  const index = createGraphQLFlowIndex();
  const graphqlFlows = index.flows.filter((flow) => flow.entrypointKind === "graphqlOperation");
  graphqlFlows[0].rootPath = "/workspace/apps/accounts";
  graphqlFlows[1].rootPath = "/workspace/apps/admin";
  graphqlFlows[2].rootPath = "/workspace/apps/accounts";
  const frameworkId = createFrameworkRowId("GraphQL");
  const accountsId = `${frameworkId}:scope:${encodeURIComponent("/workspace/apps/accounts")}`;
  const adminId = `${frameworkId}:scope:${encodeURIComponent("/workspace/apps/admin")}`;
  const rows = createSemanticFlowRows(index, {
    expandedRowIds: [REQUEST_FLOW_ROWS_ROOT_ID, frameworkId]
  });

  assert.equal(requireRow(rows, accountsId).detail, "2 GraphQL operations");
  assert.equal(requireRow(rows, adminId).detail, "1 GraphQL operations");
  assert.equal(rows.some((row) => row.id === `${accountsId}:graphql:query`), false);

  const accountsRows = createSemanticFlowRows(index, {
    expandedRowIds: [REQUEST_FLOW_ROWS_ROOT_ID, frameworkId, accountsId]
  });
  assert.equal(requireRow(accountsRows, `${accountsId}:graphql:query`).expanded, false);
  assert.equal(requireRow(accountsRows, `${accountsId}:graphql:subscription`).expanded, false);
});

test("expanded routes expose source handlers and honest coverage gaps", () => {
  const index = createFlowIndex();
  const expressRouteId = createRouteRowId("Express", "express:route");
  const djangoRouteId = createRouteRowId("Django", "django:route");
  const rows = createSemanticFlowRows(index, {
    expandedRowIds: [
      ...createDefaultSemanticFlowExpandedRowIds(index),
      createFrameworkRowId("Django"),
      createFrameworkRowId("Express"),
      expressRouteId,
      djangoRouteId
    ]
  });
  const handler = requireRow(rows, `${expressRouteId}:handler:show-user`);
  const unresolvedHandler = requireRow(rows, `${djangoRouteId}:handler:missing-feed`);
  const unresolvedRoute = requireRow(rows, djangoRouteId);
  const gap = requireRow(rows, `${djangoRouteId}:gap:handlerNotMapped`);

  assert.equal(handler.kind, "function");
  assert.equal(handler.symbolId, "show-user");
  assert.equal(handler.filePath, "/workspace/server.ts");
  assert.equal(handler.role, "routeHandler");
  assert.equal(handler.confidence, "resolved");
  assert.equal(unresolvedRoute.functionId, undefined);
  assert.equal(unresolvedRoute.symbolId, undefined);
  assert.equal(unresolvedHandler.kind, "relation");
  assert.equal(unresolvedHandler.functionId, "missing-feed");
  assert.equal(unresolvedHandler.symbolId, undefined);
  assert.equal(gap.kind, "diagnostic");
  assert.equal(gap.confidence, "unresolved");
  assert.doesNotThrow(() => JSON.stringify(rows));
});

test("expanded routes expose bounded downstream calls with stable nesting and navigation", () => {
  const index = createDownstreamFlowIndex();
  const routeId = createRouteRowId("Express", "express:route");
  const rows = createSemanticFlowRows(index, {
    expandedRowIds: [
      ...createDefaultSemanticFlowExpandedRowIds(index),
      createFrameworkRowId("Express"),
      routeId
    ]
  });
  const handlerId = `${routeId}:handler:show-user`;
  const serviceId = `${handlerId}:call:edge-handler-service`;
  const repositoryId = `${serviceId}:call:edge-service-repository`;
  const unresolvedId = `${serviceId}:call:edge-service-dynamic`;
  const gapId = `${serviceId}:gap:depthLimit`;
  const service = requireRow(rows, serviceId);
  const repository = requireRow(rows, repositoryId);
  const unresolved = requireRow(rows, unresolvedId);
  const gap = requireRow(rows, gapId);

  assert.equal(service.parentId, handlerId);
  assert.equal(service.depth, 4);
  assert.equal(service.relation, "downstream");
  assert.equal(service.role, "service");
  assert.equal(service.symbolId, "user-service");
  assert.equal(service.filePath, "/workspace/userService.ts");
  assert.equal(repository.parentId, serviceId);
  assert.equal(repository.depth, 5);
  assert.equal(repository.role, "repository");
  assert.equal(repository.symbolId, "user-repository");
  assert.equal(unresolved.parentId, serviceId);
  assert.equal(unresolved.functionId, "external:dynamicLookup");
  assert.equal(unresolved.symbolId, undefined);
  assert.match(unresolved.detail ?? "", /^Unresolved call target/);
  assert.deepEqual(unresolved.tags, ["unresolvedCall"]);
  assert.equal(gap.parentId, serviceId);
  assert.equal(gap.depth, 5);
  assert.equal(gap.label, "More calls beyond depth limit");
  assert.deepEqual(gap.metadata?.omittedFunctionIds, ["audit-service"]);
  assert.deepEqual(
    rows.filter((row) => [serviceId, repositoryId, unresolvedId, gapId].includes(row.id)).map((row) => row.id),
    [serviceId, repositoryId, unresolvedId, gapId]
  );
  assert.deepEqual(
    createSemanticFlowRows(index, {
      expandedRowIds: [
        ...createDefaultSemanticFlowExpandedRowIds(index),
        createFrameworkRowId("Express"),
        routeId
      ]
    }).map((row) => row.id),
    rows.map((row) => row.id)
  );
});

/** Creates mapped Express and unit-only Django route flows. */
function createFlowIndex(): SemanticFlowIndex {
  const mappedFlow: SemanticFlow = {
    id: "express:route",
    entrypointKind: "httpRoute",
    entrypointUnitId: "express:route",
    routeUnitId: "express:route",
    framework: "Express",
    rootPath: "/workspace",
    name: "GET /users/:id",
    steps: [
      {
        kind: "route" as const,
        depth: 0,
        role: "routeHandler",
        resolution: "concrete",
        frameworkUnitId: "express:route",
        framework: "Express",
        unitKind: "route" as const,
        name: "GET /users/:id",
        filePath: "/workspace/server.ts",
        range: createRange(10)
      },
      {
        kind: "handler" as const,
        depth: 1,
        role: "routeHandler",
        resolution: "concrete",
        frameworkUnitId: "express:controller",
        functionId: "show-user",
        framework: "Express",
        unitKind: "controller" as const,
        name: "showUser",
        functionName: "showUser",
        filePath: "/workspace/server.ts",
        range: createRange(2)
      }
    ],
    evidence: [
      {
        kind: "routesTo" as const,
        confidence: "exact" as const,
        description: "route target",
        entrypointUnitId: "express:route",
        routeUnitId: "express:route",
        frameworkUnitId: "express:controller"
      },
      {
        kind: "targetCallable" as const,
        confidence: "resolved" as const,
        description: "handler symbol",
        entrypointUnitId: "express:route",
        routeUnitId: "express:route",
        frameworkUnitId: "express:controller",
        functionId: "show-user"
      }
    ],
    confidence: "resolved" as const,
    coverageGaps: []
  };
  const djangoGap = {
    entrypointUnitId: "django:route",
    routeUnitId: "django:route",
    reason: "handlerNotMapped" as const,
    message: "No callable handler is mapped for route posts/",
    candidateFunctionIds: [],
    targetFrameworkUnitIds: ["django:view"],
    omittedFunctionIds: []
  };
  const unmappedFlow: SemanticFlow = {
    id: "django:route",
    entrypointKind: "httpRoute",
    entrypointUnitId: "django:route",
    routeUnitId: "django:route",
    framework: "Django",
    rootPath: "/workspace",
    name: "posts/",
    steps: [
      {
        kind: "route" as const,
        depth: 0,
        role: "routeHandler",
        resolution: "concrete",
        frameworkUnitId: "django:route",
        framework: "Django",
        unitKind: "route" as const,
        name: "posts/",
        filePath: "/workspace/urls.py",
        range: createRange(3)
      },
      {
        kind: "handler" as const,
        depth: 1,
        role: "routeHandler",
        resolution: "unresolved",
        frameworkUnitId: "django:view",
        functionId: "missing-feed",
        framework: "Django",
        unitKind: "view" as const,
        name: "feed",
        filePath: "/workspace/views.py",
        range: createRange(5)
      }
    ],
    evidence: [{
      kind: "routesTo" as const,
      confidence: "inferred" as const,
      description: "route target",
      entrypointUnitId: "django:route",
      routeUnitId: "django:route",
      frameworkUnitId: "django:view"
    }],
    confidence: "inferred" as const,
    coverageGaps: [djangoGap]
  };
  const flows = [unmappedFlow, mappedFlow];

  return {
    graphVersion: "flow-row-test",
    flows,
    flowsByEntrypointUnitId: new Map([
      ["django:route", [unmappedFlow]],
      ["express:route", [mappedFlow]]
    ]),
    flowsByRouteUnitId: new Map([
      ["django:route", [unmappedFlow]],
      ["express:route", [mappedFlow]]
    ]),
    coverageGaps: [djangoGap],
    coverageGapsByEntrypointUnitId: new Map([["django:route", [djangoGap]]]),
    coverageGapsByRouteUnitId: new Map([["django:route", [djangoGap]]]),
    summary: {
      graphVersion: "flow-row-test",
      entrypointCount: 2,
      routeCount: 2,
      operationCount: 0,
      mappedHandlerCount: 1,
      ambiguousEntrypointCount: 0,
      ambiguousRouteCount: 0,
      ambiguousOperationCount: 0,
      handlerNotMappedCount: 1
    }
  };
}

/** Adds a bounded handler-to-repository trace and one honest depth diagnostic. */
function createDownstreamFlowIndex(): SemanticFlowIndex {
  const index = createFlowIndex();
  const flow = index.flows.find((candidate) => candidate.routeUnitId === "express:route");
  assert.ok(flow);
  flow.steps.push(
    {
      kind: "call",
      depth: 2,
      role: "service",
      resolution: "concrete",
      relation: "calls",
      parentFunctionId: "show-user",
      callEdgeId: "edge-handler-service",
      confidence: "resolved",
      functionId: "user-service",
      name: "loadUser",
      functionName: "loadUser",
      functionQualifiedName: "UserService.loadUser",
      filePath: "/workspace/userService.ts",
      range: createRange(8)
    },
    {
      kind: "call",
      depth: 3,
      role: "repository",
      resolution: "concrete",
      relation: "calls",
      parentFunctionId: "user-service",
      callEdgeId: "edge-service-repository",
      confidence: "exact",
      functionId: "user-repository",
      name: "findById",
      functionQualifiedName: "UserRepository.findById",
      filePath: "/workspace/userRepository.ts",
      range: createRange(14)
    },
    {
      kind: "call",
      depth: 3,
      role: "unknown",
      resolution: "unresolved",
      relation: "calls",
      parentFunctionId: "user-service",
      callEdgeId: "edge-service-dynamic",
      confidence: "unresolved",
      functionId: "external:dynamicLookup",
      name: "dynamicLookup",
      filePath: "/workspace/userService.ts",
      range: createRange(18)
    }
  );
  const gap: SemanticFlow["coverageGaps"][number] = {
    entrypointUnitId: flow.entrypointUnitId,
    routeUnitId: flow.routeUnitId,
    reason: "depthLimit",
    message: "1 downstream call was omitted at depth limit 2",
    candidateFunctionIds: [],
    targetFrameworkUnitIds: [],
    sourceFunctionId: "user-service",
    omittedFunctionIds: ["audit-service"],
    limit: 2
  };
  flow.coverageGaps.push(gap);
  index.coverageGaps.push(gap);
  index.coverageGapsByEntrypointUnitId.set(flow.entrypointUnitId, flow.coverageGaps);
  if (flow.routeUnitId) {
    index.coverageGapsByRouteUnitId.set(flow.routeUnitId, flow.coverageGaps);
  }

  return index;
}

/** Adds one operation of each GraphQL root type for collapsed grouping tests. */
function createGraphQLFlowIndex(): SemanticFlowIndex {
  const index = createFlowIndex();
  const operations = [
    createGraphQLOperationFlow("graphql:user", "Query.user", "resolver:user"),
    createGraphQLOperationFlow("graphql:updateUser", "Mutation.updateUser", "resolver:updateUser"),
    createGraphQLOperationFlow("graphql:userChanged", "Subscription.userChanged", "resolver:userChanged")
  ];

  index.flows.push(...operations);
  for (const flow of operations) {
    index.flowsByEntrypointUnitId.set(flow.entrypointUnitId, [flow]);
  }
  index.summary.entrypointCount += operations.length;
  index.summary.operationCount += operations.length;
  index.summary.mappedHandlerCount += operations.length;

  return index;
}

/** Creates one source-backed GraphQL operation and direct resolver flow. */
function createGraphQLOperationFlow(
  entrypointUnitId: string,
  qualifiedName: string,
  resolverFunctionId: string
): SemanticFlow {
  const name = qualifiedName.split(".").at(-1) ?? qualifiedName;

  return {
    id: entrypointUnitId,
    entrypointKind: "graphqlOperation",
    entrypointUnitId,
    framework: "GraphQL",
    rootPath: "/workspace/graphql",
    name,
    steps: [
      {
        kind: "operation",
        depth: 0,
        role: "resolver",
        resolution: "unresolved",
        frameworkUnitId: entrypointUnitId,
        framework: "GraphQL",
        unitKind: "operation",
        name,
        qualifiedName,
        filePath: "/workspace/graphql/resolvers.ts",
        range: createRange(5)
      },
      {
        kind: "handler",
        depth: 1,
        role: "resolver",
        resolution: "concrete",
        frameworkUnitId: entrypointUnitId,
        functionId: resolverFunctionId,
        framework: "GraphQL",
        unitKind: "operation",
        name,
        functionName: name,
        functionQualifiedName: qualifiedName,
        filePath: "/workspace/graphql/resolvers.ts",
        range: createRange(5)
      }
    ],
    evidence: [{
      kind: "directCallable",
      confidence: "exact",
      description: "operation resolver",
      entrypointUnitId,
      frameworkUnitId: entrypointUnitId,
      functionId: resolverFunctionId
    }],
    confidence: "exact",
    coverageGaps: []
  };
}

/** Creates a compact source range. */
function createRange(startLine: number) {
  return {
    startLine,
    startCharacter: 0,
    endLine: startLine,
    endCharacter: 10
  };
}

/** Returns one expected row or fails with its stable identity. */
function requireRow(rows: ReturnType<typeof createSemanticFlowRows>, rowId: string) {
  const row = rows.find((candidate) => candidate.id === rowId);
  assert.ok(row, `missing row ${rowId}`);
  return row;
}

/** Recreates the public route row identity for assertions. */
function createRouteRowId(framework: string, routeUnitId: string): string {
  return `${createFrameworkRowId(framework)}:route:${encodeURIComponent(routeUnitId)}`;
}

/** Recreates the public framework bucket identity for expansion fixtures. */
function createFrameworkRowId(framework: string): string {
  return `${REQUEST_FLOW_ROWS_ROOT_ID}:framework:${encodeURIComponent(framework)}`;
}
