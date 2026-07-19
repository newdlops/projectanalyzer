/**
 * Fixture-based tests for the bounded Module Flow application projection.
 *
 * The synthetic workspace mixes nested packages, execution/dependency evidence,
 * mixed confidence, and enough boundary functions to exercise hard budgets. All
 * browser payload checks explicitly reject Host paths and analyzer identities.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { ModuleFlowProjectionService } from "../../application/moduleFlow";
import type {
  ModuleFlowDetailRequest,
  ModuleFlowEdgePayload,
  ModuleFlowEvidenceToken,
  ModuleFlowExpandRequest,
  ModuleFlowListPayload,
  ModuleFlowListRequest,
  ModuleFlowModuleNodePayload
} from "../../protocol/moduleFlow";
import type { SourceNodeToken } from "../../protocol/sourceNavigation";
import { createContentHash } from "../../shared/hash";
import type {
  EdgeConfidence,
  FrameworkUnit,
  GraphEdge,
  ProjectGraph,
  SourceRange,
  SymbolKind,
  SymbolNode
} from "../../shared/types";

const SNAPSHOT = "module-flow-snapshot:test:1";
const OTHER_SNAPSHOT = "module-flow-snapshot:test:2";
const API_BOUNDARY_FUNCTION_COUNT = 55;

const RANGE: SourceRange = {
  startLine: 0,
  startCharacter: 0,
  endLine: 0,
  endCharacter: 12
};

type TokenRecorder = {
  sourceNodeIds: string[];
  evidenceLocations: Array<{ filePath: string; range: SourceRange }>;
};

test("projects opaque mode-specific scenes with exact bounded coverage", () => {
  const recorder = createTokenRecorder();
  const service = createService(recorder);
  service.activate(SNAPSHOT, createFixtureGraph());

  const execution = service.projectList(createListRequest("execution"));
  const dependency = service.projectList(createListRequest("dependency"));
  const boundary = service.projectList(createListRequest("boundary"));
  const noInferred = service.projectList({
    ...createListRequest("execution"),
    requestId: 4,
    includeInferred: false
  });

  assert.equal(execution.nodes.length, execution.summary.totalModuleCount);
  assert.ok(execution.edges.some((edge) => hasRelation(edge, "calls")));
  assert.equal(execution.edges.some((edge) => hasRelation(edge, "imports")), false);
  assert.ok(dependency.edges.some((edge) => hasRelation(edge, "imports")));
  assert.ok(dependency.edges.some((edge) => hasRelation(edge, "exports")));
  assert.equal(dependency.edges.some((edge) => hasRelation(edge, "calls")), false);

  const api = findModuleNode(execution, "apps/api");
  const domain = findModuleNode(execution, "packages/domain");
  const shared = findModuleNode(execution, "packages/shared");
  const apiToDomain = findAggregateEdge(execution, api.id, domain.id);
  assert.ok(hasRelation(apiToDomain, "calls"));
  assert.ok(hasRelation(apiToDomain, "routesTo"));
  assert.equal(apiToDomain.confidenceCounts.inferred > 0, true);
  assert.equal(apiToDomain.confidenceCounts.resolved > 0, true);
  assert.equal(apiToDomain.omittedEvidenceCount, apiToDomain.evidenceCount);

  assert.equal(
    noInferred.edges.some((edge) => edge.sourceId === shared.id && edge.targetId === api.id),
    false
  );
  const boundaryPair = findAggregateEdge(boundary, api.id, domain.id);
  assert.ok(hasRelation(boundaryPair, "calls"));
  assert.ok(hasRelation(boundaryPair, "imports"));
  assert.ok(hasRelation(boundaryPair, "exports"));

  const bounded = service.projectList({
    ...createListRequest("boundary"),
    requestId: 5,
    moduleLimit: 2,
    edgeLimit: 1
  });
  assert.ok(bounded.nodes.length <= 2);
  assert.ok(bounded.edges.length <= 1);
  assert.equal(
    bounded.summary.visibleModuleCount + bounded.summary.omittedModuleCount,
    bounded.summary.totalModuleCount
  );
  assert.equal(
    bounded.summary.visibleEdgeCount + bounded.summary.omittedEdgeCount,
    bounded.summary.totalEdgeCount
  );

  assertOpaqueScene(execution);
  assertBrowserSafePayload(execution, dependency, boundary, bounded);
});

test("projects module source tokens and bounded edge evidence tokens", () => {
  const recorder = createTokenRecorder();
  const service = createService(recorder);
  service.activate(SNAPSHOT, createFixtureGraph());
  const scene = service.projectList(createListRequest("boundary"));
  const api = findModuleNode(scene, "apps/api");
  const domain = findModuleNode(scene, "packages/domain");
  const relation = findAggregateEdge(scene, api.id, domain.id);

  const moduleDetail = service.projectDetail({
    graphVersion: SNAPSHOT,
    requestId: 10,
    target: { kind: "module", id: api.id },
    relationLimit: 1,
    evidenceLimit: 1
  });
  assert.ok(moduleDetail);
  assert.equal(moduleDetail.detail.kind, "module");
  if (moduleDetail.detail.kind !== "module") {
    assert.fail("Expected module detail");
  }
  assert.equal(moduleDetail.detail.representativeSources.length, 1);
  assert.match(
    moduleDetail.detail.representativeSources[0]?.sourceToken ?? "",
    /^source-node:[0-9a-f]{64}$/u
  );
  assert.ok(moduleDetail.detail.incomingEdges.length <= 1);
  assert.ok(moduleDetail.detail.outgoingEdges.length <= 1);
  assert.equal(
    moduleDetail.detail.outgoingEdges.length + moduleDetail.detail.omittedOutgoingEdgeCount,
    1
  );

  const edgeRequest: ModuleFlowDetailRequest = {
    graphVersion: SNAPSHOT,
    requestId: 11,
    target: { kind: "edge", id: relation.id },
    relationLimit: 40,
    evidenceLimit: 2
  };
  const edgeDetail = service.projectDetail(edgeRequest);
  assert.ok(edgeDetail);
  assert.equal(edgeDetail.detail.kind, "edge");
  if (edgeDetail.detail.kind !== "edge") {
    assert.fail("Expected edge detail");
  }
  assert.equal(edgeDetail.detail.evidence.length, 2);
  assert.equal(
    edgeDetail.detail.evidence.length + edgeDetail.detail.omittedEvidenceCount,
    relation.evidenceCount
  );
  assert.ok(edgeDetail.detail.evidence.every((entry) =>
    /^module-flow-evidence:[0-9a-f]{64}$/u.test(entry.evidenceToken ?? "")
  ));
  assert.ok(recorder.evidenceLocations.length >= 2);
  assert.ok(recorder.evidenceLocations.every((entry) => entry.filePath.startsWith("/workspace/")));
  assert.ok(recorder.sourceNodeIds.includes("file-api-controller"));

  assertBrowserSafePayload(moduleDetail, edgeDetail);
});

test("retains edge backing only for the active bounded scene and detail rail", () => {
  const service = createService(createTokenRecorder());
  service.activate(SNAPSHOT, createFixtureGraph());
  const scene = service.projectList({
    ...createListRequest("boundary"),
    edgeLimit: 2
  });
  const resourceState = service as unknown as {
    sceneEdgeBackingById: Map<string, unknown>;
    detailEdgeBackingById: Map<string, unknown>;
  };
  const aggregateEdgeCount = scene.edges.filter((edge) => edge.presentationKind === "aggregate").length;
  assert.equal(resourceState.sceneEdgeBackingById.size, aggregateEdgeCount);

  const api = findModuleNode(scene, "apps/api");
  service.projectDetail({
    graphVersion: SNAPSHOT,
    requestId: 12,
    target: { kind: "module", id: api.id },
    relationLimit: 1,
    evidenceLimit: 1
  });
  assert.ok(resourceState.detailEdgeBackingById.size <= 2);

  service.projectList({
    ...createListRequest("execution"),
    requestId: 13,
    edgeLimit: 0
  });
  assert.equal(resourceState.sceneEdgeBackingById.size, 0);
  assert.equal(resourceState.detailEdgeBackingById.size, 0);
  service.clear();
  assert.equal(resourceState.sceneEdgeBackingById.size, 0);
});

test("attaches boundary functions to the same canvas with source tokens and exact limits", () => {
  const recorder = createTokenRecorder();
  const service = createService(recorder);
  service.activate(SNAPSHOT, createFixtureGraph());
  const scene = service.projectList(createListRequest("execution"));
  const api = findModuleNode(scene, "apps/api");
  const domain = findModuleNode(scene, "packages/domain");
  const shared = findModuleNode(scene, "packages/shared");

  const focused = service.projectExpansion({
    graphVersion: SNAPSHOT,
    requestId: 20,
    moduleId: api.id,
    expansion: "boundaryFunctions",
    direction: "both",
    nodeLimit: 1,
    edgeLimit: 3
  });
  assert.ok(focused);
  assert.equal(focused.anchorModuleId, api.id);
  assert.equal(focused.nodes.length, 1);
  assert.equal(focused.nodes[0]?.kind, "function");
  assert.match(
    focused.nodes[0]?.kind === "function" ? focused.nodes[0].sourceToken ?? "" : "",
    /^source-node:[0-9a-f]{64}$/u
  );
  assert.ok(focused.edges.some((edge) =>
    edge.presentationKind === "contains"
      && edge.sourceId === api.id
      && edge.targetId === focused.nodes[0]?.id
  ));
  assert.ok(focused.edges.some((edge) =>
    edge.presentationKind === "concreteCall"
      && (edge.sourceId === shared.id || edge.targetId === domain.id)
  ));
  assert.equal(focused.summary.candidateNodeCount, API_BOUNDARY_FUNCTION_COUNT);
  assert.equal(
    focused.summary.visibleNodeCount + focused.summary.omittedNodeCount,
    focused.summary.candidateNodeCount
  );
  assert.equal(
    focused.summary.visibleEdgeCount + focused.summary.omittedEdgeCount,
    focused.summary.candidateEdgeCount
  );

  const capped = service.projectExpansion({
    graphVersion: SNAPSHOT,
    requestId: 21,
    moduleId: api.id,
    expansion: "boundaryFunctions",
    direction: "both",
    nodeLimit: 10_000,
    edgeLimit: 10_000
  });
  assert.ok(capped);
  assert.equal(capped.summary.candidateNodeCount, API_BOUNDARY_FUNCTION_COUNT);
  assert.equal(capped.summary.visibleNodeCount, 48);
  assert.equal(capped.summary.omittedNodeCount, API_BOUNDARY_FUNCTION_COUNT - 48);
  assert.equal(capped.summary.visibleEdgeCount, 96);
  assert.equal(capped.summary.candidateEdgeCount, 144);
  assert.equal(capped.summary.omittedEdgeCount, 48);
  assert.equal(capped.nodes.length, 48);
  assert.equal(capped.edges.length, 96);
  const containedFunctionIds = new Set(capped.edges
    .filter((edge) => edge.presentationKind === "contains" && edge.sourceId === api.id)
    .map((edge) => edge.targetId));
  assert.equal(containedFunctionIds.size, capped.nodes.length);
  assert.ok(capped.nodes.every((node) => containedFunctionIds.has(node.id)));
  assert.ok(recorder.sourceNodeIds.includes("fn-api-handler-0"));

  assertBrowserSafePayload(focused, capped);
});

test("expands only direct child modules with containment edges", () => {
  const service = createService(createTokenRecorder());
  service.activate(SNAPSHOT, createFixtureGraph());
  const scene = service.projectList(createListRequest("boundary"));
  const api = findModuleNode(scene, "apps/api");

  const expansion = service.projectExpansion({
    graphVersion: SNAPSHOT,
    requestId: 30,
    moduleId: api.id,
    expansion: "childModules",
    direction: "both",
    nodeLimit: 48,
    edgeLimit: 96
  });

  assert.ok(expansion);
  assert.equal(expansion.anchorModuleId, api.id);
  assert.equal(expansion.nodes.length, 1);
  assert.equal(expansion.nodes[0]?.kind, "module");
  assert.equal(
    expansion.nodes[0]?.kind === "module" ? expansion.nodes[0].locationLabel : undefined,
    "apps/api/plugins/payments"
  );
  assert.deepEqual(expansion.replacedEdgeIds, []);
  assert.equal(expansion.edges.length, 1);
  assert.equal(expansion.edges[0]?.presentationKind, "contains");
  assert.equal(expansion.edges[0]?.sourceId, api.id);
  assert.equal(expansion.edges[0]?.targetId, expansion.nodes[0]?.id);
  assert.deepEqual(expansion.summary, {
    candidateNodeCount: 1,
    visibleNodeCount: 1,
    omittedNodeCount: 0,
    candidateEdgeCount: 1,
    visibleEdgeCount: 1,
    omittedEdgeCount: 0
  });
  assertBrowserSafePayload(expansion);
});

test("rejects stale or unavailable projection snapshots", () => {
  const service = createService(createTokenRecorder());
  const listRequest = createListRequest("execution");

  assert.throws(
    () => service.projectList(listRequest),
    /snapshot is stale or unavailable/u
  );
  service.activate(SNAPSHOT, createFixtureGraph());
  assert.equal(service.matches(SNAPSHOT), true);
  assert.equal(service.matches(OTHER_SNAPSHOT), false);
  assert.throws(
    () => service.projectList({ ...listRequest, graphVersion: OTHER_SNAPSHOT }),
    /snapshot is stale or unavailable/u
  );
  assert.throws(
    () => service.projectExpansion({
      graphVersion: OTHER_SNAPSHOT,
      requestId: 41,
      moduleId: "module-flow-module:0123456789abcdef0123456789abcdef",
      expansion: "childModules",
      direction: "both",
      nodeLimit: 1,
      edgeLimit: 1
    }),
    /snapshot is stale or unavailable/u
  );
  service.clear();
  assert.equal(service.matches(SNAPSHOT), false);
});

test("is deterministic when analyzer and metadata arrays are reversed", () => {
  const graph = createFixtureGraph();
  const reversed = reverseGraph(graph);
  const left = createService(createTokenRecorder());
  const right = createService(createTokenRecorder());
  left.activate(SNAPSHOT, graph);
  right.activate(SNAPSHOT, reversed);

  const leftScene = left.projectList(createListRequest("boundary"));
  const rightScene = right.projectList(createListRequest("boundary"));
  assert.deepEqual(rightScene, leftScene);

  const leftApi = findModuleNode(leftScene, "apps/api");
  const rightApi = findModuleNode(rightScene, "apps/api");
  const expandRequest = (moduleId: typeof leftApi.id): ModuleFlowExpandRequest => ({
    graphVersion: SNAPSHOT,
    requestId: 51,
    moduleId,
    expansion: "boundaryFunctions",
    direction: "both",
    nodeLimit: 8,
    edgeLimit: 24
  });
  assert.deepEqual(
    right.projectExpansion(expandRequest(rightApi.id)),
    left.projectExpansion(expandRequest(leftApi.id))
  );
});

/** Creates an activated service boundary whose token calls remain inspectable. */
function createService(recorder: TokenRecorder): ModuleFlowProjectionService {
  return new ModuleFlowProjectionService({
    createSourceToken(nodeId): SourceNodeToken {
      recorder.sourceNodeIds.push(nodeId);
      return `source-node:${createContentHash(`source\0${nodeId}`)}`;
    },
    createEvidenceToken(filePath, range): ModuleFlowEvidenceToken {
      recorder.evidenceLocations.push({ filePath, range: { ...range } });
      return `module-flow-evidence:${createContentHash(JSON.stringify([filePath, range]))}`;
    }
  });
}

