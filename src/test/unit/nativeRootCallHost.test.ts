/** Real production root capture/worker/strict call+root decoding/storage prove one-action ownership; no actual neural correctness/timing is claimed. */
import assert from "node:assert/strict";
import test from "node:test";
import { ModelTaskManager, type ModelTaskRequest } from "../../shared/modelTasks";
import { FunctionNarrativeError } from "../../shared/functionNarratives";
import { withCompleteNativeNarrativeWorker } from "../helpers/completeNativeNarrativeWorker";
import { createNativeRootCallHost as rootHost } from "../helpers/nativeRootCallHost";
import { nativeGate } from "../helpers/nativeNarrativeWorker";

test("actual root action forwards all six same-worker call fields and all source into both complete root pages before actual close/outer settlement", async t => {
  await withCompleteNativeNarrativeWorker(async fixture => {
    const atOuter = nativeGate(), release = nativeGate();
    class DelayedManager extends ModelTaskManager { public override async run<T>(request: ModelTaskRequest<T>): Promise<T> { const value = await super.run(request); atOuter.release(); await release.promise; return value; } }
    const h = await rootHost(fixture, { manager: new DelayedManager(), mode: "slow-close" }), pending = h.delivery.requestFunctionNarratives(h.request);
    try {
      assert.equal(await Promise.race([atOuter.promise.then(() => true), pending.then(() => false)]), true, JSON.stringify(h.replies().map(reply => reply.status)));
      assert.equal(h.writes(), 2); assert.equal(h.inputs.filter(input => input.kind === "call").length, 6); assert.equal(h.inputs.filter(input => input.kind === "root").length, 2);
      const pids = [...new Set(h.inputs.map(input => input.pid))]; assert.equal(pids.length, 1); const expected = h.expected.get(pids[0])!; assert.equal(expected.length, 12);
      for (const input of h.inputs.filter(input => input.kind === "root")) {
        assert.deepEqual(input.source.callPriors.readings, expected); assert.equal(input.source.callPriors.targets.length, 12); assert.equal(input.source.callPriors.basis, "model-inference");
        const ids = new Set(input.source.snippets.map((snippet: any) => snippet.id));
        assert.ok(input.source.callPriors.targets.every((target: any) => ids.has(target.callerSnippet) && ids.has(target.calleeSnippet)));
        assert.ok(input.source.snippets.some((snippet: any) => snippet.text.includes("Parent 원문 😀 224"))); assert.ok(input.source.snippets.some((snippet: any) => snippet.text.includes("Helper 원문 😀 84")));
        assert.ok(input.source.snippets.some((snippet: any) => snippet.text.includes("outsideCaller")));
      }
      let consumed = 0; for (const input of h.inputs.filter(input => input.kind === "call")) { assert.deepEqual(input.source.callTask.earlierModelReadings, expected.slice(0, consumed)); consumed += 2; }
      assert.ok(h.hostEvents.indexOf("native-ready") < h.hostEvents.indexOf("capture")); assert.ok(h.events.some(event => event.event === "actual-close")); assert.equal(h.receipts.length, 0);
      assert.ok(!h.replies().some(reply => reply.narrative));
      await h.delivery.requestFunctionNarratives({ ...h.request, requestId: 2, pageIndex: 0, pageLanguage: "en" }); assert.equal(h.replies().at(-1)?.status, "stale");
      release.release(); await pending; assert.equal(h.replies().at(-1)?.status, "ready"); assert.equal(h.receipts[0].worker.requests, 8); assert.equal(h.receipts[0].worker.actualCloseObserved, true);
      await h.delivery.requestFunctionNarratives({ ...h.request, requestId: 3, pageIndex: 1, pageLanguage: "en" }); assert.equal(h.replies().at(-1)?.cacheHit, true); assert.equal(h.inputs.length, 8); assert.equal(h.state.captures, 1);
      t.diagnostic(JSON.stringify({ actualFixtureExits: await fixture.reports(), actualChildEvents: h.events }));
    } finally { release.release(); await pending.catch(() => {}); await h.close(); }
  });
});

test("a malformed later root page discards its written prefix and regenerates every call/root page in the next action", async t => {
  await withCompleteNativeNarrativeWorker(async fixture => {
    const h = await rootHost(fixture, { mode: "bad-root-second" });
    try {
      await h.delivery.requestFunctionNarratives(h.request); assert.equal(h.writes(), 1); assert.equal(h.storedPages(), 0); assert.equal(h.replies().at(-1)?.coverage?.completed, 0);
      assert.ok(!h.replies().some(reply => reply.narrative)); assert.equal(h.events.filter(event => event.event === "actual-close").length, 1);
      h.setMode("complete"); await h.delivery.requestFunctionNarratives({ ...h.request, requestId: 2 }); assert.equal(h.replies().at(-1)?.status, "ready"); assert.equal(h.storedPages(), 2); assert.equal(h.state.captures, 2);
      const firstByPid = new Map<number, any>(); for (const input of h.inputs) if (!firstByPid.has(input.pid)) firstByPid.set(input.pid, input);
      assert.equal(firstByPid.size, 2); assert.ok([...firstByPid.values()].every(input => input.kind === "call" && input.source.callTask.earlierModelReadings.length === 0));
      for (const input of h.inputs.filter(input => input.kind === "root")) assert.deepEqual(input.source.callPriors.readings, h.expected.get(input.pid));
      const rows = [...h.expected.values()]; assert.notEqual(rows[0][0].role, rows[1][0].role);
      t.diagnostic(JSON.stringify({ actualFixtureExits: await fixture.reports(), actualChildEvents: h.events }));
    } finally { await h.close(); }
  });
});

