/**
 * Unit tests for the pure Guided Tour mission projector.
 * Tests keep educational copy tied to primary-path evidence and verify that
 * unavailable and unresolved states do not fabricate business-layer claims.
 */

import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createGuidedTourProjection } from "../../insights/guidedTour";
import type {
  ProjectPrimaryReadingPath,
  ProjectPrimaryReadingPathDiagnostics,
  ProjectPrimaryReadingPathResult,
  ProjectPrimaryReadingStep,
  ProjectReadingArchitecture,
  ProjectReadingEvidenceAnchor
} from "../../insights/projectReadingGuide";
import type { SourceRange } from "../../shared/types";

test("projects one mission with handler, decision, and boundary source stops", () => {
  const projection = createGuidedTourProjection(createSelectedResult(createPath([
    createStep("route", "route:orders", "entrypoint", 0, {
      frameworkEvidence: createAnchor("frameworkEvidence", "route:orders", "/workspace/routes.ts", 1)
    }),
    createStep("handler", "orders:handler", "interface", 1, {
      definition: createAnchor("definition", "orders:handler", "/workspace/controllers/orders.ts", 10)
    }),
    createStep("call", "orders:rule", "domain", 2, {
      definition: createAnchor("definition", "orders:rule", "/workspace/domain/order.ts", 20),
      incomingCallsite: createAnchor("callsite", "orders:handler", "/workspace/controllers/orders.ts", 15)
    }),
    {
      ...createStep("call", "orders:store", "dataAccess", 3, {
        definition: createAnchor("definition", "orders:store", "/workspace/persistence/orders.ts", 30),
        incomingCallsite: createAnchor("callsite", "orders:rule", "/workspace/domain/order.ts", 25)
      }),
      role: "repository",
      boundaryKind: "repository",
      readingCues: ["boundary"]
    }
  ])));

  assert.equal(projection.availability, "ready");
  if (projection.availability !== "ready") return;
  assert.equal(projection.mission.title, "Trace one request through the code");
  assert.deepEqual(
    projection.mission.stops.map((stop) => stop.kind),
    ["handler", "decisionCandidate", "boundary"]
  );
  const decision = projection.mission.stops[1];
  assert.equal(decision?.mode, "navigable");
  if (decision?.mode !== "navigable") return;
  assert.equal(decision.functionId, "orders:rule");
  assert.equal(decision.filePath, "/workspace/domain/order.ts");
  assert.equal(decision.range.startLine, 20);
  assert.equal(decision.architecture?.businessLogic, "domainRuleCandidate");
  assert.equal(decision.anchors.length, 2);
  assert.deepEqual(decision.requiredAnchorIds, decision.anchors.map((anchor) => anchor.id));
  assert.equal(
    decision.lookFor.every((item) => decision.requiredAnchorIds.includes(item.anchorId)),
    true
  );
  assert.match(decision.whyNow, /domain-rule candidate/u);
  assert.match(decision.question, /invariant|decision/u);
  assert.ok(decision.moveOnWhen.length > 0);
});

test("keeps an unresolved call as an evidence gap instead of infrastructure", () => {
  const unresolved = {
    ...createStep("call", "dynamic-target", "unclassified", 2, {
      incomingCallsite: createAnchor("callsite", "orders:handler", "/workspace/controller.ts", 12)
    }),
    resolution: "unresolved" as const,
    architecture: createArchitecture("unclassified")
  };
  const projection = createGuidedTourProjection(createSelectedResult(createPath([
    createStep("route", "route:orders", "entrypoint", 0, {
      frameworkEvidence: createAnchor("frameworkEvidence", "route:orders", "/workspace/routes.ts", 1)
    }),
    createStep("handler", "orders:handler", "interface", 1, {
      definition: createAnchor("definition", "orders:handler", "/workspace/controller.ts", 10)
    }),
    unresolved
  ], "noCandidateObserved")));

  assert.equal(projection.availability, "ready");
  if (projection.availability !== "ready") return;
  const gap = projection.mission.stops.find((stop) => stop.functionId === "dynamic-target");
  assert.equal(gap?.kind, "evidenceGap");
  assert.equal(gap?.architecture?.layer, "unclassified");
  assert.match(gap?.unknowns.join(" ") ?? "", /layer.*unknown/u);
  assert.doesNotMatch(gap?.whyNow ?? "", /infrastructure/u);
});

test("explains missing handler evidence and carries one standalone source fallback", () => {
  const diagnostics = createDiagnostics({
    supportedEntrypointCount: 1,
    mappedHandlerCount: 0,
    mappingGapCount: 1,
    fallback: {
      kind: "sourceEvidence",
      anchor: createAnchor("frameworkEvidence", "route:orders", "/workspace/routes.ts", 4)
    }
  });
  const projection = createGuidedTourProjection({
    graphVersion: "guided-tour-test",
    status: "unavailable",
    diagnostics
  });

  assert.equal(projection.availability, "unavailable");
  if (projection.availability !== "unavailable") return;
  assert.equal(projection.unavailable.reason, "handlerNotMapped");
  assert.equal(projection.unavailable.nextAction.kind, "openAnchor");
  if (projection.unavailable.nextAction.kind === "openAnchor") {
    assert.equal(projection.unavailable.nextAction.target.filePath, "/workspace/routes.ts");
    assert.equal(projection.unavailable.nextAction.target.range.startLine, 4);
    assert.ok(projection.unavailable.nextAction.lookFor.length > 0);
  }
});

