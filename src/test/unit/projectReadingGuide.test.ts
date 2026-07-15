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
  PROJECT_READING_STEP_LIMIT
} from "../../insights/projectReadingGuide";
import type {
  SemanticFlow,
  SemanticFlowCoverageGap,
  SemanticFlowStep
} from "../../insights/semanticFlow";
import type {
  DetectedFramework,
  ProjectGraph
} from "../../shared/types";
import {
  createCallable,
  createCallStep,
  createFlowIndex,
  createFramework,
  createFrameworkUnit,
  createGraph,
  createMappedFlow,
  createMappingGap,
  createUnmappedFlow,
  projectOnlyScope,
  requireScope
} from "./helpers/projectReadingGuideFixtures";

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
  assert.equal(guide.workspaceRoot, graph.workspaceRoot);
  assert.equal(guide.areas.length, PROJECT_READING_AREA_LIMIT);
  assert.equal(guide.totalAreaCount, 8);
  assert.equal(guide.omittedAreaCount, 3);
  assert.deepEqual(
    guide.areas.map((area) => area.displayPath),
    ["apps/api", "apps/web", "config", "lib/core", "packages/shared"]
  );
  assert.equal(guide.areas.every((area) => area.basis === "sourceDirectory"), true);
  assert.deepEqual(guide.areas[0]?.representativeFilePaths, ["apps/api/src/main.ts"]);
  assert.ok(guide.areas.flatMap((area) => area.representativeFilePaths).every((filePath) =>
    !filePath.startsWith(graph.workspaceRoot)
  ));
  assert.equal(guide.readingPaths.length, 0);
  assert.equal(guide.mappedFlowCount, 0);
});

test("uses stable entrypoint identity when paths have equal learning evidence", () => {
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
    ["http", "http", "http"]
  );
  assert.deepEqual(
    guide.readingPaths.map((path) => path.entrypointUnitId),
    ["http:a", "http:b", "http:c"]
  );
  assert.equal(guide.mappedFlowCount, 6);
  assert.equal(guide.omittedMappedFlowCount, 3);
  assert.equal(guide.unmappedEntrypointCount, 1);
});

test("ranks a business-layer candidate above alphabetic and transport order", () => {
  const root = "/workspace/apps/api";
  const plain = createMappedFlow("http:a-plain", "Express", root, "httpRoute", undefined);
  const recommended = createMappedFlow(
    "mutation:z-business",
    "GraphQL",
    root,
    "graphqlOperation",
    "Mutation"
  );
  const handlerId = `${recommended.entrypointUnitId}:handler`;
  recommended.steps.push(
    createCallStep(
      "place-order",
      handlerId,
      "service",
      2,
      "/workspace/apps/api/application/place-order.ts"
    ),
    createCallStep(
      "orders-model",
      "place-order",
      "model",
      3,
      "/workspace/apps/api/persistence/orders.ts"
    )
  );
  const graph = createGraph({
    frameworks: [createFramework("Express", root), createFramework("GraphQL", root)],
    files: [
      "/workspace/apps/api/routes.ts",
      "/workspace/apps/api/application/place-order.ts",
      "/workspace/apps/api/persistence/orders.ts"
    ],
    callables: [
      createCallable("place-order", "/workspace/apps/api/application/place-order.ts"),
      createCallable("orders-model", "/workspace/apps/api/persistence/orders.ts")
    ]
  });
  const guide = projectOnlyScope(graph, [plain, recommended]);

  assert.equal(guide.readingPaths[0]?.entrypointUnitId, "mutation:z-business");
  assert.equal(
    guide.readingPaths[0]?.recommendation.businessReach,
    "applicationCandidateReached"
  );
  assert.equal(guide.readingPaths[0]?.steps[2]?.architecture.layer, "application");
  assert.deepEqual(guide.readingPaths[0]?.steps[2]?.readingCues, [
    "startHere",
    "businessLogicCandidate"
  ]);
  assert.equal(guide.readingPaths[0]?.steps.at(-1)?.architecture.layer, "dataAccess");
  assert.match(guide.readingPaths[0]?.recommendation.explanation ?? "", /purity is unknown/u);
});

