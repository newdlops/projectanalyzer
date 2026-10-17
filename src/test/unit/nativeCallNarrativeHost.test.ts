/** Actual production call Host and real CPU stdio worker prove action-local prior retention/transactional cache, never neural accuracy or 3sec timing. */
import assert from "node:assert/strict";
import test from "node:test";
import { createNativeFunctionNarrativeProvider, type NativeFunctionNarrativeRunReceipt } from "../../llm/nativeNarrativeProvider";
import { unpackNativeInputMessages } from "../../llm/nativeNarrativeCodec";
import type { NativeNarrativeEvent } from "../../llm/nativeNarratives";
import { getFunctionCallFixedInputs, type FunctionCallReading } from "../../shared/functionCallNarratives";
import { FunctionNarrativeError } from "../../shared/functionNarratives";
import { ModelTaskManager, type ModelTaskRequest } from "../../shared/modelTasks";
import type { FunctionNarrativeProvider } from "../../application/functionNarratives";
import { FunctionCallNarrativesHostDelivery } from "../../webview/functionCalls/narrativesHostDelivery";
import { createWholeNarrativeCallHost as callHost } from "../helpers/wholeNarrativeCallHost";
import { withCompleteNativeNarrativeWorker } from "../helpers/completeNativeNarrativeWorker";
import { nativeGate } from "../helpers/nativeNarrativeWorker";

/** Inspect the actual public wire, independently of the new Host reply adapter. */
function sourceOf(packet: any): any {
  const content = unpackNativeInputMessages(packet.messages)[1].content, marker = "SOURCE DATA:\n";
  return JSON.parse(content.slice(content.lastIndexOf(marker) + marker.length));
}

test("actual native call Host preserves all six original replies across 12 calls and withholds every page until real close and outer settlement", async t => {
  await withCompleteNativeNarrativeWorker(async fixture => {
    const atOuter = nativeGate(), release = nativeGate(), events: NativeNarrativeEvent[] = [], sources: any[] = [], expected: FunctionCallReading[] = [], receipts: NativeFunctionNarrativeRunReceipt[] = [];
    class DelayedManager extends ModelTaskManager {
      public override async run<T>(request: ModelTaskRequest<T>): Promise<T> { const value = await super.run(request); atOuter.release(); await release.promise; return value; }
    }
    const manager = new DelayedManager();
    const h = await callHost(f => createNativeFunctionNarrativeProvider({ manager, worker: { ...fixture.options("call-slow-close"),
      onEvent(event) { events.push(event); if (event.event === "ready") f.events.push("native-ready"); },
      journal(event) {
        const line = JSON.parse(event.raw);
        if (event.direction === "input") {
          const source = sourceOf(line.requests[0].payload); sources.push(source); assert.deepEqual(source.callTask.earlierModelReadings, expected);
        } else if (line.replies) {
          const raw = JSON.parse(line.replies[0].content), targets = sources.at(-1).callTask.targets;
          raw.calls.forEach((call: any, index: number) => expected.push({ callId: targets[index].callId, role: call.role,
            inputs: call.inputs ?? getFunctionCallFixedInputs(targets[index], "en")!, output: call.output, effects: call.effects, reason: call.reason }));
        }
      } }, onRunComplete(receipt) { receipts.push(receipt); f.events.push("provider-released"); } }));
    const pending = h.host.explain(h.request);
    try {
      assert.equal(await Promise.race([atOuter.promise.then(() => true), pending.then(() => false)]), true, JSON.stringify(h.messages.map(message => message.status)));
      assert.equal(sources.length, 7); assert.equal(expected.length, 12); assert.deepEqual(sources.map(source => source.callTask.earlierModelReadings.length), [0,2,4,6,8,10,12]);
      assert.ok(events.some(event => event.event === "actual-close")); assert.equal(receipts.length, 0); assert.ok(!h.messages.some(message => message.narrative));
      assert.ok(h.events.indexOf("native-ready") < h.events.indexOf("capture"));
      await h.host.explain({ ...h.request, requestId: 2, pageIndex: 0, pageLanguage: "en" }); assert.equal(h.messages.at(-1)?.status, "stale");
      for (const source of sources) {
        assert.ok(source.sourceEvidence); assert.ok(source.snippets.some((snippet: any) => snippet.text.includes("Parent 원문 😀 224")));
        assert.ok(source.snippets.some((snippet: any) => snippet.text.includes("Helper 원문 😀 84"))); assert.ok(source.snippets.some((snippet: any) => snippet.text.includes("outsideCaller")));
        assert.ok(source.snippets.every((snippet: any) => !snippet.truncated));
      }
      assert.equal(sources.at(-1).callTask.calleeEvidence.length, 12);
      release.release(); await pending; assert.equal(h.messages.at(-1)?.status, "ready"); assert.equal(h.messages.at(-1)?.coverage?.completed, 12);
      assert.equal(receipts.length, 1); assert.equal(receipts[0].worker.requests, 7); assert.equal(receipts[0].worker.actualCloseObserved, true); assert.equal(h.state.disposed, 1);
      for (let index = 0; index < 6; index++) {
        await h.host.explain({ ...h.request, requestId: 3 + index, pageIndex: index, pageLanguage: "en" });
        assert.equal(h.messages.at(-1)?.cacheHit, true);
        assert.deepEqual(h.messages.at(-1)!.narrative!.calls.map(({callId,role,inputs,output,effects,reason}) => ({callId,role,inputs,output,effects,reason})), expected.slice(index * 2, index * 2 + 2));
      }
      assert.equal(events.filter(event => event.event === "spawn").length, 1); assert.equal(h.state.captures, 1);
      const reports = await fixture.reports(); assert.equal(reports.length, 1); assert.equal(reports[0].actualExitCode, 0); t.diagnostic(JSON.stringify({ actualFixtureExits: reports, actualChildEvents: events }));
    } finally { release.release(); await pending.catch(() => {}); h.host.reset(); await manager.dispose(); }
  });
});

