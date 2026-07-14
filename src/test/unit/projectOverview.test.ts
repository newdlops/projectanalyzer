/**
 * Unit tests for bounded Project Brief and Risk Radar domain results.
 * Fixtures use explicit SemanticFlow records so the tests verify that Overview
 * reuses supplied evidence instead of rebuilding or guessing analyzer output.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  createProjectBrief,
  createProjectOverview,
  createProjectRiskRadar,
  PROJECT_BRIEF_ENTRYPOINT_GROUP_LIMIT,
  PROJECT_RISK_EVIDENCE_IDENTITY_LIMIT,
  PROJECT_RISK_RADAR_ITEM_LIMIT
} from "../../insights/projectOverview";
import type {
  SemanticFlow,
  SemanticFlowCoverageGap,
  SemanticFlowEntrypointKind,
  SemanticFlowIndex,
  SemanticFlowStep
} from "../../insights/semanticFlow";
import type {
  AnalysisDiagnostic,
  GraphEdge,
  ProjectGraph,
  SourceRange,
  SymbolNode
} from "../../shared/types";

test("Project Brief summarizes scope, stack, execution groups, and known coverage facts", () => {
  const graph = createGraph();
  const flows = [
    ...createMappedFlows("Express", "/workspace/apps/api", "httpRoute", undefined, 4, "express"),
    ...createMappedFlows("GraphQL", "/workspace/apps/graphql", "graphqlOperation", "Query", 3, "query"),
    ...createMappedFlows("GraphQL", "/workspace/apps/graphql", "graphqlOperation", "Mutation", 2, "mutation"),
    createUnmappedFlow("django:missing", "Django", "/workspace/apps/admin", "httpRoute"),
    ...createMappedFlows(
      "GraphQL",
      "/workspace/apps/graphql",
      "graphqlOperation",
      "Subscription",
      1,
      "subscription"
    )
  ];
  const index = createFlowIndex(graph.version, flows);
  const brief = createProjectBrief(graph, index);

  assert.deepEqual(brief.scope, {
    analyzedFileCount: 12,
    symbolCount: 5,
    callableCount: 4,
    callEdgeCount: 3
  });
  assert.deepEqual(brief.stack.languages.map((item) => item.language), ["typescript", "python"]);
  assert.deepEqual(
    brief.stack.frameworkRoots.map((item) => [item.name, item.rootPath]),
    [
      ["Django", "/workspace/apps/admin"],
      ["Express", "/workspace/apps/api"],
      ["GraphQL", "/workspace/apps/graphql"]
    ]
  );
  assert.equal(brief.executionSurface.entrypointCount, 11);
  assert.equal(brief.executionSurface.routeCount, 5);
  assert.equal(brief.executionSurface.operationCount, 6);
  assert.equal(brief.executionSurface.mappedCount, 10);
  assert.equal(brief.executionSurface.mappingGapCount, 1);
  assert.equal(brief.executionSurface.groups.length, PROJECT_BRIEF_ENTRYPOINT_GROUP_LIMIT);
  assert.deepEqual(
    brief.executionSurface.groups.map((group) => [group.framework, group.operationType, group.entrypointCount]),
    [
      ["Express", undefined, 4],
      ["GraphQL", "Query", 3],
      ["GraphQL", "Mutation", 2]
    ]
  );
  assert.deepEqual(
    brief.executionSurface.groups[0]?.representativeEntrypointUnitIds,
    ["express:0", "express:1", "express:2"]
  );
  assert.equal(brief.executionSurface.omittedGroupCount, 2);
  assert.equal(brief.executionSurface.omittedEntrypointCount, 2);
  assert.deepEqual(brief.analysisCoverage, {
    errorDiagnosticCount: 1,
    warningDiagnosticCount: 1,
    infoDiagnosticCount: 1,
    unresolvedCallEdgeCount: 1,
    inferredCallEdgeCount: 1,
    ambiguousEntrypointCount: 0,
    handlerNotMappedCount: 1,
    traversalLimitGapCount: 0
  });
});

test("Project Brief output is deterministic when graph and flow arrays are shuffled", () => {
  const graph = createGraph();
  const flows = [
    ...createMappedFlows("GraphQL", "/workspace/g", "graphqlOperation", "Query", 2, "query"),
    ...createMappedFlows("Express", "/workspace/e", "httpRoute", undefined, 2, "route")
  ];
  const forward = createProjectBrief(graph, createFlowIndex(graph.version, flows));
  const reversedGraph: ProjectGraph = {
    ...graph,
    nodes: [...graph.nodes].reverse(),
    edges: [...graph.edges].reverse(),
    metadata: {
      ...graph.metadata,
      languages: [...graph.metadata.languages].reverse(),
      languageSummary: [...(graph.metadata.languageSummary ?? [])].reverse(),
      frameworks: [...(graph.metadata.frameworks ?? [])].reverse(),
      frameworkUnits: [...(graph.metadata.frameworkUnits ?? [])].reverse()
    }
  };
  const reversed = createProjectBrief(
    reversedGraph,
    createFlowIndex(reversedGraph.version, [...flows].reverse())
  );

  assert.deepEqual(reversed, forward);
});

test("Project Brief preserves same-name framework roots from distinct ecosystems", () => {
  const baseGraph = createGraph();
  const frameworks = [
    {
      name: "GraphQL",
      ecosystem: "javascript",
      category: "backend",
      confidence: "high",
      rootPath: "/workspace/shared",
      evidence: ["package.json"]
    },
    {
      name: "GraphQL",
      ecosystem: "python",
      category: "backend",
      confidence: "medium",
      rootPath: "/workspace/shared",
      evidence: ["requirements.txt"]
    },
    {
      name: "GraphQL",
      ecosystem: "javascript",
      category: "unknown",
      confidence: "low",
      rootPath: "/workspace/shared",
      evidence: ["fallback"]
    }
  ] satisfies NonNullable<ProjectGraph["metadata"]["frameworks"]>;
  const graph: ProjectGraph = {
    ...baseGraph,
    metadata: { ...baseGraph.metadata, frameworks }
  };
  const reversedGraph: ProjectGraph = {
    ...graph,
    metadata: { ...graph.metadata, frameworks: [...frameworks].reverse() }
  };
  const emptyIndex = createFlowIndex(graph.version, []);
  const forward = createProjectBrief(graph, emptyIndex);
  const reversed = createProjectBrief(reversedGraph, emptyIndex);
  const graphqlRoots = forward.stack.frameworkRoots.filter((root) => root.name === "GraphQL");

  assert.deepEqual(reversed, forward);
  assert.deepEqual(
    graphqlRoots.map((root) => [root.ecosystem, root.category, root.confidence]),
    [
      ["javascript", "backend", "high"],
      ["python", "backend", "medium"]
    ]
  );
});

test("Risk Radar preserves diagnostic, flow-bound, source, target, and edge identities", () => {
  const graph = createGraph();
  const sharedCall = createUnresolvedCall("handler:shared", "missing:a", "edge:unresolved-a", 20);
  const secondSharedCall = createUnresolvedCall("handler:shared", "missing:b", "edge:unresolved-b", 22);
  const flowA = createMappedFlow("route:a", "Express", "/workspace/apps/api", "httpRoute", undefined, "handler:shared", [sharedCall]);
  const flowB = createMappedFlow(
    "route:b",
    "Express",
    "/workspace/apps/api",
    "httpRoute",
    undefined,
    "handler:shared",
    [sharedCall, secondSharedCall]
  );
  flowA.coverageGaps.push(createTraversalGap(flowA.entrypointUnitId, "handler:shared"));
  const unmapped = createUnmappedFlow("route:missing", "FastAPI", "/workspace/apps/missing", "httpRoute");
  // This unresolved step is deliberately attached to an unmapped flow and must
  // not be presented as a reached execution path.
  unmapped.steps.push(createUnresolvedCall("missing-handler", "missing:hidden", "edge:hidden", 30));
  const ambiguous = createAmbiguousFlow(
    "operation:search",
    "GraphQL",
    "/workspace/apps/graphql",
    "graphqlOperation"
  );
  const index = createFlowIndex(graph.version, [flowA, flowB, unmapped, ambiguous]);
  const radar = createProjectRiskRadar(graph, index);
  const analysis = radar.items.find((item) => item.kind === "analysisCoverage");
  const entrypoint = radar.items.find((item) =>
    item.kind === "entrypointCoverage" && item.framework === "FastAPI"
  );
  const unresolved = radar.items.find((item) =>
    item.kind === "unresolvedExecution" && item.sourceFunctionId === "handler:shared"
  );

  assert.ok(analysis);
  assert.equal(analysis.errorDiagnosticCount, 1);
  assert.equal(analysis.warningDiagnosticCount, 1);
  assert.equal(analysis.traversalLimitGapCount, 1);
  assert.deepEqual(analysis.evidence.diagnosticIndexes, [0, 1]);
  assert.deepEqual(analysis.evidence.entrypointUnitIds, ["route:a"]);
  assert.deepEqual(analysis.evidence.sourceFunctionIds, ["handler:shared"]);
  assert.deepEqual(analysis.evidence.omittedFunctionIds, ["service:omitted"]);
  assert.ok(entrypoint?.kind === "entrypointCoverage");
  assert.equal(entrypoint.handlerNotMappedCount, 1);
  assert.deepEqual(entrypoint.evidence.entrypointUnitIds, ["route:missing"]);
  assert.ok(unresolved?.kind === "unresolvedExecution");
  assert.equal(unresolved.unresolvedCallCount, 2);
  assert.equal(unresolved.affectedEntrypointCount, 2);
  assert.equal(unresolved.sourceFunctionName, "SharedHandler.handle");
  assert.deepEqual(unresolved.evidence.sourceFunctionIds, ["handler:shared"]);
  assert.deepEqual(unresolved.evidence.targetFunctionIds, ["missing:a", "missing:b"]);
  assert.deepEqual(unresolved.evidence.edgeIds, ["edge:unresolved-a", "edge:unresolved-b"]);
  assert.equal(unresolved.location?.filePath, "/workspace/src/shared.ts");
  assert.equal(unresolved.location?.range?.startLine, 20);
  assert.equal(
    radar.items.some((item) => item.evidence.edgeIds.includes("edge:hidden")),
    false
  );
});

test("Risk Radar is capped at five while retaining every non-empty P0 category", () => {
  const graph = createGraph();
  const flows: SemanticFlow[] = [
    createUnmappedFlow("gap:a", "A", "/a", "httpRoute"),
    createUnmappedFlow("gap:b", "B", "/b", "httpRoute")
  ];

  for (let index = 0; index < 6; index += 1) {
    const sourceId = `handler:${index}`;
    graph.nodes.push(createNode(sourceId, `Handler${index}`, `/workspace/src/${index}.ts`, index));
    flows.push(createMappedFlow(
      `route:${index}`,
      "Express",
      "/workspace/apps/api",
      "httpRoute",
      undefined,
      sourceId,
      [createUnresolvedCall(sourceId, `missing:${index}`, `edge:${index}`, index)]
    ));
  }

  const radar = createProjectRiskRadar(graph, createFlowIndex(graph.version, flows));

  assert.equal(radar.items.length, PROJECT_RISK_RADAR_ITEM_LIMIT);
  assert.ok(radar.candidateItemCount > radar.items.length);
  assert.equal(radar.omittedItemCount, radar.candidateItemCount - radar.items.length);
  assert.deepEqual(
    new Set(radar.items.map((item) => item.kind)),
    new Set(["analysisCoverage", "entrypointCoverage", "unresolvedExecution"])
  );
});

test("Risk Radar keeps large-repository evidence bounded while preserving exact counts", () => {
  const mappedFlowCount = 3_000;
  const unmappedFlowCount = 3_000;
  const diagnosticCount = 10_000;
  const baseGraph = createGraph();
  const graph: ProjectGraph = {
    ...baseGraph,
    diagnostics: Array.from({ length: diagnosticCount }, (_, index): AnalysisDiagnostic => ({
      severity: index % 3 === 0 ? "error" : index % 3 === 1 ? "warning" : "info",
      code: `large.fixture.${index}`,
      message: `Large fixture diagnostic ${index}`,
      filePath: `/workspace/large/${index}.ts`,
      range: createRange(index)
    }))
  };
  const flows: SemanticFlow[] = [];

  for (let index = 0; index < mappedFlowCount; index += 1) {
    const flow = createMappedFlow(
      `route:large:${index}`,
      "Express",
      "/workspace/apps/large",
      "httpRoute",
      undefined,
      "handler:shared",
      [
        createUnresolvedCall(
          "handler:shared",
          `missing:shared:${index}`,
          `edge:shared:${index}`,
          index
        ),
        createUnresolvedCall(
          `handler:unique:${index}`,
          `missing:unique:${index}`,
          `edge:unique:${index}`,
          index
        )
      ]
    );
    const traversalGap = createTraversalGap(flow.entrypointUnitId, "handler:shared");
    traversalGap.omittedFunctionIds = [`service:omitted:${index}`];
    flow.coverageGaps.push(traversalGap);
    flows.push(flow);
  }

  for (let index = 0; index < unmappedFlowCount; index += 1) {
    const rootPath = index < unmappedFlowCount / 2
      ? "/workspace/apps/unmapped-dominant"
      : `/workspace/apps/unmapped-${index}`;
    flows.push(createUnmappedFlow(
      `route:unmapped:${index}`,
      "FastAPI",
      rootPath,
      "httpRoute"
    ));
  }

  const radar = createProjectRiskRadar(graph, createFlowIndex(graph.version, flows));
  const analysis = radar.items.find((item) => item.kind === "analysisCoverage");
  const entrypoint = radar.items.find((item) =>
    item.kind === "entrypointCoverage"
      && item.rootPath === "/workspace/apps/unmapped-dominant"
  );
  const unresolved = radar.items.find((item) =>
    item.kind === "unresolvedExecution"
      && item.sourceFunctionId === "handler:shared"
  );

  // 1 analysis + 1,501 framework roots + 3,001 unresolved source identities.
  assert.equal(radar.candidateItemCount, 4_503);
  assert.equal(radar.items.length, PROJECT_RISK_RADAR_ITEM_LIMIT);
  assert.equal(radar.omittedItemCount, 4_503 - PROJECT_RISK_RADAR_ITEM_LIMIT);
  assert.ok(analysis);
  assert.equal(analysis.errorDiagnosticCount, 3_334);
  assert.equal(analysis.warningDiagnosticCount, 3_333);
  assert.equal(analysis.traversalLimitGapCount, mappedFlowCount);
  assert.equal(analysis.evidenceCount, 9_667);
  assert.equal(analysis.affectedEntrypointCount, mappedFlowCount);
  assert.ok(entrypoint?.kind === "entrypointCoverage");
  assert.equal(entrypoint.evidenceCount, unmappedFlowCount / 2);
  assert.equal(entrypoint.affectedEntrypointCount, unmappedFlowCount / 2);
  assert.ok(unresolved?.kind === "unresolvedExecution");
  assert.equal(unresolved.unresolvedCallCount, mappedFlowCount);
  assert.equal(unresolved.affectedEntrypointCount, mappedFlowCount);

  for (const item of radar.items) {
    for (const identities of Object.values(item.evidence)) {
      assert.ok(identities.length <= PROJECT_RISK_EVIDENCE_IDENTITY_LIMIT);
    }
  }
});

test("Project Overview composes supplied brief and radar without protocol objects", () => {
  const graph = createGraph();
  const index = createFlowIndex(graph.version, [
    createMappedFlow(
      "route:overview",
      "Express",
      "/workspace/apps/api",
      "httpRoute",
      undefined,
      "handler:shared",
      []
    )
  ]);
  const overview = createProjectOverview(graph, index);

  assert.equal(overview.graphVersion, graph.version);
  assert.deepEqual(overview.brief, createProjectBrief(graph, index));
  assert.deepEqual(overview.radar, createProjectRiskRadar(graph, index));
  assert.doesNotThrow(() => JSON.stringify(overview));
});

/** Creates a compact graph with explicit stack and diagnostic evidence. */
function createGraph(): ProjectGraph {
  const nodes = [
    createNode("handler:shared", "SharedHandler.handle", "/workspace/src/shared.ts", 4),
    createNode("handler:other", "OtherHandler.handle", "/workspace/src/other.ts", 6),
    createNode("service", "UserService.load", "/workspace/src/service.ts", 8, "method"),
    createNode("constructor", "Result", "/workspace/src/result.ts", 10, "constructor"),
    createNode("file", "shared.ts", "/workspace/src/shared.ts", 0, "file")
  ];
  const edges: GraphEdge[] = [
    createEdge("edge:resolved", "handler:shared", "service", "resolved"),
    createEdge("edge:missing", "handler:shared", "missing:graph", "unresolved"),
    createEdge("edge:inferred", "handler:other", "service", "inferred")
  ];
  const diagnostics: AnalysisDiagnostic[] = [
    {
      severity: "error",
      code: "analysis.fileFailed",
      message: "Could not parse file",
      filePath: "/workspace/src/broken.ts",
      range: createRange(2)
    },
    {
      severity: "warning",
      code: "analysis.fallback",
      message: "Fallback analyzer used"
    },
    {
      severity: "info",
      code: "analysis.note",
      message: "Analysis note"
    }
  ];

  return {
    workspaceRoot: "/workspace",
    version: "project-overview-test",
    generatedAt: "2026-07-13T00:00:00.000Z",
    nodes,
    edges,
    diagnostics,
    metadata: {
      languages: ["python", "typescript"],
      languageSummary: [
        { language: "python", fileCount: 3, percentage: 25 },
        { language: "typescript", fileCount: 9, percentage: 75 }
      ],
      frameworks: [
        {
          name: "GraphQL",
          ecosystem: "javascript",
          category: "backend",
          confidence: "high",
          rootPath: "/workspace/apps/graphql",
          evidence: ["package.json"]
        },
        {
          name: "Express",
          ecosystem: "javascript",
          category: "backend",
          confidence: "high",
          rootPath: "/workspace/apps/api",
          evidence: ["package.json"]
        }
      ],
      frameworkUnits: [{
        id: "django:app",
        framework: "Django",
        rootPath: "/workspace/apps/admin",
        kind: "app",
        name: "admin",
        filePath: "/workspace/apps/admin/apps.py"
      }],
      fileCount: 12,
      symbolCount: nodes.length,
      edgeCount: edges.length
    }
  };
}

