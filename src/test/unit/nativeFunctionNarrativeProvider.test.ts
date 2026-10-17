/** Public native provider ownership, exact transport and real child cleanup; fixtures are never neural correctness or timing evidence. */
import assert from "node:assert/strict";
import test from "node:test";
import { createNativeFunctionNarrativeProvider } from "../../llm/nativeNarrativeProvider";
import { ModelTaskManager } from "../../shared/modelTasks";
import type { FunctionNarrativeRootRequest } from "../../application/functionNarratives";
import { nativeGate } from "../helpers/nativeNarrativeWorker";
import { withCompleteNativeNarrativeWorker } from "../helpers/completeNativeNarrativeWorker";

const request: FunctionNarrativeRootRequest = { schema: { type: "object" }, messages: [{ role: "user", content: 'Whole source 😀 "text"\r\n<literal>\n' + "unchanged ".repeat(180) }] };

test("native provider construction and preparation are inert; legacy or out-of-action generation cannot spawn a worker", async () => {
  const manager = new ModelTaskManager(), events: unknown[] = [], signal = new AbortController().signal;
  const provider = createNativeFunctionNarrativeProvider({ manager, worker: { kind: "test-fixture", command: "/missing/inert-native-worker", args: [], modelName: "Inert", onEvent: event => events.push(event) } });
  try {
    await provider.prepare!("en", signal, { label: "Inert" }); assert.equal(manager.idle, true); assert.equal(events.length, 0);
    await assert.rejects(provider.generateCompleteRoot!(request, "en", signal));
    await assert.rejects(provider.generate({} as never, "en", signal)); assert.equal(events.length, 0); assert.equal(manager.snapshot().history.length, 0);
    await manager.dispose(); await assert.rejects(provider.prepare!("en", signal)); await assert.rejects(provider.withRun!("en", signal, async () => "disposed"));
    assert.equal(events.length, 0);
  } finally { await manager.dispose(); }
});

test("native provider transports whole schema/messages and raw text unchanged and emits only bounded metadata after real outer settlement", async t => {
  await withCompleteNativeNarrativeWorker(async fixture => {
    const manager = new ModelTaskManager(), signal = new AbortController().signal, receipts: unknown[] = []; let validated = false;
    const provider = createNativeFunctionNarrativeProvider({ manager, worker: fixture.options("echo"), onRunComplete(receipt) {
      assert.equal(manager.idle, true); assert.equal(receipt.worker.actualCloseObserved, true); assert.equal(Object.hasOwn(receipt.worker, "closedReceipt"), false);
      receipts.push(receipt); throw new Error("An observer cannot change successful execution");
    } });
    try {
      const result = await provider.withRun!("en", signal, async ownedSignal => {
        assert.notEqual(ownedSignal, signal); assert.equal(ownedSignal?.aborted, false);
        return provider.generateCompleteRoot!(request, "en", signal, { validate(response) {
          validated = true; assert.equal(response.text, JSON.stringify({ payload: request, text: 'Raw 😀 "quoted"\r\n<literal>' }));
        } });
      });
      assert.equal(validated, true); assert.equal(result.text, JSON.stringify({ payload: request, text: 'Raw 😀 "quoted"\r\n<literal>' }));
      assert.equal(receipts.length, 1); assert.ok(!JSON.stringify(receipts).includes("Whole source")); assert.equal(manager.snapshot().history.at(-1)?.phase, "completed");
      const reports = await fixture.reports(); assert.equal(reports.length, 1); assert.equal(reports[0].actualExitCode, 0); t.diagnostic(JSON.stringify({ actualFixtureExits: reports }));
    } finally { await manager.dispose(); }
  });
});

test("a caught raw validation failure still fails the native action and waits for its actual child close", async t => {
  await withCompleteNativeNarrativeWorker(async fixture => {
    const manager = new ModelTaskManager(), signal = new AbortController().signal, failure = new Error("Explicit raw validation failure"), events: string[] = [];
    const provider = createNativeFunctionNarrativeProvider({ manager, worker: { ...fixture.options("echo"), onEvent: event => events.push(event.event) } });
    try {
      await assert.rejects(provider.withRun!("en", signal, async () => {
        await assert.rejects(provider.generateCompleteRoot!(request, "en", signal, { validate() { throw failure; } }), error => error === failure);
        return "a caught validation failure is not success";
      }), error => error === failure);
      assert.ok(events.includes("actual-close")); assert.equal(manager.snapshot().history.at(-1)?.phase, "failed");
      t.diagnostic(JSON.stringify({ actualFixtureExits: await fixture.reports() }));
    } finally { await manager.dispose(); }
  });
});

