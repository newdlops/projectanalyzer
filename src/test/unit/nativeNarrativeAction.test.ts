/** Real FIFO/child integration across whole source capture, all actual fixture priors, storage/pages and outer settlement. */
import assert from "node:assert/strict";
import test from "node:test";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { runNativeNarrativeAction, type NativeNarrativeEvent, type NativeNarrativePacket } from "../../llm/nativeNarratives";
import { ModelTaskManager, type ModelTaskRequest } from "../../shared/modelTasks";
import { createContentHash } from "../../shared/hash";
import { captureNarrativeSources } from "../../application/narrativeSources";
import { withNarrativeWorkspace, sourceLimits } from "../helpers/narrativeSourceWorkspace";
import { withNativeNarrativeWorker, nativeGate } from "../helpers/nativeNarrativeWorker";

type Prior = { callId: string; role: string; inputs: string; output: string; effects: string; reason: string };
const data = (value: unknown): NativeNarrativePacket => ({ schema: { type: "object" }, messages: [{ role: "user", content: JSON.stringify(value) }] });
const cancelled = (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "cancelled");

test("one real FIFO owner retains complete Rust source and every actual six-field fixture prior across twelve calls, storage and all pages", async () => {
  await withNarrativeWorkspace(async workspace => withNativeNarrativeWorker(async options => {
    const manager = new ModelTaskManager(), storing = nativeGate(), storage = nativeGate(), publishing = nativeGate(), publication = nativeGate();
    const firstEvents: NativeNarrativeEvent[] = [], secondEvents: NativeNarrativeEvent[] = [], packets: unknown[] = [], pages: number[] = [];
    const calls: Prior[] = [], priors: Prior[][] = []; let leaseDisposed = false, sourceText: string[] = [];
    const first = runNativeNarrativeAction({ manager, worker: { ...options("calls"), onEvent: event => firstEvents.push(event), journal(event) {
      if (event.direction === "input") packets.push(JSON.parse(event.raw).requests[0].payload);
    } }, label: "Complete calls", signal: new AbortController().signal, async execute({ transport, signal }) {
      assert.ok(firstEvents.some(event => event.event === "ready"));
      const lease = await captureNarrativeSources({ rootIds: [workspace.node("root").id], graph: workspace.authority(), reader: workspace.reader, limits: sourceLimits, signal });
      try {
        const snippets = lease.capture.declarations.map((row, index) => ({ id: "source-" + index, role: index ? "helper" : "function", text: row.text,
          startLine: row.range.startLine + 1, endLine: row.range.endLine + 1, truncated: false }));
        sourceText = snippets.map(snippet => snippet.text); assert.ok(sourceText.some(text => text.includes("const 기록219"))); assert.ok(sourceText.some(text => text.includes("const helper89")));
        for (let index = 0; index < 7; index++) {
          priors.push(structuredClone(calls));
          const payload = data({ snippets, earlierModelReadings: calls }), response = await transport.generate({ requestId: "actual-reading-" + index, payload }, signal);
          const actual = JSON.parse(response.text); assert.equal(actual.payloadSha256, createContentHash(JSON.stringify(payload)));
          for (const row of actual.calls as Prior[]) { assert.deepEqual(Object.keys(row).sort(), ["callId", "role", "inputs", "output", "effects", "reason"].sort()); calls.push(row); }
          await lease.assertCurrent(signal);
        }
        assert.equal(calls.length, 12); storing.release(); await storage.promise;
        await transport.release(); assert.equal(transport.observation.actualCloseObserved, true);
        for (let index = 0; index < 7; index++) { pages.push(index); if (index === 0) { publishing.release(); await publication.promise; } }
        return { calls: structuredClone(calls), sourceText: [...sourceText] };
      } finally { lease.dispose(); leaseDisposed = true; }
    } });
    try {
      await storing.promise;
      const second = runNativeNarrativeAction({ manager, worker: { ...options(), onEvent: event => secondEvents.push(event) }, label: "Complete root", signal: new AbortController().signal,
        async execute({ transport, signal }) { return transport.generate({ requestId: "root", payload: data({ root: true }) }, signal); } });
      assert.equal(manager.snapshot().waiting.length, 1); assert.equal(secondEvents.length, 0); storage.release(); await publishing.promise;
      assert.equal(secondEvents.length, 0); assert.equal(firstEvents.some(event => event.event === "actual-close"), true); assert.equal(manager.snapshot().waiting.length, 1);
      publication.release(); const [one, two] = await Promise.all([first, second]);
      assert.deepEqual(pages, [0, 1, 2, 3, 4, 5, 6]); assert.equal(leaseDisposed, true); assert.equal(packets.length, 7);
      for (const [index, payload] of packets.entries()) {
        const sent = JSON.parse((payload as NativeNarrativePacket).messages[0].content); assert.deepEqual(sent.snippets.map((snippet: { text: string }) => snippet.text), sourceText);
        assert.deepEqual(sent.earlierModelReadings, priors[index]);
      }
      assert.equal(priors[6].length, 12); assert.ok(priors[6].every(row => row.inputs.includes('"원문"\r\n')));
      assert.equal(one.actualWorker.actualCloseObserved, true); assert.equal(two.actualWorker.actualCloseObserved, true); assert.equal(one.outerManagerSettlementObserved, true);
      assert.equal(one.neuralAuthorshipProven, false); assert.ok(one.wholeHostMs > 0); assert.equal(manager.snapshot().history.length, 2);
      assert.ok(manager.snapshot().history.every(row => row.phase === "completed"));
    } finally { storage.release(); publication.release(); await first.catch(() => {}); await manager.dispose(); }
  }));
});

