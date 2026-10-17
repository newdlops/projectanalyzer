/** Actual production root/call Hosts prove final I/O/rollback/disposal and public-Promise timing with explicit CPU children. */
import assert from "node:assert/strict";
import test from "node:test";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { createNativeFunctionNarrativeProvider, type NativeFunctionNarrativeHostReceipt } from "../../llm/nativeNarrativeProvider";
import { ModelTaskManager } from "../../shared/modelTasks";
import { SourceCaptureError } from "../../shared/narrativeSources";
import { createNativeRootCallHost } from "../helpers/nativeRootCallHost";
import { createWholeNarrativeCallHost } from "../helpers/wholeNarrativeCallHost";
import { withCompleteNativeNarrativeWorker } from "../helpers/completeNativeNarrativeWorker";
import { nativeGate } from "../helpers/nativeNarrativeWorker";

/** Never let a missing phase silently hang a test after an early Host failure. */
async function arrive(gate: ReturnType<typeof nativeGate>, pending: Promise<void>): Promise<void> {
  assert.equal(await Promise.race([gate.promise.then(() => true), pending.then(() => false)]), true);
}
/** Source leases dispose synchronously; a measured short CPU delay verifies that finally is inside the public settlement boundary. */
function synchronousDisposal(): void { const end = performance.now() + 20; while (performance.now() < end) { /* Explicit CPU fixture delay. */ } }

test("actual root Host timing includes final freshness, page read, ready publication and source disposal after action settlement", async t => {
  await withCompleteNativeNarrativeWorker(async fixture => {
    const validation = nativeGate(), validate = nativeGate(), reading = nativeGate(), read = nativeGate(), publishing = nativeGate(), publish = nativeGate();
    let h!: Awaited<ReturnType<typeof createNativeRootCallHost>>;
    h = await createNativeRootCallHost(fixture, { callCount: 0, clock: { readyDelayMs: 60, offsetNs: "876543210123456789" }, io: {
      async read() { if (h.hostEvents.includes("provider-released")) { reading.release(); await read.promise; } },
      async postMessage(message) { if (message.type === "codeFlow/functionNarrativesLoaded" && message.payload.status === "ready") { publishing.release(); await publish.promise; } }
    } });
    const capture = h.access.capture;
    h.access.capture = async input => { const lease = await capture(input); return { ...lease,
      async assertCurrent(signal) { if (h.hostEvents.includes("provider-released")) { validation.release(); await validate.promise; } await lease.assertCurrent(signal); },
      dispose() { synchronousDisposal(); lease.dispose(); }
    }; };
    const pending = h.delivery.requestFunctionNarratives(h.request);
    try {
      await arrive(validation, pending); const tailStart = performance.now(); assert.equal(h.receipts.length, 1); assert.equal(h.hostReceipts.length, 0);
      assert.equal(h.receipts[0].worker.actualCloseObserved, true); await delay(25); validate.release();
      await arrive(reading, pending); assert.equal(h.hostReceipts.length, 0); await delay(25); read.release();
      await arrive(publishing, pending); assert.equal(h.hostReceipts.length, 0); assert.equal(h.state.disposed, 0); await delay(25); publish.release(); await pending;
      const receipt = h.hostReceipts[0]; assert.equal(h.hostReceipts.length, 1); assert.equal(h.state.disposed, 1);
      assert.equal(receipt.host.status, "ready"); assert.equal(receipt.host.promise, "fulfilled"); assert.equal(receipt.publicHostPromiseSettlementObserved, true);
      assert.ok(receipt.duration.hostReadyReceiptMs! - receipt.action.duration.hostReadyReceiptMs! >= performance.now() - tailStart - 5);
      assert.ok(receipt.duration.workerReadyMs!.upperBound > receipt.duration.hostReadyReceiptMs! + 40);
      await h.delivery.requestFunctionNarratives({ ...h.request, requestId: 2, pageIndex: 0, pageLanguage: "en" }); assert.equal(h.hostReceipts.length, 1);
      assert.equal(JSON.stringify(receipt).includes("Parent 원문"), false); assert.equal("closedReceipt" in receipt.action.worker!, false);
      t.diagnostic(JSON.stringify({ receipt, actualFixtureExits: await fixture.reports(), actualChildEvents: h.events }));
    } finally { validate.release(); read.release(); publish.release(); await pending.catch(() => {}); await h.close(); }
  });
});

