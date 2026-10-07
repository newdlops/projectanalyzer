/** Resource reuse tests prove that a warm adapter cannot outlive idle/shutdown or overlap the next owner. */
import assert from "node:assert/strict";
import test from "node:test";
import { ModelTaskManager } from "../../shared/modelTasks";

function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
const signal = () => new AbortController().signal;

test("consecutive chunks reuse one resource and idle teardown is awaited during shutdown", async () => {
  const manager = new ModelTaskManager(); let releases = 0;
  const resource = { async release() { releases++; } };
  await manager.run({ kind: "inference", label: "first", signal: signal(), resource, async execute() { return 1; } });
  await manager.run({ kind: "inference", label: "next", signal: signal(), resource, async execute() { assert.equal(releases, 0); return 2; } });
  await manager.dispose(); assert.equal(releases, 1); assert.equal(manager.shutdownComplete, true);
  assert.doesNotMatch(JSON.stringify(manager.snapshot()), /resource|release/);
});

test("a different adapter cannot execute until the old reusable resource finishes reaping", async () => {
  const manager = new ModelTaskManager(), closing = deferred(), reaped = deferred(); let nextStarted = false;
  const resource = { async release() { closing.resolve(); await reaped.promise; } };
  const first = manager.run({ kind: "inference", label: "first", signal: signal(), resource, async execute() { return 1; } });
  const next = manager.run({ kind: "inference", label: "different", signal: signal(), async execute() { nextStarted = true; return 2; } });
  await first; await closing.promise; assert.equal(nextStarted, false); reaped.resolve(); assert.equal(await next, 2); await manager.dispose();
});

test("cancellation holds the execution slot through warm-resource termination", async () => {
  const manager = new ModelTaskManager(), controller = new AbortController(), started = deferred(), closing = deferred(), reaped = deferred(); let nextStarted = false;
  const resource = { async release() { closing.resolve(); await reaped.promise; } };
  const first = manager.run({ kind: "inference", label: "first", signal: controller.signal, resource, async execute(operation) {
    started.resolve(); await new Promise<void>((_resolve, reject) => operation.addEventListener("abort", () => reject(new Error("stop")), { once: true }));
  } });
  const rejected = assert.rejects(first, { message: "cancelled" }); await started.promise;
  const next = manager.run({ kind: "inference", label: "next", signal: signal(), async execute() { nextStarted = true; } });
  controller.abort(); await closing.promise; assert.equal(nextStarted, false); reaped.resolve(); await rejected; await next; await manager.dispose();
});

test("an idle resource is released without further generation and shutdown cannot finish early", async () => {
  const manager = new ModelTaskManager(), closing = deferred(), reaped = deferred();
  const resource = { async release() { closing.resolve(); await reaped.promise; } };
  await manager.run({ kind: "inference", label: "one", signal: signal(), resource, async execute() {} });
  await closing.promise;
  const shutdown = manager.dispose(); assert.equal(manager.shutdownComplete, false); reaped.resolve(); await shutdown; assert.equal(manager.shutdownComplete, true);
});

test("an explicit resource scope survives asynchronous gaps, preserves FIFO switching and releases before scope completion", async () => {
  const manager = new ModelTaskManager(); let releases = 0;
  const resource = { async release() { releases++; } };
  await manager.withResource(resource, async () => {
    await manager.run({ kind: "inference", label: "first", signal: signal(), resource, async execute() {} });
    await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(releases, 0);
    await manager.run({ kind: "inference", label: "other", signal: signal(), async execute() { assert.equal(releases, 1); } });
    await manager.run({ kind: "inference", label: "resume", signal: signal(), resource, async execute() {} });
    await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(releases, 1);
  });
  assert.equal(releases, 2); await manager.dispose(); assert.equal(releases, 2);
});

test("failed work releases a retained model immediately and shutdown overrides an unfinished scope", async () => {
  const manager = new ModelTaskManager(); let releases = 0;
  const resource = { async release() { releases++; } };
  await manager.withResource(resource, async () => {
    await assert.rejects(manager.run({ kind: "inference", label: "fail", signal: signal(), resource,
      async execute() { throw new Error("expected"); } }), /expected/);
    assert.equal(releases, 1);
    await manager.run({ kind: "inference", label: "next", signal: signal(), resource, async execute() {} });
    await manager.dispose(); assert.equal(releases, 2);
  });
  assert.equal(manager.shutdownComplete, true); assert.equal(releases, 2);
});

test("cancelling a page in an asynchronous gap reaps its idle model before the page callback settles", async () => {
  const manager = new ModelTaskManager(), controller = new AbortController(), gap = deferred(), entered = deferred(), closing = deferred(), reaped = deferred();
  let releases = 0, finished = false, nextStarted = false;
  const resource = { async release() { releases++; closing.resolve(); await reaped.promise; } };
  const page = manager.withResource(resource, async () => {
    await manager.run({ kind: "inference", label: "one", signal: controller.signal, resource, async execute() {} });
    entered.resolve(); await gap.promise;
  }, controller.signal).then(() => { finished = true; });
  await entered.promise; controller.abort(); await closing.promise;
  assert.equal(finished, false);
  const next = manager.run({ kind: "inference", label: "other", signal: signal(), async execute() { nextStarted = true; } });
  await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(nextStarted, false);
  reaped.resolve(); await next; gap.resolve(); await page; await manager.dispose(); assert.equal(releases, 1);
});

test("cancelling one page lease preserves another owner of the same model", async () => {
  const manager = new ModelTaskManager(), first = new AbortController(), gap = deferred(), entered = deferred(); let releases = 0;
  const resource = { async release() { releases++; } };
  await manager.withResource(resource, async () => {
    const inner = manager.withResource(resource, async () => {
      await manager.run({ kind: "inference", label: "one", signal: first.signal, resource, async execute() {} });
      entered.resolve(); await gap.promise;
    }, first.signal);
    await entered.promise; first.abort(); await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(releases, 0); gap.resolve(); await inner;
  });
  assert.equal(releases, 1); await manager.dispose();
});