test("returns no action when no supported execution surface was observed", () => {
  const projection = createGuidedTourProjection({
    graphVersion: "guided-tour-test",
    status: "unavailable",
    diagnostics: createDiagnostics()
  });

  assert.equal(projection.availability, "unavailable");
  if (projection.availability !== "unavailable") return;
  assert.equal(projection.unavailable.reason, "noSupportedEntrypoint");
  assert.equal(projection.unavailable.nextAction.kind, "none");
});

test("Guided Tour depends on the Reading Guide contract rather than raw analysis layers", async () => {
  const projectRoot = path.resolve(__dirname, "../../..");
  const moduleRoot = path.join(projectRoot, "src", "insights", "guidedTour");
  const sourceFiles = (await readdir(moduleRoot)).filter((fileName) => fileName.endsWith(".ts"));

  assert.ok(sourceFiles.length >= 4);
  for (const fileName of sourceFiles) {
    const source = await readFile(path.join(moduleRoot, fileName), "utf8");
    assert.doesNotMatch(
      source,
      /from\s+["'][^"']*(?:application|extension|protocol|webview|vscode)[^"']*["']/u
    );
    assert.doesNotMatch(
      source,
      /from\s+["'][^"']*(?:semanticFlow|architecturalLayers)[^"']*["']/u
    );
  }
});

function createSelectedResult(path: ProjectPrimaryReadingPath): ProjectPrimaryReadingPathResult {
  return {
    graphVersion: "guided-tour-test",
    status: "selected",
    path,
    diagnostics: createDiagnostics({
      supportedEntrypointCount: 1,
      mappedHandlerCount: 1,
      eligiblePathCount: 1,
      navigableAnchorCount: path.steps.length
    })
  };
}

function createPath(
  steps: ProjectPrimaryReadingStep[],
  businessReach: ProjectPrimaryReadingPath["recommendation"]["businessReach"] = "domainCandidateReached"
): ProjectPrimaryReadingPath {
  return {
    id: "reading-path:orders",
    scopeId: "scope:api",
    entrypointKind: "httpRoute",
    entrypointUnitId: "route:orders",
    transport: "http",
    framework: "Express",
    name: "POST /orders",
    confidence: "exact",
    traceStatus: "mapped",
    recommendation: {
      businessReach,
      targetStepIndex: businessReach === "domainCandidateReached" ? 2 : 1,
      explanation: "Fixture recommendation",
      whyRecommended: ["The path contains source-backed learning evidence."],
      unknowns: []
    },
    steps,
    totalStepCount: steps.length,
    omittedStepCount: 0,
    depthLimitReached: false,
    stepLimitReached: false,
    unresolvedCallCount: businessReach === "noCandidateObserved" ? 1 : 0
  };
}

function createStep(
  kind: ProjectPrimaryReadingStep["kind"],
  functionId: string,
  layer: ProjectPrimaryReadingStep["architecture"]["layer"],
  depth: number,
  sourceAnchors: ProjectPrimaryReadingStep["sourceAnchors"]
): ProjectPrimaryReadingStep {
  const definition = sourceAnchors.definition
    ?? sourceAnchors.incomingCallsite
    ?? sourceAnchors.frameworkEvidence;
  return {
    kind,
    depth,
    role: kind === "handler" ? "controller" : kind === "route" ? "routeHandler" : "unknown",
    resolution: "concrete",
    name: functionId,
    functionId,
    ownerFunctionId: kind === "call" ? "orders:handler" : undefined,
    filePath: definition?.filePath ?? "",
    range: definition?.range,
    confidence: "exact",
    architecture: createArchitecture(layer),
    readingCues: layer === "domain" ? ["businessLogicCandidate"] : [],
    sourceAnchors
  };
}

function createArchitecture(
  layer: ProjectReadingArchitecture["layer"]
): ProjectReadingArchitecture {
  return {
    layer,
    confidence: layer === "unclassified" ? "unknown" : "medium",
    businessLogic: layer === "domain"
      ? "domainRuleCandidate"
      : layer === "application"
        ? "applicationWorkflowCandidate"
        : layer === "unclassified" ? "unknown" : "notBusinessLogic",
    purity: "unknown",
    evidence: layer === "unclassified" ? [] : [`Fixture ${layer} evidence.`],
    alternatives: [],
    conflicted: false
  };
}

function createAnchor(
  locationKind: ProjectReadingEvidenceAnchor["locationKind"],
  ownerFunctionId: string,
  filePath: string,
  line: number
): ProjectReadingEvidenceAnchor {
  return {
    locationKind,
    ownerFunctionId,
    filePath,
    range: createRange(line),
    label: `${locationKind} fixture`
  };
}

function createDiagnostics(
  overrides: Partial<ProjectPrimaryReadingPathDiagnostics> = {}
): ProjectPrimaryReadingPathDiagnostics {
  return {
    supportedEntrypointCount: 0,
    mappedHandlerCount: 0,
    mappingGapCount: 0,
    eligiblePathCount: 0,
    navigableAnchorCount: 0,
    fallback: { kind: "none" },
    ...overrides
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
