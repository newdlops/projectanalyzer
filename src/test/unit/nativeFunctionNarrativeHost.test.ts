/** Actual production Rust capture/Host pages bound to the public native provider/action/FIFO and real CPU stdio children. */
import assert from "node:assert/strict";
import test from "node:test";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { createNativeFunctionNarrativeProvider, type NativeFunctionNarrativeRunReceipt } from "../../llm/nativeNarrativeProvider";
import type { NativeNarrativeEvent } from "../../llm/nativeNarratives";
import { unpackNativeSourceJson } from "../../llm/nativeNarrativeCodec";
import { ModelTaskManager, type ModelTaskRequest } from "../../shared/modelTasks";
import { FunctionNarrativeError } from "../../shared/functionNarratives";
import { createWholeNarrativeRootHost as rootHost } from "../helpers/wholeNarrativeRootHost";
import { withCompleteNativeNarrativeWorker } from "../helpers/completeNativeNarrativeWorker";
import { nativeGate } from "../helpers/nativeNarrativeWorker";

test("actual Host ready waits for native child close and delayed outer manager settlement after every complete source page", async t => {
  await withCompleteNativeNarrativeWorker(async fixture => {
    const atOuter = nativeGate(), outer = nativeGate(), events: NativeNarrativeEvent[] = [], packets: any[] = [], receipts: NativeFunctionNarrativeRunReceipt[] = [];
    class DelayedManager extends ModelTaskManager {
      public override async run<T>(request: ModelTaskRequest<T>): Promise<T> { const value = await super.run(request); atOuter.release(); await outer.promise; return value; }
    }
    const manager = new DelayedManager(); let h!: Awaited<ReturnType<typeof rootHost>>;
    const provider = createNativeFunctionNarrativeProvider({ manager, worker: { ...fixture.options("slow-close"), onEvent(event) { events.push(event); if (event.event === "ready") h.events.push("native-ready"); },
      journal(event) { if (event.direction === "input") packets.push(JSON.parse(event.raw).requests[0].payload); } },
      onRunComplete(receipt) { receipts.push(receipt); h.events.push("provider-released"); }
    });
    h = await rootHost({ callCount: 2, provider }); const pending = h.delivery.requestFunctionNarratives(h.request);
    try {
      assert.equal(await Promise.race([atOuter.promise.then(() => true), pending.then(() => false)]), true, JSON.stringify(h.replies().map(reply => reply.status)));
      assert.equal(h.writes(), 2); assert.equal(h.contexts.length, 0); assert.equal(h.state.captures, 1);
      assert.ok(h.events.indexOf("native-ready") < h.events.indexOf("capture")); assert.ok(events.some(event => event.event === "actual-close"));
      assert.ok(!h.replies().some(reply => reply.status === "ready")); assert.equal(receipts.length, 0);
      const start = performance.now(); await delay(25); const heldMs = performance.now() - start; outer.release(); await pending;
      assert.equal(h.replies().at(-1)?.status, "ready"); assert.equal(h.replies().at(-1)?.coverage?.complete, true); assert.equal(h.state.disposed, 1);
      assert.equal(receipts.length, 1); assert.ok(receipts[0].actionWholeHostMs >= heldMs); assert.equal(receipts[0].outerManagerSettlementObserved, true);
      assert.equal(receipts[0].worker.requests, 2); assert.equal(receipts[0].worker.actualCloseObserved, true); assert.equal(packets.length, 2);
      for (const packet of packets) {
        const content = packet.messages[1].content, marker = "SOURCE JSON:\n";
        const source = (unpackNativeSourceJson(JSON.parse(content.slice(content.lastIndexOf(marker) + marker.length))) as any)["SOURCE DATA:"];
        assert.ok(source.snippets.some((snippet: any) => snippet.text.includes("Parent 원문 😀 224")));
        assert.ok(source.snippets.some((snippet: any) => snippet.text.includes("Helper 원문 😀 84")));
        assert.ok(source.snippets.some((snippet: any) => snippet.text.includes("outsideCaller")));
      }
      await h.delivery.requestFunctionNarratives({ ...h.request, requestId: 2, pageIndex: 1, pageLanguage: "en" });
      assert.equal(h.replies().at(-1)?.cacheHit, true); assert.equal(events.filter(event => event.event === "spawn").length, 1); assert.equal(h.state.captures, 1);
      const reports = await fixture.reports(); assert.equal(reports.length, 1); assert.equal(reports[0].actualExitCode, 0);
      t.diagnostic(JSON.stringify({ actualFixtureExits: reports, actionOnlyTimingNotNeuralOrFullHostEvidence: receipts[0].actionWholeHostMs }));
    } finally { outer.release(); await pending.catch(() => {}); h.delivery.clearScenarioInputs(); await manager.dispose(); }
  });
});

