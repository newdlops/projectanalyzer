/** Actual child boundaries: full UTF-8 packets, strict ready/UID/raw limits, cancellation and real close. */
import assert from "node:assert/strict";
import test from "node:test";
import { NativeNarrativeWorker, type NativeNarrativePacket, type NativeNarrativeWorkerOptions } from "../../llm/nativeNarratives";
import { FunctionNarrativeError } from "../../shared/functionNarratives";
import { withNativeNarrativeWorker, nativeGate } from "../helpers/nativeNarrativeWorker";

const packet = (): NativeNarrativePacket => ({ schema: { type: "object" }, messages: [{ role: "user", content: '전체 원문 😀\r\n"문자열"\r끝' }] });
const code = (expected: string) => (error: unknown) => error instanceof FunctionNarrativeError && error.code === expected;

test("native construction is inert and a neural label cannot bypass admission or proof validators", async () => {
  let spawned = 0;
  const base = { command: process.execPath, args: [], modelName: "Fixture", onEvent: () => { spawned++; } };
  const worker = new NativeNarrativeWorker({ ...base, kind: "test-fixture" });
  assert.equal(worker.observation.state, "new"); assert.equal(worker.observation.pid, undefined); await worker.release();
  assert.throws(() => new NativeNarrativeWorker({ ...base, kind: "neural-worker" } as unknown as NativeNarrativeWorkerOptions), code("invalid-response"));
  const rejected = new Error("admission not granted");
  const neural = new NativeNarrativeWorker({ ...base, kind: "neural-worker", async admit() { throw rejected; }, validateReady() {}, validateReply() {}, validateClosed() {} });
  await assert.rejects(neural.prepare(new AbortController().signal), error => error === rejected); await neural.release();
  assert.equal(neural.observation.pid, undefined); assert.equal(spawned, 0);
});

test("native requests keep all source bytes, actual response strings and independent UIDs across split UTF-8", async () => {
  await withNativeNarrativeWorker(async options => {
    const worker = new NativeNarrativeWorker(options("split-utf8")), signal = new AbortController().signal, inputs: string[] = [];
    const data = packet(), before = JSON.stringify(data);
    try {
      for (let index = 0; index < 2; index++) {
        const response = await worker.generate({ requestId: "owned-" + index, payload: data }, signal);
        const value = JSON.parse(response.text); assert.equal(response.requestId, "owned-" + index); assert.equal(value.uid, index);
        assert.deepEqual(value.payload, data); inputs.push(value.text);
      }
      assert.deepEqual(inputs, ['시험 😀 "문자열"\r\n그대로', '시험 😀 "문자열"\r\n그대로']); assert.equal(JSON.stringify(data), before);
    } finally { await worker.release(); }
    assert.equal(worker.observation.requests, 2); assert.equal(worker.observation.actualCloseObserved, true); assert.equal(worker.observation.neuralAuthorshipProven, false);
  });
});

test("source-bearing ready is rejected only after the actual fixture child closes", async () => {
  await withNativeNarrativeWorker(async options => {
    const worker = new NativeNarrativeWorker(options("bad-ready"));
    await assert.rejects(worker.prepare(new AbortController().signal), code("invalid-response"));
    assert.equal(worker.observation.actualCloseObserved, true); await assert.rejects(worker.release(), code("invalid-response"));
  });
});

test("a wrong UID keeps its failed request owned until actual termination even when SIGTERM is ignored", async () => {
  await withNativeNarrativeWorker(async options => {
    const badLine = nativeGate(), worker = new NativeNarrativeWorker({ ...options("wrong-uid"), journal(event) {
      if (event.direction === "output" && event.raw.includes('"replies"')) badLine.release();
    } });
    let settled = false;
    const request = worker.generate({ requestId: "wrong-uid", payload: packet() }, new AbortController().signal).finally(() => { settled = true; });
    const rejected = assert.rejects(request, code("invalid-response"));
    await badLine.promise; assert.equal(settled, false); assert.equal(worker.observation.actualCloseObserved, false);
    await rejected; assert.equal(worker.observation.actualCloseObserved, true); assert.equal(worker.observation.closedSignal, "SIGKILL"); await assert.rejects(worker.release(), code("invalid-response"));
  });
});

test("a close receipt cannot settle release or authorize reuse while its process remains alive", async () => {
  await withNativeNarrativeWorker(async options => {
    const receipt = nativeGate(), worker = new NativeNarrativeWorker({ ...options("close-before-exit"), killGraceMs: 1000,
      onEvent(event) { if (event.event === "close-receipt") receipt.release(); } });
    const signal = new AbortController().signal; await worker.prepare(signal); let settled = false;
    const closing = worker.release().then(() => { settled = true; });
    await receipt.promise; assert.equal(worker.observation.actualCloseObserved, false); assert.equal(settled, false);
    await closing; await worker.release(); assert.equal(worker.observation.actualCloseObserved, true);
    await assert.rejects(worker.prepare(signal), code("failed"));
  });
});

