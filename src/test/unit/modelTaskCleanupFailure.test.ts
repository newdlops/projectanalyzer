/** Failed resource cleanup must retain ownership across FIFO switches, reuse, cancellation and shutdown. */
import assert from "node:assert/strict";
import test from "node:test";
import { getGlobalModelTaskManager, ModelTaskError, ModelTaskManager } from "../../shared/modelTasks";

/** Deferred cleanup proves serialization without loading a Model or relying on elapsed-time sleeps. */
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
const signal = () => new AbortController().signal;
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

test("a failed resource switch rejects the new owner and retries the same cleanup before later work", { timeout: 2000 }, async () => {
  const manager = new ModelTaskManager(), cleanupFailure = new Error("cleanup did not prove termination");
  let releases = 0, oldResourceLive = true, firstNextStarted = false;
  const resource = { async release() { if (++releases === 1) throw cleanupFailure; oldResourceLive = false; } };
  try {
    await manager.withResource(resource, async () => {
      await manager.run({ kind: "inference", label: "old", signal: signal(), resource, async execute() {} });
      await assert.rejects(manager.run({ kind: "inference", label: "next", signal: signal(),
        async execute() { firstNextStarted = true; } }), error => error === cleanupFailure);
      assert.equal(firstNextStarted, false);
      assert.equal(releases, 1, "a rejected acquisition must not silently retry cleanup again in its finalizer");
      await manager.run({ kind: "inference", label: "retry", signal: signal(), async execute() {
        assert.equal(oldResourceLive, false, "the prior resource must be closed before any new owner executes");
      } });
      assert.equal(releases, 2);
    });
  } finally { await manager.dispose(); }
});

test("the same resource cannot bypass failed idle cleanup and run while its retry is still reaping", { timeout: 2000 }, async () => {
  const manager = new ModelTaskManager(), firstRelease = gate(), reaped = gate();
  let releases = 0, resumed = false;
  const resource = { async release() {
    releases++;
    if (releases === 1) { firstRelease.resolve(); throw new Error("idle cleanup failed"); }
    if (releases === 2) await reaped.promise;
  } };
  try {
    await manager.run({ kind: "inference", label: "first", signal: signal(), resource, async execute() {} });
    await firstRelease.promise; await flush();
    const next = manager.run({ kind: "inference", label: "reuse", signal: signal(), resource, async execute() { resumed = true; } });
    void next.catch(() => {});
    await flush();
    assert.equal(releases, 2);
    assert.equal(resumed, false, "resource identity is not proof that its failed teardown completed");
    reaped.resolve(); await next; assert.equal(resumed, true);
  } finally { reaped.resolve(); await manager.dispose(); }
});

test("cancellation preserves its original outcome while a failed close still blocks the following owner", { timeout: 2000 }, async () => {
  const manager = new ModelTaskManager(), controller = new AbortController(), entered = gate(), reaped = gate();
  let releases = 0, nextStarted = false;
  const resource = { async release() {
    releases++;
    if (releases === 1) throw new Error("cancel cleanup failed");
    if (releases === 2) await reaped.promise;
  } };
  try {
    const first = manager.run({ kind: "inference", label: "cancelled", signal: controller.signal, resource,
      async execute(operation) {
        entered.resolve();
        await new Promise<void>((_resolve, reject) => operation.addEventListener("abort", () => reject(new Error("adapter cancelled")), { once: true }));
      } });
    const cancelled = assert.rejects(first, error => error instanceof ModelTaskError && error.code === "cancelled");
    await entered.promise; controller.abort(); await cancelled;
    assert.equal(releases, 1);
    const next = manager.run({ kind: "inference", label: "following", signal: signal(), async execute() { nextStarted = true; } });
    void next.catch(() => {});
    await flush();
    assert.equal(releases, 2);
    assert.equal(nextStarted, false);
    reaped.resolve(); await next; assert.equal(nextStarted, true);
  } finally { reaped.resolve(); await manager.dispose(); }
});

test("a rejected shutdown cannot let the global manager forget a resource that has not closed", { timeout: 2000 }, async () => {
  const manager = getGlobalModelTaskManager(), cleanupFailure = new Error("shutdown cleanup failed");
  let canClose = false, releases = 0;
  const resource = { async release() { releases++; if (!canClose) throw cleanupFailure; } };
  try {
    await manager.run({ kind: "inference", label: "owned", signal: signal(), resource, async execute() {} });
    await assert.rejects(manager.dispose(), error => error === cleanupFailure);
    assert.equal(manager.shutdownComplete, false);
    assert.equal(getGlobalModelTaskManager(), manager, "a failed shutdown is not permission to allocate a replacement manager");
    canClose = true; await manager.dispose(); assert.equal(releases, 2);
    assert.equal(manager.shutdownComplete, true);
    const replacement = getGlobalModelTaskManager();
    assert.notEqual(replacement, manager); await replacement.dispose();
  } finally { canClose = true; await manager.dispose(); }
});

test("a cancelled page observes failed gap cleanup without dropping ownership or an unhandled rejection", { timeout: 2000 }, async () => {
  const manager = new ModelTaskManager(), controller = new AbortController(), entered = gate(), gap = gate();
  const cleanupFailure = new Error("page gap cleanup failed"); let releases = 0;
  const resource = { async release() { if (++releases === 1) throw cleanupFailure; } };
  try {
    const page = manager.withResource(resource, async () => {
      await manager.run({ kind: "inference", label: "page", signal: controller.signal, resource, async execute() {} });
      entered.resolve(); await gap.promise;
    }, controller.signal);
    const rejected = assert.rejects(page, error => error === cleanupFailure);
    await entered.promise; controller.abort(); await flush();
    assert.equal(releases, 1);
    await manager.run({ kind: "inference", label: "after page", signal: signal(), async execute() {
      assert.equal(releases, 2, "the cancelled page's resource must be closed before the next owner runs");
    } });
    gap.resolve(); await rejected;
  } finally { gap.resolve(); await manager.dispose(); }
});

test("a failed page preserves its original operation error when its final cleanup also rejects", { timeout: 2000 }, async () => {
  const manager = new ModelTaskManager(), operationFailure = new Error("original page failure");
  const cleanupFailure = new Error("page final cleanup failed"); let canClose = false;
  const resource = { async release() { if (!canClose) throw cleanupFailure; } };
  try {
    await assert.rejects(manager.withResource(resource, async () => {
      await manager.run({ kind: "inference", label: "failed page", signal: signal(), resource,
        async execute() { throw operationFailure; } });
    }), error => error === operationFailure);
  } finally { canClose = true; await manager.dispose(); }
});