test("actual Host page I/O keeps the next native FIFO action unspawned until callback work and actual close finish", async t => {
  await withCompleteNativeNarrativeWorker(async fixture => {
    const manager = new ModelTaskManager(), entered = nativeGate(), io = nativeGate(), order: string[] = []; let paused = false, h!: Awaited<ReturnType<typeof rootHost>>;
    const first = createNativeFunctionNarrativeProvider({ manager, worker: { ...fixture.options("slow-close"), onEvent: event => order.push("first:" + event.event) }, onRunComplete() { h.events.push("provider-released"); } });
    h = await rootHost({ provider: first, async read() { if (!paused) { paused = true; entered.release(); await io.promise; } } });
    const pending = h.delivery.requestFunctionNarratives(h.request);
    try {
      assert.equal(await Promise.race([entered.promise.then(() => true), pending.then(() => false)]), true);
      const second = createNativeFunctionNarrativeProvider({ manager, worker: { ...fixture.options("echo"), onEvent: event => order.push("second:" + event.event) } });
      const queued = second.withRun!("en", new AbortController().signal, async () => "second");
      assert.equal(manager.snapshot().waiting.length, 1); assert.equal(order.includes("second:spawn"), false); io.release(); await Promise.all([pending, queued]);
      assert.ok(order.indexOf("first:actual-close") < order.indexOf("second:spawn")); assert.equal(h.replies().at(-1)?.status, "ready");
      t.diagnostic(JSON.stringify({ actualFixtureExits: await fixture.reports() }));
    } finally { io.release(); await pending.catch(() => {}); h.delivery.clearScenarioInputs(); await manager.dispose(); }
  });
});

test("manager disposal propagates its owned signal into actual Host page I/O and waits for both that I/O and actual child close", async t => {
  await withCompleteNativeNarrativeWorker(async fixture => {
    const manager = new ModelTaskManager(), entered = nativeGate(), io = nativeGate(), closed = nativeGate(); let paused = false, disposed = false, returned = false;
    const provider = createNativeFunctionNarrativeProvider({ manager, worker: { ...fixture.options(), onEvent(event) { if (event.event === "actual-close") closed.release(); } } });
    const h = await rootHost({ provider, async read() { if (!paused) { paused = true; entered.release(); await io.promise; } } });
    const pending = h.delivery.requestFunctionNarratives(h.request).finally(() => { returned = true; });
    try {
      assert.equal(await Promise.race([entered.promise.then(() => true), pending.then(() => false)]), true);
      const disposal = manager.dispose().then(() => { disposed = true; }); await closed.promise;
      assert.equal(disposed, false); assert.equal(returned, false); assert.equal(h.state.disposed, 0); io.release(); await Promise.all([pending, disposal]);
      assert.equal(manager.shutdownComplete, true); assert.equal(h.state.disposed, 1); assert.ok(!h.replies().some(reply => reply.status === "ready"));
      assert.equal(h.replies().at(-1)?.status, "cancelled");
      t.diagnostic(JSON.stringify({ actualFixtureExits: await fixture.reports() }));
    } finally { io.release(); await pending.catch(() => {}); h.delivery.clearScenarioInputs(); await manager.dispose(); }
  });
});

for (const mode of ["bad-reply", "bad-close"] as const) test(mode + " from the actual native child cannot publish Host ready or fall back to legacy generation", async t => {
  await withCompleteNativeNarrativeWorker(async fixture => {
    const manager = new ModelTaskManager(), events: string[] = [];
    const provider = createNativeFunctionNarrativeProvider({ manager, worker: { ...fixture.options(mode), onEvent: event => events.push(event.event) } });
    const h = await rootHost({ provider });
    try {
      await h.delivery.requestFunctionNarratives(h.request); assert.ok(!h.replies().some(reply => reply.status === "ready")); assert.equal(h.contexts.length, 0);
      assert.ok(events.includes("actual-close")); assert.equal(manager.snapshot().history.at(-1)?.phase, "failed"); assert.equal(h.state.disposed, 1);
      if (mode === "bad-close") assert.equal(h.storedPages(), 0);
      t.diagnostic(JSON.stringify({ actualFixtureExits: await fixture.reports() }));
    } finally { h.delivery.clearScenarioInputs(); await manager.dispose(); }
  });
});

