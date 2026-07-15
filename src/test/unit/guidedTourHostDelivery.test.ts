/**
 * Unit tests for snapshot-bound Guided Tour Host delivery. The fixtures verify
 * that only an exact graph/mission/stop/token tuple can open source and that an
 * acknowledgement is emitted only after the editor action succeeds.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type {
  GuidedTourOpenSourceRequest,
  GuidedTourPayload,
  GuidedTourStopPayload
} from "../../protocol/guidedTour";
import type { ExtensionResponse } from "../../protocol/messages";
import type { SourceNodeToken } from "../../protocol/sourceNavigation";
import type { SymbolNode } from "../../shared/types";
import { GuidedTourHostDelivery } from "../../webview/guidedTour/guidedTourHostDelivery";

const GRAPH_VERSION = "sidebar-snapshot:guided-tour:1";
const MISSION_ID = "guided-mission:orders" as const;
const HANDLER_STOP_ID = "guided-stop:orders-handler" as const;
const DOMAIN_STOP_ID = "guided-stop:order-policy" as const;
const HANDLER_TOKEN = "source-node:handler-token" as const;
const DOMAIN_TOKEN = "source-node:domain-token" as const;

test("publish binds stops and an exact tuple opens source before ACK", async () => {
  const harness = createHarness();
  const payload = createReadyPayload();

  await harness.delivery.publish(payload);

  assert.equal(harness.posted.length, 1);
  assert.equal(harness.posted[0]?.type, "project/guidedTourLoaded");
  assert.strictEqual(
    harness.posted[0]?.type === "project/guidedTourLoaded"
      ? harness.posted[0].payload
      : undefined,
    payload
  );

  harness.resetObservations();
  const request = createOpenRequest(HANDLER_STOP_ID, HANDLER_TOKEN, 11);
  await harness.delivery.openSource(request);

  assert.deepEqual(harness.resolvedTokens, [HANDLER_TOKEN]);
  assert.deepEqual(harness.openedNodeIds, ["handler"]);
  assert.deepEqual(harness.events, [
    "resolve:source-node:handler-token",
    "open:handler",
    "post:project/guidedTourSourceOpened"
  ]);
  assert.deepEqual(harness.posted, [{
    type: "project/guidedTourSourceOpened",
    payload: request
  }]);
});

test("a token swapped from another bound stop fails without resolving or opening", async () => {
  const harness = createHarness();
  await harness.delivery.publish(createReadyPayload());
  harness.resetObservations();

  const swapped = createOpenRequest(HANDLER_STOP_ID, DOMAIN_TOKEN, 12);
  await harness.delivery.openSource(swapped);

  assert.deepEqual(harness.resolvedTokens, []);
  assert.deepEqual(harness.openedNodeIds, []);
  assert.deepEqual(harness.posted, [{
    type: "project/guidedTourSourceOpenFailed",
    payload: {
      ...swapped,
      message: "This Guided Tour source is no longer available."
    }
  }]);
});

test("publishing a replacement mission removes prior stop bindings", async () => {
  const harness = createHarness();
  await harness.delivery.publish(createReadyPayload());
  await harness.delivery.publish(createUnavailablePayload());
  harness.resetObservations();

  const retired = createOpenRequest(HANDLER_STOP_ID, HANDLER_TOKEN, 13);
  await harness.delivery.openSource(retired);

  assert.deepEqual(harness.resolvedTokens, []);
  assert.deepEqual(harness.openedNodeIds, []);
  assert.equal(harness.posted[0]?.type, "project/guidedTourSourceOpenFailed");
});

test("a stale publication cannot replace the current mission bindings", async () => {
  const harness = createHarness();
  await harness.delivery.publish(createReadyPayload());
  harness.resetObservations();
  harness.graphMatches = false;

  await harness.delivery.publish({
    ...createUnavailablePayload(),
    graphVersion: "sidebar-snapshot:stale"
  });

  assert.equal(harness.posted.length, 0);
  harness.graphMatches = true;
  const request = createOpenRequest(HANDLER_STOP_ID, HANDLER_TOKEN, 18);
  await harness.delivery.openSource(request);
  assert.deepEqual(harness.openedNodeIds, ["handler"]);
  assert.equal(harness.posted[0]?.type, "project/guidedTourSourceOpened");
});

test("stale or no-longer-current graph requests are ignored", async () => {
  const harness = createHarness();
  await harness.delivery.publish(createReadyPayload());
  harness.resetObservations();

  await harness.delivery.openSource({
    ...createOpenRequest(HANDLER_STOP_ID, HANDLER_TOKEN, 14),
    graphVersion: "sidebar-snapshot:stale"
  });
  assertNoNavigationObservation(harness);

  harness.graphMatches = false;
  await harness.delivery.openSource(createOpenRequest(HANDLER_STOP_ID, HANDLER_TOKEN, 15));
  assertNoNavigationObservation(harness);
});

test("an editor open exception returns a correlated failure instead of ACK", async () => {
  const harness = createHarness();
  await harness.delivery.publish(createReadyPayload());
  harness.resetObservations();
  harness.openFailure = true;

  const request = createOpenRequest(DOMAIN_STOP_ID, DOMAIN_TOKEN, 16);
  await harness.delivery.openSource(request);

  assert.deepEqual(harness.resolvedTokens, [DOMAIN_TOKEN]);
  assert.deepEqual(harness.openedNodeIds, ["domain"]);
  assert.deepEqual(harness.posted, [{
    type: "project/guidedTourSourceOpenFailed",
    payload: {
      ...request,
      message: "VS Code could not open this Guided Tour source."
    }
  }]);
});

test("clear drops the active snapshot and every source binding", async () => {
  const harness = createHarness();
  await harness.delivery.publish(createReadyPayload());
  harness.delivery.clear();
  harness.resetObservations();

  await harness.delivery.openSource(createOpenRequest(HANDLER_STOP_ID, HANDLER_TOKEN, 17));

  assertNoNavigationObservation(harness);
});

type DeliveryHarness = {
  delivery: GuidedTourHostDelivery;
  posted: ExtensionResponse[];
  resolvedTokens: SourceNodeToken[];
  openedNodeIds: string[];
  events: string[];
  graphMatches: boolean;
  openFailure: boolean;
  resetObservations(): void;
};

/** Creates a mutable Host harness while keeping VS Code outside the unit test. */
function createHarness(): DeliveryHarness {
  const posted: ExtensionResponse[] = [];
  const resolvedTokens: SourceNodeToken[] = [];
  const openedNodeIds: string[] = [];
  const events: string[] = [];
  const nodesByToken = new Map<SourceNodeToken, SymbolNode>([
    [HANDLER_TOKEN, createNode("handler")],
    [DOMAIN_TOKEN, createNode("domain")]
  ]);
  const harness = {
    posted,
    resolvedTokens,
    openedNodeIds,
    events,
    graphMatches: true,
    openFailure: false,
    resetObservations(): void {
      posted.length = 0;
      resolvedTokens.length = 0;
      openedNodeIds.length = 0;
      events.length = 0;
    }
  } as DeliveryHarness;
  harness.delivery = new GuidedTourHostDelivery({
    graphMatches(): boolean {
      return harness.graphMatches;
    },
    resolveSource(sourceToken): SymbolNode | undefined {
      resolvedTokens.push(sourceToken);
      events.push(`resolve:${sourceToken}`);
      return nodesByToken.get(sourceToken);
    },
    async openSource(node): Promise<void> {
      openedNodeIds.push(node.id);
      events.push(`open:${node.id}`);
      if (harness.openFailure) {
        throw new Error("editor rejected open");
      }
    },
    postMessage(message): Promise<void> {
      posted.push(message);
      events.push(`post:${message.type}`);
      return Promise.resolve();
    }
  });
  return harness;
}