test("failed native root receipt waits for actual page rollback and reports rejected action separately from fulfilled failure delivery", async t => {
  await withCompleteNativeNarrativeWorker(async fixture => {
    const disposing = nativeGate(), dispose = nativeGate();
    const h = await createNativeRootCallHost(fixture, { callCount: 0, mode: "bad-root-second", clock: {}, io: {
      async dispose(hasPages) { if (hasPages) { disposing.release(); await dispose.promise; } }
    } });
    const pending = h.delivery.requestFunctionNarratives(h.request);
    try {
      await arrive(disposing, pending); assert.equal(h.hostReceipts.length, 0); assert.ok(h.events.some(event => event.event === "actual-close"));
      await delay(25); dispose.release(); await pending;
      const receipt = h.hostReceipts[0]; assert.equal(h.hostReceipts.length, 1); assert.equal(receipt.action.succeeded, false);
      assert.equal(receipt.host.status, "invalid-response"); assert.equal(receipt.host.promise, "fulfilled"); assert.equal(h.storedPages(), 0); assert.equal(h.state.disposed, 1);
      assert.equal(receipt.action.worker?.actualCloseObserved, true); assert.ok(receipt.duration.hostReadyReceiptMs! > receipt.action.duration.hostReadyReceiptMs! + 20);
      t.diagnostic(JSON.stringify({ receipt, actualFixtureExits: await fixture.reports(), actualChildEvents: h.events }));
    } finally { dispose.release(); await pending.catch(() => {}); await h.close(); }
  });
});

test("root ready-publication failure retains successful action receipt but reports failed Host and rolls back every private page", async t => {
  await withCompleteNativeNarrativeWorker(async fixture => {
    const h = await createNativeRootCallHost(fixture, { callCount: 0, clock: {}, io: { async postMessage(message) {
      if (message.type === "codeFlow/functionNarrativesLoaded" && message.payload.status === "ready") throw new Error("private publication error");
    } } });
    try {
      await h.delivery.requestFunctionNarratives(h.request);
      const receipt = h.hostReceipts[0]; assert.equal(receipt.action.succeeded, true); assert.equal(receipt.host.status, "failed");
      assert.equal(receipt.host.promise, "fulfilled"); assert.equal(h.storedPages(), 0); assert.equal(h.replies().at(-1)?.status, "failed");
      assert.equal(JSON.stringify(receipt).includes("private publication error"), false); t.diagnostic(JSON.stringify({ receipt, actualFixtureExits: await fixture.reports() }));
    } finally { await h.close(); }
  });
});

test("root cancellation has a failed-action receipt only after actual child close and all Host cleanup", async t => {
  await withCompleteNativeNarrativeWorker(async fixture => {
    const requested = nativeGate();
    const h = await createNativeRootCallHost(fixture, { callCount: 0, mode: "hold-root-second", clock: {}, onEvent(event) {
      if (event.event === "request" && event.uid === 1) requested.release();
    } });
    const pending = h.delivery.requestFunctionNarratives(h.request);
    try {
      await arrive(requested, pending); assert.equal(h.hostReceipts.length, 0); h.delivery.cancelFunctionNarratives(h.request); await pending;
      const receipt = h.hostReceipts[0]; assert.equal(receipt.action.succeeded, false); assert.equal(receipt.host.status, "cancelled");
      assert.equal(receipt.action.worker?.actualCloseObserved, true); assert.equal(h.storedPages(), 0); assert.equal(h.state.disposed, 1);
      assert.ok(!h.replies().some(reply => reply.narrative)); t.diagnostic(JSON.stringify({ receipt, actualFixtureExits: await fixture.reports(), actualChildEvents: h.events }));
    } finally { h.delivery.cancelFunctionNarratives(h.request); await pending.catch(() => {}); await h.close(); }
  });
});

test("legacy worker clock absence preserves explicit Host-receipt timing and never invents worker-ready bounds", async () => {
  await withCompleteNativeNarrativeWorker(async fixture => {
    const h = await createNativeRootCallHost(fixture, { callCount: 0 });
    try {
      await h.delivery.requestFunctionNarratives(h.request); assert.equal(h.hostReceipts.length, 1);
      assert.equal(h.hostReceipts[0].duration.workerReadyMs, undefined); assert.ok(h.hostReceipts[0].duration.hostReadyReceiptMs! > 0);
      assert.equal(h.hostReceipts[0].neuralAuthorshipProven, false);
    } finally { await h.close(); }
  });
});

test("actual call Host waits for final ready transport and source disposal before its public request completion receipt", async t => {
  await withCompleteNativeNarrativeWorker(async fixture => {
    const manager = new ModelTaskManager(), publishing = nativeGate(), publish = nativeGate(), receipts: NativeFunctionNarrativeHostReceipt[] = [];
    const h = await createWholeNarrativeCallHost(f => {
      const capture = f.access.capture; f.access.capture = async input => { const lease = await capture(input); return { ...lease, dispose() { synchronousDisposal(); lease.dispose(); } }; };
      return createNativeFunctionNarrativeProvider({ manager, worker: fixture.options("call", {}), onRunComplete() { f.events.push("provider-released"); },
        onHostRunComplete(receipt) { receipts.push(receipt); } });
    }, undefined, async message => { if (message.status === "ready" && !message.cacheHit) { publishing.release(); await publish.promise; } });
    const pending = h.host.explain(h.request);
    try {
      await arrive(publishing, pending); assert.equal(receipts.length, 0); assert.equal(h.state.disposed, 0); const held = performance.now();
      await delay(25); publish.release(); await pending;
      const receipt = receipts[0]; assert.equal(receipts.length, 1); assert.equal(receipt.host.status, "ready"); assert.equal(receipt.action.worker?.requests, 7);
      assert.equal(h.state.disposed, 1); assert.ok(receipt.duration.hostReadyReceiptMs! - receipt.action.duration.hostReadyReceiptMs! >= performance.now() - held - 5);
      await h.host.explain({ ...h.request, requestId: 2, pageIndex: 0 }); assert.equal(receipts.length, 1);
      t.diagnostic(JSON.stringify({ receipt, actualFixtureExits: await fixture.reports() }));
    } finally { publish.release(); await pending.catch(() => {}); h.host.reset(); await manager.dispose(); }
  });
});