test("actual native Host cancellation reaps a noncooperative child before releasing FIFO ownership and never publishes a partial answer", async t => {
  await withCompleteNativeNarrativeWorker(async fixture => {
    const manager = new ModelTaskManager(), requested = nativeGate(), events: string[] = [];
    const provider = createNativeFunctionNarrativeProvider({ manager, worker: { ...fixture.options("hold"), onEvent(event) { events.push(event.event); if (event.event === "request") requested.release(); } } });
    const h = await rootHost({ provider }); const pending = h.delivery.requestFunctionNarratives(h.request);
    try {
      assert.equal(await Promise.race([requested.promise.then(() => true), pending.then(() => false)]), true);
      h.delivery.cancelFunctionNarratives(h.request); await pending;
      assert.equal(h.writes(), 0); assert.ok(events.includes("force-kill")); assert.ok(events.includes("actual-close")); assert.equal(manager.idle, true);
      assert.ok(!h.replies().some(reply => reply.status === "ready")); assert.equal(h.state.disposed, 1);
      assert.equal(h.replies().at(-1)?.status, "cancelled");
      t.diagnostic(JSON.stringify({ actualFixtureExits: await fixture.reports(), forceKilledChildPeakInvented: false }));
    } finally { await pending.catch(() => {}); h.delivery.clearScenarioInputs(); await manager.dispose(); }
  });
});

test("actual native Host source mutation during storage revokes every page after native close", async t => {
  await withCompleteNativeNarrativeWorker(async fixture => {
    const manager = new ModelTaskManager(), events: string[] = [];
    const provider = createNativeFunctionNarrativeProvider({ manager, worker: { ...fixture.options(), onEvent: event => events.push(event.event) } });
    const h = await rootHost({ provider, mutateDuringWrite: true });
    try {
      await h.delivery.requestFunctionNarratives(h.request); assert.equal(h.replies().at(-1)?.status, "stale"); assert.equal(h.storedPages(), 0);
      assert.ok(events.includes("actual-close")); assert.equal(h.state.disposed, 1); assert.ok(!h.replies().some(reply => reply.status === "ready"));
      t.diagnostic(JSON.stringify({ actualFixtureExits: await fixture.reports() }));
    } finally { h.delivery.clearScenarioInputs(); await manager.dispose(); }
  });
});

test("a source change combined with an actual native close-proof failure still revokes the complete Host cache as stale", async t => {
  await withCompleteNativeNarrativeWorker(async fixture => {
    const manager = new ModelTaskManager(), events: string[] = [];
    const provider = createNativeFunctionNarrativeProvider({ manager, worker: { ...fixture.options("bad-close"), onEvent: event => events.push(event.event) } });
    const h = await rootHost({ provider, mutateDuringWrite: true });
    try {
      await h.delivery.requestFunctionNarratives(h.request); assert.equal(h.replies().at(-1)?.status, "stale"); assert.equal(h.storedPages(), 0);
      assert.ok(events.includes("actual-close")); assert.equal(h.state.disposed, 1); assert.ok(!h.replies().some(reply => reply.status === "ready"));
      t.diagnostic(JSON.stringify({ actualFixtureExits: await fixture.reports(), cleanupFailureRetainedInManager: manager.snapshot().history.at(-1)?.phase }));
    } finally { h.delivery.clearScenarioInputs(); await manager.dispose(); }
  });
});

test("retry after pre-ready native admission failure binds the session to the later actual whole-source capture", async t => {
  await withCompleteNativeNarrativeWorker(async fixture => {
    const manager = new ModelTaskManager(), packets: any[] = [], events: string[] = []; let admissions = 0, h!: Awaited<ReturnType<typeof rootHost>>;
    const provider = createNativeFunctionNarrativeProvider({ manager, worker: { ...fixture.options(), async admit() {
      if (++admissions === 1) throw new FunctionNarrativeError("unavailable", "explicit-first-admission-failure");
    }, onEvent: event => events.push(event.event), journal(event) { if (event.direction === "input") packets.push(JSON.parse(event.raw).requests[0].payload); } },
    onRunComplete() { h.events.push("provider-released"); } });
    h = await rootHost({ callCount: 2, provider });
    try {
      await h.delivery.requestFunctionNarratives(h.request); assert.equal(h.replies().at(-1)?.status, "unavailable"); assert.equal(h.state.captures, 0); assert.equal(events.length, 0);
      await h.delivery.requestFunctionNarratives({ ...h.request, requestId: 2 });
      assert.equal(h.replies().at(-1)?.status, "ready"); assert.equal(h.state.captures, 1); assert.equal(h.writes(), 2); assert.equal(packets.length, 2);
      for (const packet of packets) {
        const content = packet.messages[1].content, marker = "SOURCE JSON:\n";
        const source = (unpackNativeSourceJson(JSON.parse(content.slice(content.lastIndexOf(marker) + marker.length))) as any)["SOURCE DATA:"];
        assert.ok(source.sourceEvidence); assert.ok(source.snippets.some((snippet: any) => snippet.text.includes("Parent 원문 😀 224")));
        assert.ok(source.snippets.some((snippet: any) => snippet.text.includes("Helper 원문 😀 84"))); assert.ok(source.snippets.some((snippet: any) => snippet.text.includes("outsideCaller")));
      }
      t.diagnostic(JSON.stringify({ actualFixtureExits: await fixture.reports(), sourceFreeAdmissionFailuresBeforeCapture: 1 }));
    } finally { h.delivery.clearScenarioInputs(); await manager.dispose(); }
  });
});