/** Creates fresh token side-effect storage for one service instance. */
function createTokenRecorder(): TokenRecorder {
  return { sourceNodeIds: [], evidenceLocations: [] };
}

/** Creates one full-list request with stable snapshot correlation. */
function createListRequest(mode: ModuleFlowListRequest["mode"]): ModuleFlowListRequest {
  return {
    graphVersion: SNAPSHOT,
    requestId: mode === "execution" ? 1 : mode === "dependency" ? 2 : 3,
    mode,
    moduleLimit: 80,
    edgeLimit: 160,
    includeExternal: true,
    includeInferred: true
  };
}

/** Builds the nested-package graph shared by every projection scenario. */
function createFixtureGraph(): ProjectGraph {
  const files = [
    createNode("file-api-controller", "file", "/workspace/apps/api/src/controller.ts", "controller.ts"),
    createNode("file-payments", "file", "/workspace/apps/api/plugins/payments/src/pay.ts", "pay.ts"),
    createNode("file-domain", "file", "/workspace/packages/domain/src/order.ts", "order.ts"),
    createNode("file-shared", "file", "/workspace/packages/shared/src/events.ts", "events.ts")
  ];
  const apiFunctions = Array.from({ length: API_BOUNDARY_FUNCTION_COUNT }, (_, index) =>
    createNode(
      `fn-api-handler-${index}`,
      "function",
      "/workspace/apps/api/src/controller.ts",
      `handleOrder${index}`,
      `OrdersController.handleOrder${index}`,
      index + 1
    )
  );
  const domainFunction = createNode(
    "fn-domain-place",
    "function",
    "/workspace/packages/domain/src/order.ts",
    "placeOrder",
    "OrderService.placeOrder"
  );
  const sharedFunction = createNode(
    "fn-shared-dispatch",
    "function",
    "/workspace/packages/shared/src/events.ts",
    "dispatchOrder",
    "OrderEvents.dispatchOrder"
  );
  const paymentFunction = createNode(
    "fn-payments-capture",
    "function",
    "/workspace/apps/api/plugins/payments/src/pay.ts",
    "capturePayment",
    "Payments.capturePayment"
  );

  const crossModuleCalls: GraphEdge[] = [];
  for (let index = 0; index < apiFunctions.length; index += 1) {
    crossModuleCalls.push(createEdge({
      id: `call-api-domain-${index}`,
      kind: "calls",
      sourceId: apiFunctions[index].id,
      targetId: domainFunction.id,
      filePath: apiFunctions[index].filePath,
      confidence: index % 2 === 0 ? "resolved" : "inferred",
      line: index + 1
    }));
    crossModuleCalls.push(createEdge({
      id: `call-shared-api-${index}`,
      kind: "calls",
      sourceId: sharedFunction.id,
      targetId: apiFunctions[index].id,
      filePath: sharedFunction.filePath,
      confidence: "inferred",
      line: index + 1
    }));
  }

  const edges: GraphEdge[] = [
    ...crossModuleCalls,
    createEdge({
      id: "import-api-domain",
      kind: "imports",
      sourceId: "file-api-controller",
      targetId: "file-domain",
      filePath: "/workspace/apps/api/src/controller.ts",
      confidence: "exact"
    }),
    createEdge({
      id: "export-api-domain",
      kind: "exports",
      sourceId: "file-api-controller",
      targetId: "file-domain",
      filePath: "/workspace/apps/api/src/controller.ts",
      confidence: "inferred",
      line: 100
    }),
    createEdge({
      id: "call-api-internal",
      kind: "calls",
      sourceId: apiFunctions[0].id,
      targetId: apiFunctions[1].id,
      filePath: apiFunctions[0].filePath,
      confidence: "exact",
      line: 101
    })
  ];

  const frameworkUnits: FrameworkUnit[] = [{
    id: "unit-api-route",
    framework: "Express",
    rootPath: "apps/api",
    kind: "route",
    name: "POST /orders",
    filePath: "/workspace/apps/api/src/controller.ts",
    range: RANGE
  }, {
    id: "unit-domain-service",
    framework: "Fixture",
    rootPath: "packages/domain",
    kind: "service",
    name: "OrderService",
    filePath: "/workspace/packages/domain/src/order.ts",
    range: RANGE
  }];

  const nodes = [
    ...files,
    ...apiFunctions,
    domainFunction,
    sharedFunction,
    paymentFunction
  ];
  return {
    workspaceRoot: "/workspace",
    version: "module-flow-fixture-v1",
    generatedAt: "2026-07-19T00:00:00.000Z",
    nodes,
    edges,
    diagnostics: [],
    metadata: {
      languages: ["typescript"],
      languageSummary: [{ language: "typescript", fileCount: files.length, percentage: 100 }],
      frameworks: [{
        name: "Express",
        ecosystem: "javascript",
        category: "backend",
        confidence: "high",
        rootPath: "apps/api",
        evidence: ["fixture framework evidence"]
      }],
      projectPackageRoots: [{
        rootPath: "apps/api",
        manifestPaths: ["apps/api/package.json"],
        ecosystems: ["javascript"]
      }, {
        rootPath: "apps/api/plugins/payments",
        manifestPaths: ["apps/api/plugins/payments/package.json"],
        ecosystems: ["javascript"]
      }, {
        rootPath: "packages/domain",
        manifestPaths: ["packages/domain/package.json"],
        ecosystems: ["javascript"]
      }, {
        rootPath: "packages/shared",
        manifestPaths: ["packages/shared/package.json"],
        ecosystems: ["javascript"]
      }],
      frameworkUnits,
      frameworkUnitEdges: [{
        id: "framework-api-domain",
        kind: "routesTo",
        sourceId: "unit-api-route",
        targetId: "unit-domain-service",
        filePath: "/workspace/apps/api/src/controller.ts",
        range: { ...RANGE, startLine: 110, endLine: 110 },
        confidence: "resolved"
      }],
      fileCount: files.length,
      symbolCount: nodes.length,
      edgeCount: edges.length
    }
  };
}

