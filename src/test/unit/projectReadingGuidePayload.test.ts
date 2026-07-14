/**
 * Protocol-boundary tests for Project Reading Guide payload budgets.
 * Fixtures intentionally exceed every domain display cap so the Webview adapter
 * remains bounded independently from projector implementation details.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  createProjectReadingGuidePayload,
  createProjectReadingScopePayloadId,
  createProjectScopeReadingGuidePayload
} from "../../application/projectReadingGuide";
import type {
  ProjectReadingGuideIndex,
  ProjectReadingPath,
  ProjectReadingScopeSummary,
  ProjectReadingSourceArea,
  ProjectScopeReadingGuide
} from "../../insights/projectReadingGuide";
import type { SemanticFlowIndex } from "../../insights/semanticFlow";
import type { ProjectGraph } from "../../shared/types";

test("initial reading guide sends three opaque scope summaries without host identities", () => {
  const graph = createGraph();
  const index: ProjectReadingGuideIndex = {
    graphVersion: graph.version,
    workspaceRoot: ".",
    scopes: Array.from({ length: 7 }, (_, value) => createScope(value)),
    totalScopeCount: 7,
    omittedScopeCount: 0
  };
  const payload = createProjectReadingGuidePayload(graph, createSemanticFlows(34), index);

  assert.equal(payload.scopes.length, 3);
  assert.equal(payload.candidateScopeCount, 7);
  assert.equal(payload.omittedScopeCount, 4);
  assert.match(payload.headline, /GraphQL/);
  assert.match(payload.detail, /34 HTTP\/GraphQL entrypoints/);
  assert.ok(payload.scopes.every((scope) => /^reading-scope:[0-9a-f]{24}$/u.test(scope.id)));
  assert.equal(payload.scopes[0]?.id, createProjectReadingScopePayloadId(index.scopes[0]?.id ?? ""));

  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(
    serialized,
    /rootPath|filePath|representativeFilePaths|functionId|ownerFunctionId|callEdgeId|readingPaths/u
  );
  assert.doesNotMatch(serialized, /project-reading:scope|%2Fworkspace|\/workspace/u);
  assert.equal(serialized.includes("C:\\\\Users"), false);
  assert.doesNotMatch(serialized, /%5CUsers|%5C%5Cserver/u);
  assert.ok(Buffer.byteLength(serialized, "utf8") < 4 * 1024);
});

test("selected scope caps areas, flows, and steps while preserving omission counts", () => {
  const paths = Array.from({ length: 8 }, (_, value) => createReadingPath(value));
  const guide: ProjectScopeReadingGuide = {
    graphVersion: "reading-payload",
    scope: createScope(0),
    areas: Array.from({ length: 12 }, (_, value) => createArea(value)),
    totalAreaCount: 12,
    omittedAreaCount: 0,
    readingPaths: paths,
    mappedFlowCount: 8,
    omittedMappedFlowCount: 0,
    unmappedEntrypointCount: 2
  };
  const payload = createProjectScopeReadingGuidePayload(guide);

  assert.equal(payload.areas.length, 5);
  assert.equal(payload.omittedAreaCount, 7);
  assert.equal(payload.representativeFlows.length, 3);
  assert.equal(payload.omittedFlowCount, 5);
  assert.ok(payload.representativeFlows.every((flow) => flow.steps.length === 5));
  assert.ok(payload.representativeFlows.every((flow) => flow.omittedStepCount === 2));
  assert.equal(payload.representativeFlows[0]?.steps[3]?.functionId, undefined);
  assert.equal(payload.representativeFlows[0]?.steps[3]?.boundaryKind, "unresolvedCall");
  assert.ok(Buffer.byteLength(JSON.stringify(payload), "utf8") < 16 * 1024);
});

/** Creates one scope with GraphQL and HTTP counts that must remain separated. */
function createScope(value: number): ProjectReadingScopeSummary {
  const rootPath = value === 1
    ? "C:\\Users\\private-user\\apps\\app-1"
    : value === 2
      ? "\\\\server\\private-share\\apps\\app-2"
      : `/workspace/apps/app-${value}`;

  return {
    id: `project-reading:scope:${encodeURIComponent(rootPath)}`,
    rootPath,
    displayPath: `apps/app-${value}`,
    basis: "application",
    frameworks: ["GraphQL", "NestJS"],
    frameworkCount: 2,
    omittedFrameworkCount: 0,
    analyzedFileCount: 100 - value,
    callableCount: 200 - value,
    execution: {
      entrypointCount: 17,
      mappedCount: 15,
      mappingGapCount: 2,
      httpRouteCount: 8,
      graphqlQueryCount: 4,
      graphqlMutationCount: 3,
      graphqlSubscriptionCount: 1,
      graphqlOtherCount: 1
    }
  };
}

