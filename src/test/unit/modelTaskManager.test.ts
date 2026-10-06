/** Cross-owner serialization, execution deadlines, cleanup and bounded metadata invariants. */
import assert from "node:assert/strict";
import test from "node:test";
import { ModelTaskManager, ModelTaskError, isModelTaskProgress, type ModelTaskProgress } from "../../shared/modelTasks";

/** Deferred work makes queue/cleanup assertions deterministic without timing-dependent sleeps. */
function gate<T = void>() { let resolve!: (value: T | PromiseLike<T>) => void; const promise = new Promise<T>(accept => { resolve = accept; }); return { promise, resolve }; }
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

test("different owners run FIFO with one execution and never preempt earlier work", async () => {
  const manager = new ModelTaskManager(), release = gate(), entered: string[] = [], progress: ModelTaskProgress[] = [];
  let active = 0, maximum = 0;
  const run = (label: string) => manager.run({ kind: "inference", label, signal: new AbortController().signal, onProgress: value => progress.push(value),
    async execute(signal) { entered.push(label); maximum = Math.max(maximum, ++active); if (label === "first") await release.promise; assert.equal(signal.aborted, false); active--; return label; } });
  const first = run("first"), second = run("second"), third = run("third");
  await flush(); assert.deepEqual(entered, ["first"]); assert.equal(manager.snapshot().waiting.length, 2);
  release.resolve(); assert.deepEqual(await Promise.all([first, second, third]), ["first", "second", "third"]);
  assert.deepEqual(entered, ["first", "second", "third"]); assert.equal(maximum, 1); assert.ok(progress.every(isModelTaskProgress));
  assert.deepEqual(manager.snapshot().history.map(record => record.phase), ["completed", "completed", "completed"]);
});

test("queued cancellation never invokes its adapter and updates the remaining waiting positions", async () => {
  const manager = new ModelTaskManager(), release = gate(), parent = new AbortController(), positions: number[] = [];
  const first = manager.run({ kind: "prepare", label: "setup", signal: new AbortController().signal, execute: () => release.promise });
  let invoked = false;
  const second = manager.run({ kind: "inference", label: "cancelled", signal: parent.signal, async execute() { invoked = true; } });
  const rejected = assert.rejects(second, error => error instanceof ModelTaskError && error.code === "cancelled");
  const third = manager.run({ kind: "inference", label: "retained", signal: new AbortController().signal,
    onProgress(progress) { if (progress.phase === "queued") positions.push(progress.position); }, async execute() { return "retained"; } });
  parent.abort(); await rejected; assert.equal(invoked, false); assert.ok(positions.includes(2) && positions.includes(1));
  release.resolve(); await first; assert.equal(await third, "retained");
});

test("queue waiting is outside timeout and the next operation waits for cancelled adapter cleanup", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const manager = new ModelTaskManager(), release = gate(), drain = gate();
  const first = manager.run({ kind: "inference", label: "long owner", signal: new AbortController().signal, execute: () => release.promise });
  let secondStarted = false, thirdStarted = false;
  const second = manager.run({ kind: "inference", label: "bounded owner", signal: new AbortController().signal, timeoutMs: 10,
    async execute(signal) { secondStarted = true; await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true })); await drain.promise; } });
  const rejected = assert.rejects(second, error => error instanceof ModelTaskError && error.code === "timeout");
  const third = manager.run({ kind: "inference", label: "next owner", signal: new AbortController().signal, async execute() { thirdStarted = true; } });
  await flush(); t.mock.timers.tick(1000); await flush(); assert.equal(secondStarted, false);
  release.resolve(); await first; await flush(); assert.equal(secondStarted, true);
  t.mock.timers.tick(9); await flush(); assert.equal(manager.snapshot().active?.phase, "running");
  t.mock.timers.tick(1); await flush(); assert.equal(manager.snapshot().active?.phase, "cancelling"); assert.equal(thirdStarted, false);
  drain.resolve(); await rejected; await third; assert.equal(thirdStarted, true);
});

test("failed work does not poison the queue or retain source/response/error text in diagnostic history", async () => {
  const manager = new ModelTaskManager({ historyLimit: 2 });
  const subscription = manager.subscribe(() => { throw new Error("observer failure"); });
  await assert.rejects(manager.run({ kind: "inference", label: "failed", signal: new AbortController().signal,
    async execute() { throw Object.assign(new Error("private prompt and response"), { code: "invalid-response" }); } }), { message: "private prompt and response" });
  assert.equal(manager.snapshot().history[0].failure, "invalid-response");
  for (let index = 0; index < 40; index++) assert.equal(await manager.run({ kind: "inference", label: "work", signal: new AbortController().signal, async execute() { return "private response"; } }), "private response");
  assert.equal(manager.snapshot().history.length, 2); assert.doesNotMatch(JSON.stringify(manager.snapshot()), /private|prompt|response/u);
  subscription.dispose();
});

test("bounded admission and awaited disposal stop queued work and drain the running adapter", async () => {
  const manager = new ModelTaskManager({ maxWaiting: 1 }), drain = gate(); let queuedStarted = false;
  const first = manager.run({ kind: "inference", label: "active", signal: new AbortController().signal,
    async execute(signal) { await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true })); await drain.promise; } });
  const firstRejected = assert.rejects(first, { message: "cancelled" });
  const second = manager.run({ kind: "inference", label: "waiting", signal: new AbortController().signal, async execute() { queuedStarted = true; } });
  const secondRejected = assert.rejects(second, { message: "cancelled" });
  await assert.rejects(manager.run({ kind: "inference", label: "overflow", signal: new AbortController().signal, async execute() {} }), { message: "queue-full" });
  await flush(); let disposed = false; const shutdown = manager.dispose().then(() => { disposed = true; });
  await secondRejected; await flush(); assert.equal(disposed, false); assert.equal(queuedStarted, false);
  drain.resolve(); await firstRejected; await shutdown; assert.equal(manager.idle, true);
  await assert.rejects(manager.run({ kind: "inference", label: "late", signal: new AbortController().signal, async execute() {} }), { message: "disposed" });
});

test("progress contracts reject forged positions, terminal states and extra source data", () => {
  const progress = { id: "model-task:1", kind: "inference", phase: "queued", position: 1, waiting: 2 };
  assert.equal(isModelTaskProgress(progress), true);
  for (const value of [{ ...progress, position: 0 }, { ...progress, position: 3 }, { ...progress, waiting: 33 }, { ...progress, phase: "completed" },
    { ...progress, source: "private" }, { ...progress, id: "unknown" }, { ...progress, kind: ["inference"] },
    { ...progress, phase: ["queued"] }]) assert.equal(isModelTaskProgress(value), false);
  for (const limit of [0, 33, NaN]) assert.throws(() => new ModelTaskManager({ maxWaiting: limit }), RangeError);
});

test("observer snapshots cannot mutate a running task or another observer's history", async () => {
  const manager = new ModelTaskManager(), release = gate();
  const job = manager.run({ kind: "inference", label: "kept", signal: new AbortController().signal, execute: () => release.promise });
  const before = manager.snapshot();
  assert.ok(Object.isFrozen(before) && Object.isFrozen(before.active) && Object.isFrozen(before.waiting));
  assert.throws(() => { (before.active as { label: string }).label = "overwritten"; }, TypeError);
  release.resolve(); await job;
  const after = manager.snapshot();
  assert.ok(Object.isFrozen(after.history) && Object.isFrozen(after.history[0]));
  assert.equal(after.history[0].label, "kept");
  assert.equal(before.active?.phase, "running", "a retained snapshot must not change after completion");
});