/** Creates multiple mapped flows in the same execution group. */
function createMappedFlows(
  framework: string,
  rootPath: string,
  entrypointKind: SemanticFlowEntrypointKind,
  operationType: "Query" | "Mutation" | "Subscription" | undefined,
  count: number,
  prefix: string
): SemanticFlow[] {
  const flows: SemanticFlow[] = [];

  for (let index = 0; index < count; index += 1) {
    flows.push(createMappedFlow(
      `${prefix}:${index}`,
      framework,
      rootPath,
      entrypointKind,
      operationType,
      `handler:${prefix}:${index}`,
      []
    ));
  }

  return flows;
}

/** Creates one mapped entrypoint with optional bounded call steps. */
function createMappedFlow(
  entrypointUnitId: string,
  framework: string,
  rootPath: string,
  entrypointKind: SemanticFlowEntrypointKind,
  operationType: "Query" | "Mutation" | "Subscription" | undefined,
  handlerFunctionId: string,
  calls: SemanticFlowStep[]
): SemanticFlow {
  const graphql = entrypointKind === "graphqlOperation";
  const name = entrypointUnitId.split(":").at(-1) ?? entrypointUnitId;
  const entrypointStep: SemanticFlowStep = {
    kind: graphql ? "operation" : "route",
    depth: 0,
    role: graphql ? "resolver" : "routeHandler",
    resolution: "unresolved",
    frameworkUnitId: entrypointUnitId,
    framework,
    unitKind: graphql ? "operation" : "route",
    name,
    qualifiedName: graphql ? `${operationType ?? "Other"}.${name}` : name,
    filePath: `/workspace/${framework.toLowerCase()}/${name}.ts`,
    range: createRange(1)
  };
  const handlerStep: SemanticFlowStep = {
    kind: "handler",
    depth: 1,
    role: graphql ? "resolver" : "routeHandler",
    resolution: "concrete",
    frameworkUnitId: entrypointUnitId,
    functionId: handlerFunctionId,
    framework,
    unitKind: graphql ? "operation" : "route",
    name: handlerFunctionId,
    functionName: handlerFunctionId,
    filePath: entrypointStep.filePath,
    range: createRange(2)
  };

  return {
    id: entrypointUnitId,
    entrypointKind,
    entrypointUnitId,
    routeUnitId: graphql ? undefined : entrypointUnitId,
    framework,
    rootPath,
    name,
    steps: [entrypointStep, handlerStep, ...calls],
    evidence: [{
      kind: "directCallable",
      confidence: "exact",
      description: "fixture callable",
      entrypointUnitId,
      routeUnitId: graphql ? undefined : entrypointUnitId,
      frameworkUnitId: entrypointUnitId,
      functionId: handlerFunctionId
    }],
    confidence: "exact",
    coverageGaps: []
  };
}