test("separate native actions sharing one parent signal queue independently and expired async work cannot borrow the next worker", async t => {
  await withCompleteNativeNarrativeWorker(async fixture => {
    const manager = new ModelTaskManager(), signal = new AbortController().signal, firstEntered = nativeGate(), firstHold = nativeGate(), late = nativeGate(), secondEntered = nativeGate(), secondHold = nativeGate();
    const events: Array<{ event: string; pid?: number }> = [];
    const provider = createNativeFunctionNarrativeProvider({ manager, worker: { ...fixture.options("echo"), onEvent: event => events.push(event) } });
    let expired!: Promise<unknown>, expiredRun!: Promise<unknown>;
    const first = provider.withRun!("en", signal, async () => {
      expired = late.promise.then(() => provider.generateCompleteRoot!(request, "en", signal)); void expired.catch(() => {});
      expiredRun = late.promise.then(() => provider.withRun!("en", signal, async () => "expired action")); void expiredRun.catch(() => {});
      firstEntered.release(); await firstHold.promise; return provider.generateCompleteRoot!(request, "en", signal);
    });
    try {
      await firstEntered.promise;
      const second = provider.withRun!("en", signal, async () => { secondEntered.release(); await secondHold.promise; return provider.generateCompleteRoot!(request, "en", signal); });
      assert.equal(manager.snapshot().waiting.length, 1); assert.equal(events.filter(event => event.event === "spawn").length, 1);
      firstHold.release(); await first; await secondEntered.promise; late.release(); await assert.rejects(expired);
      secondHold.release(); await second; await assert.rejects(expiredRun);
      const pids = events.filter(event => event.event === "spawn").map(event => event.pid); assert.equal(new Set(pids).size, 2);
      assert.ok(events.findIndex(event => event.event === "actual-close" && event.pid === pids[0]) < events.findIndex(event => event.event === "spawn" && event.pid === pids[1]));
      assert.deepEqual(manager.snapshot().history.map(row => row.phase), ["completed", "completed"]);
      t.diagnostic(JSON.stringify({ actualFixtureExits: await fixture.reports() }));
    } finally { firstHold.release(); secondHold.release(); late.release(); await first.catch(() => {}); await manager.dispose(); }
  });
});

test("unawaited native work fails its action instead of releasing a successful owner with a live request", async t => {
  await withCompleteNativeNarrativeWorker(async fixture => {
    const manager = new ModelTaskManager(), signal = new AbortController().signal, events: string[] = []; let generation: Promise<unknown> | undefined;
    const provider = createNativeFunctionNarrativeProvider({ manager, worker: { ...fixture.options("hold"), onEvent: event => events.push(event.event) } });
    try {
      await assert.rejects(provider.withRun!("en", signal, async () => { generation = provider.generateCompleteRoot!(request, "en", signal); return "unfinished"; }));
      await assert.rejects(generation!); assert.ok(events.includes("actual-close")); assert.equal(manager.snapshot().history.at(-1)?.phase, "failed");
      t.diagnostic(JSON.stringify({ actualFixtureExits: await fixture.reports(), forcedCloseObserved: events.includes("force-kill"), killedChildPeakInvented: false }));
    } finally { await manager.dispose(); }
  });
});

test("a nested different native provider cannot enqueue behind its current FIFO owner", async t => {
  await withCompleteNativeNarrativeWorker(async fixture => {
    const manager = new ModelTaskManager(), controller = new AbortController(), events: string[] = [];
    const first = createNativeFunctionNarrativeProvider({ manager, worker: { ...fixture.options("echo"), onEvent: event => events.push("first:" + event.event) } });
    const second = createNativeFunctionNarrativeProvider({ manager, worker: { ...fixture.options("echo"), onEvent: event => events.push("second:" + event.event) } });
    let nested: Promise<unknown> | undefined;
    const pending = first.withRun!("en", controller.signal, async () => {
      nested = second.withRun!("en", controller.signal, async () => "nested"); void nested.catch(() => {});
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(manager.snapshot().waiting.length, 0, "nested actions must reject instead of waiting for their own parent");
      await assert.rejects(nested); return first.generateCompleteRoot!(request, "en", controller.signal);
    });
    try { await pending; assert.equal(events.includes("second:spawn"), false); t.diagnostic(JSON.stringify({ actualFixtureExits: await fixture.reports() })); }
    finally { controller.abort(); await pending.catch(() => {}); await nested?.catch(() => {}); await manager.dispose(); }
  });
});

test("a caught generation attempt through another native provider fails its originating action without borrowing a worker", async t => {
  await withCompleteNativeNarrativeWorker(async fixture => {
    const manager = new ModelTaskManager(), signal = new AbortController().signal, secondEvents: string[] = [];
    const first = createNativeFunctionNarrativeProvider({ manager, worker: fixture.options("echo") });
    const second = createNativeFunctionNarrativeProvider({ manager, worker: { ...fixture.options("echo"), onEvent: event => secondEvents.push(event.event) } });
    try {
      await assert.rejects(first.withRun!("en", signal, async () => { await assert.rejects(second.generateCompleteRoot!(request, "en", signal)); return "caught misrouting is not success"; }));
      assert.equal(secondEvents.length, 0); assert.equal(manager.snapshot().history.at(-1)?.phase, "failed");
      t.diagnostic(JSON.stringify({ actualFixtureExits: await fixture.reports() }));
    } finally { await manager.dispose(); }
  });
});
