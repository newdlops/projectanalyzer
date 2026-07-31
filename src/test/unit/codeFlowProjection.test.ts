/**
 * Unit tests for bounded CodeFlow application projections. Fixtures exercise
 * catalog search, reading stages, source-token safety, cycles, and depth gaps.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  CodeFlowInsightCache,
  createCodeFlowCatalogPayload,
  createEntrypointCodeFlowDetail,
  createSymbolCodeFlowDetail
} from "../../application/codeFlow";
import { createFunctionArchitectureIndex } from "../../insights/architecturalLayers";
import type { SemanticFlow } from "../../insights/semanticFlow";
import type { SourceNodeToken } from "../../protocol/sourceNavigation";
import type { GraphEdge, ProjectGraph } from "../../shared/types";
import {
  createCallable,
  createFlowIndex,
  createGraph,
  createMappedFlow,
  createUnmappedFlow
} from "./helpers/projectReadingGuideFixtures";

const deliveryVersion = "sidebar-snapshot:test-session:1";

test("entrypoint catalog is bounded, searchable, and snapshot-opaque", () => {
  const graph = createGraph();
  const flows = [
    createUnmappedFlow("Query.viewer", "GraphQL", "/workspace/graphql", "Query"),
    createMappedFlow("GET /orders", "Express", "/workspace/api", "httpRoute", undefined),
    createMappedFlow("POST /orders", "Express", "/workspace/api", "httpRoute", undefined)
  ];
  const index = createFlowIndex(graph.version, flows);
  const payload = createCodeFlowCatalogPayload(graph, index, deliveryVersion, {
    graphVersion: deliveryVersion,
    requestId: 7,
    query: "express",
    limit: 1
  });

  assert.equal(payload.requestId, 7);
  assert.equal(payload.totalMatchCount, 2);
  assert.equal(payload.items.length, 1);
  assert.equal(payload.omittedMatchCount, 1);
  assert.equal(payload.items[0]?.mapped, true);
  assert.match(payload.items[0]?.id ?? "", /^code-flow:[0-9a-f]{32}$/u);
  assert.doesNotMatch(JSON.stringify(payload), /GET \/orders:handler|\/workspace/u);

  const nextSnapshot = createCodeFlowCatalogPayload(graph, index, `${deliveryVersion}:next`, {
    graphVersion: `${deliveryVersion}:next`,
    requestId: 8,
    query: "GET /orders",
    limit: 1
  });
  assert.notEqual(nextSnapshot.items[0]?.id, payload.items[0]?.id);
});

test("entrypoint detail teaches boundary, decision, effect, and verification", () => {
  const handlerId = "GET /orders:handler";
  const serviceId = "orders-service";
  const repositoryId = "orders-repository";
  const callables = [
    createCallable(handlerId, "/workspace/src/interface/ordersController.ts"),
    createCallable(serviceId, "/workspace/src/application/ordersService.ts"),
    createCallable(repositoryId, "/workspace/src/repositories/ordersRepository.ts")
  ];
  const graph = createGraph({ files: callables.map((node) => node.filePath), callables });
  const base = createMappedFlow(
    "GET /orders",
    "Express",
    "/workspace/api",
    "httpRoute",
    undefined
  );
  const flow: SemanticFlow = {
    ...base,
    steps: base.steps.concat(
      createCallStep(serviceId, handlerId, "service", 2, callables[1].filePath),
      createCallStep(repositoryId, serviceId, "repository", 3, callables[2].filePath)
    )
  };
  const detail = createEntrypointCodeFlowDetail(
    graph,
    flow,
    deliveryVersion,
    createFunctionArchitectureIndex(graph),
    createSourceToken
  );

  assert.equal(detail.semantics, "static");
  assert.deepEqual(detail.steps.map((step) => step.stage), [
    "boundary",
    "boundary",
    "decision",
    "effect"
  ]);
  assert.equal(detail.steps[1]?.parentId, detail.steps[0]?.id);
  assert.equal(detail.steps[2]?.parentId, detail.steps[1]?.id);
  assert.equal(detail.steps[3]?.parentId, detail.steps[2]?.id);
  assert.ok(detail.steps.every((step) => step.evidenceLabel.length > 0));
  assert.ok(detail.steps.slice(1).every((step) => step.sourceToken));
  assert.equal(detail.summary.decisionStepCount, 1);
  assert.equal(detail.summary.effectStepCount, 1);
  assert.doesNotMatch(JSON.stringify(detail), /\/workspace/u);
});

test("Code Flow projection emits finite descriptors for subtitles, fallbacks, and evidence", () => {
  const base = createMappedFlow("", "", "/workspace/api", "httpRoute", undefined);
  const confidenceValues: GraphEdge["confidence"][] = ["exact", "resolved", "inferred", "unresolved"];
  const resolutionValues = ["concrete", "external", "unresolved"] as const;
  const handlers = confidenceValues.map((confidence, index) => ({
    ...createCallStep(`handler-${confidence}`, "", "routeHandler", index + 1, `/workspace/handler-${index}.ts`),
    kind: "handler" as const,
    confidence
  }));
  const calls = confidenceValues.flatMap((confidence, confidenceIndex) =>
    resolutionValues.map((resolution, resolutionIndex) => ({
      ...createCallStep(
        `call-${confidence}-${resolution}`,
        "",
        "service",
        10 + confidenceIndex * resolutionValues.length + resolutionIndex,
        `/workspace/call-${confidenceIndex}-${resolutionIndex}.ts`
      ),
      confidence,
      resolution
    }))
  );
  const graph = createGraph();
  const detail = createEntrypointCodeFlowDetail(
    graph,
    { ...base, steps: [base.steps[0], ...handlers, ...calls] },
    deliveryVersion,
    createFunctionArchitectureIndex(graph),
    createSourceToken
  );

  assert.equal(detail.titlePresentation?.key, "code-flow-unnamed-entrypoint");
  assert.equal(getSubtitlePresentationKey(detail.subtitlePresentation), "code-flow-entrypoint-http-unknown-framework");
  assert.equal(detail.steps[0]?.evidencePresentation?.key, "code-flow-evidence-framework-boundary");
  assert.deepEqual(
    new Set(detail.steps.slice(1, 5).map((step) => step.evidencePresentation?.key)),
    new Set(confidenceValues.map((confidence) => `code-flow-evidence-handler-${confidence}`))
  );
  assert.deepEqual(
    new Set(detail.steps.slice(5).map((step) => step.evidencePresentation?.key)),
    new Set(confidenceValues.flatMap((confidence) =>
      resolutionValues.map((resolution) => `code-flow-evidence-call-${confidence}-${resolution}`)
    ))
  );

  const knownHttp = createEntrypointCodeFlowDetail(
    graph,
    createMappedFlow("GET /known", "Express", "/workspace/api", "httpRoute", undefined),
    deliveryVersion,
    createFunctionArchitectureIndex(graph),
    createSourceToken
  );
  const knownGraphql = createEntrypointCodeFlowDetail(
    graph,
    createMappedFlow("viewer", "Apollo", "/workspace/api", "graphqlOperation", "Query"),
    deliveryVersion,
    createFunctionArchitectureIndex(graph),
    createSourceToken
  );
  const unknownGraphql = createEntrypointCodeFlowDetail(
    graph,
    createMappedFlow("viewer", "", "/workspace/api", "graphqlOperation", "Query"),
    deliveryVersion,
    createFunctionArchitectureIndex(graph),
    createSourceToken
  );
  assert.equal(getSubtitlePresentationKey(knownHttp.subtitlePresentation), "code-flow-entrypoint-http");
  assert.equal(getSubtitlePresentationKey(knownGraphql.subtitlePresentation), "code-flow-entrypoint-graphql");
  assert.equal(getSubtitlePresentationKey(unknownGraphql.subtitlePresentation), "code-flow-entrypoint-graphql-unknown-framework");
});

test("Code Flow semantic gaps emit finite titles and locale-neutral bound parameters", () => {
  const gaps: SemanticFlow["coverageGaps"] = [
    { entrypointUnitId: "route", reason: "ambiguous", message: "legacy", candidateFunctionIds: ["a", "b"], targetFrameworkUnitIds: [], omittedFunctionIds: [] },
    { entrypointUnitId: "route", reason: "handlerNotMapped", message: "legacy", candidateFunctionIds: [], targetFrameworkUnitIds: [], omittedFunctionIds: [] },
    { entrypointUnitId: "route", reason: "depthLimit", message: "legacy", candidateFunctionIds: [], targetFrameworkUnitIds: [], omittedFunctionIds: ["a"], limit: 3 },
    { entrypointUnitId: "route", reason: "stepLimit", message: "legacy", candidateFunctionIds: [], targetFrameworkUnitIds: [], omittedFunctionIds: ["a", "b"], limit: 8 }
  ];
  const graph = createGraph();
  const detail = createEntrypointCodeFlowDetail(
    graph,
    createMappedFlow("GET /gaps", "Express", "/workspace/api", "httpRoute", undefined, { gaps }),
    deliveryVersion,
    createFunctionArchitectureIndex(graph),
    createSourceToken
  );

  assert.deepEqual(detail.gaps.map((gap) => gap.labelPresentation?.key), [
    "code-flow-gap-ambiguous", "code-flow-gap-handler-not-mapped",
    "code-flow-gap-depth-limit", "code-flow-gap-step-limit"
  ]);
  assert.deepEqual(detail.gaps.map((gap) => gap.codeFlowDetailPresentation), [
    { key: "code-flow-gap-ambiguous-detail", params: { count: 2 } },
    { key: "code-flow-gap-handler-not-mapped-detail", params: {} },
    { key: "code-flow-gap-depth-limit-detail", params: { count: 1, depth: 3 } },
    { key: "code-flow-gap-step-limit-detail", params: { count: 2, limit: 8 } }
  ]);
});

test("function context iteratively collapses cycles and reports depth limits", () => {
  const nodes = [
    createCallable("root", "/workspace/src/application/root.ts"),
    createCallable("first", "/workspace/src/application/first.ts"),
    createCallable("second", "/workspace/src/domain/second.ts"),
    createCallable("third", "/workspace/src/repositories/third.ts"),
    createCallable("fourth", "/workspace/src/infrastructure/fourth.ts")
  ];
  const edges: GraphEdge[] = [
    createCallEdge("root-first", "root", "first", "exact"),
    createCallEdge("root-missing", "root", "missing", "unresolved", "persistUnknown"),
    createCallEdge("root-missing-no-label", "root", "missing-no-label", "unresolved"),
    createCallEdge("first-root", "first", "root", "inferred"),
    createCallEdge("first-second", "first", "second", "resolved"),
    createCallEdge("second-third", "second", "third", "resolved"),
    createCallEdge("third-fourth", "third", "fourth", "resolved")
  ];
  const graph = withEdges(createGraph({ callables: nodes }), edges);
  const origin = withHandler(
    createMappedFlow("GET /root", "Express", "/workspace", "httpRoute", undefined),
    "root"
  );
  const detail = createSymbolCodeFlowDetail(
    graph,
    createFlowIndex(graph.version, [origin]),
    nodes[0],
    deliveryVersion,
    createFunctionArchitectureIndex(graph),
    createSourceToken,
    { maxDepth: 2, maxSteps: 10 }
  );

  assert.equal(detail.kind, "symbol");
  assert.equal(detail.origins.length, 1);
  assert.ok(detail.steps.some((step) => step.resolution === "unresolved"));
  assert.ok(detail.gaps.some((gap) => gap.reason === "cycleOrDuplicate"));
  assert.ok(detail.gaps.some((gap) => gap.reason === "depthLimit"));
  assert.match(detail.gaps.find((gap) => gap.reason === "depthLimit")?.detail ?? "", /depth 2/u);
  assert.equal(detail.steps.filter((step) => step.label === "root").length, 1);
  assert.ok(detail.steps.filter((step) => step.resolution === "concrete").every((step) => step.sourceToken));
  assert.ok(detail.steps.filter((step) => step.resolution === "unresolved").every((step) => !step.sourceToken));
  assert.equal(
    detail.steps.find((step) => step.resolution === "unresolved")?.detailPresentation?.key,
    "code-flow-unresolved-callsite-source"
  );
  assert.equal(
    detail.steps.find((step) => step.label === "Unresolved call target")?.labelPresentation?.key,
    "code-flow-unresolved-target"
  );
  assert.deepEqual(
    detail.gaps.map((gap) => gap.labelPresentation?.key),
    ["code-flow-gap-depth-limit", "code-flow-gap-cycle-or-duplicate"]
  );
  assert.equal(detail.titlePresentation, undefined);
  assert.equal(getSubtitlePresentationKey(detail.subtitlePresentation), "code-flow-function-context-source");
  assert.equal(detail.steps[0]?.evidencePresentation?.key, "code-flow-evidence-selected-definition");
  assert.ok(detail.steps.every((step) => step.evidencePresentation));
});

test("function context distinguishes anonymous labels and a missing source location", () => {
  const node = { ...createCallable("", "") };
  const graph = createGraph({ callables: [node] });
  const detail = createSymbolCodeFlowDetail(
    graph,
    createFlowIndex(graph.version, []),
    node,
    deliveryVersion,
    createFunctionArchitectureIndex(graph),
    createSourceToken
  );

  assert.equal(detail.titlePresentation?.key, "code-flow-anonymous-callable");
  assert.equal(getSubtitlePresentationKey(detail.subtitlePresentation), "code-flow-function-context");
  assert.equal(detail.steps[0]?.labelPresentation?.key, "code-flow-anonymous-callable");
});

test("CodeFlow insight cache keys by immutable graph object", () => {
  const graph = createGraph({ callables: [createCallable("root", "/workspace/src/root.ts")] });
  const cache = new CodeFlowInsightCache();
  const first = cache.get(graph);
  const second = cache.get(graph);
  const replacement = cache.get({ ...graph });

  assert.strictEqual(second, first);
  assert.notStrictEqual(replacement, first);
  cache.clear();
  assert.notStrictEqual(cache.get(graph), replacement);
});

/** Creates a semantic call step without coupling tests to projector internals. */
function createCallStep(
  functionId: string,
  parentFunctionId: string,
  role: SemanticFlow["steps"][number]["role"],
  depth: number,
  filePath: string
): SemanticFlow["steps"][number] {
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
    range: { startLine: depth, startCharacter: 0, endLine: depth, endCharacter: 1 }
  };
}