/** Reverses every analyzer-owned array while retaining equal graph evidence. */
function reverseGraph(graph: ProjectGraph): ProjectGraph {
  return {
    ...graph,
    nodes: [...graph.nodes].reverse(),
    edges: [...graph.edges].reverse(),
    metadata: {
      ...graph.metadata,
      languages: [...graph.metadata.languages].reverse(),
      languageSummary: [...(graph.metadata.languageSummary ?? [])].reverse(),
      frameworks: [...(graph.metadata.frameworks ?? [])].reverse(),
      projectPackageRoots: [...(graph.metadata.projectPackageRoots ?? [])].reverse(),
      frameworkUnits: [...(graph.metadata.frameworkUnits ?? [])].reverse(),
      frameworkUnitEdges: [...(graph.metadata.frameworkUnitEdges ?? [])].reverse()
    }
  };
}

/** Creates one file or callable with human-facing names distinct from analyzer IDs. */
function createNode(
  id: string,
  kind: SymbolKind,
  filePath: string,
  name: string,
  qualifiedName = name,
  line = 0
): SymbolNode {
  const range = { ...RANGE, startLine: line, endLine: line };
  return {
    id,
    kind,
    name,
    qualifiedName,
    filePath,
    range,
    selectionRange: range,
    language: "typescript"
  };
}