test("prefers exact handler mapping before candidate kind within a complete path tier", () => {
  const root = "/workspace/apps/api";
  const inferredDomain = createMappedFlow(
    "http:inferred-domain",
    "Express",
    root,
    "httpRoute",
    undefined
  );
  const exactApplication = createMappedFlow(
    "http:exact-application",
    "Express",
    root,
    "httpRoute",
    undefined
  );
  inferredDomain.confidence = "inferred";
  exactApplication.confidence = "exact";
  inferredDomain.steps.push(
    createCallStep(
      "domain-policy",
      `${inferredDomain.entrypointUnitId}:handler`,
      "unknown",
      2,
      `${root}/domain/order-policy.ts`
    ),
    createCallStep(
      "domain-store",
      "domain-policy",
      "repository",
      3,
      `${root}/persistence/domain-store.ts`
    )
  );
  exactApplication.steps.push(
    createCallStep(
      "application-workflow",
      `${exactApplication.entrypointUnitId}:handler`,
      "service",
      2,
      `${root}/application/place-order.ts`
    ),
    createCallStep(
      "application-store",
      "application-workflow",
      "repository",
      3,
      `${root}/persistence/application-store.ts`
    )
  );
  const graph = createGraph({
    frameworks: [createFramework("Express", root)],
    files: [...inferredDomain.steps, ...exactApplication.steps].map((step) => step.filePath),
    callables: [
      createCallable("domain-policy", `${root}/domain/order-policy.ts`),
      createCallable("domain-store", `${root}/persistence/domain-store.ts`),
      createCallable("application-workflow", `${root}/application/place-order.ts`),
      createCallable("application-store", `${root}/persistence/application-store.ts`)
    ]
  });
  const guide = projectOnlyScope(graph, [inferredDomain, exactApplication]);

  assert.equal(guide.readingPaths[0]?.entrypointUnitId, "http:exact-application");
  assert.equal(guide.readingPaths[0]?.confidence, "exact");
  assert.equal(guide.readingPaths[1]?.recommendation.businessReach, "domainCandidateReached");
});

test("prefers a reachable domain candidate over an earlier application branch", () => {
  const root = "/workspace/apps/api";
  const flow = createMappedFlow("http:domain", "Express", root, "httpRoute", undefined);
  const handlerId = `${flow.entrypointUnitId}:handler`;
  flow.steps.push(
    createCallStep(
      "application-workflow",
      handlerId,
      "unknown",
      2,
      "/workspace/apps/api/application/workflow.ts"
    ),
    createCallStep(
      "domain-policy",
      handlerId,
      "unknown",
      3,
      "/workspace/apps/api/domain/order-policy.ts"
    ),
    createCallStep(
      "orders-store",
      "domain-policy",
      "unknown",
      4,
      "/workspace/apps/api/persistence/orders.ts"
    )
  );
  const graph = createGraph({
    frameworks: [createFramework("Express", root)],
    files: flow.steps.map((step) => step.filePath),
    callables: [
      createCallable("application-workflow", "/workspace/apps/api/application/workflow.ts"),
      createCallable("domain-policy", "/workspace/apps/api/domain/order-policy.ts"),
      createCallable("orders-store", "/workspace/apps/api/persistence/orders.ts")
    ]
  });
  const path = projectOnlyScope(graph, [flow]).readingPaths[0];

  assert.equal(path?.recommendation.businessReach, "domainCandidateReached");
  assert.equal(path?.steps[path.recommendation.targetStepIndex ?? -1]?.functionId, "domain-policy");
  assert.equal(path?.steps.some((step) => step.functionId === "application-workflow"), false);
  assert.equal(path?.steps.at(-1)?.architecture.layer, "dataAccess");
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
  assert.equal(readingPath.recommendation.businessReach, "workflowBridgeCandidateReached");
  assert.equal(
    readingPath.steps[readingPath.recommendation.targetStepIndex ?? -1]?.functionId,
    "orchestrator"
  );
  assert.equal(readingPath.steps[2]?.architecture.layer, "unclassified");
  assert.equal(readingPath.steps[2]?.contextInference?.confidence, "low");
  assert.deepEqual(readingPath.steps[2]?.readingCues, [
    "startHere",
    "workflowBridgeCandidate"
  ]);
});

test("finds a low-confidence workflow bridge in a generic layout without changing its layer", () => {
  const root = "/workspace/apps/api";
  const flow = createMappedFlow("http:generic-workflow", "Express", root, "httpRoute", undefined);
  const handlerId = `${flow.entrypointUnitId}:handler`;
  flow.steps.push(
    createCallStep("direct-store", handlerId, "repository", 2, `${root}/persistence/direct.ts`),
    createCallStep("order-workflow", handlerId, "unknown", 2, `${root}/src/orders.ts`),
    createCallStep("orders-store", "order-workflow", "repository", 3, `${root}/persistence/orders.ts`)
  );
  const graph = createGraph({
    frameworks: [createFramework("Express", root)],
    files: flow.steps.map((step) => step.filePath),
    callables: [
      createCallable("direct-store", `${root}/persistence/direct.ts`),
      createCallable("order-workflow", `${root}/src/orders.ts`),
      createCallable("orders-store", `${root}/persistence/orders.ts`)
    ]
  });
  const forward = projectOnlyScope(graph, [flow]).readingPaths[0];
  const reversed = projectOnlyScope(
    { ...graph, nodes: [...graph.nodes].reverse() },
    [{ ...flow, steps: [...flow.steps].reverse() }]
  ).readingPaths[0];

  assert.deepEqual(reversed, forward);
  assert.equal(forward?.recommendation.businessReach, "workflowBridgeCandidateReached");
  const target = forward?.steps[forward.recommendation.targetStepIndex ?? -1];
  assert.equal(target?.functionId, "order-workflow");
  assert.equal(target?.architecture.layer, "unclassified");
  assert.equal(target?.architecture.businessLogic, "unknown");
  assert.equal(target?.architecture.purity, "unknown");
  assert.equal(target?.contextInference?.role, "workflowBridgeCandidate");
  assert.equal(forward?.steps.at(-1)?.functionId, "orders-store");
  assert.equal(forward?.steps.at(-1)?.boundaryKind, "repository");
  assert.equal(forward?.steps.some((step) => step.functionId === "direct-store"), false);
});

