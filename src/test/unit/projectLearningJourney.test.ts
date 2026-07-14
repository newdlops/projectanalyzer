/**
 * Curriculum and generated-Webview tests for the first Project Learning
 * Journey slice. They distinguish visited analyzer actions from comprehension
 * and ensure graph-scoped progress cannot be advanced by stale evidence.
 */

import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createProjectLearningCurriculum } from "../../shared/projectLearningJourney";
import { getExplorerHtml } from "../../webview/webviewHtml";
import { installSidebarWebviewRuntime } from "./helpers/sidebarWebviewRuntime";

test("shared learning curriculum stays independent from host and UI modules", async () => {
  const projectRoot = path.resolve(__dirname, "../../..");
  const moduleRoot = path.join(projectRoot, "src", "shared", "projectLearningJourney");
  const sourceFiles = (await readdir(moduleRoot)).filter((fileName) => fileName.endsWith(".ts"));

  assert.ok(sourceFiles.length >= 2);
  for (const fileName of sourceFiles) {
    const source = await readFile(path.join(moduleRoot, fileName), "utf8");
    assert.doesNotMatch(
      source,
      /from\s+["'][^"']*(?:application|extension|protocol|webview|vscode)[^"']*["']/u
    );
  }
});

test("curriculum keeps the full learning process ordered and evidence-qualified", () => {
  const curriculum = createProjectLearningCurriculum();

  assert.deepEqual(
    curriculum.roadmap.map((stage) => stage.id),
    [
      "context",
      "architecture",
      "criticalFlows",
      "dataDependencies",
      "qualityChange",
      "operationsFailure",
      "handsOnProof",
      "continuousRefresh"
    ]
  );
  assert.deepEqual(
    curriculum.orientationActions.map((action) => action.id),
    ["inspectScope", "traceRepresentativePath", "verifyConcreteSource"]
  );
  assert.ok(curriculum.roadmap.some((stage) => stage.evidenceStates.includes("unknown")));
  assert.ok(curriculum.roadmap.some((stage) => stage.evidenceStates.includes("confirmed")));
  assert.ok(curriculum.roadmap.some((stage) => stage.evidenceStates.includes("demonstrated")));
  assert.ok(curriculum.orientationActions.every((action) => action.explainBack.length > 0));
  assert.doesNotMatch(JSON.stringify(curriculum), /mastered|onboarding complete/iu);
});

test("sidebar advances only current-snapshot scope, path, and concrete-source visits", () => {
  const script = getSidebarScript();
  const runtime = installSidebarWebviewRuntime({ unrelatedState: "preserved" });

  try {
    new Function(script)();
    runtime.dispatchMessage(createGraphLoaded("graph-learning-1"));
    runtime.dispatchMessage(createReadingGuideLoaded("graph-learning-1"));

    assert.ok(runtime.textValues.includes("Next 1/3 · Map the project"));
    assert.equal(latestOrientationProgress(runtime.textValues),
      "0 of 3 orientation actions visited · not a readiness score");
    assert.deepEqual(runtime.messages.map((message) => message.type), ["ui/ready"]);

    runtime.clickByTitle("Inspect apps/api");
    assert.deepEqual(runtime.messages.at(-1), {
      type: "project/readingGuideScope",
      payload: {
        graphVersion: "graph-learning-1",
        scopeId: "reading-scope:learning"
      }
    });
    runtime.clickByTitle("Inspect apps/api");
    assert.equal(countMessages(runtime.messages, "project/readingGuideScope"), 1);

    runtime.dispatchMessage(createScopeGuideLoaded("stale-graph"));
    assert.equal(latestOrientationProgress(runtime.textValues),
      "0 of 3 orientation actions visited · not a readiness score");

    runtime.dispatchMessage(createScopeGuideLoaded("graph-learning-1"));
    assert.equal(latestOrientationProgress(runtime.textValues),
      "1 of 3 orientation actions visited · not a readiness score");
    assert.ok(runtime.textValues.includes("Next 2/3 · Trace one request"));

    runtime.clickByTitle("Study reading path: GET /users/:id");
    assert.equal(latestOrientationProgress(runtime.textValues),
      "2 of 3 orientation actions visited · not a readiness score");
    assert.ok(runtime.textValues.includes("Next 3/3 · Verify in source"));
    assert.equal(countMessages(runtime.messages, "node/openSource"), 0);

    runtime.clickByTitle("Open UsersController.findOne · src/users.controller.ts:12");
    assert.equal(latestOrientationProgress(runtime.textValues),
      "3 of 3 orientation actions visited · not a readiness score");
    assert.ok(runtime.textValues.includes("Orientation actions visited"));
    assert.deepEqual(runtime.messages.at(-1), {
      type: "node/openSource",
      payload: { nodeId: `source-node:${"a".repeat(64)}` }
    });

    const persisted = runtime.getPersistedState() as {
      projectLearningJourney?: Record<string, unknown>;
      unrelatedState?: string;
    };
    assert.equal(persisted.unrelatedState, "preserved");
    assert.deepEqual(persisted.projectLearningJourney, {
      curriculumVersion: "1",
      graphVersion: "graph-learning-1",
      visitedActionIds: [
        "inspectScope",
        "traceRepresentativePath",
        "verifyConcreteSource"
      ]
    });
    assert.doesNotMatch(JSON.stringify(persisted), /workspace|users\.controller|source-node/iu);

    runtime.dispatchMessage(createGraphLoaded("graph-learning-2"));
    assert.equal(latestOrientationProgress(runtime.textValues),
      "0 of 3 orientation actions visited · not a readiness score");
    assert.ok(runtime.textValues.filter((value) => value === "Next 1/3 · Map the project").length >= 2);
  } finally {
    runtime.restore();
  }
});

test("sidebar restores only matching graph and curriculum progress", () => {
  const matchingRuntime = installSidebarWebviewRuntime({
    unrelatedState: "preserved",
    projectLearningJourney: {
      curriculumVersion: "1",
      graphVersion: "graph-learning-saved",
      visitedActionIds: ["inspectScope", "unknown-action"]
    }
  });

  try {
    new Function(getSidebarScript())();
    matchingRuntime.dispatchMessage(createGraphLoaded("graph-learning-saved"));
    assert.equal(latestOrientationProgress(matchingRuntime.textValues),
      "1 of 3 orientation actions visited · not a readiness score");
    assert.ok(matchingRuntime.textValues.includes("Next 2/3 · Trace one request"));
  } finally {
    matchingRuntime.restore();
  }

  const changedCurriculumRuntime = installSidebarWebviewRuntime({
    projectLearningJourney: {
      curriculumVersion: "older",
      graphVersion: "graph-learning-saved",
      visitedActionIds: ["inspectScope"]
    }
  });

  try {
    new Function(getSidebarScript())();
    changedCurriculumRuntime.dispatchMessage(createGraphLoaded("graph-learning-saved"));
    assert.equal(latestOrientationProgress(changedCurriculumRuntime.textValues),
      "0 of 3 orientation actions visited · not a readiness score");
  } finally {
    changedCurriculumRuntime.restore();
  }
});

test("sidebar rejects non-contiguous saved learning actions", () => {
  const runtime = installSidebarWebviewRuntime({
    projectLearningJourney: {
      curriculumVersion: "1",
      graphVersion: "graph-learning-out-of-order",
      visitedActionIds: ["verifyConcreteSource", "traceRepresentativePath"]
    }
  });

  try {
    new Function(getSidebarScript())();
    runtime.dispatchMessage(createGraphLoaded("graph-learning-out-of-order"));
    assert.equal(latestOrientationProgress(runtime.textValues),
      "0 of 3 orientation actions visited · not a readiness score");
    assert.ok(runtime.textValues.includes("Next 1/3 · Map the project"));
  } finally {
    runtime.restore();
  }
});

test("reading steps without a source token cannot advance source verification", () => {
  const runtime = installSidebarWebviewRuntime();

  try {
    new Function(getSidebarScript())();
    runtime.dispatchMessage(createGraphLoaded("graph-learning-no-token"));
    runtime.dispatchMessage(createReadingGuideLoaded("graph-learning-no-token"));
    runtime.clickByTitle("Inspect apps/api");
    runtime.dispatchMessage(createScopeGuideLoaded("graph-learning-no-token", false));
    runtime.clickByTitle("Study reading path: GET /users/:id");

    assert.throws(
      () => runtime.clickByTitle("Open UsersController.findOne · src/users.controller.ts:12"),
      /missing element titled/u
    );
    assert.equal(latestOrientationProgress(runtime.textValues),
      "2 of 3 orientation actions visited · not a readiness score");
    assert.equal(countMessages(runtime.messages, "node/openSource"), 0);
  } finally {
    runtime.restore();
  }
});

test("late scope failures cannot clear the currently selected scope", () => {
  const runtime = installSidebarWebviewRuntime();
  const firstScope = createScope("reading-scope:first", "apps/first");
  const secondScope = createScope("reading-scope:second", "apps/second");

  try {
    new Function(getSidebarScript())();
    runtime.dispatchMessage(createGraphLoaded("graph-learning-scopes"));
    runtime.dispatchMessage(createReadingGuideLoaded(
      "graph-learning-scopes",
      [firstScope, secondScope]
    ));
    runtime.clickByTitle("Inspect apps/first");
    runtime.clickByTitle("Inspect apps/second");
    assert.equal(countMessages(runtime.messages, "project/readingGuideScope"), 2);

    runtime.dispatchMessage({
      type: "project/readingGuideScopeFailed",
      payload: {
        graphVersion: "graph-learning-scopes",
        scopeId: "reading-scope:first",
        message: "Stale first scope failure"
      }
    });
    assert.ok(!runtime.textValues.includes("Stale first scope failure"));
    assert.equal(latestOrientationProgress(runtime.textValues),
      "0 of 3 orientation actions visited · not a readiness score");

    runtime.dispatchMessage(createScopeGuideLoaded(
      "graph-learning-scopes",
      true,
      secondScope
    ));
    assert.equal(latestOrientationProgress(runtime.textValues),
      "1 of 3 orientation actions visited · not a readiness score");
    runtime.clickByTitle("Inspect apps/second");
    assert.equal(countMessages(runtime.messages, "project/readingGuideScope"), 2);
  } finally {
    runtime.restore();
  }
});

test("sidebar HTML contains every required learning-journey landmark", () => {
  const html = getSidebarHtml();
  const script = getSidebarScript();

  assert.match(html, /Project Learning Journey/u);
  assert.match(html, /script-src 'nonce-learning-nonce'/u);
  assert.match(html, /id="learning-progress"[^>]*aria-live="polite"/u);
  assert.match(html, /id="learning-current"/u);
  assert.match(html, /id="learning-roadmap"/u);
  assert.match(html, /Full onboarding roadmap/u);
  assert.match(html, /Project Map evidence/u);
  assert.doesNotMatch(script, /<\/script|\beval\s*\(/u);
});

/** Extracts the executable sidebar source from its generated HTML document. */
function getSidebarScript(): string {
  const html = getSidebarHtml();
  const match = html.match(/<script nonce="learning-nonce">([\s\S]*)<\/script>/u);
  assert.ok(match, "missing generated sidebar script");
  return match[1];
}

/** Builds one sidebar document for static and executable Webview assertions. */
function getSidebarHtml(): string {
  return getExplorerHtml({
    webview: { cspSource: "vscode-webview:" } as never,
    extensionUri: {} as never,
    nonce: "learning-nonce",
    defaultDepth: 2,
    maxRenderedNodes: 500,
    initialMode: "file",
    surface: "sidebar"
  });
}

/** Returns the newest progress sentence from accumulated fake-DOM text writes. */
function latestOrientationProgress(values: string[]): string | undefined {
  return values.filter((value) => value.includes("orientation actions visited")).at(-1);
}

function countMessages(
  messages: Array<{ type: string; payload: unknown }>,
  type: string
): number {
  return messages.filter((message) => message.type === type).length;
}

function createGraphLoaded(version: string): Record<string, unknown> {
  return {
    type: "graph/loaded",
    payload: {
      workspaceRoot: "/workspace",
      version,
      generatedAt: "2026-07-14T00:00:00.000Z",
      nodes: [],
      edges: [],
      diagnostics: [],
      metadata: {
        languages: ["typescript"],
        frameworks: [],
        frameworkUnits: [],
        frameworkUnitEdges: [],
        fileCount: 4,
        symbolCount: 8,
        edgeCount: 3
      }
    }
  };
}

function createReadingGuideLoaded(
  graphVersion: string,
  scopes: Record<string, unknown>[] = [createScope()]
): Record<string, unknown> {
  return {
    type: "project/readingGuideLoaded",
    payload: {
      graphVersion,
      headline: "NestJS",
      detail: "4 analyzed files · 1 HTTP/GraphQL entrypoints · 1 scope",
      scopes,
      candidateScopeCount: scopes.length,
      omittedScopeCount: 0
    }
  };
}

function createScopeGuideLoaded(
  graphVersion: string,
  includeSourceToken = true,
  scope = createScope()
): Record<string, unknown> {
  return {
    type: "project/readingGuideScopeLoaded",
    payload: {
      graphVersion,
      scope,
      areas: [{
        id: "reading-area:src",
        displayPath: "apps/api/src",
        basis: "sourceDirectory",
        analyzedFileCount: 4,
        callableCount: 8,
        entrypointCount: 1,
        representativeFilePaths: ["apps/api/src/users.controller.ts"]
      }],
      candidateAreaCount: 1,
      omittedAreaCount: 0,
      representativeFlows: [{
        id: "reading-flow:users",
        transport: "http",
        framework: "NestJS",
        name: "GET /users/:id",
        confidence: "resolved",
        traceStatus: "limited",
        steps: [{
          stages: ["entrypoint", "handler"],
          role: "controller",
          label: "UsersController.findOne",
          sourceLocation: "src/users.controller.ts:12",
          sourceLocationKind: "definition",
          ...(includeSourceToken ? { sourceToken: `source-node:${"a".repeat(64)}` } : {})
        }, {
          stages: ["intermediate", "boundary"],
          role: "unresolved",
          label: "Unresolved call",
          sourceLocation: "src/users.controller.ts:18",
          sourceLocationKind: "callsite",
          boundaryKind: "unresolvedCall"
        }],
        omittedStepCount: 0,
        depthLimitReached: false,
        stepLimitReached: false,
        unresolvedCallCount: 1
      }],
      eligibleFlowCount: 1,
      omittedFlowCount: 0,
      unmappedEntrypointCount: 0
    }
  };
}

function createScope(
  id = "reading-scope:learning",
  displayPath = "apps/api"
): Record<string, unknown> {
  return {
    id,
    displayPath,
    basis: "application",
    frameworks: ["NestJS"],
    frameworkCount: 1,
    omittedFrameworkCount: 0,
    analyzedFileCount: 4,
    callableCount: 8,
    execution: {
      entrypointCount: 1,
      mappedCount: 1,
      mappingGapCount: 0,
      httpRouteCount: 1,
      graphqlQueryCount: 0,
      graphqlMutationCount: 0,
      graphqlSubscriptionCount: 0,
      graphqlOtherCount: 0
    }
  };
}
