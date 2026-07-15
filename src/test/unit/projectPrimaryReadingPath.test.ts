/**
 * Unit tests for graph-wide primary Project Reading Path selection.
 * Fixtures verify comparator reuse, exact diagnostics, source anchors, stable
 * input ordering, and unavailable outcomes without projecting scope areas.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createProjectReadingGuideProjector } from "../../insights/projectReadingGuide";
import type {
  SemanticFlow,
  SemanticFlowCoverageGap,
  SemanticFlowIndex,
  SemanticFlowStep
} from "../../insights/semanticFlow";
import type {
  GraphEdge,
  ProjectGraph,
  SourceRange,
  SymbolNode
} from "../../shared/types";

test("selects the same top path as its scope guide and preserves definition and callsite anchors", () => {
  const plain = createMappedFlow("plain", "/workspace/apps/plain");
  const domain = createMappedFlow("orders", "/workspace/apps/orders", [
    createCallStep("orders:domain", "orders:handler", 2, "/workspace/apps/orders/domain/order.ts"),
    createCallStep("orders:store", "orders:domain", 3, "/workspace/apps/orders/persistence/store.ts", "repository")
  ]);
  const graph = createGraph({
    nodes: [
      createCallable("plain:handler", "/workspace/apps/plain/controllers/plain.ts", 10),
      createCallable("orders:handler", "/workspace/apps/orders/controllers/orders.ts", 10),
      createCallable("orders:domain", "/workspace/apps/orders/domain/order.ts", 20),
      createCallable("orders:store", "/workspace/apps/orders/persistence/store.ts", 30)
    ],
    edges: [
      createCallEdge("orders:handler", "orders:domain", "/workspace/apps/orders/controllers/orders.ts", 15),
      createCallEdge("orders:domain", "orders:store", "/workspace/apps/orders/domain/order.ts", 25)
    ]
  });
  const projector = createProjectReadingGuideProjector(
    graph,
    createFlowIndex(graph.version, [plain, domain])
  );
  const primary = projector.projectPrimaryPath();

  assert.equal(primary.status, "selected");
  if (primary.status !== "selected") return;
  assert.equal(primary.path.entrypointUnitId, "orders");
  assert.deepEqual(primary.diagnostics, {
    supportedEntrypointCount: 2,
    mappedHandlerCount: 2,
    mappingGapCount: 0,
    eligiblePathCount: 2,
    navigableAnchorCount: 6,
    fallback: {
      kind: "sourceEvidence",
      anchor: {
        locationKind: "frameworkEvidence",
        ownerFunctionId: "orders",
        filePath: "/workspace/apps/orders/routes.ts",
        range: createRange(0),
        label: "orders entrypoint evidence"
      }
    }
  });

  const handlerStep = primary.path.steps.find((step) => step.functionId === "orders:handler");
  assert.equal(
    handlerStep?.sourceAnchors.definition?.filePath,
    "/workspace/apps/orders/controllers/orders.ts"
  );
  assert.equal(handlerStep?.sourceAnchors.definition?.range.startLine, 10);

  const domainStep = primary.path.steps.find((step) => step.functionId === "orders:domain");
  assert.equal(domainStep?.sourceAnchors.definition?.filePath, "/workspace/apps/orders/domain/order.ts");
  assert.equal(domainStep?.sourceAnchors.definition?.range.startLine, 20);
  assert.equal(domainStep?.sourceAnchors.incomingCallsite?.filePath, "/workspace/apps/orders/controllers/orders.ts");
  assert.equal(domainStep?.sourceAnchors.incomingCallsite?.range.startLine, 15);

  const scopeGuide = projector.projectScope(primary.path.scopeId);
  assert.equal(scopeGuide?.readingPaths[0]?.id, primary.path.id);
  assert.equal(projector.projectPrimaryPath(), primary);
});

test("keeps the primary result stable when scope and flow input order is reversed", () => {
  const alpha = createMappedFlow("alpha", "/workspace/apps/a");
  const zeta = createMappedFlow("zeta", "/workspace/apps/z");
  const graph = createGraph({
    nodes: [
      createCallable("alpha:handler", "/workspace/apps/a/controllers/a.ts", 1),
      createCallable("zeta:handler", "/workspace/apps/z/controllers/z.ts", 1)
    ]
  });

  const forward = createProjectReadingGuideProjector(
    graph,
    createFlowIndex(graph.version, [zeta, alpha])
  ).projectPrimaryPath();
  const reversed = createProjectReadingGuideProjector(
    graph,
    createFlowIndex(graph.version, [alpha, zeta])
  ).projectPrimaryPath();

  assert.equal(forward.status, "selected");
  assert.equal(reversed.status, "selected");
  assert.equal(
    forward.status === "selected" ? forward.path.entrypointUnitId : undefined,
    "alpha"
  );
  assert.deepEqual(reversed, forward);
});

test("reports no supported entrypoint without inventing a fallback file", () => {
  const graph = createGraph();
  const result = createProjectReadingGuideProjector(
    graph,
    createFlowIndex(graph.version, [])
  ).projectPrimaryPath();

  assert.deepEqual(result, {
    graphVersion: graph.version,
    status: "unavailable",
    diagnostics: {
      supportedEntrypointCount: 0,
      mappedHandlerCount: 0,
      mappingGapCount: 0,
      eligiblePathCount: 0,
      navigableAnchorCount: 0,
      fallback: { kind: "none" }
    }
  });
});

test("retains exact entrypoint evidence when no concrete handler is mapped", () => {
  const gap: SemanticFlowCoverageGap = {
    entrypointUnitId: "unmapped",
    reason: "handlerNotMapped",
    message: "No unique handler",
    candidateFunctionIds: [],
    targetFrameworkUnitIds: [],
    omittedFunctionIds: []
  };
  const flow: SemanticFlow = {
    id: "unmapped-flow",
    entrypointKind: "httpRoute",
    entrypointUnitId: "unmapped",
    routeUnitId: "unmapped",
    framework: "Express",
    rootPath: "/workspace/apps/api",
    name: "GET /unmapped",
    steps: [createEntrypointStep("unmapped", "/workspace/apps/api/routes.ts")],
    evidence: [],
    coverageGaps: [gap]
  };
  const graph = createGraph();
  const result = createProjectReadingGuideProjector(
    graph,
    createFlowIndex(graph.version, [flow])
  ).projectPrimaryPath();

  assert.equal(result.status, "unavailable");
  assert.equal(result.diagnostics.supportedEntrypointCount, 1);
  assert.equal(result.diagnostics.mappedHandlerCount, 0);
  assert.equal(result.diagnostics.mappingGapCount, 1);
  assert.equal(result.diagnostics.fallback.kind, "sourceEvidence");
  if (result.diagnostics.fallback.kind === "sourceEvidence") {
    assert.equal(result.diagnostics.fallback.anchor.filePath, "/workspace/apps/api/routes.ts");
  }
});

test("rejects a mapped handler with no exact navigable stop range", () => {
  const flow = createMappedFlow("range-gap", "/workspace/apps/api");
  const handler = flow.steps.find((step) => step.kind === "handler");
  if (handler) handler.range = undefined;
  const graph = createGraph();
  const result = createProjectReadingGuideProjector(
    graph,
    createFlowIndex(graph.version, [flow])
  ).projectPrimaryPath();

  assert.equal(result.status, "unavailable");
  assert.equal(result.diagnostics.mappedHandlerCount, 1);
  assert.equal(result.diagnostics.eligiblePathCount, 0);
  assert.equal(result.diagnostics.navigableAnchorCount, 0);
});

test("keeps a ten-thousand-flow primary projection bounded with exact counts", () => {
  const flows = Array.from({ length: 10_000 }, (_, index) =>
    createMappedFlow(
      `route:${String(index).padStart(5, "0")}`,
      "/workspace/apps/api"
    )
  );
  const graph = createGraph({
    nodes: flows.map((flow) => createCallable(
      `${flow.entrypointUnitId}:handler`,
      `/workspace/apps/api/controllers/${flow.entrypointUnitId}.ts`,
      1
    ))
  });
  const result = createProjectReadingGuideProjector(
    graph,
    createFlowIndex(graph.version, flows)
  ).projectPrimaryPath();

  assert.equal(result.status, "selected");
  if (result.status !== "selected") return;
  assert.equal(result.path.entrypointUnitId, "route:00000");
  assert.equal(result.path.steps.length <= 5, true);
  assert.equal(result.diagnostics.supportedEntrypointCount, 10_000);
  assert.equal(result.diagnostics.mappedHandlerCount, 10_000);
  assert.equal(result.diagnostics.eligiblePathCount, 10_000);
  assert.equal(result.diagnostics.navigableAnchorCount, 10_000);
});

function createGraph(options: { nodes?: SymbolNode[]; edges?: GraphEdge[] } = {}): ProjectGraph {
  const nodes = options.nodes ?? [];
  const edges = options.edges ?? [];
  return {
    workspaceRoot: "/workspace",
    version: "primary-reading-path-test",
    generatedAt: "2026-07-14T00:00:00.000Z",
    nodes,
    edges,
    diagnostics: [],
    metadata: {
      languages: ["typescript"],
      frameworks: [],
      frameworkUnits: [],
      frameworkUnitEdges: [],
      fileCount: 0,
      symbolCount: nodes.length,
      edgeCount: edges.length
    }
  };
}

function createMappedFlow(
  id: string,
  rootPath: string,
  calls: SemanticFlowStep[] = []
): SemanticFlow {
  return {
    id: `${id}:flow`,
    entrypointKind: "httpRoute",
    entrypointUnitId: id,
    routeUnitId: id,
    framework: "Express",
    rootPath,
    name: id,
    steps: [
      createEntrypointStep(id, `${rootPath}/routes.ts`),
      {
        kind: "handler",
        depth: 1,
        role: "controller",
        resolution: "concrete",
        functionId: `${id}:handler`,
        name: `${id}Handler`,
        filePath: `${rootPath}/controllers/${id}.ts`,
        range: createRange(1)
      },
      ...calls
    ],
    evidence: [{
      kind: "directCallable",
      confidence: "exact",
      description: "Fixture mapping",
      entrypointUnitId: id,
      routeUnitId: id,
      frameworkUnitId: id,
      functionId: `${id}:handler`
    }],
    confidence: "exact",
    coverageGaps: []
  };
}

function createEntrypointStep(id: string, filePath: string): SemanticFlowStep {
  return {
    kind: "route",
    depth: 0,
    role: "routeHandler",
    resolution: "concrete",
    functionId: id,
    frameworkUnitId: id,
    unitKind: "route",
    name: id,
    filePath,
    range: createRange(0)
  };
}

function createCallStep(
  functionId: string,
  parentFunctionId: string,
  depth: number,
  filePath: string,
  role: SemanticFlowStep["role"] = "unknown"
): SemanticFlowStep {
  return {
    kind: "call",
    depth,
    role,
    resolution: "concrete",
    relation: "calls",
    parentFunctionId,
    callEdgeId: `edge:${parentFunctionId}:${functionId}`,
    confidence: "exact",
    functionId,
    name: functionId,
    filePath,
    range: createRange(depth)
  };
}

function createCallable(id: string, filePath: string, line: number): SymbolNode {
  return {
    id,
    kind: "function",
    name: id,
    qualifiedName: id,
    filePath,
    range: createRange(line),
    selectionRange: createRange(line),
    language: "typescript"
  };
}

function createCallEdge(
  sourceId: string,
  targetId: string,
  filePath: string,
  line: number
): GraphEdge {
  return {
    id: `edge:${sourceId}:${targetId}`,
    kind: "calls",
    sourceId,
    targetId,
    filePath,
    range: createRange(line),
    confidence: "exact"
  };
}

function createFlowIndex(graphVersion: string, flows: SemanticFlow[]): SemanticFlowIndex {
  const coverageGaps = flows.flatMap((flow) => flow.coverageGaps);
  return {
    graphVersion,
    flows,
    flowsByEntrypointUnitId: new Map(flows.map((flow) => [flow.entrypointUnitId, [flow]])),
    flowsByRouteUnitId: new Map(
      flows.filter((flow) => flow.routeUnitId).map((flow) => [flow.routeUnitId ?? "", [flow]])
    ),
    coverageGaps,
    coverageGapsByEntrypointUnitId: new Map(
      flows.map((flow) => [flow.entrypointUnitId, flow.coverageGaps])
    ),
    coverageGapsByRouteUnitId: new Map(
      flows.filter((flow) => flow.routeUnitId).map((flow) => [flow.routeUnitId ?? "", flow.coverageGaps])
    ),
    summary: {
      graphVersion,
      entrypointCount: flows.length,
      routeCount: flows.length,
      operationCount: 0,
      mappedHandlerCount: flows.filter((flow) =>
        flow.steps.some((step) => step.kind === "handler" && step.functionId)
      ).length,
      ambiguousEntrypointCount: 0,
      ambiguousRouteCount: 0,
      ambiguousOperationCount: 0,
      handlerNotMappedCount: coverageGaps.filter((gap) => gap.reason === "handlerNotMapped").length
    }
  };
}

function createRange(line: number): SourceRange {
  return {
    startLine: line,
    startCharacter: 0,
    endLine: line,
    endCharacter: 1
  };
}