/** Creates one callsite or dependency edge with stable source coordinates. */
function createEdge(input: {
  id: string;
  kind: GraphEdge["kind"];
  sourceId: string;
  targetId: string;
  filePath: string;
  confidence: EdgeConfidence;
  line?: number;
}): GraphEdge {
  const line = input.line ?? 0;
  return {
    id: input.id,
    kind: input.kind,
    sourceId: input.sourceId,
    targetId: input.targetId,
    filePath: input.filePath,
    confidence: input.confidence,
    range: { ...RANGE, startLine: line, endLine: line }
  };
}

/** Finds one projected module by its workspace-relative, display-only location. */
function findModuleNode(
  payload: ModuleFlowListPayload,
  locationLabel: string
): ModuleFlowModuleNodePayload {
  const module = payload.nodes.find((candidate) => candidate.locationLabel === locationLabel);
  assert.ok(module, `Expected projected module ${locationLabel}`);
  return module;
}

/** Finds one pair-aggregated edge without relying on array position. */
function findAggregateEdge(
  payload: ModuleFlowListPayload,
  sourceId: ModuleFlowModuleNodePayload["id"],
  targetId: ModuleFlowModuleNodePayload["id"]
): ModuleFlowEdgePayload {
  const edge = payload.edges.find((candidate) =>
    candidate.presentationKind === "aggregate"
      && candidate.sourceId === sourceId
      && candidate.targetId === targetId
  );
  assert.ok(edge, `Expected aggregate edge ${sourceId} -> ${targetId}`);
  return edge;
}