/** Rebinds the mapped handler to the selected fixture function. */
function withHandler(flow: SemanticFlow, functionId: string): SemanticFlow {
  return {
    ...flow,
    steps: flow.steps.map((step) => step.kind === "handler"
      ? { ...step, functionId, name: functionId, functionName: functionId, functionQualifiedName: functionId }
      : step)
  };
}

/** Adds call edges while keeping graph metadata internally consistent. */
function withEdges(graph: ProjectGraph, edges: GraphEdge[]): ProjectGraph {
  return {
    ...graph,
    edges,
    metadata: { ...graph.metadata, edgeCount: edges.length }
  };
}

/** Creates one static call relationship and optional unresolved display name. */
function createCallEdge(
  id: string,
  sourceId: string,
  targetId: string,
  confidence: GraphEdge["confidence"],
  targetName?: string
): GraphEdge {
  return {
    id,
    kind: "calls",
    sourceId,
    targetId,
    filePath: `/workspace/src/${sourceId}.ts`,
    range: { startLine: 4, startCharacter: 2, endLine: 4, endCharacter: 8 },
    confidence,
    metadata: targetName ? { targetName } : undefined
  };
}

/** Produces a deterministic opaque token for concrete test definitions. */
function createSourceToken(nodeId: string): SourceNodeToken {
  return `source-node:${nodeId}`;
}

/** Narrows the legacy Function Logic marker while asserting Code Flow descriptors. */
function getSubtitlePresentationKey(
  presentation: { key: string } | "functionLogic" | undefined
): string | undefined {
  return typeof presentation === "string" ? undefined : presentation?.key;
}