/** Creates an entrypoint whose handler or resolver is not mapped. */
function createUnmappedFlow(
  entrypointUnitId: string,
  framework: string,
  rootPath: string,
  entrypointKind: SemanticFlowEntrypointKind
): SemanticFlow {
  const graphql = entrypointKind === "graphqlOperation";
  const gap: SemanticFlowCoverageGap = {
    entrypointUnitId,
    routeUnitId: graphql ? undefined : entrypointUnitId,
    reason: "handlerNotMapped",
    message: "No callable handler mapped",
    candidateFunctionIds: [],
    targetFrameworkUnitIds: [`${entrypointUnitId}:target`],
    omittedFunctionIds: []
  };

  return {
    id: entrypointUnitId,
    entrypointKind,
    entrypointUnitId,
    routeUnitId: graphql ? undefined : entrypointUnitId,
    framework,
    rootPath,
    name: entrypointUnitId,
    steps: [{
      kind: graphql ? "operation" : "route",
      depth: 0,
      role: graphql ? "resolver" : "routeHandler",
      resolution: "unresolved",
      frameworkUnitId: entrypointUnitId,
      framework,
      unitKind: graphql ? "operation" : "route",
      name: entrypointUnitId,
      qualifiedName: graphql ? `Query.${entrypointUnitId}` : entrypointUnitId,
      filePath: `/workspace/${framework.toLowerCase()}/entrypoint.ts`,
      range: createRange(3)
    }],
    evidence: [],
    coverageGaps: [gap]
  };
}