test("call source staleness after successful action settlement produces a stale Host receipt with no exposed narrative", async t => {
  await withCompleteNativeNarrativeWorker(async fixture => {
    const manager = new ModelTaskManager(), receipts: NativeFunctionNarrativeHostReceipt[] = [];
    const h = await createWholeNarrativeCallHost(f => {
      const capture = f.access.capture; f.access.capture = async input => { const lease = await capture(input); return { ...lease, async assertCurrent(signal) {
        if (f.events.includes("provider-released")) throw new SourceCaptureError("source-changed", "private source change"); await lease.assertCurrent(signal);
      } }; };
      return createNativeFunctionNarrativeProvider({ manager, worker: fixture.options("call", {}), onRunComplete() { f.events.push("provider-released"); }, onHostRunComplete(receipt) { receipts.push(receipt); } });
    });
    try {
      await h.host.explain(h.request); assert.equal(receipts.length, 1); assert.equal(receipts[0].action.succeeded, true); assert.equal(receipts[0].host.status, "stale");
      assert.ok(!h.messages.some(message => message.narrative)); assert.equal(h.state.disposed, 1); t.diagnostic(JSON.stringify({ receipt: receipts[0], actualFixtureExits: await fixture.reports() }));
    } finally { h.host.reset(); await manager.dispose(); }
  });
});

test("source disposal throwing after ready publication is a rejected public Host Promise with a failed completion receipt", async t => {
  await withCompleteNativeNarrativeWorker(async fixture => {
    const h = await createNativeRootCallHost(fixture, { callCount: 0, clock: {} }), capture = h.access.capture, failure = new Error("private disposal failure");
    h.access.capture = async input => { const lease = await capture(input); return { ...lease, dispose() { synchronousDisposal(); lease.dispose(); throw failure; } }; };
    try {
      await assert.rejects(h.delivery.requestFunctionNarratives(h.request), error => error === failure);
      assert.equal(h.hostReceipts.length, 1); const receipt = h.hostReceipts[0]; assert.equal(receipt.host.promise, "rejected"); assert.equal(receipt.host.status, "failed");
      assert.equal(receipt.action.succeeded, true); assert.equal(h.state.disposed, 1); assert.equal(JSON.stringify(receipt).includes("private disposal failure"), false);
      t.diagnostic(JSON.stringify({ receipt, actualFixtureExits: await fixture.reports() }));
    } finally { await h.close(); }
  });
});

for (const surface of ["root", "call"] as const) test(surface + " cancellation while final transport is pending cannot produce a ready completion receipt", async t => {
  await withCompleteNativeNarrativeWorker(async fixture => {
    const publishing = nativeGate(), publish = nativeGate(), manager = new ModelTaskManager(), receipts: NativeFunctionNarrativeHostReceipt[] = [];
    const h = surface === "root" ? await createNativeRootCallHost(fixture, { manager, callCount: 0, clock: {}, io: { async postMessage(message) {
      if (message.type === "codeFlow/functionNarrativesLoaded" && message.payload.status === "ready") { publishing.release(); await publish.promise; }
    } } }) : undefined;
    const c = surface === "call" ? await createWholeNarrativeCallHost(f => createNativeFunctionNarrativeProvider({ manager, worker: fixture.options("call", {}),
      onRunComplete() { f.events.push("provider-released"); }, onHostRunComplete(receipt) { receipts.push(receipt); } }), undefined,
      async message => { if (message.status === "ready") { publishing.release(); await publish.promise; } }) : undefined;
    const pending = h ? h.delivery.requestFunctionNarratives(h.request) : c!.host.explain(c!.request);
    try {
      await arrive(publishing, pending); assert.equal(h?.hostReceipts.length ?? receipts.length, 0);
      if (h) h.delivery.cancelFunctionNarratives(h.request); else c!.host.cancelExplanation(c!.request);
      publish.release(); await pending;
      const receipt = (h?.hostReceipts ?? receipts)[0]; assert.equal(receipt.action.succeeded, true); assert.equal(receipt.host.status, "cancelled");
      assert.equal(receipt.action.worker?.actualCloseObserved, true); assert.equal(receipt.host.promise, "fulfilled");
      t.diagnostic(JSON.stringify({ receipt, actualFixtureExits: await fixture.reports() }));
    } finally { publish.release(); await pending.catch(() => {}); if (h) await h.close(); c?.host.reset(); await manager.dispose(); }
  });
});