test("cancelling a live native request keeps the next FIFO action unspawned until actual force-kill close", async () => {
  await withNativeNarrativeWorker(async options => {
    const manager = new ModelTaskManager(), controller = new AbortController(), requested = nativeGate(), events: string[] = [];
    const first = runNativeNarrativeAction({ manager, worker: { ...options("ignore-term"), onEvent(event) { events.push("first:" + event.event); if (event.event === "request") requested.release(); } },
      label: "Calls", signal: controller.signal, async execute({ transport, signal }) { return transport.generate({ requestId: "cancel", payload: data({}) }, signal); } });
    const rejected = assert.rejects(first, cancelled);
    try {
      await requested.promise;
      const second = runNativeNarrativeAction({ manager, worker: { ...options(), onEvent: event => events.push("second:" + event.event) }, label: "Root", signal: new AbortController().signal,
        async execute() { return "root"; } });
      controller.abort(); assert.equal(events.includes("second:spawn"), false); await rejected; await second;
      assert.ok(events.indexOf("first:actual-close") < events.indexOf("second:spawn")); assert.ok(events.includes("first:force-kill"));
      assert.deepEqual(manager.snapshot().history.map(row => row.phase), ["cancelled", "completed"]);
    } finally { controller.abort(); await first.catch(() => {}); await manager.dispose(); }
  });
});

test("native cancellation during source or storage I/O waits for that callback and the actual worker close", async () => {
  await withNativeNarrativeWorker(async options => {
    const manager = new ModelTaskManager(), controller = new AbortController(), entered = nativeGate(), io = nativeGate(), closed = nativeGate(); let settled = false;
    const first = runNativeNarrativeAction({ manager, worker: { ...options(), onEvent(event) { if (event.event === "actual-close") closed.release(); } }, label: "Source I/O", signal: controller.signal,
      async execute() { entered.release(); await io.promise; return "uncommitted"; } }).finally(() => { settled = true; });
    const rejected = assert.rejects(first, cancelled);
    try {
      await entered.promise; controller.abort(); await closed.promise; assert.equal(settled, false); assert.equal(manager.snapshot().active?.phase, "cancelling");
      io.release(); await rejected; assert.equal(manager.idle, true);
    } finally { io.release(); controller.abort(); await first.catch(() => {}); await manager.dispose(); }
  });
});

