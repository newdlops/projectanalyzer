/**
 * Protocol-boundary tests for the Guided Tour POC adapter. They verify that
 * only definition-backed stops become actionable and that host identities are
 * replaced by bounded display text plus snapshot-local source tokens.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createGuidedTourPayload } from "../../application/guidedTour";
import type {
  GuidedTourNavigableStop,
  GuidedTourProjection
} from "../../insights/guidedTour";

test("ready projection emits only token-backed definitions without host identities", () => {
  const projection = createReadyProjection();
  const payload = createGuidedTourPayload(
    projection,
    "sidebar-snapshot:test:1",
    "/workspace",
    (functionId) => functionId === "function:handler"
      ? "source-node:handler-token"
      : undefined
  );

  assert.equal(payload.availability, "ready");
  if (payload.availability !== "ready") {
    return;
  }
  assert.match(payload.mission.id, /^guided-mission:[0-9a-f]{24}$/u);
  assert.equal(payload.mission.stops.length, 1);
  assert.equal(payload.mission.omittedStopCount, 1);
  assert.match(payload.mission.limitations[0] ?? "", /1 non-definition/u);
  assert.match(payload.mission.stops[0]?.id ?? "", /^guided-stop:[0-9a-f]{24}$/u);
  assert.equal(payload.mission.stops[0]?.sourceToken, "source-node:handler-token");
  assert.equal(payload.mission.stops[0]?.sourceLocation, "apps/api/orders.ts:12");
  assert.equal(payload.mission.stops[0]?.architecture.purity, "unknown");
  assert.deepEqual(payload.mission.stops[0]?.lookFor, [
    "Find input normalization and the first delegated call."
  ]);
  assert.equal(payload.mission.trigger, "POST /orders/:id");

  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /function:handler|domain-mission|domain-stop/u);
  assert.doesNotMatch(serialized, /\/workspace|Users[\\/]private|[A-Z]:[\\/]/u);
});

test("ready domain projection becomes unavailable when no definition token can open", () => {
  const payload = createGuidedTourPayload(
    createReadyProjection(),
    "sidebar-snapshot:test:2",
    "/workspace",
    () => undefined
  );

  assert.deepEqual(payload, {
    graphVersion: "sidebar-snapshot:test:2",
    availability: "unavailable",
    unavailable: {
      reason: "noConcreteStop",
      explanation: "The selected path has no concrete function definition that this POC can open safely.",
      observedEvidence: ["A concrete handler is mapped."],
      nextAction: {
        destination: "explore",
        label: "Inspect the selected path evidence",
        lookFor: "Find the callsite or mapping evidence that lacks a concrete definition target."
      }
    }
  });
});

test("domain unavailable reason is mapped to the bounded POC vocabulary", () => {
  const projection: GuidedTourProjection = {
    graphVersion: "domain-version",
    availability: "unavailable",
    unavailable: {
      reason: "noNavigableAnchor",
      explanation: "A path exists without an exact source anchor.",
      observedEvidence: ["1 handler mapping observed."],
      nextAction: { kind: "none", explanation: "No exact range is available." }
    }
  };
  const payload = createGuidedTourPayload(
    projection,
    "sidebar-snapshot:test:3",
    "/workspace",
    () => undefined
  );

  assert.equal(payload.availability, "unavailable");
  assert.equal(payload.unavailable.reason, "noConcreteStop");
  assert.equal(payload.graphVersion, "sidebar-snapshot:test:3");
});

/** Creates one definition stop plus anchors this POC intentionally defers. */
function createReadyProjection(): GuidedTourProjection {
  return {
    graphVersion: "domain-version",
    availability: "ready",
    mission: {
      id: "domain-mission:/workspace/apps/api",
      scopeId: "domain-scope:/workspace/apps/api",
      pathId: "domain-path:/workspace/apps/api/orders.ts",
      title: "Trace one request through the code",
      trigger: "POST /orders/:id",
      objective: "Follow the handler to its first decision candidate.",
      selection: {
        evidenceKind: "concreteHandlerInvestigation",
        reasons: ["A concrete handler is mapped."],
        unknowns: ["Runtime frequency is unknown."]
      },
      stops: [
        createDefinitionStop(),
        {
          ...createDefinitionStop(),
          id: "domain-stop:callsite-only",
          order: 2,
          functionId: undefined,
          filePath: "/outside/private/caller.ts",
          anchors: [{
            id: "callsite-anchor",
            locationKind: "callsite",
            ownerFunctionId: "function:handler",
            filePath: "/outside/private/caller.ts",
            range: createRange(30),
            label: "incoming call"
          }],
          primaryAnchorId: "callsite-anchor",
          requiredAnchorIds: ["callsite-anchor"]
        }
      ],
      explainBack: ["Where does transport handling end?"],
      exitCriteria: "Explain the observed path without claiming runtime completeness."
    }
  };
}

/** Creates the concrete handler definition promoted to an actionable stop. */
function createDefinitionStop(): GuidedTourNavigableStop {
  return {
    id: "domain-stop:handler",
    order: 1,
    mode: "navigable",
    kind: "handler",
    label: "symbol::C:\\Users\\private\\orders.ts::OrdersController.create",
    functionId: "function:handler",
    filePath: "/workspace/apps/api/orders.ts",
    range: createRange(11),
    architecture: {
      layer: "interface",
      confidence: "high",
      businessLogic: "notBusinessLogic",
      purity: "unknown",
      evidence: ["Framework handler mapping."],
      alternatives: [],
      conflicted: false
    },
    anchors: [{
      id: "definition-anchor",
      locationKind: "definition",
      functionId: "function:handler",
      filePath: "/workspace/apps/api/orders.ts",
      range: createRange(11),
      label: "handler definition"
    }, {
      id: "callsite-anchor",
      locationKind: "callsite",
      ownerFunctionId: "function:caller",
      filePath: "/workspace/apps/api/routes.ts",
      range: createRange(8),
      label: "incoming call"
    }],
    primaryAnchorId: "definition-anchor",
    requiredAnchorIds: ["definition-anchor", "callsite-anchor"],
    whyNow: "The framework maps the request here.",
    lookFor: [{
      instruction: "Find input normalization and the first delegated call.",
      anchorId: "definition-anchor",
      evidenceRuleId: "handler-definition"
    }, {
      instruction: "Inspect the incoming call arguments.",
      anchorId: "callsite-anchor",
      evidenceRuleId: "handler-callsite"
    }],
    question: "Which concern belongs to transport handling?",
    moveOnWhen: "You can name the first delegated collaborator.",
    evidence: ["Concrete framework binding."],
    unknowns: []
  };
}

/** Creates one valid zero-based source range. */
function createRange(startLine: number) {
  return { startLine, startCharacter: 0, endLine: startLine, endCharacter: 8 };
}
