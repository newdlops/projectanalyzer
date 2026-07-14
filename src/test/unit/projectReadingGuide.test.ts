/**
 * Unit tests for the bounded two-stage Project Reading Guide domain.
 *
 * Fixtures cover normalized scope merging, source-only repositories, exact
 * omission counts, transport-diverse flow examples, evidence-backed boundary
 * chains, deterministic shuffled input, and large fixed-top-K candidate sets.
 */

import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  createProjectReadingGuideProjector,
  PROJECT_READING_AREA_LIMIT,
  PROJECT_READING_PATH_LIMIT,
  PROJECT_READING_SCOPE_LIMIT,
  PROJECT_READING_STEP_LIMIT,
  type ProjectScopeReadingGuide
} from "../../insights/projectReadingGuide";
import type {
  SemanticFlow,
  SemanticFlowCoverageGap,
  SemanticFlowIndex,
  SemanticFlowStep
} from "../../insights/semanticFlow";
import type {
  DetectedFramework,
  FrameworkUnit,
  ProjectGraph,
  SourceRange,
  SymbolNode
} from "../../shared/types";

test("Project Reading Guide stays independent from application, protocol, and host UI", async () => {
  const projectRoot = path.resolve(__dirname, "../../..");
  const moduleRoot = path.join(projectRoot, "src", "insights", "projectReadingGuide");
  const sourceFiles = (await readdir(moduleRoot))
    .filter((fileName) => fileName.endsWith(".ts"));

  assert.ok(sourceFiles.length >= 7);
  for (const fileName of sourceFiles) {
    const source = await readFile(path.join(moduleRoot, fileName), "utf8");
    assert.doesNotMatch(
      source,
      /from\s+["'][^"']*(?:application|extension|protocol|webview|vscode)[^"']*["']/u
    );
  }
});

test("merges same-root frameworks and preserves exact HTTP and GraphQL counters", () => {
  const root = "/workspace/apps/api";
  const flows = [
    createMappedFlow("http:users", "NestJS", root, "httpRoute", undefined),
    createMappedFlow("query:user", "GraphQL", root, "graphqlOperation", "Query"),
    createMappedFlow("mutation:user", "GraphQL", root, "graphqlOperation", "Mutation"),
    createMappedFlow("subscription:user", "GraphQL", root, "graphqlOperation", "Subscription"),
    createMappedFlow("other:user", "GraphQL", root, "graphqlOperation", "Other", {
      gaps: [createMappingGap("other:user")]
    }),
    createMappedFlow("admin:route", "Django", "/workspace/apps/admin", "httpRoute", undefined)
  ];
  const frameworks: DetectedFramework[] = [
    createFramework("NestJS", root),
    createFramework("GraphQL", "apps/api/"),
    createFramework("Django", "/workspace/apps/admin"),
    createFramework("Express", "/workspace/apps/misc")
  ];
  const units = [
    createFrameworkUnit("zeta:app", "Internal", "/workspace/apps/zeta")
  ];
  const graph = createGraph({
    frameworks,
    units,
    files: [
      "/workspace/apps/api/src/main.ts",
      "/workspace/apps/admin/views.py",
      "/workspace/apps/misc/index.ts",
      "/workspace/apps/zeta/app.ts"
    ],
    callables: [
      createCallable("api:handler", "/workspace/apps/api/src/main.ts"),
      createCallable("admin:handler", "/workspace/apps/admin/views.py")
    ]
  });
  const projector = createProjectReadingGuideProjector(graph, createFlowIndex(graph.version, flows));
  const index = projector.projectIndex();

  assert.equal(index.scopes.length, PROJECT_READING_SCOPE_LIMIT);
  assert.equal(index.totalScopeCount, 4);
  assert.equal(index.omittedScopeCount, 1);
  const api = index.scopes.find((scope) => scope.displayPath === "apps/api");

  assert.ok(api);
  assert.equal(api.basis, "application");
  assert.deepEqual(api.frameworks, ["GraphQL", "NestJS"]);
  assert.equal(api.frameworkCount, 2);
  assert.equal(api.analyzedFileCount, 1);
  assert.equal(api.callableCount, 1);
  assert.deepEqual(api.execution, {
    entrypointCount: 5,
    mappedCount: 5,
    mappingGapCount: 1,
    httpRouteCount: 1,
    graphqlQueryCount: 1,
    graphqlMutationCount: 1,
    graphqlSubscriptionCount: 1,
    graphqlOtherCount: 1
  });

  const apiGuide = requireScope(projector.projectScope(api.id));
  const frameworkArea = apiGuide.areas.find((area) => area.displayPath === "apps/api");
  const sourceArea = apiGuide.areas.find((area) => area.displayPath === "apps/api/src");
  assert.equal(frameworkArea?.basis, "frameworkRoot");
  assert.equal(frameworkArea?.entrypointCount, 5);
  assert.equal(sourceArea?.analyzedFileCount, 1);
  assert.equal(sourceArea?.callableCount, 1);
});

test("merges Windows root casing while retaining a deterministic display path", () => {
  const graph = createGraph({
    frameworks: [
      createFramework("NestJS", "C:\\Repo\\Apps\\Api"),
      createFramework("GraphQL", "c:/REPO/apps/API/")
    ],
    files: ["C:\\Repo\\Apps\\Api\\Src\\Controllers\\main.ts"]
  });
  graph.workspaceRoot = "C:\\Repo";
  const flows = [
    createMappedFlow(
      "query:windows",
      "GraphQL",
      "c:/repo/apps/api",
      "graphqlOperation",
      "Query"
    )
  ];
  const projector = createProjectReadingGuideProjector(
    graph,
    createFlowIndex(graph.version, flows)
  );
  const index = projector.projectIndex();

  assert.equal(index.totalScopeCount, 1);
  assert.deepEqual(index.scopes[0]?.frameworks, ["GraphQL", "NestJS"]);
  assert.equal(index.scopes[0]?.displayPath, "Apps/Api");
  const guide = requireScope(projector.projectScope(index.scopes[0]?.id ?? ""));
  assert.equal(guide.areas.some((area) => area.displayPath === "Apps/Api/Src/Controllers"), true);
});

test("ranks measured application exposure before a zero-entrypoint parent scope", () => {
  const flows = Array.from({ length: 12 }, (_, index) =>
    createMappedFlow(
      `api:${String(index).padStart(2, "0")}`,
      "FastAPI",
      "/workspace/apps/api",
      "httpRoute",
      undefined
    )
  );
  const graph = createGraph({
    units: [
      createFrameworkUnit("workspace:app", "WorkspaceApp", "/workspace"),
      createFrameworkUnit("api:app", "FastAPI", "/workspace/apps/api")
    ],
    files: ["/workspace/README.md", "/workspace/apps/api/main.py"]
  });
  const index = createProjectReadingGuideProjector(
    graph,
    createFlowIndex(graph.version, flows)
  ).projectIndex();

  assert.equal(index.scopes[0]?.displayPath, "apps/api");
  assert.equal(index.scopes[0]?.execution.entrypointCount, 12);
  assert.equal(index.scopes[1]?.displayPath, ".");
  assert.equal(index.scopes[1]?.basis, "application");
});

test("creates a source-only scope and two-segment source areas without framework guesses", () => {
  const files = [
    "/workspace/apps/api/src/main.ts",
    "/workspace/apps/web/src/main.ts",
    "/workspace/packages/shared/index.ts",
    "/workspace/services/worker/worker.ts",
    "/workspace/src/controllers/users.ts",
    "/workspace/src/models/user.ts",
    "/workspace/lib/core/log.ts",
    "/workspace/config/settings.ts"
  ];
  const graph = createGraph({
    files,
    callables: [
      createCallable("users", "/workspace/src/controllers/users.ts"),
      createCallable("worker", "/workspace/services/worker/worker.ts")
    ]
  });
  const projector = createProjectReadingGuideProjector(
    graph,
    createFlowIndex(graph.version, [])
  );
  const index = projector.projectIndex();

  assert.equal(index.scopes.length, 1);
  assert.equal(index.scopes[0]?.basis, "source");
  assert.equal(index.scopes[0]?.displayPath, ".");
  assert.deepEqual(index.scopes[0]?.frameworks, []);
  assert.equal(index.scopes[0]?.analyzedFileCount, files.length);
  assert.equal(index.scopes[0]?.callableCount, 2);

  const guide = requireScope(projector.projectScope(index.scopes[0]?.id ?? ""));
  assert.equal(guide.areas.length, PROJECT_READING_AREA_LIMIT);
  assert.equal(guide.totalAreaCount, 8);
  assert.equal(guide.omittedAreaCount, 3);
  assert.deepEqual(
    guide.areas.map((area) => area.displayPath),
    ["apps/api", "apps/web", "config", "lib/core", "packages/shared"]
  );
  assert.equal(guide.areas.every((area) => area.basis === "sourceDirectory"), true);
  assert.equal(guide.readingPaths.length, 0);
  assert.equal(guide.mappedFlowCount, 0);
});

test("keeps transport-diverse mapped flows before filling repeated HTTP examples", () => {
  const root = "/workspace/apps/api";
  const flows = [
    createMappedFlow("http:c", "Express", root, "httpRoute", undefined),
    createMappedFlow("http:a", "Express", root, "httpRoute", undefined),
    createMappedFlow("http:b", "Express", root, "httpRoute", undefined),
    createMappedFlow("query:z", "GraphQL", root, "graphqlOperation", "Query"),
    createMappedFlow("mutation:z", "GraphQL", root, "graphqlOperation", "Mutation"),
    createMappedFlow("subscription:z", "GraphQL", root, "graphqlOperation", "Subscription"),
    createUnmappedFlow("query:unmapped", "GraphQL", root, "Query")
  ];
  const graph = createGraph({
    frameworks: [createFramework("Express", root), createFramework("GraphQL", root)],
    files: ["/workspace/apps/api/routes.ts"]
  });
  const projector = createProjectReadingGuideProjector(
    graph,
    createFlowIndex(graph.version, flows)
  );
  const scopeId = projector.projectIndex().scopes[0]?.id ?? "";
  const guide = requireScope(projector.projectScope(scopeId));

  assert.equal(guide.readingPaths.length, PROJECT_READING_PATH_LIMIT);
  assert.deepEqual(
    guide.readingPaths.map((path) => path.transport),
    ["http", "graphqlQuery", "graphqlMutation"]
  );
  assert.equal(guide.readingPaths[0]?.entrypointUnitId, "http:a");
  assert.equal(guide.mappedFlowCount, 6);
  assert.equal(guide.omittedMappedFlowCount, 3);
  assert.equal(guide.unmappedEntrypointCount, 1);
});

test("walks an evidence-backed boundary chain instead of stopping at a helper leaf", () => {
  const root = "/workspace/apps/api";
  const flow = createMappedFlow("http:boundary", "Express", root, "httpRoute", undefined);
  const handlerId = `${flow.entrypointUnitId}:handler`;
  flow.steps.push(
    createCallStep("helper", handlerId, "unknown", 2, "/workspace/apps/api/a-helper.ts"),
    createCallStep("orchestrator", handlerId, "unknown", 2, "/workspace/apps/api/z-orchestrator.ts"),
    createCallStep("service", "orchestrator", "service", 3, "/workspace/apps/api/service.ts"),
    createCallStep("adapter", "service", "unknown", 4, "/workspace/apps/api/adapter.ts"),
    createCallStep("repository", "adapter", "repository", 5, "/workspace/apps/api/repository.ts"),
    createCallStep(handlerId, "repository", "unknown", 6, "/workspace/apps/api/cycle.ts")
  );
  const gap: SemanticFlowCoverageGap = {
    entrypointUnitId: flow.entrypointUnitId,
    routeUnitId: flow.entrypointUnitId,
    reason: "depthLimit",
    message: "bounded test path",
    candidateFunctionIds: [],
    targetFrameworkUnitIds: [],
    sourceFunctionId: "repository",
    omittedFunctionIds: ["audit"],
    limit: 5
  };
  flow.coverageGaps.push(gap);
  const graph = createGraph({
    frameworks: [createFramework("Express", root)],
    files: [
      "/workspace/apps/api/routes.ts",
      "/workspace/apps/api/a-helper.ts",
      "/workspace/apps/api/z-orchestrator.ts",
      "/workspace/apps/api/service.ts",
      "/workspace/apps/api/adapter.ts",
      "/workspace/apps/api/repository.ts"
    ]
  });
  const forward = projectOnlyScope(graph, [flow]);
  const reversedFlow: SemanticFlow = {
    ...flow,
    steps: [...flow.steps].reverse(),
    coverageGaps: [...flow.coverageGaps].reverse()
  };
  const reversedGraph: ProjectGraph = {
    ...graph,
    nodes: [...graph.nodes].reverse(),
    metadata: {
      ...graph.metadata,
      frameworks: [...(graph.metadata.frameworks ?? [])].reverse()
    }
  };
  const reversed = projectOnlyScope(reversedGraph, [reversedFlow]);

  assert.deepEqual(reversed, forward);
  const readingPath = forward.readingPaths[0];
  assert.ok(readingPath);
  assert.equal(readingPath.steps.length, PROJECT_READING_STEP_LIMIT);
  assert.deepEqual(
    readingPath.steps.map((step) => step.functionId ?? step.frameworkUnitId),
    [
      flow.entrypointUnitId,
      handlerId,
      "orchestrator",
      "service",
      "repository"
    ]
  );
  assert.equal(readingPath.steps.at(-1)?.boundaryKind, "repository");
  assert.equal(readingPath.steps.some((step) => step.functionId === "helper"), false);
  assert.equal(readingPath.totalStepCount, flow.steps.length);
  assert.equal(readingPath.omittedStepCount, flow.steps.length - PROJECT_READING_STEP_LIMIT);
  assert.equal(readingPath.traceStatus, "limited");
  assert.equal(readingPath.depthLimitReached, true);
});

test("keeps fixed top-K projections bounded with exact large-repository counts", () => {
  const root = "/workspace/apps/api";
  const flowCount = 2_000;
  const flows = Array.from({ length: flowCount }, (_, index) =>
    createMappedFlow(
      `route:${String(index).padStart(4, "0")}`,
      "Express",
      root,
      "httpRoute",
      undefined
    )
  ).reverse();
  const frameworkCount = 1_000;
  const frameworks = Array.from({ length: frameworkCount }, (_, index) =>
    createFramework(`Framework${String(index).padStart(4, "0")}`, `/workspace/scopes/${String(index).padStart(4, "0")}`)
  );
  frameworks.push(createFramework("Express", root));
  const graph = createGraph({ frameworks, files: ["/workspace/apps/api/routes.ts"] });
  const projector = createProjectReadingGuideProjector(
    graph,
    createFlowIndex(graph.version, flows)
  );
  const index = projector.projectIndex();

  assert.equal(index.scopes.length, PROJECT_READING_SCOPE_LIMIT);
  assert.equal(index.totalScopeCount, frameworkCount + 1);
  assert.equal(index.omittedScopeCount, frameworkCount + 1 - PROJECT_READING_SCOPE_LIMIT);
  assert.equal(index.scopes[0]?.displayPath, "apps/api");
  const guide = requireScope(projector.projectScope(index.scopes[0]?.id ?? ""));
  assert.equal(guide.readingPaths.length, PROJECT_READING_PATH_LIMIT);
  assert.equal(guide.mappedFlowCount, flowCount);
  assert.equal(guide.omittedMappedFlowCount, flowCount - PROJECT_READING_PATH_LIMIT);
  assert.deepEqual(
    guide.readingPaths.map((path) => path.entrypointUnitId),
    ["route:0000", "route:0001", "route:0002"]
  );
  assert.equal(projector.projectScope("missing-scope"), undefined);
});

/** Projects the only visible scope for deterministic flow comparisons. */
function projectOnlyScope(graph: ProjectGraph, flows: SemanticFlow[]): ProjectScopeReadingGuide {
  const projector = createProjectReadingGuideProjector(
    graph,
    createFlowIndex(graph.version, flows)
  );
  return requireScope(projector.projectScope(projector.projectIndex().scopes[0]?.id ?? ""));
}

/** Narrows an optional scope result inside tests. */
function requireScope(
  guide: ProjectScopeReadingGuide | undefined
): ProjectScopeReadingGuide {
  assert.ok(guide);
  return guide;
}

/** Creates a graph with explicit source file and callable fixtures. */
function createGraph(options: {
  frameworks?: DetectedFramework[];
  units?: FrameworkUnit[];
  files?: string[];
  callables?: SymbolNode[];
} = {}): ProjectGraph {
  const fileNodes = (options.files ?? []).map((filePath, index) =>
    createFileNode(`file:${index}:${filePath}`, filePath)
  );
  const nodes = fileNodes.concat(options.callables ?? []);

  return {
    workspaceRoot: "/workspace",
    version: "project-reading-guide-test",
    generatedAt: "2026-07-13T00:00:00.000Z",
    nodes,
    edges: [],
    diagnostics: [],
    metadata: {
      languages: ["typescript"],
      frameworks: options.frameworks ?? [],
      frameworkUnits: options.units ?? [],
      frameworkUnitEdges: [],
      fileCount: fileNodes.length,
      symbolCount: nodes.length,
      edgeCount: 0
    }
  };
}

/** Creates one deterministic framework detector record. */
function createFramework(name: string, rootPath: string): DetectedFramework {
  return {
    name,
    ecosystem: "test",
    category: "backend",
    confidence: "high",
    rootPath,
    evidence: [`${name} fixture`]
  };
}

/** Creates one explicit framework unit, which is application-scope evidence. */
function createFrameworkUnit(id: string, framework: string, rootPath: string): FrameworkUnit {
  return {
    id,
    framework,
    rootPath,
    kind: "app",
    name: id,
    filePath: `${rootPath}/app.ts`,
    range: createRange(0)
  };
}

/** Creates one file graph node. */
function createFileNode(id: string, filePath: string): SymbolNode {
  return {
    id,
    kind: "file",
    name: filePath.split("/").at(-1) ?? filePath,
    qualifiedName: filePath,
    filePath,
    range: createRange(0),
    selectionRange: createRange(0),
    language: filePath.endsWith(".py") ? "python" : "typescript"
  };
}

/** Creates one callable node assigned by source path. */
function createCallable(id: string, filePath: string): SymbolNode {
  return {
    id,
    kind: "function",
    name: id,
    qualifiedName: id,
    filePath,
    range: createRange(1),
    selectionRange: createRange(1),
    language: filePath.endsWith(".py") ? "python" : "typescript"
  };
}

/** Creates one mapped HTTP or GraphQL semantic flow. */
function createMappedFlow(
  id: string,
  framework: string,
  rootPath: string,
  entrypointKind: SemanticFlow["entrypointKind"],
  operationType: "Query" | "Mutation" | "Subscription" | "Other" | undefined,
  options: { gaps?: SemanticFlowCoverageGap[] } = {}
): SemanticFlow {
  const operation = entrypointKind === "graphqlOperation";
  const entrypointStep: SemanticFlowStep = {
    kind: operation ? "operation" : "route",
    depth: 0,
    role: operation ? "resolver" : "routeHandler",
    resolution: "concrete",
    frameworkUnitId: id,
    functionId: id,
    framework,
    unitKind: operation ? "operation" : "route",
    name: id,
    qualifiedName: operation ? `${operationType ?? "Other"}.${id}` : id,
    filePath: `${rootPath}/routes.ts`,
    range: createRange(0)
  };
  const handlerId = `${id}:handler`;
  const handlerStep: SemanticFlowStep = {
    kind: "handler",
    depth: 1,
    role: operation ? "resolver" : "routeHandler",
    resolution: "concrete",
    frameworkUnitId: `${id}:handler-unit`,
    functionId: handlerId,
    framework,
    unitKind: operation ? "operation" : "controller",
    name: handlerId,
    functionName: handlerId,
    functionQualifiedName: handlerId,
    filePath: `${rootPath}/handler.ts`,
    range: createRange(1)
  };

  return {
    id,
    entrypointKind,
    entrypointUnitId: id,
    routeUnitId: operation ? undefined : id,
    framework,
    rootPath,
    name: id,
    steps: [entrypointStep, handlerStep],
    evidence: [{
      kind: "directCallable",
      confidence: "resolved",
      description: "test mapping",
      entrypointUnitId: id,
      routeUnitId: operation ? undefined : id,
      frameworkUnitId: handlerStep.frameworkUnitId ?? `${id}:handler-unit`,
      functionId: handlerId
    }],
    confidence: "resolved",
    coverageGaps: options.gaps ?? []
  };
}

/** Creates a GraphQL flow with no concrete handler. */
function createUnmappedFlow(
  id: string,
  framework: string,
  rootPath: string,
  operationType: "Query" | "Mutation" | "Subscription" | "Other"
): SemanticFlow {
  const gap = createMappingGap(id);
  return {
    id,
    entrypointKind: "graphqlOperation",
    entrypointUnitId: id,
    framework,
    rootPath,
    name: id,
    steps: [{
      kind: "operation",
      depth: 0,
      role: "resolver",
      resolution: "unresolved",
      frameworkUnitId: id,
      framework,
      unitKind: "operation",
      name: id,
      qualifiedName: `${operationType}.${id}`,
      filePath: `${rootPath}/schema.ts`,
      range: createRange(0)
    }],
    evidence: [],
    coverageGaps: [gap]
  };
}

/** Creates one mapping gap associated with its entrypoint. */
function createMappingGap(entrypointUnitId: string): SemanticFlowCoverageGap {
  return {
    entrypointUnitId,
    reason: "handlerNotMapped",
    message: "test mapping gap",
    candidateFunctionIds: [],
    targetFrameworkUnitIds: [],
    omittedFunctionIds: []
  };
}

/** Creates one concrete call step linked to an explicit parent function. */
function createCallStep(
  functionId: string,
  parentFunctionId: string,
  role: SemanticFlowStep["role"],
  depth: number,
  filePath: string
): SemanticFlowStep {
  return {
    kind: "call",
    depth,
    role,
    resolution: "concrete",
    relation: "calls",
    parentFunctionId,
    callEdgeId: `edge:${parentFunctionId}:${functionId}`,
    confidence: "resolved",
    functionId,
    name: functionId,
    functionName: functionId,
    functionQualifiedName: functionId,
    filePath,
    range: createRange(depth)
  };
}

/** Creates all SemanticFlowIndex lookup maps without rebuilding analysis. */
function createFlowIndex(graphVersion: string, flows: SemanticFlow[]): SemanticFlowIndex {
  const flowsByEntrypointUnitId = new Map<string, SemanticFlow[]>();
  const flowsByRouteUnitId = new Map<string, SemanticFlow[]>();
  const coverageGapsByEntrypointUnitId = new Map<string, SemanticFlowCoverageGap[]>();
  const coverageGapsByRouteUnitId = new Map<string, SemanticFlowCoverageGap[]>();
  const coverageGaps: SemanticFlowCoverageGap[] = [];

  for (const flow of flows) {
    flowsByEntrypointUnitId.set(flow.entrypointUnitId, [flow]);
    coverageGapsByEntrypointUnitId.set(flow.entrypointUnitId, flow.coverageGaps);
    coverageGaps.push(...flow.coverageGaps);
    if (flow.routeUnitId) {
      flowsByRouteUnitId.set(flow.routeUnitId, [flow]);
      coverageGapsByRouteUnitId.set(flow.routeUnitId, flow.coverageGaps);
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
      mappedHandlerCount: flows.filter((flow) =>
        flow.steps.some((step) => step.kind === "handler" && step.functionId !== undefined)
      ).length,
      ambiguousEntrypointCount: ambiguousFlows.length,
      ambiguousRouteCount: ambiguousFlows.filter((flow) => flow.entrypointKind === "httpRoute").length,
      ambiguousOperationCount: ambiguousFlows.filter((flow) => flow.entrypointKind === "graphqlOperation").length,
      handlerNotMappedCount: flows.filter((flow) =>
        flow.coverageGaps.some((gap) => gap.reason === "handlerNotMapped")
      ).length
    }
  };
}

/** Creates a zero-based single-line source range. */
function createRange(line: number): SourceRange {
  return {
    startLine: line,
    startCharacter: 0,
    endLine: line,
    endCharacter: 1
  };
}