for (const mode of ["malformed", "invalid-utf8", "oversized-line", "oversized-content", "unterminated", "negative-zero"]) {
  test("native " + mode + " response cannot be normalized into a successful request", async () => {
    await withNativeNarrativeWorker(async options => {
      const worker = new NativeNarrativeWorker(options(mode));
      try { await assert.rejects(worker.generate({ requestId: mode, payload: packet() }, new AbortController().signal), error => error instanceof FunctionNarrativeError); }
      finally { await worker.release().catch(() => {}); }
      assert.equal(worker.observation.actualCloseObserved, true);
    });
  });
}

test("duplicate output after one valid reply cannot regain action success through release", async () => {
  await withNativeNarrativeWorker(async options => {
    const worker = new NativeNarrativeWorker(options("duplicate"));
    await worker.generate({ requestId: "duplicate", payload: packet() }, new AbortController().signal);
    await assert.rejects(worker.release(), code("invalid-response")); assert.equal(worker.observation.actualCloseObserved, true);
  });
});

test("the UTF-8 input byte limit fails the whole request before any prefix is written", async () => {
  await withNativeNarrativeWorker(async options => {
    let writes = 0; const worker = new NativeNarrativeWorker({ ...options(), journal(event) { if (event.direction === "input") writes++; } });
    try {
      const data = packet(); data.messages = [{ role: "user", content: "😀".repeat(50_000) }];
      await assert.rejects(worker.generate({ requestId: "too-large", payload: data }, new AbortController().signal), code("context-too-large")); assert.equal(writes, 0);
    } finally { await worker.release(); }
  });
});

test("source packet capabilities are rejected without invoking their getters or writing a request", async () => {
  await withNativeNarrativeWorker(async options => {
    let called = 0, writes = 0; const worker = new NativeNarrativeWorker({ ...options(), journal(event) { if (event.direction === "input") writes++; } });
    const data = packet(); Object.defineProperty(data.schema, "answer", { enumerable: true, get() { called++; return "forbidden"; } });
    try { await assert.rejects(worker.generate({ requestId: "getter", payload: data }, new AbortController().signal), code("invalid-response")); }
    finally { await worker.release(); }
    assert.equal(called, 0); assert.equal(writes, 0);
  });
});

test("release during admission revokes a late spawn and the pending prepare promise", async () => {
  await withNativeNarrativeWorker(async options => {
    const entered = nativeGate(), admission = nativeGate(); let spawned = 0;
    const worker = new NativeNarrativeWorker({ ...options(), async admit() { entered.release(); await admission.promise; }, onEvent(event) { if (event.event === "spawn") spawned++; } });
    const preparing = worker.prepare(new AbortController().signal).then(() => ({ error: undefined }), error => ({ error: error as unknown }));
    await entered.promise; const closing = worker.release(); admission.release(); await closing; const result = await preparing;
    assert.ok(code("cancelled")(result.error));
    assert.equal(spawned, 0); assert.equal(worker.observation.pid, undefined);
  });
});

test("hidden source getters cannot be silently omitted or invoked by packet serialization", async () => {
  await withNativeNarrativeWorker(async options => {
    let called = 0, writes = 0; const worker = new NativeNarrativeWorker({ ...options(), journal(event) { if (event.direction === "input") writes++; } });
    const value = packet(); Object.defineProperty(value, "schema", { enumerable: false, get() { called++; return {}; } });
    try { await assert.rejects(worker.generate({ requestId: "hidden", payload: value }, new AbortController().signal), code("invalid-response")); }
    finally { await worker.release(); }
    assert.equal(called, 0); assert.equal(writes, 0);
  });
});

test("request timeout waits through bounded force-kill and actual process close", async () => {
  await withNativeNarrativeWorker(async options => {
    const worker = new NativeNarrativeWorker({ ...options("ignore-term"), requestTimeoutMs: 40, killGraceMs: 40 });
    await assert.rejects(worker.generate({ requestId: "timeout", payload: packet() }, new AbortController().signal), code("timeout"));
    assert.equal(worker.observation.actualCloseObserved, true); assert.equal(worker.observation.closedSignal, "SIGKILL"); await assert.rejects(worker.release(), code("timeout"));
  });
});

test("a failed executable spawn reaches actual close without pretending a worker PID existed", async () => {
  const worker = new NativeNarrativeWorker({ command: "/nonexistent/project-analyzer-native-worker", args: [], kind: "test-fixture", modelName: "Fixture" });
  await assert.rejects(worker.prepare(new AbortController().signal), code("unavailable")); assert.equal(worker.observation.pid, undefined);
  assert.equal(worker.observation.actualCloseObserved, true); await assert.rejects(worker.release(), code("unavailable"));
});

test("a rejected close proof retains its original cause after actual process closure", async () => {
  await withNativeNarrativeWorker(async options => {
    const original = new Error("independent close proof failed"), worker = new NativeNarrativeWorker({ ...options(), validateClosed() { throw original; } });
    await worker.prepare(new AbortController().signal);
    await assert.rejects(worker.release(), error => error instanceof FunctionNarrativeError && error.detailCode === "worker-close-proof" && error.cause === original);
    assert.equal(worker.observation.actualCloseObserved, true);
  });
});
