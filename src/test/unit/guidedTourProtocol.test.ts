/**
 * Runtime protocol tests for Guided Tour source-navigation requests. The
 * extension host must accept only the complete opaque correlation tuple before
 * dispatching a request to snapshot-bound delivery.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { WebviewRequest } from "../../protocol/messages";
import {
  isWebviewRequest,
  validateWebviewRequest
} from "../../protocol/webviewRequestValidation";

const VALID_REQUEST = {
  type: "project/guidedTourOpenSource",
  payload: {
    graphVersion: "sidebar-snapshot:guided-tour:1",
    missionId: `guided-mission:${"a".repeat(24)}`,
    stopId: `guided-stop:${"b".repeat(24)}`,
    sourceToken: `source-node:${"c".repeat(64)}`,
    requestId: 7
  }
} satisfies WebviewRequest;

test("accepts a complete Guided Tour source request", () => {
  const result = validateWebviewRequest(VALID_REQUEST);

  assert.equal(result.ok, true);
  assert.equal(isWebviewRequest(VALID_REQUEST), true);
  if (result.ok) {
    assert.strictEqual(result.value, VALID_REQUEST);
  }
});

test("rejects malformed Guided Tour mission, stop, token, and request identities", () => {
  const malformed: unknown[] = [
    withPayload({ missionId: "mission:orders" }),
    withPayload({ missionId: `guided-mission:${"a".repeat(25)}` }),
    withPayload({ missionId: 42 }),
    withPayload({ stopId: "stop:orders-handler" }),
    withPayload({ stopId: null }),
    withPayload({ sourceToken: "node:0123456789abcdef" }),
    withPayload({ sourceToken: `source-node:${"c".repeat(63)}` }),
    withPayload({ sourceToken: {} }),
    withPayload({ graphVersion: "" }),
    withPayload({ graphVersion: "g".repeat(129) }),
    withPayload({ requestId: -1 }),
    withPayload({ requestId: 1.5 }),
    withPayload({ requestId: Number.NaN }),
    withPayload({ requestId: "7" }),
    {
      type: VALID_REQUEST.type,
      payload: { ...VALID_REQUEST.payload, reflected: "untrusted" }
    }
  ];

  for (const request of malformed) {
    const result = validateWebviewRequest(request);
    assert.equal(result.ok, false);
    assert.equal(isWebviewRequest(request), false);
    if (!result.ok) {
      assert.equal(result.receivedType, "project/guidedTourOpenSource");
    }
  }
});

/** Replaces selected untrusted fields while retaining an otherwise valid tuple. */
function withPayload(
  replacement: Record<string, unknown>
): { type: string; payload: Record<string, unknown> } {
  return {
    type: VALID_REQUEST.type,
    payload: { ...VALID_REQUEST.payload, ...replacement }
  };
}