/** Creates one source area; representative file identities stay host-side. */
function createArea(value: number): ProjectReadingSourceArea {
  return {
    id: `area:${value}`,
    rootPath: `/workspace/apps/api/src/area-${value}`,
    displayPath: `apps/api/src/area-${value}`,
    basis: "sourceDirectory",
    analyzedFileCount: 10,
    callableCount: 20,
    entrypointCount: 2,
    representativeFilePaths: [`src/area-${value}/index.ts`],
    omittedFileCount: 9
  };
}

/** Creates seven steps, including an unresolved call that must not become clickable. */
function createReadingPath(value: number): ProjectReadingPath {
  const kinds = ["operation", "handler", "call", "call", "call", "call", "call"] as const;

  return {
    id: `path:${value}`,
    scopeId: "scope:0",
    entrypointKind: "graphqlOperation",
    entrypointUnitId: `operation:${value}`,
    transport: "graphqlQuery",
    operationType: "Query",
    framework: "GraphQL",
    name: `viewer${value}`,
    confidence: "resolved",
    traceStatus: "unresolved",
    steps: kinds.map((kind, stepIndex) => ({
      kind,
      depth: stepIndex,
      role: stepIndex === 3 ? "unknown" : stepIndex === 4 ? "repository" : "service",
      resolution: stepIndex === 3 ? "unresolved" : "concrete",
      name: `step${stepIndex}`,
      qualifiedName: `Flow.step${stepIndex}`,
      functionId: `fn:${value}:${stepIndex}`,
      ownerFunctionId: stepIndex > 1 ? `fn:${value}:${stepIndex - 1}` : undefined,
      callEdgeId: stepIndex > 1 ? `edge:${value}:${stepIndex}` : undefined,
      filePath: `/workspace/apps/api/src/step-${stepIndex}.ts`,
      range: {
        startLine: stepIndex,
        startCharacter: 0,
        endLine: stepIndex,
        endCharacter: 10
      },
      confidence: stepIndex === 3 ? "unresolved" : "resolved"
    })),
    totalStepCount: 7,
    omittedStepCount: 0,
    depthLimitReached: false,
    stepLimitReached: false,
    unresolvedCallCount: 1
  };
}

/** Creates only metadata used by headline projection. */
function createGraph(): ProjectGraph {
  return {
    workspaceRoot: "/workspace",
    version: "reading-payload",
    generatedAt: "2026-07-13T00:00:00.000Z",
    nodes: [],
    edges: [],
    diagnostics: [],
    metadata: {
      languages: ["typescript"],
      languageSummary: [{ language: "typescript", fileCount: 700, percentage: 100 }],
      fileCount: 700,
      symbolCount: 0,
      edgeCount: 0
    }
  };
}

/** Creates the summary-only Semantic Flow shape required by the first adapter. */
function createSemanticFlows(entrypointCount: number): SemanticFlowIndex {
  return {
    graphVersion: "reading-payload",
    flows: [],
    flowsByEntrypointUnitId: new Map(),
    flowsByRouteUnitId: new Map(),
    coverageGaps: [],
    coverageGapsByEntrypointUnitId: new Map(),
    coverageGapsByRouteUnitId: new Map(),
    summary: {
      graphVersion: "reading-payload",
      entrypointCount,
      routeCount: 20,
      operationCount: 14,
      mappedHandlerCount: 30,
      ambiguousEntrypointCount: 1,
      ambiguousRouteCount: 1,
      ambiguousOperationCount: 0,
      handlerNotMappedCount: 3
    }
  };
}