test("a concurrent cache lookup cannot see a partial native root page and cancellation removes all pages before a fresh retry", async t => {
  await withCompleteNativeNarrativeWorker(async fixture => {
    const second = nativeGate(), h = await rootHost(fixture, { mode: "hold-root-second", onEvent(event) { if (event.event === "request" && event.uid === 7) second.release(); } });
    const pending = h.delivery.requestFunctionNarratives(h.request);
    try {
      assert.equal(await Promise.race([second.promise.then(() => true), pending.then(() => false)]), true); assert.equal(h.writes(), 1); assert.ok(!h.replies().some(reply => reply.narrative));
      await h.delivery.requestFunctionNarratives({ ...h.request, requestId: 2, pageIndex: 0, pageLanguage: "en" }); assert.equal(h.replies().at(-1)?.status, "stale");
      h.delivery.cancelFunctionNarratives(h.request); await pending; assert.equal(h.replies().at(-1)?.status, "cancelled"); assert.equal(h.storedPages(), 0); assert.equal(h.replies().at(-1)?.coverage?.completed, 0);
      h.setMode("complete"); await h.delivery.requestFunctionNarratives({ ...h.request, requestId: 3 }); assert.equal(h.replies().at(-1)?.status, "ready");
      const pid = h.inputs.at(-1)!.pid; assert.deepEqual(h.inputs.find(input => input.pid === pid)!.source.callTask.earlierModelReadings, []);
      assert.equal(h.events.filter(event => event.event === "actual-close").length, 2); t.diagnostic(JSON.stringify({ actualFixtureExits: await fixture.reports(), actualChildEvents: h.events }));
    } finally { h.delivery.cancelFunctionNarratives(h.request); await pending.catch(() => {}); await h.close(); }
  });
});

test("source mutation after call priors plus invalid native close proof remains stale and never sends a root packet", async t => {
  await withCompleteNativeNarrativeWorker(async fixture => {
    const h = await rootHost(fixture, { mode: "bad-close", onEvent(event, host) { if (event.event === "response" && event.uid === 5) { host.files[1].content += "// source changed"; host.state.revision++; } } });
    try {
      await h.delivery.requestFunctionNarratives(h.request); assert.equal(h.replies().at(-1)?.status, "stale"); assert.ok(!h.replies().some(reply => reply.narrative)); assert.equal(h.storedPages(), 0);
      assert.equal(h.inputs.filter(input => input.kind === "root").length, 0); assert.ok(h.events.some(event => event.event === "actual-close"));
      t.diagnostic(JSON.stringify({ actualFixtureExits: await fixture.reports(), actualChildEvents: h.events }));
    } finally { await h.close(); }
  });
});

test("manager disposal cancels the same root action's real call-source file I/O and waits for I/O and actual child close", async t => {
  await withCompleteNativeNarrativeWorker(async fixture => {
    const entered = nativeGate(), io = nativeGate(), closed = nativeGate(); let observed!: AbortSignal, disposed = false;
    const h = await rootHost(fixture, { onEvent(event) { if (event.event === "actual-close") closed.release(); } });
    const read = h.access.readFileText; h.access.readFileText = async (file, signal) => { observed = signal; entered.release(); await io.promise; if (signal.aborted) throw new FunctionNarrativeError("cancelled"); return read(file, signal); };
    const pending = h.delivery.requestFunctionNarratives(h.request);
    try {
      assert.equal(await Promise.race([entered.promise.then(() => true), pending.then(() => false)]), true);
      const disposal = h.manager.dispose().then(() => { disposed = true; }); await closed.promise; assert.equal(observed.aborted, true); assert.equal(disposed, false); assert.equal(h.state.disposed, 0);
      io.release(); await Promise.all([pending, disposal]); assert.equal(h.replies().at(-1)?.status, "cancelled"); assert.equal(h.storedPages(), 0); assert.equal(h.state.disposed, 1); assert.ok(!h.replies().some(reply => reply.narrative));
      t.diagnostic(JSON.stringify({ actualFixtureExits: await fixture.reports(), actualChildEvents: h.events }));
    } finally { io.release(); await pending.catch(() => {}); await h.close(); }
  });
});
