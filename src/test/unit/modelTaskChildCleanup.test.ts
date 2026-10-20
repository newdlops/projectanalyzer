/** Actual inert Node children exercise portable scheduler cleanup; these are never Model/native-readiness fixtures. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import test from "node:test";
import { getGlobalModelTaskManager, ModelTaskError, ModelTaskManager } from "../../shared/modelTasks";

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
const signal = () => new AbortController().signal;
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const missing = (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT";
type InertChild = { pid: number; isClosed(): boolean; stop(): Promise<void> };

/** Require the real acknowledged fixture handle before observing its PID or close event. */
function owned(child: InertChild | undefined): InertChild { assert.ok(child);return child; }

/** Own one small real process until stdin EOF; parent death also closes that pipe and cannot orphan the fixture. */
async function inertChild(label: string, events: string[]): Promise<InertChild> {
  const child = spawn(process.execPath, ["--max-old-space-size=32", "-e",
    "console.log(JSON.stringify({inertSchedulerChild:true,pid:process.pid}));process.stdin.resume();process.stdin.once('end',()=>process.exit(0));"],
  { shell: false, stdio: ["pipe", "pipe", "ignore"] });
  let closed = false, exitCode: number | null = null, exitSignal: NodeJS.Signals | null = null;
  const ended = new Promise<void>(resolve => child.once("close", (code, reason) => {
    closed = true; exitCode = code; exitSignal = reason; events.push(label + ":close"); resolve();
  }));
  const lines = createInterface({ input: child.stdout });
  const online = new Promise<string>((resolve, reject) => {
    lines.once("line", resolve);child.once("error", reject);
    child.once("close", () => reject(new Error("Inert scheduler child closed before its online line")));
  });
  let stopping: Promise<void> | undefined;
  const stop = () => stopping ??= (async () => {
    if (!closed) child.stdin.end();
    const force = setTimeout(() => { if (!closed) child.kill("SIGKILL"); }, 2000);force.unref();
    try { await ended; } finally { clearTimeout(force); }
    assert.equal(exitCode, 0);assert.equal(exitSignal, null);
  })();
  try {
    const row = JSON.parse(await online) as { inertSchedulerChild?: unknown; pid?: unknown };
    assert.equal(row.inertSchedulerChild, true);assert.equal(row.pid, child.pid);
    assert.ok(Number.isSafeInteger(child.pid) && child.pid! > 0);
    assert.equal(closed, false);events.push(label + ":online");
    return { pid: child.pid!, isClosed: () => closed, stop };
  } catch (error) { await stop().catch(() => {});throw error; }
  finally { lines.close(); }
}

test("a real cleanup ENOENT retains the live child until retry closes it before the next child starts", { timeout: 10000 }, async t => {
  const manager = new ModelTaskManager(), events: string[] = [], closeGate = gate();
  const directory = await mkdtemp(join(tmpdir(), "pa-task-child-"));
  let first: InertChild | undefined, next: InertChild | undefined, releases = 0;
  const oldResource = { async release() {
    if (++releases === 1) await stat(join(directory, "absent-cleanup-input"));
    await closeGate.promise;await first?.stop();
  } };
  const nextResource = { async release() { await next?.stop(); } };
  try {
    await manager.withResource(oldResource, async () => {
      await manager.run({ kind: "prepare", label: "inert old child", signal: signal(), resource: oldResource,
        async execute() { first = await inertChild("old", events); } });
      await assert.rejects(manager.run({ kind: "prepare", label: "rejected child switch", signal: signal(), resource: nextResource,
        async execute() { next = await inertChild("next", events); } }), missing);
      assert.equal(Boolean(next), false);assert.equal(owned(first).isClosed(), false);assert.equal(releases, 1);
      const retry = manager.run({ kind: "prepare", label: "retry child switch", signal: signal(), resource: nextResource,
        async execute() {
          assert.equal(owned(first).isClosed(), true);next = await inertChild("next", events);
        } });
      void retry.catch(() => {});await flush();
      assert.equal(releases, 2);assert.equal(Boolean(next), false);assert.equal(owned(first).isClosed(), false);
      closeGate.resolve();await retry;
      assert.ok(events.indexOf("old:close") < events.indexOf("next:online"));
    });
    await manager.dispose();assert.equal(owned(next).isClosed(), true);
    t.diagnostic(JSON.stringify({ actualInertNodeChildLifecycle: true, case: "cleanup-failure-retry",
      childPids: [owned(first).pid, owned(next).pid], events, allChildrenClosed: true, modelLoads: 0 }));
  } finally {
    closeGate.resolve();await manager.dispose().catch(() => {});
    await first?.stop();await next?.stop();await rm(directory, { recursive: true, force: true });
  }
});

