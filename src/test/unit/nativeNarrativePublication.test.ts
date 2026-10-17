/** Actual CPU children and production Hosts exercise commit/rollback after final source, storage and transport work. */
import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createNativeRootCallHost } from "../helpers/nativeRootCallHost";
import { withCompleteNativeNarrativeWorker } from "../helpers/completeNativeNarrativeWorker";
import { nativeGate } from "../helpers/nativeNarrativeWorker";
import { publicationHost } from "../helpers/nativePublicationHost";

/** A phase that did not occur is an immediate failure, rather than an unbounded test wait after early Host completion. */
async function arrived(gate: ReturnType<typeof nativeGate>, pending: Promise<void>): Promise<void> {
  assert.equal(await Promise.race([gate.promise.then(() => true), pending.then(() => false)]), true);
}

for (const surface of ["root", "call"] as const) {
  test(surface + " final-transport cache query waits for commit and source is released before sending", async t => {
    await withCompleteNativeNarrativeWorker(async fixture => {
      const sending = nativeGate(), send = nativeGate();
      const h = await publicationHost(fixture, surface, { async post(message) { if (message.requestId === 1 && message.status === "ready") { sending.release(); await send.promise; } } });
      const pending = h.request(1);
      let lookup: Promise<void> | undefined, lookedUp = false;
      try {
        await arrived(sending, pending); lookup = h.request(2, 0).then(() => { lookedUp = true; }); await delay(20);
        assert.equal(lookedUp, false); assert.ok(!h.replies().some(message => message.requestId === 2)); assert.equal(h.state.disposed, 1);
        assert.equal(h.receipts.length, 0); send.release(); await pending; assert.equal(h.receipts[0].host.status, "ready");
        await lookup; assert.equal(h.replies().find(message => message.requestId === 2)?.cacheHit, true);
        await h.request(3, 0); assert.equal(h.replies().at(-1)?.cacheHit, true); assert.equal(h.events.filter(event => event.event === "spawn").length, 1);
      } finally { send.release(); await pending.catch(() => {}); await lookup?.catch(() => {}); t.diagnostic(JSON.stringify({ actualFixtureExits: await fixture.reports(), actualChildEvents: h.events })); await h.close(); }
    });
  });

  test(surface + " final-transport cancellation drops cache authority and a retry uses a fresh actual worker", async t => {
    await withCompleteNativeNarrativeWorker(async fixture => {
      const sending = nativeGate(), send = nativeGate();
      const h = await publicationHost(fixture, surface, { async post(message) { if (message.requestId === 1 && message.status === "ready") { sending.release(); await send.promise; } } });
      const pending = h.request(1);
      try {
        await arrived(sending, pending); h.cancel(1); send.release(); await pending;
        assert.equal(h.replies().filter(message => message.requestId === 1).at(-1)?.status, "cancelled"); assert.equal(h.receipts[0].host.status, "cancelled");
        assert.equal(h.storedPages(), 0); await h.request(2, 0); assert.equal(h.replies().at(-1)?.status, "stale");
        await h.request(3); assert.equal(h.replies().at(-1)?.status, "ready"); assert.equal(h.events.filter(event => event.event === "spawn").length, 2);
        assert.equal(h.state.captures, 2); assert.equal(h.state.disposed, 2);
      } finally { send.release(); await pending.catch(() => {}); t.diagnostic(JSON.stringify({ actualFixtureExits: await fixture.reports(), actualChildEvents: h.events })); await h.close(); }
    });
  });

  test(surface + " source disposal failure is delivered before ready and does not retain any result", async t => {
    await withCompleteNativeNarrativeWorker(async fixture => {
      const h = await publicationHost(fixture, surface), capture = h.access.capture; let disposalCalls = 0;
      h.access.capture = async input => { const lease = await capture(input); return { ...lease, dispose() { disposalCalls++; lease.dispose(); throw new Error("explicit CPU source release failure"); } }; };
      try {
        await h.request(1).catch(() => {}); assert.ok(!h.replies().some(message => message.status === "ready"));
        assert.equal(h.replies().at(-1)?.status, "failed"); assert.equal(h.receipts[0].action.succeeded, true); assert.equal(h.receipts[0].host.status, "failed");
        assert.equal(disposalCalls, 1); assert.equal(h.storedPages(), 0); await h.request(2, 0); assert.equal(h.replies().at(-1)?.status, "stale");
      } finally { t.diagnostic(JSON.stringify({ actualFixtureExits: await fixture.reports(), actualChildEvents: h.events })); await h.close(); }
    });
  });

  test(surface + " changed source while final transport awaits revokes the result before cache commit", async t => {
    await withCompleteNativeNarrativeWorker(async fixture => {
      const sending = nativeGate(), send = nativeGate();
      const h = await publicationHost(fixture, surface, { async post(message) { if (message.requestId === 1 && message.status === "ready") { sending.release(); await send.promise; } } });
      const pending = h.request(1);
      try {
        await arrived(sending, pending); h.files[0].content += "// changed during final transport"; h.state.revision++; send.release(); await pending;
        assert.equal(h.replies().filter(message => message.requestId === 1).at(-1)?.status, "stale"); assert.equal(h.receipts[0].host.status, "stale");
        assert.equal(h.storedPages(), 0); await h.request(2, 0); assert.equal(h.replies().at(-1)?.status, "stale");
      } finally { send.release(); await pending.catch(() => {}); t.diagnostic(JSON.stringify({ actualFixtureExits: await fixture.reports(), actualChildEvents: h.events })); await h.close(); }
    });
  });

  test(surface + " an old failed transport cannot delete a newer independently committed result", async t => {
    await withCompleteNativeNarrativeWorker(async fixture => {
      const sending = nativeGate(), send = nativeGate();
      const h = await publicationHost(fixture, surface, { async post(message) { if (message.requestId === 1 && message.status === "ready") { sending.release(); await send.promise; throw new Error("old explicit transport failure"); } } });
      const pending = h.request(1);
      try {
        await arrived(sending, pending); await h.request(2); assert.equal(h.replies().filter(message => message.requestId === 2).at(-1)?.status, "ready");
        const current = h.replies().filter(message => message.requestId === 2).at(-1)!.narrative;
        assert.equal(h.events.filter(event => event.event === "spawn").length, 2); send.release(); await pending;
        await h.request(3, 0); assert.equal(h.replies().at(-1)?.cacheHit, true);
        if (surface === "root") assert.deepEqual(h.replies().at(-1)?.narrative, current);
        assert.equal(h.receipts.length, 2);
      } finally { send.release(); await pending.catch(() => {}); t.diagnostic(JSON.stringify({ actualFixtureExits: await fixture.reports(), actualChildEvents: h.events })); await h.close(); }
    });
  });
}