for (const mode of ["call-bad-second", "call-bad-close"] as const) test(mode + " discards every private call/page and closes its actual child", async t => {
  await withCompleteNativeNarrativeWorker(async fixture => {
    const manager = new ModelTaskManager(), events: NativeNarrativeEvent[] = [];
    const h = await callHost(() => createNativeFunctionNarrativeProvider({ manager, worker: { ...fixture.options(mode), onEvent: event => events.push(event) } }));
    try {
      await h.host.explain(h.request); assert.ok(!h.messages.some(message => message.narrative)); assert.ok(events.some(event => event.event === "actual-close"));
      assert.equal(manager.snapshot().history.at(-1)?.phase, "failed"); assert.equal(h.state.disposed, 1);
      await h.host.explain({ ...h.request, requestId: 2, pageIndex: 0, pageLanguage: "en" }); assert.equal(h.messages.at(-1)?.status, "stale");
      t.diagnostic(JSON.stringify({ actualFixtureExits: await fixture.reports(), actualChildEvents: events }));
    } finally { h.host.reset(); await manager.dispose(); }
  });
});

test("cancelled native calls expose no prefix and a retry regenerates priors only from its new actual worker action", async t => {
  await withCompleteNativeNarrativeWorker(async fixture => {
    const manager = new ModelTaskManager(), secondRequested = nativeGate(), events: NativeNarrativeEvent[] = [], sources: any[] = []; let current!: FunctionNarrativeProvider;
    const h = await callHost(() => {
      const first = createNativeFunctionNarrativeProvider({ manager, worker: { ...fixture.options("call-hold-second"), onEvent(event) { events.push(event); if (event.event === "request" && event.uid === 1) secondRequested.release(); } } });
      current = first;
      return { generate: (...args) => current.generate(...args), prepare: (...args) => current.prepare!(...args), withRun: (...args) => current.withRun!(...args),
        generateCompleteCall: (...args) => current.generateCompleteCall!(...args), managesDeadlines: true } as FunctionNarrativeProvider;
    });
    const pending = h.host.explain(h.request);
    try {
      assert.equal(await Promise.race([secondRequested.promise.then(() => true), pending.then(() => false)]), true);
      await h.host.explain({ ...h.request, requestId: 2, pageIndex: 0, pageLanguage: "en" }); assert.equal(h.messages.at(-1)?.status, "stale");
      h.host.cancelExplanation(h.request); await pending; assert.equal(h.messages.at(-1)?.status, "cancelled"); assert.ok(!h.messages.some(message => message.narrative));
      current = createNativeFunctionNarrativeProvider({ manager, worker: { ...fixture.options("call"), onEvent: event => events.push(event), journal(event) { if (event.direction === "input") sources.push(sourceOf(JSON.parse(event.raw).requests[0].payload)); } }, onRunComplete() { h.events.push("provider-released"); } });
      await h.host.explain({ ...h.request, requestId: 3 }); assert.equal(h.messages.at(-1)?.status, "ready"); assert.equal(h.state.captures, 2);
      assert.deepEqual(sources.map(source => source.callTask.earlierModelReadings.length), [0,2,4,6,8,10,12]); assert.equal(sources[0].callTask.targets[0].callId, "call-1");
      assert.equal(events.filter(event => event.event === "actual-close").length, 2); t.diagnostic(JSON.stringify({ actualFixtureExits: await fixture.reports(), actualChildEvents: events }));
    } finally { h.host.cancelExplanation(h.request); await pending.catch(() => {}); h.host.reset(); await manager.dispose(); }
  });
});

