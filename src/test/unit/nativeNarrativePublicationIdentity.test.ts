/** Host-issued publication identity binds late failure/withdrawal to the exact visible native result, independently of cache request IDs. */
import assert from "node:assert/strict";
import test from "node:test";
import { isNarrativePublicationId, isNarrativePublicationRevocation } from "../../shared/narrativePublications";
import { publicationHost, type NativePublicationMessage } from "../helpers/nativePublicationHost";
import { withCompleteNativeNarrativeWorker } from "../helpers/completeNativeNarrativeWorker";
import { nativeGate } from "../helpers/nativeNarrativeWorker";

/** Failing to reach a phase must fail immediately instead of leaving a gated test hanging. */
async function arrived(gate: ReturnType<typeof nativeGate>, pending: Promise<void>) {
  assert.equal(await Promise.race([gate.promise.then(() => true), pending.then(() => false)]), true);
}

for (const surface of ["root", "call"] as const) {
  test(surface + " Host assigns a single opaque publication identity across public cached pages without adding it to model source", async t => {
    await withCompleteNativeNarrativeWorker(async fixture => {
      const h = await publicationHost(fixture, surface);
      try {
        await h.request(1); const ready = h.replies().at(-1)!; assert.equal(ready.status, "ready"); assert.equal(isNarrativePublicationId(ready.publicationId), true);
        assert.equal(ready.publicationRevoked, undefined); assert.equal(ready.language, "en");
        await h.request(2, 0); assert.equal(h.replies().at(-1)?.publicationId, ready.publicationId); assert.equal(h.replies().at(-1)?.cacheHit, true);
        assert.notEqual(h.replies().at(-1)?.requestId, ready.requestId); assert.equal(h.events.filter(event => event.event === "spawn").length, 1);
        assert.ok(h.modelInputs().length > 0); assert.equal(JSON.stringify(h.modelInputs()).includes("narrative-publication:"), false);
      } finally { await h.close(); t.diagnostic(JSON.stringify({ actualFixtureExits: await fixture.reports(), actualChildEvents: h.events })); }
    });
  });

  test(surface + " transport cancellation after ready sends a validated withdrawal for that same publication", async t => {
    await withCompleteNativeNarrativeWorker(async fixture => {
      const sending = nativeGate(), send = nativeGate(); let shown!: NativePublicationMessage;
      const h = await publicationHost(fixture, surface, { async post(message) { if (message.status === "ready" && message.requestId === 1) { shown = message; sending.release(); await send.promise; } } });
      const pending = h.request(1);
      try {
        await arrived(sending, pending); h.cancel(1); send.release(); await pending;
        const failure = h.replies().at(-1)!; assert.equal(failure.status, "cancelled"); assert.equal(failure.publicationId, shown.publicationId);
        assert.equal(isNarrativePublicationRevocation(failure), true); assert.equal(failure.narrative, undefined);
      } finally { send.release(); await pending.catch(() => {}); await h.close(); t.diagnostic(JSON.stringify({ actualFixtureExits: await fixture.reports(), actualChildEvents: h.events })); }
    });
  });

  test(surface + " a rejected final transport withdraws only the old publication after a newer one has committed", async t => {
    await withCompleteNativeNarrativeWorker(async fixture => {
      const sending = nativeGate(), send = nativeGate(); let shown!: NativePublicationMessage;
      const h = await publicationHost(fixture, surface, { async post(message) { if (message.status === "ready" && message.requestId === 1) { shown = message; sending.release(); await send.promise; throw new Error("explicit old CPU transport rejection"); } } });
      const pending = h.request(1);
      try {
        await arrived(sending, pending); await h.request(2); const fresh = h.replies().at(-1)!;
        assert.equal(fresh.status, "ready"); assert.notEqual(fresh.publicationId, shown.publicationId); send.release(); await pending;
        const old = h.replies().find(message => message.requestId === 1 && message.publicationRevoked)!;
        assert.equal(old.publicationId, shown.publicationId); assert.equal(isNarrativePublicationRevocation(old), true);
        assert.equal(h.replies().some(message => message.publicationRevoked && message.publicationId === fresh.publicationId), false);
        await h.request(3, 0); assert.equal(h.replies().at(-1)?.publicationId, fresh.publicationId); assert.equal(h.replies().at(-1)?.cacheHit, true);
      } finally { send.release(); await pending.catch(() => {}); await h.close(); t.diagnostic(JSON.stringify({ actualFixtureExits: await fixture.reports(), actualChildEvents: h.events })); }
    });
  });

  test(surface + " stale source during final transport sends a source-free withdrawal with its original result identity", async t => {
    await withCompleteNativeNarrativeWorker(async fixture => {
      const sending = nativeGate(), send = nativeGate(); let shown!: NativePublicationMessage;
      const h = await publicationHost(fixture, surface, { async post(message) { if (message.status === "ready" && message.requestId === 1) { shown = message; sending.release(); await send.promise; } } });
      const pending = h.request(1);
      try {
        await arrived(sending, pending); h.files[0].content += "// stale during the explicit final transport"; h.state.revision++; send.release(); await pending;
        const failure = h.replies().at(-1)!; assert.equal(failure.status, "stale"); assert.equal(failure.publicationId, shown.publicationId);
        assert.equal(isNarrativePublicationRevocation(failure), true); await h.request(2, 0); assert.equal(h.replies().at(-1)?.status, "stale");
      } finally { send.release(); await pending.catch(() => {}); await h.close(); t.diagnostic(JSON.stringify({ actualFixtureExits: await fixture.reports(), actualChildEvents: h.events })); }
    });
  });

  test(surface + " a cache freshness failure withdraws the retained publication using its original generation id", async t => {
    await withCompleteNativeNarrativeWorker(async fixture => {
      const h = await publicationHost(fixture, surface);
      try {
        await h.request(1); const ready = h.replies().at(-1)!; h.files[0].content += "// invalidate the committed source"; h.state.revision++;
        await h.request(2, 0); const stale = h.replies().find(message => message.publicationRevoked)!;
        assert.equal(stale.requestId, ready.requestId); assert.equal(stale.publicationId, ready.publicationId); assert.equal(isNarrativePublicationRevocation(stale), true);
        assert.equal(h.replies().at(-1)?.status, "stale"); assert.equal(h.events.filter(event => event.event === "spawn").length, 1);
      } finally { await h.close(); t.diagnostic(JSON.stringify({ actualFixtureExits: await fixture.reports(), actualChildEvents: h.events })); }
    });
  });

  test(surface + " failure before any ready attempt cannot claim to withdraw displayed prose", async t => {
    await withCompleteNativeNarrativeWorker(async fixture => {
      const h = await publicationHost(fixture, surface), capture = h.access.capture;
      h.access.capture = async input => { const lease = await capture(input); return { ...lease, dispose() { lease.dispose(); throw new Error("explicit CPU pre-publication release failure"); } }; };
      try { await h.request(1); assert.equal(h.replies().at(-1)?.status, "failed"); assert.equal(h.attempts.some(message => message.status === "ready" || message.publicationRevoked), false); }
      finally { await h.close(); t.diagnostic(JSON.stringify({ actualFixtureExits: await fixture.reports(), actualChildEvents: h.events })); }
    });
  });
}

test("call source invalidation withdraws each retained reading scope under the same declaration context", async t => {
  await withCompleteNativeNarrativeWorker(async fixture => {
    const h = await publicationHost(fixture, "call");
    try {
      await h.request(1); const overview = h.replies().at(-1)!; assert.ok(h.firstConnectionId);
      await h.request(2, undefined, { scope: "call", connectionId: h.firstConnectionId }); const selected = h.replies().at(-1)!;
      assert.equal(selected.status, "ready"); assert.notEqual(overview.publicationId, selected.publicationId);
      h.files[0].content += "// invalidate both retained routes"; h.state.revision++; await h.request(3, 0);
      const withdrawn = h.replies().filter(message => message.publicationRevoked); assert.equal(withdrawn.length, 2);
      assert.deepEqual(new Set(withdrawn.map(message => message.publicationId)), new Set([overview.publicationId, selected.publicationId]));
      assert.ok(withdrawn.every(isNarrativePublicationRevocation)); assert.equal(h.events.filter(event => event.event === "spawn").length, 2);
    } finally { await h.close(); t.diagnostic(JSON.stringify({ actualFixtureExits: await fixture.reports(), actualChildEvents: h.events })); }
  });
});
