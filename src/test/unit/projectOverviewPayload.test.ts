/** Tests the bounded Project Overview presentation boundary. */

import assert from "node:assert/strict";
import test from "node:test";
import { createProjectOverviewPayload } from "../../application/projectOverview";
import type { ProjectOverview, ProjectRiskItem } from "../../insights/projectOverview";

test("createProjectOverviewPayload emits three factual lines and three signals", () => {
  const overview = createOverviewFixture();
  const payload = createProjectOverviewPayload(overview);

  assert.equal(payload.graphVersion, "overview-test");
  assert.deepEqual(payload.facts.map((fact) => fact.id), [
    "scopeStack",
    "executionSurface",
    "analysisCoverage"
  ]);
  assert.match(payload.facts[0]?.value ?? "", /842 files/);
  assert.match(payload.facts[1]?.value ?? "", /68 entrypoints · 61 mapped/);
  assert.match(payload.facts[2]?.detail ?? "", /8 unresolved calls/);
  assert.equal(payload.signals.length, 3);
  assert.equal(payload.candidateSignalCount, 6);
  assert.equal(payload.omittedSignalCount, 3);
  assert.doesNotThrow(() => JSON.stringify(payload));
});

test("createProjectOverviewPayload caps evidence identities and keeps source navigation", () => {
  const payload = createProjectOverviewPayload(createOverviewFixture());
  const unresolved = payload.signals.find((signal) => signal.kind === "unresolvedExecution");

  assert.ok(unresolved);
  assert.equal(unresolved.functionId, "service");
  assert.equal(unresolved.filePath, "/workspace/src/service.ts");
  assert.equal(unresolved.evidence.functionIds.length, 3);
  assert.equal(unresolved.evidence.omittedIdentityCount, 7);
});

test("createProjectOverviewPayload stays small when domain evidence is large", () => {
  const overview = createOverviewFixture();
  const firstRisk = overview.radar.items[0];

  assert.ok(firstRisk);
  firstRisk.evidence.entrypointUnitIds = Array.from({ length: 2_000 }, (_, index) => `entry-${index}`);
  firstRisk.evidence.frameworkUnitIds = Array.from({ length: 2_000 }, (_, index) => `unit-${index}`);
  firstRisk.evidence.sourceFunctionIds = Array.from({ length: 2_000 }, (_, index) => `source-${index}`);
  firstRisk.evidence.edgeIds = Array.from({ length: 2_000 }, (_, index) => `edge-${index}`);

  const payload = createProjectOverviewPayload(overview);
  const serializedBytes = Buffer.byteLength(JSON.stringify(payload), "utf8");

  assert.ok(serializedBytes < 8 * 1024, `overview payload was ${serializedBytes} bytes`);
  assert.ok(payload.signals.every((signal) => signal.evidence.entrypointUnitIds.length <= 3));
  assert.ok(payload.signals.every((signal) => signal.evidence.frameworkUnitIds.length <= 3));
  assert.ok(payload.signals.every((signal) => signal.evidence.functionIds.length <= 3));
  assert.ok(payload.signals.every((signal) => signal.evidence.edgeIds.length <= 3));
});

/** Creates a rich domain result without coupling this adapter test to graph analysis. */
function createOverviewFixture(): ProjectOverview {
  const risks: ProjectRiskItem[] = [
    createUnresolvedRisk("risk:unresolved", 9),
    {
      ...createRiskBase("risk:entrypoint", "entrypointCoverage", 4),
      kind: "entrypointCoverage",
      framework: "GraphQL",
      rootPath: "apps/api",
      ambiguousCount: 1,
      handlerNotMappedCount: 3
    },
    {
      ...createRiskBase("risk:analysis", "analysisCoverage", 3),
      kind: "analysisCoverage",
      errorDiagnosticCount: 2,
      warningDiagnosticCount: 1,
      traversalLimitGapCount: 0
    },
    createUnresolvedRisk("risk:omitted-visible", 1)
  ];

  return {
    graphVersion: "overview-test",
    brief: {
      graphVersion: "overview-test",
      scope: {
        analyzedFileCount: 842,
        symbolCount: 6_000,
        callableCount: 3_100,
        callEdgeCount: 5_000
      },
      stack: {
        languages: [
          { language: "typescript", fileCount: 700, percentage: 83 },
          { language: "python", fileCount: 120, percentage: 14 },
          { language: "javascript", fileCount: 22, percentage: 3 }
        ],
        frameworkRoots: [
          { name: "NestJS", ecosystem: "javascript", category: "backend", rootPath: "apps/api" },
          { name: "GraphQL", ecosystem: "javascript", category: "backend", rootPath: "apps/api" },
          { name: "Django", ecosystem: "python", category: "backend", rootPath: "apps/admin" }
        ]
      },
      executionSurface: {
        entrypointCount: 68,
        routeCount: 44,
        operationCount: 24,
        mappedCount: 61,
        mappingGapCount: 7,
        groups: [],
        omittedGroupCount: 0,
        omittedEntrypointCount: 0
      },
      analysisCoverage: {
        errorDiagnosticCount: 2,
        warningDiagnosticCount: 1,
        infoDiagnosticCount: 0,
        unresolvedCallEdgeCount: 8,
        inferredCallEdgeCount: 3,
        ambiguousEntrypointCount: 1,
        handlerNotMappedCount: 6,
        traversalLimitGapCount: 2
      }
    },
    radar: {
      graphVersion: "overview-test",
      items: risks,
      candidateItemCount: 6,
      omittedItemCount: 2
    }
  };
}

/** Creates one unresolved-flow signal with more identities than the wire cap. */
function createUnresolvedRisk(id: string, count: number): ProjectRiskItem {
  return {
    ...createRiskBase(id, "unresolvedExecution", count),
    kind: "unresolvedExecution",
    sourceFunctionId: "service",
    sourceFunctionName: "UserService.load",
    unresolvedCallCount: count,
    location: {
      filePath: "/workspace/src/service.ts",
      range: { startLine: 10, startCharacter: 2, endLine: 10, endCharacter: 20 }
    }
  };
}

/** Creates common source-backed evidence used by all fixture signals. */
function createRiskBase(
  id: string,
  kind: ProjectRiskItem["kind"],
  evidenceCount: number
): Omit<ProjectRiskItem, "kind"> & { kind: typeof kind } {
  return {
    id,
    kind,
    evidenceCount,
    affectedEntrypointCount: 2,
    confidence: "unresolved",
    evidence: {
      diagnosticIndexes: [0, 1, 2, 3],
      entrypointUnitIds: ["entry-1", "entry-2", "entry-3", "entry-4"],
      frameworkUnitIds: ["unit-1", "unit-2", "unit-3", "unit-4"],
      sourceFunctionIds: ["service", "caller-1"],
      targetFunctionIds: ["target-1", "target-2", "target-3"],
      omittedFunctionIds: ["target-4"],
      edgeIds: ["edge-1", "edge-2", "edge-3", "edge-4"]
    }
  } as Omit<ProjectRiskItem, "kind"> & { kind: typeof kind };
}