/** Returns whether one projected pair includes a specific domain relation kind. */
function hasRelation(
  edge: ModuleFlowEdgePayload,
  kind: ModuleFlowEdgePayload["relations"][number]["kind"]
): boolean {
  return edge.relations.some((relation) => relation.kind === kind);
}

/** Verifies graph identities are fixed-width opaque digests. */
function assertOpaqueScene(payload: ModuleFlowListPayload): void {
  assert.ok(payload.nodes.every((node) =>
    /^module-flow-module:[0-9a-f]{32}$/u.test(node.id)
  ));
  assert.ok(payload.edges.every((edge) =>
    /^module-flow-edge:[0-9a-f]{32}$/u.test(edge.id)
      && /^module-flow-(?:module|function):[0-9a-f]{32}$/u.test(edge.sourceId)
      && /^module-flow-(?:module|function):[0-9a-f]{32}$/u.test(edge.targetId)
  ));
}

/** Rejects absolute paths and representative raw analyzer identities in payload JSON. */
function assertBrowserSafePayload(...payloads: unknown[]): void {
  const serialized = JSON.stringify(payloads);
  for (const forbidden of [
    "/workspace",
    "project-module:",
    "file-api-controller",
    "fn-api-handler-",
    "fn-domain-place",
    "fn-shared-dispatch",
    "call-api-domain-",
    "framework-api-domain"
  ]) {
    assert.equal(serialized.includes(forbidden), false, `Leaked Host identity: ${forbidden}`);
  }
  assertJsonValue(payloads);
}

/** Checks plain JSON serialization with an explicit stack and cycle guard. */
function assertJsonValue(value: unknown): void {
  const stack: unknown[] = [value];
  const visited = new Set<object>();
  while (stack.length > 0) {
    const next = stack.pop();
    if (next === null) {
      continue;
    }
    const valueType = typeof next;
    if (valueType === "string" || valueType === "number" || valueType === "boolean") {
      continue;
    }
    if (valueType !== "object") {
      assert.fail(`Expected JSON value, received ${valueType}`);
    }
    const object = next as object;
    if (visited.has(object)) {
      continue;
    }
    visited.add(object);
    if (next instanceof Map || next instanceof Set || next instanceof Date) {
      assert.fail("Module Flow browser payload must remain plain JSON");
    }
    if (Array.isArray(next)) {
      stack.push(...next);
      continue;
    }
    for (const child of Object.values(next as Record<string, unknown>)) {
      // JSON.stringify omits optional object properties whose value is undefined;
      // verify the actual cross-Webview representation rather than object literals.
      if (child !== undefined) {
        stack.push(child);
      }
    }
  }
  assert.doesNotThrow(() => JSON.stringify(value));
}
