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
