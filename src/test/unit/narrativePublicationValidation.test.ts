/** Portable withdrawal envelopes must be bounded Host metadata with no narrative payload. */
import assert from "node:assert/strict";
import test from "node:test";
import { isNarrativePublicationId, isNarrativePublicationRevocation } from "../../shared/narrativePublications";

const envelope = { graphVersion: "fixture", requestId: 1, status: "failed", language: "en", publicationId: "narrative-publication:" + "a".repeat(32), publicationRevoked: true };

test("publication identity accepts only the Host's bounded opaque shape", () => {
  assert.equal(isNarrativePublicationId(envelope.publicationId), true);
  for (const invalid of [undefined, null, 1, {}, "a".repeat(32), "narrative-publication:" + "A".repeat(32), envelope.publicationId + "0", "narrative-publication:" + "a".repeat(31)]) assert.equal(isNarrativePublicationId(invalid), false);
});

test("publication withdrawal allows every terminal failure and excludes ready, progress and working", () => {
  for (const status of ["failed", "stale", "cancelled", "timeout", "invalid-response", "language-mismatch", "context-too-large", "unavailable", "denied", "download-failed", "queue-full"]) assert.equal(isNarrativePublicationRevocation({ ...envelope, status }), true);
  for (const status of ["ready", "progress", "working", "idle", undefined]) assert.equal(isNarrativePublicationRevocation({ ...envelope, status }), false);
});

test("publication withdrawal rejects data-bearing, unbounded and uncorrelated metadata", () => {
  for (const value of [undefined, null, [], "failed", { ...envelope, publicationRevoked: false }, { ...envelope, publicationId: "forged" },
    { ...envelope, narrative: {} }, { ...envelope, narrative: null }, { ...envelope, graphVersion: "" }, { ...envelope, graphVersion: "a".repeat(513) },
    { ...envelope, requestId: -1 }, { ...envelope, requestId: 1.1 }, { ...envelope, requestId: Number.MAX_SAFE_INTEGER + 1 },
    { ...envelope, language: "ja" }, { ...envelope, language: undefined }]) assert.equal(isNarrativePublicationRevocation(value), false);
  assert.equal(isNarrativePublicationRevocation({ ...envelope, requestId: 0, language: "ko" }), true);
});
