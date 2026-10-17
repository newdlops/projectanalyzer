/** Real CPU children exercise source-free clock bounds and success/failure settlement; no model or analyzed source executes. */
import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { runNativeNarrativeAction, type NativeNarrativeActionSettlement } from "../../llm/nativeNarratives";
import { ModelTaskManager, type ModelTaskRequest } from "../../shared/modelTasks";
import { FunctionNarrativeError } from "../../shared/functionNarratives";
import { withCompleteNativeNarrativeWorker } from "../helpers/completeNativeNarrativeWorker";
import { nativeGate } from "../helpers/nativeNarrativeWorker";

test("source-free clock exchange includes delayed ready emission with an independent worker clock epoch", async t => {
  await withCompleteNativeNarrativeWorker(async fixture => {
    const manager = new ModelTaskManager(), settlements: NativeNarrativeActionSettlement[] = [], frames: any[] = [];
    try {
      const result = await runNativeNarrativeAction({ manager, worker: { ...fixture.options("echo", { readyDelayMs: 80, offsetNs: "987654321012345678" }),
        journal(event) { if (event.direction === "input") frames.push(JSON.parse(event.raw)); } }, label: "Clock bounds", signal: new AbortController().signal,
        onSettled: receipt => settlements.push(receipt), async execute({ transport, signal }) {
          assert.equal(transport.observation.readyClock?.basis, "monotonic-exchange-v1");
          const response = await transport.generate({ requestId: "after-clock", payload: { schema: {}, messages: [{ role: "user", content: "Explicit source-free CPU fixture" }] } }, signal); return response.text;
        } });
      assert.equal(frames.length, 2); assert.ok(frames[0].nativeClock); assert.ok(frames[1].requests); assert.equal(result.actualWorker.requests, 1);
      const receipt = settlements[0], bounds = receipt.duration.workerReadyMs!;
      assert.equal(settlements.length, 1); assert.equal(receipt.succeeded, true); assert.equal(receipt.worker?.actualCloseObserved, true);
      assert.ok(bounds.upperBound >= bounds.lowerBound); assert.ok(Math.abs(bounds.upperBound - bounds.lowerBound - bounds.uncertaintyMs) < 0.001);
      assert.ok(bounds.upperBound - receipt.duration.hostReadyReceiptMs! >= 60, JSON.stringify(receipt.duration));
      assert.equal(receipt.neuralAuthorshipProven, false); assert.equal("closedReceipt" in receipt.worker!, false);
      t.diagnostic(JSON.stringify({ settlement: receipt, actualFixtureExits: await fixture.reports() }));
    } finally { await manager.dispose(); }
  });
});

for (const fault of ["missing", "nonce", "order", "silent", "exit"] as const) test("ready clock " + fault + " fails before source work and settles after actual child close", async t => {
  await withCompleteNativeNarrativeWorker(async fixture => {
    const manager = new ModelTaskManager(), settlements: NativeNarrativeActionSettlement[] = [], events: unknown[] = []; let executed = false;
    try {
      await assert.rejects(runNativeNarrativeAction({ manager, worker: { ...fixture.options("echo", { fault }), requestTimeoutMs: 60, onEvent: event => events.push(event) },
        label: "Invalid clock", signal: new AbortController().signal, onSettled: receipt => settlements.push(receipt), async execute() { executed = true; } }));
      assert.equal(executed, false); assert.equal(settlements.length, 1); assert.equal(settlements[0].succeeded, false);
      assert.equal(settlements[0].worker?.actualCloseObserved, true); assert.equal(settlements[0].worker?.requests, 0);
      assert.equal(settlements[0].duration.workerReadyMs, undefined); assert.equal(manager.idle, true);
      t.diagnostic(JSON.stringify({ settlement: settlements[0], actualChildEvents: events, actualFixtureExits: await fixture.reports() }));
    } finally { await manager.dispose(); }
  });
});

test("admission failure emits no ready duration and observer exceptions preserve the primary error", async () => {
  await withCompleteNativeNarrativeWorker(async fixture => {
    const manager = new ModelTaskManager(), original = new FunctionNarrativeError("denied"), settlements: NativeNarrativeActionSettlement[] = [];
    try {
      await assert.rejects(runNativeNarrativeAction({ manager, worker: { ...fixture.options(), async admit() { throw original; } }, signal: new AbortController().signal,
        label: "Admission", onSettled(receipt) { settlements.push(receipt); throw new Error("private observer"); }, async execute() { assert.fail("source must not execute"); } }), error => error === original);
      assert.deepEqual(settlements[0].duration, {}); assert.equal(settlements[0].worker?.pid, undefined); assert.equal(settlements[0].succeeded, false);
      assert.deepEqual(await fixture.reports(), []);
    } finally { await manager.dispose(); }
  });
});

test("failure receipt waits for rejected outer manager settlement and retains body plus cleanup failures", async t => {
  await withCompleteNativeNarrativeWorker(async fixture => {
    const entered = nativeGate(), release = nativeGate(), settlements: NativeNarrativeActionSettlement[] = [], primary = new Error("private body");
    class DelayedManager extends ModelTaskManager {
      public override async run<T>(request: ModelTaskRequest<T>): Promise<T> {
        try { return await super.run(request); } catch (error) { entered.release(); await release.promise; throw error; }
      }
    }
    const manager = new DelayedManager();
    const pending = runNativeNarrativeAction({ manager, worker: fixture.options("bad-close", {}), signal: new AbortController().signal, label: "Failed outer",
      onSettled: receipt => settlements.push(receipt), async execute() { throw primary; } });
    const rejected = assert.rejects(pending, error => error instanceof AggregateError && error.errors.includes(primary) && error.errors.length === 2);
    try {
      await entered.promise; assert.equal(settlements.length, 0); await delay(25); release.release(); await rejected;
      assert.equal(settlements.length, 1); assert.equal(settlements[0].succeeded, false); assert.equal(settlements[0].outerManagerSettlementObserved, true);
      assert.equal(settlements[0].worker?.actualCloseObserved, true); assert.ok(settlements[0].duration.workerReadyMs!.upperBound >= 25);
      assert.equal(JSON.stringify(settlements).includes("private body"), false); t.diagnostic(JSON.stringify({ settlement: settlements[0], actualFixtureExits: await fixture.reports() }));
    } finally { release.release(); await pending.catch(() => {}); await manager.dispose(); }
  });
});

test("queued cancellation records actual manager rejection with no worker or invented readiness duration", async () => {
  await withCompleteNativeNarrativeWorker(async fixture => {
    const manager = new ModelTaskManager(), entered = nativeGate(), release = nativeGate(), controller = new AbortController(), settlements: NativeNarrativeActionSettlement[] = [];
    const first = manager.run({ kind: "inference", label: "Queue owner", signal: new AbortController().signal, async execute() { entered.release(); await release.promise; } });
    try {
      await entered.promise;
      const pending = runNativeNarrativeAction({ manager, worker: fixture.options(), signal: controller.signal, label: "Queued", onSettled: receipt => settlements.push(receipt),
        async execute() { assert.fail("queued source"); } });
      const rejected = assert.rejects(pending); controller.abort(); await rejected;
      assert.equal(settlements.length, 1); assert.equal(settlements[0].worker, undefined); assert.deepEqual(settlements[0].duration, {}); assert.deepEqual(await fixture.reports(), []);
    } finally { release.release(); await first; await manager.dispose(); }
  });
});
