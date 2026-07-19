/**
 * Fixture-based unit tests for project-module boundary ownership and relations.
 * The synthetic graph mixes nested packages, inferred areas, framework evidence,
 * internal calls, cycles, external targets, and unresolved coverage gaps.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  createProjectModuleIndex,
  PROJECT_MODULE_RELATION_EVIDENCE_LIMIT,
  type ProjectModuleIndex,
  type ProjectModuleRelation
} from "../../insights/projectModules";
import type {
  EdgeConfidence,
  FrameworkUnit,
  GraphEdge,
  ProjectGraph,
  SourceRange,
  SymbolKind,
  SymbolNode
} from "../../shared/types";

const RANGE: SourceRange = {
  startLine: 0,
  startCharacter: 0,
  endLine: 0,
  endCharacter: 10
};

test("assigns source to the nearest package or inferred module without overlap", () => {
  const graph = createFixtureGraph();
  graph.nodes.push(createNode("file-outside", "file", "/outside-workspace/ignored.ts"));
  const index = createProjectModuleIndex(graph, {
    roots: [{
      rootPath: "../outside-workspace",
      basis: "workspacePackage",
      label: "Must be rejected"
    }]
  });
  const root = findModule(index, ".");
  const api = findModule(index, "apps/api");
  const payments = findModule(index, "apps/api/plugins/payments");
  const domain = findModule(index, "packages/domain");
  const shared = findModule(index, "packages/shared");
  const apiClient = findModule(index, "apps/api-client");

  assert.equal(index.summary.internalModuleCount, 6);
  assert.equal(index.summary.analyzedFileCount, 9);
  assert.equal(index.summary.ownedFileCount, 8);
  assert.equal(index.modules.some((module) => module.displayPath.includes("outside-workspace")), false);

  assert.equal(root.basis, "workspaceRoot");
  assert.equal(root.analyzedFileCount, 1);
  assert.equal(root.descendantFileCount, 8);
  assert.equal(root.descendantCallableCount, 6);

  assert.equal(api.basis, "workspacePackage");
  assert.equal(api.confidence, "exact");
  assert.deepEqual(api.frameworks, ["Express"]);
  assert.deepEqual(api.manifestPaths, ["apps/api/package.json"]);
  assert.equal(api.analyzedFileCount, 2);
  assert.equal(api.descendantFileCount, 3);
  assert.equal(api.callableCount, 2);
  assert.equal(api.descendantCallableCount, 3);
  assert.equal(api.frameworkUnitCount, 1);
  assert.equal(api.entrypointCount, 1);
  assert.ok(api.evidence.some((entry) => entry.kind === "manifest"));
  assert.ok(api.evidence.some((entry) => entry.kind === "framework"));

  assert.equal(payments.parentModuleId, api.id);
  assert.equal(payments.analyzedFileCount, 1);
  assert.equal(index.moduleIdByNodeId.get("fn-payments-capture"), payments.id);
  assert.equal(index.moduleIdByNodeId.get("fn-domain-place"), domain.id);

  assert.equal(shared.basis, "sourceArea");
  assert.equal(shared.parentModuleId, root.id);
  assert.equal(apiClient.basis, "sourceArea");
  assert.notEqual(apiClient.parentModuleId, api.id);
  assert.equal(index.moduleIdByPathKey.get("/workspace/apps/api-client/src/index.ts"), apiClient.id);
});

test("aggregates cross-module execution and dependency evidence without self-loops", () => {
  const index = createProjectModuleIndex(createFixtureGraph());
  const api = findModule(index, "apps/api");
  const payments = findModule(index, "apps/api/plugins/payments");
  const domain = findModule(index, "packages/domain");
  const shared = findModule(index, "packages/shared");
  const external = index.modules.find((module) => module.basis === "externalBoundary");

  assert.ok(external);
  assert.equal(index.summary.moduleCount, 7);
  assert.equal(index.summary.crossModuleRelationCount, 8);
  assert.equal(index.summary.crossModuleEvidenceCount, 9);
  assert.equal(index.summary.internalRelationEvidenceCount, 1);
  assert.equal(index.summary.externalRelationEvidenceCount, 2);
  assert.equal(index.summary.unownedRelationEvidenceCount, 1);

  const calls = findRelation(index, api.id, domain.id, "calls");
  assert.equal(calls.evidenceCount, 2);
  assert.deepEqual(calls.confidenceCounts, {
    exact: 0,
    resolved: 1,
    inferred: 1,
    unresolved: 0
  });
  assert.equal(
    calls.evidence.every((entry) => entry.filePath === "/workspace/apps/api/src/controller.ts"),
    true
  );

  assert.equal(findRelation(index, api.id, domain.id, "imports").evidenceCount, 1);
  assert.equal(findRelation(index, api.id, domain.id, "exports").evidenceCount, 1);
  assert.equal(findRelation(index, api.id, domain.id, "routesTo").evidenceCount, 1);
  assert.equal(findRelation(index, domain.id, shared.id, "calls").evidenceCount, 1);
  assert.equal(findRelation(index, shared.id, api.id, "calls").evidenceCount, 1);
  assert.equal(findRelation(index, api.id, external.id, "imports").evidenceCount, 1);
  assert.equal(findRelation(index, payments.id, external.id, "calls").evidenceCount, 1);

  assert.equal(
    index.relations.some((relation) => relation.sourceModuleId === relation.targetModuleId),
    false
  );
  assert.equal(api.internalRelationCounts.calls, 1);
  assert.equal(external.incomingEvidenceCount, 2);
});

test("bounds representative callsites while retaining exact counts", () => {
  const graph = createFixtureGraph();
  graph.edges = graph.edges.filter((edge) => !edge.id.startsWith("call-api-domain-"));
  const generatedCalls = Array.from({ length: 7 }, (_, index) => createEdge({
    id: `call-api-domain-${index}`,
    kind: "calls",
    sourceId: "fn-api-handle",
    targetId: "fn-domain-place",
    filePath: "/workspace/apps/api/src/controller.ts",
    confidence: index === 0 ? "resolved" : "inferred",
    range: { ...RANGE, startLine: 20 + index, endLine: 20 + index }
  }));
  graph.edges.push(...generatedCalls, { ...generatedCalls[0] });

  const index = createProjectModuleIndex(graph);
  const relation = findRelation(
    index,
    findModule(index, "apps/api").id,
    findModule(index, "packages/domain").id,
    "calls"
  );

  assert.equal(relation.evidenceCount, 7);
  assert.equal(relation.evidence.length, PROJECT_MODULE_RELATION_EVIDENCE_LIMIT);
  assert.equal(relation.omittedEvidenceCount, 2);
  assert.equal(relation.confidenceCounts.resolved, 1);
  assert.equal(relation.confidenceCounts.inferred, 6);
});

test("produces the same module index when analyzer arrays are reversed", () => {
  const graph = createFixtureGraph();
  const reversed: ProjectGraph = {
    ...graph,
    nodes: [...graph.nodes].reverse(),
    edges: [...graph.edges].reverse(),
    metadata: {
      ...graph.metadata,
      projectPackageRoots: [...(graph.metadata.projectPackageRoots ?? [])].reverse(),
      frameworks: [...(graph.metadata.frameworks ?? [])].reverse(),
      frameworkUnits: [...(graph.metadata.frameworkUnits ?? [])].reverse(),
      frameworkUnitEdges: [...(graph.metadata.frameworkUnitEdges ?? [])].reverse()
    }
  };

  assert.deepEqual(
    serializeIndex(createProjectModuleIndex(reversed)),
    serializeIndex(createProjectModuleIndex(graph))
  );
});

/** Creates the complete multi-boundary graph used by every module test. */
function createFixtureGraph(): ProjectGraph {
  const files = [
    createNode("file-api-controller", "file", "/workspace/apps/api/src/controller.ts"),
    createNode("file-api-index", "file", "/workspace/apps/api/src/index.ts"),
    createNode("file-payments", "file", "/workspace/apps/api/plugins/payments/src/pay.ts"),
    createNode("file-domain-order", "file", "/workspace/packages/domain/src/order.ts"),
    createNode("file-domain-rules", "file", "/workspace/packages/domain/src/rules.ts"),
    createNode("file-shared", "file", "/workspace/packages/shared/src/log.ts"),
    createNode("file-root", "file", "/workspace/root-script.ts"),
    createNode("file-api-client", "file", "/workspace/apps/api-client/src/index.ts")
  ];
  const callables = [
    createNode("fn-api-handle", "function", "/workspace/apps/api/src/controller.ts"),
    createNode("fn-api-validate", "function", "/workspace/apps/api/src/controller.ts"),
    createNode("fn-payments-capture", "function", "/workspace/apps/api/plugins/payments/src/pay.ts"),
    createNode("fn-domain-place", "function", "/workspace/packages/domain/src/order.ts"),
    createNode("fn-domain-check", "function", "/workspace/packages/domain/src/rules.ts"),
    createNode("fn-shared-log", "function", "/workspace/packages/shared/src/log.ts")
  ];
  const external = createNode(
    "external-react",
    "external",
    "/workspace/apps/api/src/controller.ts"
  );
  external.qualifiedName = "react";

  const edges: GraphEdge[] = [
    createEdge({
      id: "call-api-domain-resolved",
      kind: "calls",
      sourceId: "fn-api-handle",
      targetId: "fn-domain-place",
      filePath: "/workspace/apps/api/src/controller.ts",
      confidence: "resolved"
    }),
    createEdge({
      id: "call-api-domain-inferred",
      kind: "calls",
      sourceId: "fn-api-handle",
      targetId: "fn-domain-place",
      filePath: "/workspace/apps/api/src/controller.ts",
      confidence: "inferred",
      range: { ...RANGE, startLine: 2, endLine: 2 }
    }),
    createEdge({
      id: "import-api-domain",
      kind: "imports",
      sourceId: "file-api-controller",
      targetId: "file-domain-order",
      filePath: "/workspace/apps/api/src/controller.ts",
      confidence: "resolved"
    }),
    createEdge({
      id: "export-api-domain",
      kind: "exports",
      sourceId: "file-api-index",
      targetId: "file-domain-order",
      filePath: "/workspace/apps/api/src/index.ts",
      confidence: "resolved"
    }),
    createEdge({
      id: "call-api-internal",
      kind: "calls",
      sourceId: "fn-api-handle",
      targetId: "fn-api-validate",
      filePath: "/workspace/apps/api/src/controller.ts",
      confidence: "exact"
    }),
    createEdge({
      id: "call-domain-shared",
      kind: "calls",
      sourceId: "fn-domain-place",
      targetId: "fn-shared-log",
      filePath: "/workspace/packages/domain/src/order.ts",
      confidence: "exact"
    }),
    createEdge({
      id: "call-shared-api",
      kind: "calls",
      sourceId: "fn-shared-log",
      targetId: "fn-api-handle",
      filePath: "/workspace/packages/shared/src/log.ts",
      confidence: "inferred"
    }),
    createEdge({
      id: "import-api-external",
      kind: "imports",
      sourceId: "file-api-controller",
      targetId: "external-react",
      filePath: "/workspace/apps/api/src/controller.ts",
      confidence: "unresolved"
    }),
    createEdge({
      id: "call-payments-missing",
      kind: "calls",
      sourceId: "fn-payments-capture",
      targetId: "missing-unresolved",
      filePath: "/workspace/apps/api/plugins/payments/src/pay.ts",
      confidence: "unresolved"
    }),
    createEdge({
      id: "call-domain-missing-resolved",
      kind: "calls",
      sourceId: "fn-domain-place",
      targetId: "missing-resolved",
      filePath: "/workspace/packages/domain/src/order.ts",
      confidence: "resolved"
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
    framework: "DomainFixture",
    rootPath: "packages/domain",
    kind: "service",
    name: "OrderService",
    filePath: "/workspace/packages/domain/src/order.ts",
    range: RANGE
  }];

  return {
    workspaceRoot: "/workspace",
    version: "module-fixture-v1",
    generatedAt: "2026-07-19T00:00:00.000Z",
    nodes: [...files, ...callables, external],
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
        evidence: ["package.json dependency: express"]
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
        manifestPaths: ["packages/domain/pyproject.toml"],
        ecosystems: ["python"]
      }],
      frameworkUnits,
      frameworkUnitEdges: [{
        id: "framework-route-domain",
        kind: "routesTo",
        sourceId: "unit-api-route",
        targetId: "unit-domain-service",
        filePath: "/workspace/apps/api/src/controller.ts",
        range: RANGE,
        confidence: "resolved"
      }],
      fileCount: files.length,
      symbolCount: files.length + callables.length,
      edgeCount: edges.length
    }
  };
}