/** Creates an operation with two equally supported resolver candidates. */
function createAmbiguousFlow(
  entrypointUnitId: string,
  framework: string,
  rootPath: string,
  entrypointKind: SemanticFlowEntrypointKind
): SemanticFlow {
  const flow = createUnmappedFlow(entrypointUnitId, framework, rootPath, entrypointKind);
  flow.coverageGaps = [{
    ...flow.coverageGaps[0],
    reason: "ambiguous",
    message: "Multiple callable handlers mapped",
    candidateFunctionIds: ["resolver:a", "resolver:b"]
  }];
  flow.confidence = "resolved";
  return flow;
}

/** Creates one edge-local unresolved call step. */
function createUnresolvedCall(
  sourceFunctionId: string,
  targetFunctionId: string,
  callEdgeId: string,
  startLine: number
): SemanticFlowStep {
  return {
    kind: "call",
    depth: 2,
    role: "unknown",
    resolution: "unresolved",
    relation: "calls",
    parentFunctionId: sourceFunctionId,
    callEdgeId,
    confidence: "unresolved",
    functionId: targetFunctionId,
    name: targetFunctionId,
    filePath: "/workspace/src/shared.ts",
    range: createRange(startLine)
  };
}

/** Creates one flow traversal frontier with preserved omitted identities. */
function createTraversalGap(
  entrypointUnitId: string,
  sourceFunctionId: string
): SemanticFlowCoverageGap {
  return {
    entrypointUnitId,
    routeUnitId: entrypointUnitId,
    reason: "depthLimit",
    message: "Depth limit reached",
    candidateFunctionIds: [],
    targetFrameworkUnitIds: [],
    sourceFunctionId,
    omittedFunctionIds: ["service:omitted"],
    limit: 3
  };
}