test("queued native cancellation never constructs or admits a second worker", async () => {
  await withNativeNarrativeWorker(async options => {
    const manager = new ModelTaskManager(), entered = nativeGate(), gate = nativeGate(), controller = new AbortController(); let admitted = false;
    const first = runNativeNarrativeAction({ manager, worker: options(), label: "First", signal: new AbortController().signal, async execute() { entered.release(); await gate.promise; return 1; } });
    try {
      await entered.promise;
      const second = runNativeNarrativeAction({ manager, worker: { ...options(), async admit() { admitted = true; } }, label: "Queued", signal: controller.signal, async execute() { return 2; } });
      const rejected = assert.rejects(second, cancelled); controller.abort(); await rejected; assert.equal(admitted, false); gate.release(); await first;
    } finally { gate.release(); await first.catch(() => {}); await manager.dispose(); }
  });
});

test("native action preserves distinct body and cleanup errors and cannot record scheduler success", async () => {
  await withNativeNarrativeWorker(async options => {
    const manager = new ModelTaskManager(), primary = new Error("body failed");
    try {
      await assert.rejects(runNativeNarrativeAction({ manager, worker: options("bad-close"), label: "Invalid", signal: new AbortController().signal,
        async execute() { throw primary; } }), error => error instanceof AggregateError && error.errors.includes(primary) && error.errors.length === 2);
      assert.equal(manager.snapshot().history.at(-1)?.phase, "failed");
    } finally { await manager.dispose(); }
  });
});

test("native worker disposal blocks shutdown until actual close and callback cleanup finish", async () => {
  await withNativeNarrativeWorker(async options => {
    const manager = new ModelTaskManager(), entered = nativeGate(), cleanup = nativeGate(), closed = nativeGate(); let disposed = false;
    const action = runNativeNarrativeAction({ manager, worker: { ...options(), onEvent(event) { if (event.event === "actual-close") closed.release(); } }, label: "Dispose", signal: new AbortController().signal,
      async execute() { entered.release(); await cleanup.promise; } });
    const rejected = assert.rejects(action, cancelled);
    await entered.promise; const disposal = manager.dispose().then(() => { disposed = true; });
    try { await closed.promise; assert.equal(disposed, false); cleanup.release(); await rejected; await disposal; assert.equal(manager.shutdownComplete, true); }
    finally { cleanup.release(); await action.catch(() => {}); await disposal; }
  });
});

test("whole native timing includes actual outer manager.run settlement after callback and real child close", async () => {
  await withNativeNarrativeWorker(async options => {
    const atOuter = nativeGate(), outer = nativeGate(); let returned = false;
    class DelayedOuterManager extends ModelTaskManager {
      public override async run<T>(request: ModelTaskRequest<T>): Promise<T> { const value = await super.run(request); atOuter.release(); await outer.promise; return value; }
    }
    const manager = new DelayedOuterManager();
    const result = runNativeNarrativeAction({ manager, worker: options(), label: "Outer", signal: new AbortController().signal, async execute() { return 17; } }).then(value => { returned = true; return value; });
    try {
      await atOuter.promise; const heldAt = performance.now(); assert.equal(returned, false); assert.equal(manager.idle, true);
      await delay(40); const heldFor = performance.now() - heldAt; outer.release(); const actual = await result;
      assert.equal(actual.value, 17); assert.ok(actual.wholeHostMs >= heldFor); assert.equal(actual.outerManagerSettlementObserved, true); assert.equal(actual.actualWorker.actualCloseObserved, true);
    } finally { outer.release(); await result.catch(() => {}); await manager.dispose(); }
  });
});

test("native whole-action timing starts at ready-line receipt and includes synchronous ready observers", async () => {
  await withNativeNarrativeWorker(async options => {
    const manager = new ModelTaskManager(); let observerMs = 0;
    try {
      const actual = await runNativeNarrativeAction({ manager, worker: { ...options(), onEvent(event) {
        if (event.event === "ready") { const start = performance.now(); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40); observerMs = performance.now() - start; }
      } }, label: "Ready receipt", signal: new AbortController().signal, async execute() { return true; } });
      assert.equal(typeof actual.actualWorker.sourceFreeReadyAtMonotonicMs, "number"); assert.ok(actual.wholeHostMs >= observerMs);
    } finally { await manager.dispose(); }
  });
});