/** Creates a ready mission with two distinct source-bound stops. */
function createReadyPayload(): GuidedTourPayload {
  return {
    graphVersion: GRAPH_VERSION,
    availability: "ready",
    mission: {
      id: MISSION_ID,
      scopeLabel: "apps/api",
      title: "Follow POST /orders",
      trigger: "POST /orders",
      objective: "Find the first source-backed business decision candidate.",
      selectionReasons: ["Mapped handler and concrete downstream call"],
      unknowns: [],
      stops: [
        createStop(HANDLER_STOP_ID, 1, "handler", "OrdersController.create", HANDLER_TOKEN),
        createStop(DOMAIN_STOP_ID, 2, "decisionCandidate", "OrderPolicy.price", DOMAIN_TOKEN)
      ],
      omittedStopCount: 0,
      limitations: [],
      explainBack: ["Where does transport handling end?"],
      exitCriteria: "Explain the exposed path and one remaining unknown."
    }
  };
}

/** Creates an unavailable payload on the same graph to exercise binding replacement. */
function createUnavailablePayload(): GuidedTourPayload {
  return {
    graphVersion: GRAPH_VERSION,
    availability: "unavailable",
    unavailable: {
      reason: "noConcreteStop",
      explanation: "No concrete source-backed stop is available.",
      observedEvidence: ["The entrypoint mapping is incomplete."]
    }
  };
}

/** Creates one compact navigable stop with a display-safe architecture assessment. */
function createStop(
  id: typeof HANDLER_STOP_ID | typeof DOMAIN_STOP_ID,
  order: number,
  kind: "handler" | "decisionCandidate",
  label: string,
  sourceToken: SourceNodeToken
): GuidedTourStopPayload {
  return {
    id,
    order,
    kind,
    label,
    sourceLocation: `src/orders.ts:${order}`,
    sourceToken,
    architecture: {
      layer: kind === "handler" ? "interface" : "domain",
      confidence: "medium",
      businessLogic: kind === "handler" ? "notBusinessLogic" : "domainRuleCandidate",
      purity: "unknown",
      evidence: ["source-backed test evidence"],
      alternatives: [],
      conflicted: false
    },
    whyNow: "This stop follows the observed call order.",
    lookFor: ["Inputs and outgoing calls"],
    question: "What responsibility belongs here?",
    moveOnWhen: "The observed responsibility can be explained from source.",
    evidence: ["Concrete callable"],
    unknowns: []
  };
}

/** Creates a fully correlated navigation request for one published stop. */
function createOpenRequest(
  stopId: typeof HANDLER_STOP_ID | typeof DOMAIN_STOP_ID,
  sourceToken: SourceNodeToken,
  requestId: number
): GuidedTourOpenSourceRequest {
  return {
    graphVersion: GRAPH_VERSION,
    missionId: MISSION_ID,
    stopId,
    sourceToken,
    requestId
  };
}

/** Creates one concrete callable returned by the snapshot token registry. */
function createNode(id: string): SymbolNode {
  const range = { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 7 };
  return {
    id,
    kind: "function",
    name: id,
    qualifiedName: `Orders.${id}`,
    filePath: `/workspace/src/${id}.ts`,
    range,
    selectionRange: range,
    language: "typescript"
  };
}

/** Asserts that a stale request produces no observable Host-side action. */
function assertNoNavigationObservation(harness: DeliveryHarness): void {
  assert.deepEqual(harness.resolvedTokens, []);
  assert.deepEqual(harness.openedNodeIds, []);
  assert.deepEqual(harness.posted, []);
  assert.deepEqual(harness.events, []);
}