/** Builds all canonical indexes and counters expected by Overview consumers. */
function createFlowIndex(graphVersion: string, flows: SemanticFlow[]): SemanticFlowIndex {
  const flowsByEntrypointUnitId = new Map<string, SemanticFlow[]>();
  const flowsByRouteUnitId = new Map<string, SemanticFlow[]>();
  const coverageGapsByEntrypointUnitId = new Map<string, SemanticFlowCoverageGap[]>();
  const coverageGapsByRouteUnitId = new Map<string, SemanticFlowCoverageGap[]>();
  const coverageGaps: SemanticFlowCoverageGap[] = [];

  for (const flow of flows) {
    flowsByEntrypointUnitId.set(flow.entrypointUnitId, [flow]);

    if (flow.routeUnitId) {
      flowsByRouteUnitId.set(flow.routeUnitId, [flow]);
    }

    if (flow.coverageGaps.length > 0) {
      coverageGaps.push(...flow.coverageGaps);
      coverageGapsByEntrypointUnitId.set(flow.entrypointUnitId, flow.coverageGaps);

      if (flow.routeUnitId) {
        coverageGapsByRouteUnitId.set(flow.routeUnitId, flow.coverageGaps);
      }
    }
  }

  const ambiguousFlows = flows.filter((flow) =>
    flow.coverageGaps.some((gap) => gap.reason === "ambiguous")
  );

  return {
    graphVersion,
    flows,
    flowsByEntrypointUnitId,
    flowsByRouteUnitId,
    coverageGaps,
    coverageGapsByEntrypointUnitId,
    coverageGapsByRouteUnitId,
    summary: {
      graphVersion,
      entrypointCount: flows.length,
      routeCount: flows.filter((flow) => flow.entrypointKind === "httpRoute").length,
      operationCount: flows.filter((flow) => flow.entrypointKind === "graphqlOperation").length,
      mappedHandlerCount: flows.filter((flow) => flow.steps.some((step) =>
        step.kind === "handler" && step.resolution === "concrete"
      )).length,
      ambiguousEntrypointCount: ambiguousFlows.length,
      ambiguousRouteCount: ambiguousFlows.filter((flow) => flow.entrypointKind === "httpRoute").length,
      ambiguousOperationCount: ambiguousFlows.filter((flow) => flow.entrypointKind === "graphqlOperation").length,
      handlerNotMappedCount: flows.filter((flow) =>
        flow.coverageGaps.some((gap) => gap.reason === "handlerNotMapped")
      ).length
    }
  };
}

/** Creates one concrete graph symbol. */
function createNode(
  id: string,
  qualifiedName: string,
  filePath: string,
  startLine: number,
  kind: SymbolNode["kind"] = "function"
): SymbolNode {
  const range = createRange(startLine);
  return {
    id,
    kind,
    name: qualifiedName.split(".").at(-1) ?? qualifiedName,
    qualifiedName,
    filePath,
    range,
    selectionRange: range,
    language: "typescript"
  };
}

/** Creates one source-backed call edge. */
function createEdge(
  id: string,
  sourceId: string,
  targetId: string,
  confidence: GraphEdge["confidence"]
): GraphEdge {
  return {
    id,
    kind: "calls",
    sourceId,
    targetId,
    filePath: "/workspace/src/shared.ts",
    range: createRange(15),
    confidence
  };
}

/** Creates one compact single-line range. */
function createRange(startLine: number): SourceRange {
  return {
    startLine,
    startCharacter: 0,
    endLine: startLine,
    endCharacter: 20
  };
}