/** Creates one graph node with stable fixture ranges and language metadata. */
function createNode(
  id: string,
  kind: SymbolKind,
  filePath: string
): SymbolNode {
  const name = filePath.split("/").at(-1) ?? id;
  return {
    id,
    kind,
    name,
    qualifiedName: id,
    filePath,
    range: RANGE,
    selectionRange: RANGE,
    language: "typescript"
  };
}

/** Creates a fixture graph edge while allowing callsite-specific ranges. */
function createEdge(input: {
  id: string;
  kind: GraphEdge["kind"];
  sourceId: string;
  targetId: string;
  filePath: string;
  confidence: EdgeConfidence;
  range?: SourceRange;
}): GraphEdge {
  return { ...input, range: input.range ?? RANGE };
}

/** Finds one expected module by its workspace-relative display identity. */
function findModule(index: ProjectModuleIndex, displayPath: string) {
  const module = index.modules.find((candidate) => candidate.displayPath === displayPath);
  assert.ok(module, `Expected module ${displayPath}`);
  return module;
}

/** Finds one expected relation without relying on array position. */
function findRelation(
  index: ProjectModuleIndex,
  sourceModuleId: string,
  targetModuleId: string,
  kind: ProjectModuleRelation["kind"]
): ProjectModuleRelation {
  const relation = index.relations.find((candidate) =>
    candidate.sourceModuleId === sourceModuleId
      && candidate.targetModuleId === targetModuleId
      && candidate.kind === kind
  );
  assert.ok(relation, `Expected ${kind} relation from ${sourceModuleId} to ${targetModuleId}`);
  return relation;
}

/** Converts host-side maps to sorted entries for deterministic deep comparison. */
function serializeIndex(index: ProjectModuleIndex) {
  return {
    modules: index.modules,
    relations: index.relations,
    moduleIdByPathKey: [...index.moduleIdByPathKey].sort(compareEntry),
    moduleIdByNodeId: [...index.moduleIdByNodeId].sort(compareEntry),
    summary: index.summary
  };
}

/** Stable map-entry comparison used only by the deterministic fixture assertion. */
function compareEntry(left: [string, string], right: [string, string]): number {
  return left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0;
}
