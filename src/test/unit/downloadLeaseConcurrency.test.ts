/** Real filesystem regression for simultaneous recovery of an actually exited lease owner. */
import assert from "node:assert/strict";
import { promises as fileSystem } from "node:fs";
import { chmod, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { acquireDownloadLease } from "../../storage/localModels/downloadLease";
import { startModelCacheLeaseChild } from "./helpers/modelCacheLeaseChild";
import { startDownloadLeaseRecoveryChild, type DownloadLeaseRecoveryChild } from "./helpers/downloadLeaseRecoveryChild";

/** Coordinate actual I/O boundaries without replacing file contents or process identity. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

/** Observation expiry is a failure; it never asserts process termination or a released lease. */
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Lease recovery observation expired")), 4000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

test("simultaneous stale-owner recoverers preserve the newly acquired live lease", { timeout: 12000 }, async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "pa-lease-recovery-"));
  const lock = path.join(directory, "fixture.lock");
  const child = await startModelCacheLeaseChild(lock);
  const controllers = [new AbortController(), new AbortController()];
  const releases = new Set<() => Promise<void>>();
  const firstRead = deferred(), secondBoundary = deferred<"stale-read" | "waiting">();
  const continueFirst = deferred(), continueSecond = deferred(), waitingWhileHeld = deferred();
  let staleReads = 0, holderAcquired = false;
  let first: Promise<() => Promise<void>> | undefined, second: Promise<() => Promise<void>> | undefined;
  const originalRead = fileSystem.readFile.bind(fileSystem);
  try {
    const closed = await child.exitWithoutRelease();
    assert.deepEqual(closed, { code: 0, signal: null });
    assert.throws(() => process.kill(child.pid, 0), (error: unknown) =>
      !!error && typeof error === "object" && "code" in error && error.code === "ESRCH");
    const staleOwnerText = await originalRead(lock, "utf8");
    assert.equal(JSON.parse(staleOwnerText).pid, child.pid);

    // Return exactly the bytes read by the real filesystem. Only their delivery
    // is paused, exposing the interval between owner inspection and removal.
    t.mock.method(fileSystem, "readFile", (async (...args: Parameters<typeof fileSystem.readFile>) => {
      const value = await originalRead(...args);
      if (args[0] === lock && String(value) === staleOwnerText && staleReads < 2) {
        const index = staleReads++;
        if (index === 0) { firstRead.resolve(); await continueFirst.promise; }
        else { secondBoundary.resolve("stale-read"); await continueSecond.promise; }
      }
      return value;
    }) as typeof fileSystem.readFile);

    first = acquireDownloadLease(lock, controllers[0].signal, () => {}).then((release) => {
      releases.add(release); return release;
    });
    void first.catch(() => {});
    await bounded(firstRead.promise);
    second = acquireDownloadLease(lock, controllers[1].signal, () => {
      secondBoundary.resolve("waiting");
      if (holderAcquired) waitingWhileHeld.resolve();
    }).then((release) => { releases.add(release); return release; });
    void second.catch(() => {});
    await bounded(secondBoundary.promise);
    continueFirst.resolve();
    const releaseFirst = await bounded(first);
    const actualLiveOwner = await originalRead(lock, "utf8");
    assert.equal(JSON.parse(actualLiveOwner).pid, process.pid);
    holderAcquired = true;
    continueSecond.resolve();
    const outcome = await bounded(Promise.race([
      second.then(() => "acquired" as const), waitingWhileHeld.promise.then(() => "waiting" as const)
    ]));
    assert.equal(outcome, "waiting", "another stale read must not remove the current holder's lock");
    assert.equal(await originalRead(lock, "utf8"), actualLiveOwner);
    await releaseFirst();
    const releaseSecond = await bounded(second);
    await releaseSecond();
    assert.deepEqual(await readdir(directory), []);
    t.diagnostic(JSON.stringify({ actualExitedOwnerPid: child.pid, actualStaleReads: staleReads,
      observedSecondContender: outcome, modelLoads: 0 }));
  } finally {
    controllers.forEach((controller) => controller.abort());
    continueFirst.resolve(); continueSecond.resolve();
    t.mock.restoreAll();
    await Promise.allSettled([first, second].filter((value): value is Promise<() => Promise<void>> => !!value));
    await Promise.all([...releases].map((release) => release()));
    await child.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

/** An exited fixture PID must actually be absent; a timeout/intent is not proof of death. */
function assertAbsent(pid: number): void {
  assert.throws(() => process.kill(pid, 0), (error: unknown) =>
    !!error && typeof error === "object" && "code" in error && error.code === "ESRCH");
}

test("distinct processes recovering the same exited owner remain mutually exclusive", { timeout: 15000 }, async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "pa-lease-process-recovery-"));
  const lock = path.join(directory, "fixture.lock");
  const old = await startModelCacheLeaseChild(lock);
  let first: DownloadLeaseRecoveryChild | undefined, second: DownloadLeaseRecoveryChild | undefined;
  try {
    const exited = await old.exitWithoutRelease(); assertAbsent(old.pid);
    const stale = await readFile(lock, "utf8");
    first = await startDownloadLeaseRecoveryChild(lock, "stale-read", stale);
    const firstRead = await bounded(first.paused);
    second = await startDownloadLeaseRecoveryChild(lock, "stale-read", stale);
    const secondRead = await bounded(second.paused);
    assert.notEqual(first.pid, second.pid); assert.notEqual(first.pid, process.pid); assert.notEqual(second.pid, process.pid);
    assert.equal(firstRead.filePath, lock); assert.equal(secondRead.filePath, lock);
    assert.equal(firstRead.readSha256, secondRead.readSha256);
    await first.continue(); await bounded(first.acquired);
    const firstOwner = await readFile(lock, "utf8"); assert.equal(JSON.parse(firstOwner).pid, first.pid);
    await second.continue();
    const outcome = await bounded(Promise.race([
      second.acquired.then(() => "acquired" as const), second.waiting.then(() => "waiting" as const)
    ]));
    assert.equal(outcome, "waiting"); assert.equal(await readFile(lock, "utf8"), firstOwner);
    const firstClosed = await first.release(); assertAbsent(first.pid);
    await bounded(second.acquired); assert.equal(JSON.parse(await readFile(lock, "utf8")).pid, second.pid);
    const secondClosed = await second.release(); assertAbsent(second.pid);
    assert.deepEqual(await readdir(directory), []);
    t.diagnostic(JSON.stringify({ case: "cross-process-recovery", actualExitedOwnerPid: old.pid, exited,
      actualContenderPids: [first.pid, second.pid], firstClosed, secondClosed,
      scriptSha256: first.scriptSha256, outcome, modelLoads: 0 }));
  } finally {
    await first?.dispose(); await second?.dispose(); await old.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("cancelling a gate waiter preserves a live choosing participant and recovers it only after actual exit", { timeout: 15000 }, async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "pa-lease-choosing-"));
  const lock = path.join(directory, "fixture.lock"), controller = new AbortController();
  const child = await startDownloadLeaseRecoveryChild(lock, "choosing");
  let pending: Promise<() => Promise<void>> | undefined, release: (() => Promise<void>) | undefined;
  try {
    const paused = await bounded(child.paused);
    assert.ok(paused.filePath && path.dirname(paused.filePath) === lock + ".queue");
    assert.ok(path.basename(paused.filePath).startsWith(`${child.pid}-`));
    const original = await stat(paused.filePath); assert.equal(original.size, 0);
    const waiting = deferred();
    pending = acquireDownloadLease(lock, controller.signal, () => { waiting.resolve(); });
    void pending.catch(() => {});
    await bounded(waiting.promise); controller.abort();
    await assert.rejects(pending, (error: unknown) => !!error && typeof error === "object" && "code" in error && error.code === "cancelled");
    assert.doesNotThrow(() => process.kill(child.pid, 0));
    assert.equal((await stat(paused.filePath)).ino, original.ino);
    const liveFiles = await readdir(lock + ".queue");
    assert.equal(liveFiles.length, 1); assert.equal(liveFiles[0], path.basename(paused.filePath));
    const closed = await child.exitWithoutRelease(); assertAbsent(child.pid);
    assert.equal((await stat(paused.filePath)).ino, original.ino);
    release = await bounded(acquireDownloadLease(lock, new AbortController().signal, () => {}));
    assert.equal(JSON.parse(await readFile(lock, "utf8")).pid, process.pid);
    await release(); release = undefined;
    assert.deepEqual(await readdir(directory), []);
    t.diagnostic(JSON.stringify({ case: "choosing-cancel-and-exit", actualChildPid: child.pid, closed,
      scriptSha256: child.scriptSha256, liveParticipantPreserved: true, deadParticipantRecovered: true, modelLoads: 0 }));
  } finally {
    controller.abort(); await pending?.catch(() => {}); await release?.(); await child.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("failed gate cleanup revokes an undelivered lease and remains recoverable after permission repair", async (t) => {
  if (process.platform === "win32" || process.getuid?.() === 0) { t.skip("Requires effective POSIX directory permissions"); return; }
  const directory = await mkdtemp(path.join(tmpdir(), "pa-lease-gate-cleanup-"));
  const lock = path.join(directory, "fixture.lock"), queue = lock + ".queue";
  const originalRename = fileSystem.rename.bind(fileSystem);
  let blocked = false, release: (() => Promise<void>) | undefined;
  try {
    t.mock.method(fileSystem, "rename", async (...args: Parameters<typeof fileSystem.rename>) => {
      const result = await originalRename(...args);
      if (!blocked && path.dirname(String(args[1])) === queue) { blocked = true; await chmod(queue, 0o500); }
      return result;
    });
    await assert.rejects(acquireDownloadLease(lock, new AbortController().signal, () => {}),
      (error: unknown) => !!error && typeof error === "object" && "code" in error && ["EACCES", "EPERM"].includes(String(error.code)));
    assert.equal(blocked, true);
    const undelivered = JSON.parse(await readFile(lock, "utf8")); assert.equal(undelivered.pid, process.pid);
    assert.equal((await readdir(queue)).length, 1);
    t.mock.restoreAll(); await chmod(queue, 0o700);
    release = await bounded(acquireDownloadLease(lock, new AbortController().signal, () => {}));
    const replacement = JSON.parse(await readFile(lock, "utf8"));
    assert.equal(replacement.pid, process.pid); assert.notEqual(replacement.token, undelivered.token);
    await release(); release = undefined;
    assert.deepEqual(await readdir(directory), []);
    t.diagnostic(JSON.stringify({ case: "gate-permission-repair", actualDeniedCleanup: blocked,
      newOwnerToken: replacement.token !== undelivered.token, modelLoads: 0 }));
  } finally {
    t.mock.restoreAll(); await chmod(queue, 0o700).catch(() => {}); await release?.();
    await rm(directory, { recursive: true, force: true });
  }
});