test("failed shutdown keeps the global owner while its real child is alive and replacement waits for close", { timeout: 10000 }, async t => {
  const manager = getGlobalModelTaskManager(), events: string[] = [];
  const directory = await mkdtemp(join(tmpdir(), "pa-task-shutdown-"));
  let first: InertChild | undefined, next: InertChild | undefined, replacement: ModelTaskManager | undefined, releases = 0;
  const resource = { async release() {
    if (++releases === 1) await stat(join(directory, "absent-cleanup-input"));
    await first?.stop();
  } };
  try {
    await manager.run({ kind: "prepare", label: "inert global child", signal: signal(), resource,
      async execute() { first = await inertChild("global-old", events); } });
    await assert.rejects(manager.dispose(), missing);
    assert.equal(manager.shutdownComplete, false);assert.equal(owned(first).isClosed(), false);
    assert.equal(getGlobalModelTaskManager(), manager);
    await manager.dispose();assert.equal(owned(first).isClosed(), true);
    replacement = getGlobalModelTaskManager();assert.notEqual(replacement, manager);
    await replacement.run({ kind: "prepare", label: "inert replacement child", signal: signal(),
      resource: { async release() { await next?.stop(); } }, async execute() {
        assert.equal(owned(first).isClosed(), true);next = await inertChild("global-next", events);
      } });
    await replacement.dispose();assert.equal(owned(next).isClosed(), true);
    assert.ok(events.indexOf("global-old:close") < events.indexOf("global-next:online"));
    t.diagnostic(JSON.stringify({ actualInertNodeChildLifecycle: true, case: "shutdown-replacement",
      childPids: [owned(first).pid, owned(next).pid], events, allChildrenClosed: true, modelLoads: 0 }));
  } finally {
    await manager.dispose().catch(() => {});await replacement?.dispose().catch(() => {});
    await first?.stop();await next?.stop();await rm(directory, { recursive: true, force: true });
  }
});

test("cancellation retains the FIFO slot until the real child's close event, then recovery starts a new child", { timeout: 10000 }, async t => {
  const manager = new ModelTaskManager(), controller = new AbortController(), entered = gate(), closeGate = gate();
  const events: string[] = [];let first: InertChild | undefined, next: InertChild | undefined;
  const resource = { async release() { await closeGate.promise;await first?.stop(); } };
  try {
    const active = manager.run({ kind: "prepare", label: "inert cancelled child", signal: controller.signal, resource,
      async execute(operation) {
        first = await inertChild("cancelled", events);entered.resolve();
        await new Promise<void>((_resolve, reject) => {
          const abort = () => reject(new ModelTaskError("cancelled"));
          operation.addEventListener("abort", abort, { once: true });if (operation.aborted) abort();
        });
      } });
    const cancelled = assert.rejects(active, error => error instanceof ModelTaskError && error.code === "cancelled");
    await entered.promise;
    const following = manager.run({ kind: "prepare", label: "inert recovery child", signal: signal(),
      resource: { async release() { await next?.stop(); } }, async execute() {
        assert.equal(owned(first).isClosed(), true);next = await inertChild("recovered", events);
      } });
    void following.catch(() => {});controller.abort();await flush();
    assert.equal(manager.snapshot().active?.phase, "cancelling");
    assert.equal(Boolean(next), false);assert.equal(owned(first).isClosed(), false);
    closeGate.resolve();await cancelled;await following;await manager.dispose();
    assert.equal(owned(next).isClosed(), true);assert.ok(events.indexOf("cancelled:close") < events.indexOf("recovered:online"));
    t.diagnostic(JSON.stringify({ actualInertNodeChildLifecycle: true, case: "cancel-recovery",
      childPids: [owned(first).pid, owned(next).pid], events, allChildrenClosed: true, modelLoads: 0 }));
  } finally {
    closeGate.resolve();await manager.dispose().catch(() => {});await first?.stop();await next?.stop();
  }
});