test("does not infer a workflow bridge from direct, unresolved, terminal, or non-local boundaries", () => {
  const root = "/workspace/apps/api";
  const fixtures: Array<{ id: string; calls: SemanticFlowStep[] }> = [];

  for (const boundary of ["repository", "unresolved", "terminal", "external"] as const) {
    const id = `http:no-bridge-${boundary}`;
    const handlerId = `${id}:handler`;
    const first = boundary === "repository"
      ? createCallStep(`${boundary}-target`, handlerId, "repository", 2, `${root}/persistence/direct.ts`)
      : createCallStep(`${boundary}-helper`, handlerId, "unknown", 2, `${root}/src/${boundary}.ts`);
    const calls = [first];
    if (boundary === "unresolved" || boundary === "external") {
      calls.push({
        ...createCallStep(`${boundary}-target`, first.functionId ?? "", "unknown", 3, `${root}/src/${boundary}.ts`),
        resolution: boundary,
        confidence: boundary === "unresolved" ? "unresolved" : "resolved"
      });
    }
    fixtures.push({ id, calls });
  }

  for (const fixture of fixtures) {
    const flow = createMappedFlow(fixture.id, "Express", root, "httpRoute", undefined);
    flow.steps.push(...fixture.calls);
    const graph = createGraph({
      frameworks: [createFramework("Express", root)],
      files: flow.steps.map((step) => step.filePath),
      callables: fixture.calls
        .filter((step) => step.resolution === "concrete" && step.functionId)
        .map((step) => createCallable(step.functionId ?? "missing", step.filePath))
    });
    const path = projectOnlyScope(graph, [flow]).readingPaths[0];

    assert.equal(path?.recommendation.businessReach, "noCandidateObserved", fixture.id);
    assert.equal(path?.steps.some((step) => step.contextInference !== undefined), false, fixture.id);
  }
});

test("ranks mapped, unresolved, then limited paths with equal candidate evidence", () => {
  const root = "/workspace/apps/api";
  const limited = createMappedFlow("http:a-limited", "Express", root, "httpRoute", undefined);
  const unresolved = createMappedFlow("http:m-unresolved", "Express", root, "httpRoute", undefined);
  const complete = createMappedFlow("http:z-complete", "Express", root, "httpRoute", undefined);
  for (const flow of [limited, unresolved, complete]) {
    const handlerId = `${flow.entrypointUnitId}:handler`;
    flow.steps.push(
      createCallStep(`${flow.id}:workflow`, handlerId, "unknown", 2, `${root}/application/workflow.ts`),
      createCallStep(`${flow.id}:store`, `${flow.id}:workflow`, "repository", 3, `${root}/persistence/store.ts`)
    );
  }
  limited.coverageGaps.push({
    entrypointUnitId: limited.entrypointUnitId,
    routeUnitId: limited.routeUnitId,
    reason: "depthLimit",
    message: "limited fixture",
    candidateFunctionIds: [],
    targetFrameworkUnitIds: [],
    omittedFunctionIds: ["deeper-call"],
    limit: 2
  });
  unresolved.steps.push({
    ...createCallStep(
      "dynamic-target",
      `${unresolved.entrypointUnitId}:handler`,
      "unknown",
      2,
      `${root}/src/dynamic.ts`
    ),
    resolution: "unresolved",
    confidence: "unresolved"
  });
  const graph = createGraph({
    frameworks: [createFramework("Express", root)],
    files: [...limited.steps, ...unresolved.steps, ...complete.steps].map((step) => step.filePath),
    callables: [...limited.steps, ...unresolved.steps, ...complete.steps]
      .filter((step) => step.kind === "call" && step.resolution === "concrete" && step.functionId)
      .map((step) => createCallable(step.functionId ?? "missing", step.filePath))
  });
  const guide = projectOnlyScope(graph, [limited, unresolved, complete]);

  assert.equal(guide.readingPaths[0]?.entrypointUnitId, "http:z-complete");
  assert.equal(guide.readingPaths[1]?.entrypointUnitId, "http:m-unresolved");
  assert.equal(guide.readingPaths[2]?.entrypointUnitId, "http:a-limited");
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