test("manager disposal reaches actual call capture I/O and waits for that I/O and real child close", async t => {
  await withCompleteNativeNarrativeWorker(async fixture => {
    const manager = new ModelTaskManager(), entered = nativeGate(), io = nativeGate(), closed = nativeGate(), events: NativeNarrativeEvent[] = []; let disposed = false, captureSignal!: AbortSignal;
    const h = await callHost(f => {
      const capture = f.access.capture; f.access.capture = async input => { captureSignal = input.signal; entered.release(); await io.promise;
        if (input.signal.aborted) throw new FunctionNarrativeError("cancelled"); return capture(input); };
      return createNativeFunctionNarrativeProvider({ manager, worker: { ...fixture.options("call"), onEvent(event) { events.push(event); if (event.event === "actual-close") closed.release(); } } });
    });
    const pending = h.host.explain(h.request);
    try {
      assert.equal(await Promise.race([entered.promise.then(() => true), pending.then(() => false)]), true);
      const disposal = manager.dispose().then(() => { disposed = true; }); await closed.promise;
      assert.equal(captureSignal.aborted, true); assert.equal(disposed, false); assert.ok(!h.messages.some(message => message.narrative));
      io.release(); await Promise.all([pending, disposal]); assert.equal(h.messages.at(-1)?.status, "cancelled"); assert.equal(manager.shutdownComplete, true);
      t.diagnostic(JSON.stringify({ actualFixtureExits: await fixture.reports(), actualChildEvents: events }));
    } finally { io.release(); await pending.catch(() => {}); h.host.reset(); await manager.dispose(); }
  });
});

test("native call source mutation combined with close-proof failure remains stale and revokes all cache authority", async t => {
  await withCompleteNativeNarrativeWorker(async fixture => {
    const manager = new ModelTaskManager(), events: NativeNarrativeEvent[] = []; let replies = 0;
    const h = await callHost(f => createNativeFunctionNarrativeProvider({ manager, worker: { ...fixture.options("call-bad-close"), onEvent(event) {
      events.push(event); if (event.event === "response" && ++replies === 7) { f.files[1].content += "// changed"; f.state.revision++; }
    } } }));
    try {
      await h.host.explain(h.request); assert.equal(h.messages.at(-1)?.status, "stale"); assert.ok(!h.messages.some(message => message.narrative));
      assert.ok(events.some(event => event.event === "actual-close")); assert.equal(h.state.disposed, 1);
      await h.host.explain({ ...h.request, requestId: 2, pageIndex: 0 }); assert.equal(h.messages.at(-1)?.status, "stale");
      t.diagnostic(JSON.stringify({ actualFixtureExits: await fixture.reports(), actualChildEvents: events }));
    } finally { h.host.reset(); await manager.dispose(); }
  });
});

test("native call admission failure before ready reads no source and retries with a fresh empty prior list", async t => {
  await withCompleteNativeNarrativeWorker(async fixture => {
    const manager = new ModelTaskManager(), sources: any[] = []; let admissions = 0;
    const h = await callHost(f => createNativeFunctionNarrativeProvider({ manager, worker: { ...fixture.options("call"), async admit() { if (++admissions === 1) throw new FunctionNarrativeError("unavailable"); },
      journal(event) { if (event.direction === "input") sources.push(sourceOf(JSON.parse(event.raw).requests[0].payload)); } }, onRunComplete() { f.events.push("provider-released"); } }));
    try {
      await h.host.explain(h.request); assert.equal(h.messages.at(-1)?.status, "unavailable"); assert.equal(h.state.captures, 0);
      await h.host.explain({ ...h.request, requestId: 2 }); assert.equal(h.messages.at(-1)?.status, "ready"); assert.equal(h.state.captures, 1);
      assert.deepEqual(sources[0].callTask.earlierModelReadings, []); t.diagnostic(JSON.stringify({ actualFixtureExits: await fixture.reports() }));
    } finally { h.host.reset(); await manager.dispose(); }
  });
});

test("native call whole-source overflow never sends a shortened model packet", async t => {
  await withCompleteNativeNarrativeWorker(async fixture => {
    const manager = new ModelTaskManager(), events: NativeNarrativeEvent[] = [];
    const h = await callHost(() => createNativeFunctionNarrativeProvider({ manager, worker: { ...fixture.options("call"), onEvent: event => events.push(event) } }), { maxSourceBytes: 1000 });
    try { await h.host.explain(h.request); assert.equal(h.messages.at(-1)?.status, "context-too-large"); assert.ok(!events.some(event => event.event === "request"));
      assert.ok(events.some(event => event.event === "actual-close")); assert.ok(!h.messages.some(message => message.narrative)); t.diagnostic(JSON.stringify({ actualFixtureExits: await fixture.reports(), actualChildEvents: events }));
    } finally { h.host.reset(); await manager.dispose(); }
  });
});

test("native call capability without actual source authority rejects before worker creation and never uses legacy generation", async () => {
  await withCompleteNativeNarrativeWorker(async fixture => {
    const manager = new ModelTaskManager(), events: NativeNarrativeEvent[] = [], h = await callHost();
    const provider = createNativeFunctionNarrativeProvider({ manager, worker: { ...fixture.options("call"), onEvent: event => events.push(event) } }), messages: any[] = [];
    const delivery = new FunctionCallNarrativesHostDelivery({ ...h, provider, getLanguage: () => "en", async readSourceText() { throw new Error("No legacy source fallback"); }, async postMessage(message) { messages.push(message); } });
    try {
      const contextId = delivery.register(h.slice, h.root, h.files[0].content)!; await delivery.request({ ...h.request, contextId });
      assert.equal(messages.at(-1)?.status, "unavailable"); assert.equal(events.length, 0); assert.equal(manager.idle, true);
    } finally { delivery.clear(); h.host.reset(); await manager.dispose(); }
  });
});