test("root source change during the final page read is caught before any ready transport", async t => {
  await withCompleteNativeNarrativeWorker(async fixture => {
    let h!: Awaited<ReturnType<typeof publicationHost>>, changed = false;
    h = await publicationHost(fixture, "root", { async read() { if (h.isReleased() && !changed) { changed = true; h.files[0].content += "// changed during final read"; h.state.revision++; } } });
    try {
      await h.request(1); assert.equal(changed, true); assert.ok(!h.replies().some(message => message.status === "ready"));
      assert.equal(h.replies().at(-1)?.status, "stale"); assert.equal(h.storedPages(), 0);
    } finally { t.diagnostic(JSON.stringify({ actualFixtureExits: await fixture.reports(), actualChildEvents: h.events })); await h.close(); }
  });
});

test("root cleanup from an older close-proof failure cannot revoke a newer successful request", async t => {
  await withCompleteNativeNarrativeWorker(async fixture => {
    const disposing = nativeGate(), dispose = nativeGate(); let held = false;
    const h = await publicationHost(fixture, "root", { badClose: true, async disposePages(hasPages) { if (hasPages && !held) { held = true; disposing.release(); await dispose.promise; } } });
    const pending = h.request(1);
    try {
      await arrived(disposing, pending); h.setComplete(); await h.request(2); assert.equal(h.replies().filter(message => message.requestId === 2).at(-1)?.status, "ready");
      dispose.release(); await pending; await h.request(3, 0); assert.equal(h.replies().at(-1)?.status, "ready"); assert.equal(h.replies().at(-1)?.cacheHit, true);
      assert.equal(h.events.filter(event => event.event === "spawn").length, 2);
    } finally { dispose.release(); await pending.catch(() => {}); t.diagnostic(JSON.stringify({ actualFixtureExits: await fixture.reports(), actualChildEvents: h.events })); await h.close(); }
  });
});

test("root node-details prefetch immediately after ready waits for the same completed publication", async t => {
  await withCompleteNativeNarrativeWorker(async fixture => {
    const sending = nativeGate(), send = nativeGate(); let nodeId: string | undefined;
    const h = await createNativeRootCallHost(fixture, { callCount: 0, clock: {}, io: { async postMessage(message) {
      if (message.type === "codeFlow/functionNarrativesLoaded" && message.payload.requestId === 1 && message.payload.status === "ready") {
        nodeId = message.payload.narrative?.scenarios[0].nodeDetails?.[0].nodeId; sending.release(); await send.promise;
      }
    } } });
    const pending = h.delivery.requestFunctionNarratives(h.request); let lookup: Promise<void> | undefined, settled = false;
    try {
      await arrived(sending, pending); assert.ok(nodeId);
      lookup = h.delivery.requestFunctionNarratives({ ...h.request, requestId: 2, nodeId, pageLanguage: "en" }).then(() => { settled = true; });
      await delay(20); assert.equal(settled, false); assert.ok(!h.replies().some(reply => reply.requestId === 2));
      send.release(); await pending; await lookup;
      const result = h.replies().find(reply => reply.requestId === 2); assert.equal(result?.status, "ready"); assert.equal(result?.cacheHit, true);
      assert.ok(result?.narrative?.scenarios.some(scenario => scenario.nodeDetails?.some(detail => detail.nodeId === nodeId)));
      assert.equal(h.events.filter(event => event.event === "spawn").length, 1);
    } finally { send.release(); await pending.catch(() => {}); await lookup?.catch(() => {}); t.diagnostic(JSON.stringify({ actualFixtureExits: await fixture.reports(), actualChildEvents: h.events })); await h.close(); }
  });
});
