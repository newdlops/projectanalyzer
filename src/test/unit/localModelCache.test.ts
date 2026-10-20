/** Real streamed HTTP/filesystem tests for first-use download, resume, integrity and concurrent host leases. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { get, createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { promises as fs } from "node:fs";
import { chmodSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test, { type TestContext } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createManagedLocalModelCache } from "../../storage/localModels";
import { LocalModelError, type LocalModelDescriptor, type LocalModelProgress } from "../../shared/localModels";
import type { OpenModelDownload } from "../../storage/localModels/download";
import { acquireDownloadLease } from "../../storage/localModels/downloadLease";
import { startModelCacheLeaseChild, type ModelCacheLeaseChild } from "./helpers/modelCacheLeaseChild";

const bytes = Buffer.from("GGUF fixture weights ".repeat(8000));
const model: LocalModelDescriptor = { id: "fixture", name: "Fixture", fileName: "fixture.gguf", url: "http://127.0.0.1/fixture",
  bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
const cancelled = (error: unknown) => error instanceof LocalModelError && error.code === "cancelled";

/** Only the external transport uses loopback HTTP; all validation/storage executes production code. */
async function fixture(handler: (request: IncomingMessage, response: ServerResponse, call: number) => void) {
  const directory = await mkdtemp(path.join(tmpdir(), "pa-model-cache-"));
  const ranges: string[] = [];
  const server = createServer((request, response) => { ranges.push(request.headers.range ?? ""); handler(request, response, ranges.length); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address === "object");
  const download: OpenModelDownload = async (_url, offset, signal) => new Promise((resolve, reject) => {
    const request = get(`http://127.0.0.1:${address.port}/fixture`, { signal, headers: offset ? { Range: `bytes=${offset}-` } : {} }, (response) => resolve({
      status: response.statusCode ?? 0, headers: { contentRange: response.headers["content-range"], contentLength: response.headers["content-length"] },
      chunks: response, close: () => response.destroy()
    })); request.on("error", reject);
  });
  const cache = createManagedLocalModelCache(directory, model, download);
  const target = path.join(directory, "models", model.id, model.fileName);
  return { directory, target, cache, download, ranges, async dispose() {
    cache.dispose(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); await rm(directory, { recursive: true, force: true });
  } };
}
function whole(_request: IncomingMessage, response: ServerResponse): void { response.writeHead(200, { "Content-Length": bytes.length }); response.end(bytes); }
function ranged(request: IncomingMessage, response: ServerResponse): void {
  const offset = Number(request.headers.range?.match(/^bytes=(\d+)-$/)?.[1] ?? 0);
  response.writeHead(offset ? 206 : 200, { "Content-Length": bytes.length - offset,
    ...(offset ? { "Content-Range": `bytes ${offset}-${bytes.length - 1}/${bytes.length}` } : {}) }); response.end(bytes.subarray(offset));
}

test("managed model is inert until requested, atomically verified and reused across cache instances", async () => {
  const f = await fixture(whole); const progress: LocalModelProgress[] = [];
  try {
    assert.deepEqual(await readdir(f.directory), []); assert.equal(f.ranges.length, 0);
    assert.equal(await f.cache.ensure(new AbortController().signal, (value) => progress.push(value)), f.target);
    assert.deepEqual(await readFile(f.target), bytes); assert.equal((await stat(f.target)).mode & 0o777, 0o600);
    assert.deepEqual(await readdir(path.dirname(f.target)), [model.fileName]);
    await f.cache.ensure(new AbortController().signal, () => {});
    const other = createManagedLocalModelCache(f.directory, model, f.download);
    try { await other.ensure(new AbortController().signal, () => {}); } finally { other.dispose(); }
    assert.equal(f.ranges.length, 1); assert.ok(progress.some((value) => value.phase === "downloading")); assert.equal(progress.at(-1)!.phase, "verifying");
  } finally { await f.dispose(); }
});

test("a truncated connection keeps a partial and the next explicit request resumes with a validated Range", async () => {
  const prefix = bytes.subarray(0, 19000);
  const f = await fixture((request, response, call) => { if (call === 1) { response.writeHead(200); response.end(prefix); } else ranged(request, response); });
  try {
    await assert.rejects(f.cache.ensure(new AbortController().signal, () => {}), (error) => error instanceof LocalModelError && error.code === "download");
    assert.equal((await stat(f.target + ".part")).size, prefix.length); await assert.rejects(stat(f.target));
    await f.cache.ensure(new AbortController().signal, () => {});
    assert.deepEqual(f.ranges, ["", `bytes=${prefix.length}-`]); assert.deepEqual(await readFile(f.target), bytes);
  } finally { await f.dispose(); }
});

test("a server ignoring Range restarts instead of appending duplicate weights", async () => {
  const f = await fixture(whole);
  try {
    await f.cache.ensure(new AbortController().signal, () => {});
    await rm(f.target); await writeFile(f.target + ".part", bytes.subarray(0, 4000));
    await f.cache.ensure(new AbortController().signal, () => {});
    assert.equal(f.ranges.at(-1), "bytes=4000-"); assert.deepEqual(await readFile(f.target), bytes);
  } finally { await f.dispose(); }
});

test("cancellation retains received bytes, stops transport and retry resumes", async () => {
  const f = await fixture((request, response, call) => {
    if (call > 1) { ranged(request, response); return; }
    response.writeHead(200, { "Content-Length": bytes.length }); response.flushHeaders();
    void delay(300).then(() => { if (!response.destroyed) response.write(bytes.subarray(0, 32000)); });
  });
  try {
    const controller = new AbortController();
    await assert.rejects(f.cache.ensure(controller.signal, (value) => { if (value.phase === "downloading" && value.completedBytes > 0) controller.abort(); }), cancelled);
    assert.equal((await stat(f.target + ".part")).size, 32000); await assert.rejects(stat(f.target));
    await f.cache.ensure(new AbortController().signal, () => {}); assert.equal(f.ranges.at(-1), "bytes=32000-");
  } finally { await f.dispose(); }
});

test("the first received bytes report progress and permit cancellation within the throttle window", async (t) => {
  t.mock.method(Date, "now", () => 1000);
  const f = await fixture(whole); const received: number[] = [];
  try {
    const controller = new AbortController();
    await assert.rejects(f.cache.ensure(controller.signal, (value) => {
      if (value.phase === "downloading" && value.completedBytes > 0) {
        received.push(value.completedBytes); controller.abort();
      }
    }), cancelled);
    assert.equal(received.length, 1);
    assert.ok(received[0] > 0);
    assert.equal((await stat(f.target + ".part")).size, received[0]);
    await assert.rejects(stat(f.target));
  } finally { await f.dispose(); }
});

test("incorrect SHA-256 deletes the partial and never exposes an executable model", async () => {
  const bad = Buffer.from(bytes); bad[8] ^= 0xff;
  const f = await fixture((_request, response, call) => { response.writeHead(200, { "Content-Length": bytes.length }); response.end(call === 1 ? bad : bytes); });
  try {
    await assert.rejects(f.cache.ensure(new AbortController().signal, () => {}), (error) => error instanceof LocalModelError && error.code === "integrity");
    await assert.rejects(stat(f.target)); await assert.rejects(stat(f.target + ".part"));
    await f.cache.ensure(new AbortController().signal, () => {}); assert.deepEqual(f.ranges, ["", ""]);
  } finally { await f.dispose(); }
});

test("failed corrupt-partial removal preserves integrity failure and retries safely after permission recovery", async (t) => {
  if (process.platform === "win32" || process.getuid?.() === 0) { t.skip("Requires effective POSIX directory permissions"); return; }
  const bad = Buffer.from(bytes); bad[8] ^= 0xff;
  const f = await fixture((_request, response, call) => {
    response.writeHead(200, { "Content-Length": bytes.length }); response.end(call === 1 ? bad : bytes);
  });
  const replacement = createManagedLocalModelCache(f.directory, model, f.download);
  try {
    const failure: unknown = await f.cache.ensure(new AbortController().signal, (value) => {
      // The real checksum failure follows the last write; deny unlink without mocking filesystem errors.
      if (value.phase === "verifying" && value.completedBytes === bytes.length) chmodSync(path.dirname(f.target), 0o500);
    }).catch((error: unknown) => error);
    await assert.rejects(stat(f.target), { code: "ENOENT" });
    assert.deepEqual(await readFile(f.target + ".part"), bad);
    await assert.rejects(rm(f.target + ".part"), { code: "EACCES" });
    assert.ok(failure instanceof LocalModelError); assert.equal(failure.code, "integrity");
    await chmod(path.dirname(f.target), 0o700); f.cache.dispose();
    assert.equal(await replacement.ensure(AbortSignal.timeout(2000), () => {}), f.target);
    assert.deepEqual(await readFile(f.target), bytes); assert.deepEqual(f.ranges, ["", ""]);
    await assert.rejects(stat(f.target + ".part"), { code: "ENOENT" });
    await assert.rejects(stat(f.target + ".lock"), { code: "ENOENT" });
  } finally { await chmod(path.dirname(f.target), 0o700); replacement.dispose(); await f.dispose(); }
});

test("oversized streaming responses and incorrect Content-Range cannot corrupt retained weights", async () => {
  const f = await fixture((_request, response, call) => {
    if (call === 1) { response.writeHead(200); response.end(Buffer.concat([bytes, Buffer.from("extra")])); }
    else { response.writeHead(206, { "Content-Range": `bytes 0-${bytes.length - 1}/${bytes.length}` }); response.end(bytes); }
  });
  try {
    await assert.rejects(f.cache.ensure(new AbortController().signal, () => {}), (error) => error instanceof LocalModelError && error.code === "integrity");
    await assert.rejects(stat(f.target + ".part"));
    await writeFile(f.target + ".part", bytes.subarray(0, 4000));
    await assert.rejects(f.cache.ensure(new AbortController().signal, () => {})); assert.equal((await stat(f.target + ".part")).size, 4000);
    await assert.rejects(stat(f.target));
  } finally { await f.dispose(); }
});

test("same-size corruption in a completed cache is detected and repaired", async () => {
  const f = await fixture(whole);
  try {
    await f.cache.ensure(new AbortController().signal, () => {});
    const bad = Buffer.from(bytes); bad[5] ^= 0xff; await writeFile(f.target, bad);
    await f.cache.ensure(new AbortController().signal, () => {});
    assert.equal(f.ranges.length, 2); assert.deepEqual(await readFile(f.target), bytes);
  } finally { await f.dispose(); }
});

test("a complete retained partial is verified and renamed without a network request", async () => {
  const f = await fixture(whole);
  try {
    await f.cache.ensure(new AbortController().signal, () => {}); await rm(f.target); await writeFile(f.target + ".part", bytes);
    await f.cache.ensure(new AbortController().signal, () => {}); assert.equal(f.ranges.length, 1);
  } finally { await f.dispose(); }
});

test("concurrent cache instances share a lease and a waiting request is cancellable", async () => {
  let received!: () => void; const started = new Promise<void>((resolve) => { received = resolve; });
  let send!: () => void;
  const f = await fixture((_request, response) => { send = () => response.end(bytes); response.writeHead(200, { "Content-Length": bytes.length }); response.flushHeaders(); received(); });
  const other = createManagedLocalModelCache(f.directory, model, f.download);
  try {
    const first = f.cache.ensure(new AbortController().signal, () => {}); await started;
    const cancel = new AbortController();
    await assert.rejects(other.ensure(cancel.signal, (value) => { if (value.phase === "waiting") cancel.abort(); }), cancelled);
    const second = other.ensure(new AbortController().signal, () => {}); send();
    await Promise.all([first, second]); assert.equal(f.ranges.length, 1);
  } finally { other.dispose(); await f.dispose(); }
});

test("extension disposal aborts an active transfer and rejects future requests", async () => {
  let received!: () => void; const started = new Promise<void>((resolve) => { received = resolve; });
  const f = await fixture((_request, response) => { response.writeHead(200, { "Content-Length": bytes.length }); response.flushHeaders(); received(); });
  try {
    const pending = f.cache.ensure(new AbortController().signal, () => {}); await started; f.cache.dispose();
    await assert.rejects(pending, cancelled); await assert.rejects(f.cache.ensure(new AbortController().signal, () => {}), cancelled);
  } finally { await f.dispose(); }
});

test("cancellation during a verified cache identity check does not return a model path", async (t) => {
  const f = await fixture(whole);
  try {
    await f.cache.ensure(new AbortController().signal, () => {});
    const controller = new AbortController();
    const originalStat = fs.stat;
    t.mock.method(fs, "stat", async (filePath: Parameters<typeof stat>[0]) => {
      const info = await originalStat(filePath);
      if (filePath === f.target) controller.abort();
      return info;
    });
    await assert.rejects(f.cache.ensure(controller.signal, () => {}), cancelled);
    assert.equal(f.ranges.length, 1);
  } finally { t.mock.restoreAll(); await f.dispose(); }
});

test("disposal during a verified cache identity check revokes the pending request", async (t) => {
  const f = await fixture(whole);
  try {
    await f.cache.ensure(new AbortController().signal, () => {});
    const originalStat = fs.stat;
    t.mock.method(fs, "stat", async (filePath: Parameters<typeof stat>[0]) => {
      const info = await originalStat(filePath);
      if (filePath === f.target) f.cache.dispose();
      return info;
    });
    await assert.rejects(f.cache.ensure(new AbortController().signal, () => {}), cancelled);
    assert.equal(f.ranges.length, 1);
  } finally { t.mock.restoreAll(); await f.dispose(); }
});

test("cancellation after atomic completion keeps verified weights available for retry", async (t) => {
  const f = await fixture(whole);
  try {
    const controller = new AbortController();
    const originalStat = fs.stat;
    t.mock.method(fs, "stat", async (filePath: Parameters<typeof stat>[0]) => {
      const info = await originalStat(filePath);
      if (filePath === f.target) controller.abort();
      return info;
    });
    await assert.rejects(f.cache.ensure(controller.signal, () => {}), cancelled);
    t.mock.restoreAll();
    assert.deepEqual(await readFile(f.target), bytes);
    await f.cache.ensure(new AbortController().signal, () => {});
    assert.equal(f.ranges.length, 1);
  } finally { t.mock.restoreAll(); await f.dispose(); }
});

for (const action of ["cancel", "dispose"] as const) {
  test(`${action} while releasing the cache lease revokes the pending result`, async (t) => {
    const f = await fixture(whole);
    try {
      await f.cache.ensure(new AbortController().signal, () => {});
      const controller = new AbortController();
      const originalRead = fs.readFile;
      // Releasing the lease is the last asynchronous step, after the cache hit was verified.
      t.mock.method(fs, "readFile", async (...args: Parameters<typeof readFile>) => {
        const contents = await originalRead(...args);
        if (args[0] === f.target + ".lock") {
          if (action === "cancel") controller.abort(); else f.cache.dispose();
        }
        return contents;
      });
      await assert.rejects(f.cache.ensure(controller.signal, () => {}), cancelled);
      t.mock.restoreAll();
      assert.deepEqual(await readFile(f.target), bytes);
      assert.deepEqual(await readdir(path.dirname(f.target)), [model.fileName]);
      assert.equal(f.ranges.length, 1);
      if (action === "cancel") {
        await f.cache.ensure(new AbortController().signal, () => {});
        assert.equal(f.ranges.length, 1);
      }
    } finally { t.mock.restoreAll(); await f.dispose(); }
  });
}

/** Deny real directory removal only after the cache has read an existing verified target. */
function blockLeaseRemoval(t: TestContext, target: string): void {
  const originalStat = fs.stat;
  t.mock.method(fs, "stat", async (filePath: Parameters<typeof stat>[0]) => {
    const info = await originalStat(filePath);
    if (filePath === target) await chmod(path.dirname(target), 0o500);
    return info;
  });
}

test("filesystem lease cleanup failures use the storage error category", async (t) => {
  if (process.platform === "win32" || process.getuid?.() === 0) { t.skip("Requires effective POSIX directory permissions"); return; }
  const f = await fixture(whole);
  try {
    await f.cache.ensure(new AbortController().signal, () => {});
    blockLeaseRemoval(t, f.target);
    await assert.rejects(f.cache.ensure(new AbortController().signal, () => {}),
      (error) => error instanceof LocalModelError && error.code === "storage");
    assert.deepEqual(await readFile(f.target), bytes);
  } finally { t.mock.restoreAll(); await chmod(path.dirname(f.target), 0o700); await f.dispose(); }
});

test("filesystem lease cleanup preserves an earlier download failure", async (t) => {
  if (process.platform === "win32" || process.getuid?.() === 0) { t.skip("Requires effective POSIX directory permissions"); return; }
  const f = await fixture((_request, response) => { response.writeHead(200); response.end(bytes.subarray(0, 19000)); });
  try {
    await assert.rejects(f.cache.ensure(new AbortController().signal, (value) => {
      if (value.phase === "downloading" && value.completedBytes > 0) chmodSync(path.dirname(f.target), 0o500);
    }), (error) => error instanceof LocalModelError && error.code === "download");
  } finally { await chmod(path.dirname(f.target), 0o700); await f.dispose(); }
});

test("filesystem lease cleanup retries a retained release on the next request", async (t) => {
  if (process.platform === "win32" || process.getuid?.() === 0) { t.skip("Requires effective POSIX directory permissions"); return; }
  const f = await fixture(whole);
  try {
    await f.cache.ensure(new AbortController().signal, () => {});
    blockLeaseRemoval(t, f.target);
    await assert.rejects(f.cache.ensure(new AbortController().signal, () => {}));
    t.mock.restoreAll(); await chmod(path.dirname(f.target), 0o700);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1000);
    try { assert.equal(await f.cache.ensure(controller.signal, () => {}), f.target); }
    finally { clearTimeout(timer); }
    await assert.rejects(stat(f.target + ".lock"), { code: "ENOENT" });
    assert.equal(f.ranges.length, 1);
  } finally { t.mock.restoreAll(); await chmod(path.dirname(f.target), 0o700); await f.dispose(); }
});

test("retained lease cleanup serializes simultaneous cache retries", async (t) => {
  if (process.platform === "win32" || process.getuid?.() === 0) { t.skip("Requires effective POSIX directory permissions"); return; }
  const f = await fixture(whole);
  try {
    await f.cache.ensure(new AbortController().signal, () => {});
    blockLeaseRemoval(t, f.target);
    await assert.rejects(f.cache.ensure(new AbortController().signal, () => {}));
    t.mock.restoreAll(); await chmod(path.dirname(f.target), 0o700);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1000);
    try {
      const paths = await Promise.all([f.cache.ensure(controller.signal, () => {}), f.cache.ensure(controller.signal, () => {})]);
      assert.deepEqual(paths, [f.target, f.target]);
    } finally { clearTimeout(timer); }
    await assert.rejects(stat(f.target + ".lock"), { code: "ENOENT" });
    assert.equal(f.ranges.length, 1);
  } finally { t.mock.restoreAll(); await chmod(path.dirname(f.target), 0o700); await f.dispose(); }
});

test("replacement cache recovers a failed release after the old cache is disposed", async (t) => {
  if (process.platform === "win32" || process.getuid?.() === 0) { t.skip("Requires effective POSIX directory permissions"); return; }
  const f = await fixture(whole);
  const replacement = createManagedLocalModelCache(f.directory, model, f.download);
  try {
    await f.cache.ensure(new AbortController().signal, () => {});
    blockLeaseRemoval(t, f.target);
    await assert.rejects(f.cache.ensure(new AbortController().signal, () => {}),
      (error) => error instanceof LocalModelError && error.code === "storage");
    t.mock.restoreAll(); await chmod(path.dirname(f.target), 0o700); f.cache.dispose();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1000);
    try { assert.equal(await replacement.ensure(controller.signal, () => {}), f.target); }
    finally { clearTimeout(timer); }
    await assert.rejects(stat(f.target + ".lock"), { code: "ENOENT" });
    assert.equal(f.ranges.length, 1);
  } finally { t.mock.restoreAll(); await chmod(path.dirname(f.target), 0o700); replacement.dispose(); await f.dispose(); }
});

test("replacement cache already waiting recovers a peer's failed release", { timeout: 5000 }, async (t) => {
  if (process.platform === "win32" || process.getuid?.() === 0) { t.skip("Requires effective POSIX directory permissions"); return; }
  const f = await fixture(whole);
  const replacement = createManagedLocalModelCache(f.directory, model, f.download);
  const controller = new AbortController();
  let inspected!: () => void, allowFailure!: () => void, waiting!: () => void;
  const inspectedTarget = new Promise<void>((resolve) => { inspected = resolve; });
  const finishInspection = new Promise<void>((resolve) => { allowFailure = resolve; });
  const peerWaiting = new Promise<void>((resolve) => { waiting = resolve; });
  let first: Promise<void> | undefined, second: Promise<unknown> | undefined;
  try {
    await f.cache.ensure(new AbortController().signal, () => {});
    const originalStat = fs.stat;
    t.mock.method(fs, "stat", async (filePath: Parameters<typeof stat>[0]) => {
      const info = await originalStat(filePath);
      if (filePath === f.target) {
        await chmod(path.dirname(f.target), 0o500); inspected(); await finishInspection;
      }
      return info;
    });
    first = assert.rejects(f.cache.ensure(new AbortController().signal, () => {}),
      (error) => error instanceof LocalModelError && error.code === "storage");
    await inspectedTarget;
    second = replacement.ensure(controller.signal, (value) => { if (value.phase === "waiting") waiting(); }).catch(error => error);
    await peerWaiting; allowFailure(); await first;
    t.mock.restoreAll(); await chmod(path.dirname(f.target), 0o700); f.cache.dispose();
    const timer = setTimeout(() => controller.abort(), 1000);
    try { assert.equal(await second, f.target); }
    finally { clearTimeout(timer); }
    await assert.rejects(stat(f.target + ".lock"), { code: "ENOENT" });
    assert.equal(f.ranges.length, 1);
  } finally {
    allowFailure(); controller.abort(); t.mock.restoreAll(); await chmod(path.dirname(f.target), 0o700);
    await Promise.allSettled([first, second]); replacement.dispose(); await f.dispose();
  }
});

test("unreadable lease metadata cannot complete a cache request or discard its pending release", async (t) => {
  if (process.platform === "win32" || process.getuid?.() === 0) { t.skip("Requires effective POSIX directory permissions"); return; }
  const f = await fixture(whole);
  const replacement = createManagedLocalModelCache(f.directory, model, f.download);
  try {
    await f.cache.ensure(new AbortController().signal, () => {});
    const originalStat = fs.stat;
    t.mock.method(fs, "stat", async (filePath: Parameters<typeof stat>[0]) => {
      const info = await originalStat(filePath);
      if (filePath === f.target) await chmod(f.target + ".lock", 0o000);
      return info;
    });
    await assert.rejects(f.cache.ensure(new AbortController().signal, () => {}),
      (error) => error instanceof LocalModelError && error.code === "storage");
    t.mock.restoreAll(); await chmod(f.target + ".lock", 0o600); f.cache.dispose();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1000);
    try { assert.equal(await replacement.ensure(controller.signal, () => {}), f.target); }
    finally { clearTimeout(timer); }
    await assert.rejects(stat(f.target + ".lock"), { code: "ENOENT" });
    assert.equal(f.ranges.length, 1);
  } finally {
    t.mock.restoreAll(); await chmod(f.target + ".lock", 0o600).catch(() => {});
    replacement.dispose(); await f.dispose();
  }
});

test("unreadable lease metadata reports storage failure while another real lease remains owned", async (t) => {
  if (process.platform === "win32" || process.getuid?.() === 0) { t.skip("Requires effective POSIX directory permissions"); return; }
  const f = await fixture(whole);
  let release: (() => Promise<void>) | undefined;
  try {
    await f.cache.ensure(new AbortController().signal, () => {});
    release = await acquireDownloadLease(f.target + ".lock", new AbortController().signal, () => {});
    await chmod(f.target + ".lock", 0o000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1000);
    try {
      await assert.rejects(f.cache.ensure(controller.signal, () => {}),
        (error) => error instanceof LocalModelError && error.code === "storage");
    } finally { clearTimeout(timer); }
    await chmod(f.target + ".lock", 0o600);
    assert.equal((await stat(f.target + ".lock")).isFile(), true);
  } finally {
    await chmod(f.target + ".lock", 0o600).catch(() => {}); await release?.(); await f.dispose();
  }
});

/** Read the real kernel disposition after the child's genuine close event, retaining the actual errno. */
function absentLeaseChild(pid: number): { status: "absent"; code: string } {
  try { process.kill(pid, 0); }
  catch (error) {
    assert.equal((error as NodeJS.ErrnoException).code, "ESRCH");
    return { status: "absent", code: (error as NodeJS.ErrnoException).code! };
  }
  throw new Error("Actual closed lease-child PID is still present");
}

test("cross-process lease blocks cache delivery until its live owner releases and closes", { timeout: 7000 }, async (t) => {
  const f = await fixture(whole); let holder: ModelCacheLeaseChild | undefined;
  const controller = new AbortController(); let pending: Promise<unknown> | undefined;
  try {
    await f.cache.ensure(new AbortController().signal, () => {});
    holder = await startModelCacheLeaseChild(f.target + ".lock");
    const owner = JSON.parse(await readFile(f.target + ".lock", "utf8")); assert.equal(owner.pid, holder.pid);
    let waiting!: () => void, settled = false;
    const observedWaiting = new Promise<void>((resolve) => { waiting = resolve; });
    pending = f.cache.ensure(controller.signal, (value) => { if (value.phase === "waiting") waiting(); })
      .then(value => { settled = true; return value; }, error => { settled = true; return error; });
    await Promise.race([observedWaiting, pending.then(() => { throw new Error("Cache settled before observing its live lease owner"); })]);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(settled, false); assert.doesNotThrow(() => process.kill(holder!.pid, 0));
    const close = await holder.release(); const outside = absentLeaseChild(holder.pid);
    assert.equal(await pending, f.target); assert.equal(f.ranges.length, 1);
    await assert.rejects(stat(f.target + ".lock"), { code: "ENOENT" });
    t.diagnostic(JSON.stringify({ case: "live-owner", acquired: holder.acquired, released: holder.released, scriptSha256: holder.scriptSha256,
      productionModulePath: holder.productionModulePath, close, outside, actualModelLoads: 0 }));
  } finally { controller.abort(); await holder?.dispose(); await pending; await f.dispose(); }
});

test("cross-process lease recovers a genuinely exited owner without redownloading verified weights", { timeout: 7000 }, async (t) => {
  const f = await fixture(whole); let holder: ModelCacheLeaseChild | undefined;
  const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await f.cache.ensure(new AbortController().signal, () => {});
    holder = await startModelCacheLeaseChild(f.target + ".lock");
    const before = await readFile(f.target + ".lock", "utf8"); assert.equal(JSON.parse(before).pid, holder.pid);
    const close = await holder.exitWithoutRelease(); const outside = absentLeaseChild(holder.pid);
    assert.equal(holder.released, undefined);
    assert.equal(await readFile(f.target + ".lock", "utf8"), before);
    timer = setTimeout(() => controller.abort(), 1500);
    assert.equal(await f.cache.ensure(controller.signal, () => {}), f.target);
    await assert.rejects(stat(f.target + ".lock"), { code: "ENOENT" }); assert.equal(f.ranges.length, 1);
    t.diagnostic(JSON.stringify({ case: "exited-owner", acquired: holder.acquired, scriptSha256: holder.scriptSha256,
      productionModulePath: holder.productionModulePath, close, outside, actualModelLoads: 0 }));
  } finally { if (timer) clearTimeout(timer); controller.abort(); await holder?.dispose(); await f.dispose(); }
});

test("cross-process lease wait cancellation preserves the real live owner's lease", { timeout: 7000 }, async (t) => {
  const f = await fixture(whole); let holder: ModelCacheLeaseChild | undefined;
  try {
    await f.cache.ensure(new AbortController().signal, () => {});
    holder = await startModelCacheLeaseChild(f.target + ".lock");
    const before = await readFile(f.target + ".lock", "utf8"); assert.equal(JSON.parse(before).pid, holder.pid);
    const controller = new AbortController();
    await assert.rejects(f.cache.ensure(controller.signal, (value) => { if (value.phase === "waiting") controller.abort(); }), cancelled);
    assert.equal(await readFile(f.target + ".lock", "utf8"), before); assert.doesNotThrow(() => process.kill(holder!.pid, 0));
    const close = await holder.release(); const outside = absentLeaseChild(holder.pid);
    assert.equal(await f.cache.ensure(new AbortController().signal, () => {}), f.target); assert.equal(f.ranges.length, 1);
    t.diagnostic(JSON.stringify({ case: "cancel-wait", acquired: holder.acquired, released: holder.released, scriptSha256: holder.scriptSha256,
      productionModulePath: holder.productionModulePath, close, outside, actualModelLoads: 0 }));
  } finally { await holder?.dispose(); await f.dispose(); }
});

test("cross-process lease blocks a cold-cache transfer before any HTTP request", { timeout: 7000 }, async (t) => {
  const f = await fixture(whole); let holder: ModelCacheLeaseChild | undefined;
  const controller = new AbortController(); let pending: Promise<unknown> | undefined;
  try {
    await mkdir(path.dirname(f.target), { recursive: true });
    holder = await startModelCacheLeaseChild(f.target + ".lock");
    assert.equal(JSON.parse(await readFile(f.target + ".lock", "utf8")).pid, holder.pid);
    let waiting!: () => void;
    const observedWaiting = new Promise<void>((resolve) => { waiting = resolve; });
    pending = f.cache.ensure(controller.signal, (value) => { if (value.phase === "waiting") waiting(); }).catch(error => error);
    await Promise.race([observedWaiting, pending.then(() => { throw new Error("Cold-cache request escaped its live lease owner"); })]);
    assert.equal(f.ranges.length, 0); await assert.rejects(stat(f.target), { code: "ENOENT" });
    await assert.rejects(stat(f.target + ".part"), { code: "ENOENT" });
    const close = await holder.release(); const outside = absentLeaseChild(holder.pid);
    assert.equal(await pending, f.target); assert.deepEqual(await readFile(f.target), bytes);
    assert.equal(f.ranges.length, 1); await assert.rejects(stat(f.target + ".lock"), { code: "ENOENT" });
    t.diagnostic(JSON.stringify({ case: "cold-cache", acquired: holder.acquired, released: holder.released,
      scriptSha256: holder.scriptSha256, productionModulePath: holder.productionModulePath, close, outside, actualModelLoads: 0 }));
  } finally { controller.abort(); await holder?.dispose(); await pending; await f.dispose(); }
});

test("cross-process dead lease recovery resumes a retained partial with a validated Range", { timeout: 7000 }, async (t) => {
  const prefix = bytes.subarray(0, 19000);
  const f = await fixture((request, response, call) => {
    if (call === 1) { response.writeHead(200); response.end(prefix); } else ranged(request, response);
  });
  let holder: ModelCacheLeaseChild | undefined;
  const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // The first real HTTP request owns the retained prefix. The distinct child
    // then acquires its lease and exits before resuming; no child-produced bytes are invented.
    await assert.rejects(f.cache.ensure(new AbortController().signal, () => {}),
      (error) => error instanceof LocalModelError && error.code === "download");
    assert.equal((await stat(f.target + ".part")).size, prefix.length);
    holder = await startModelCacheLeaseChild(f.target + ".lock");
    assert.equal(JSON.parse(await readFile(f.target + ".lock", "utf8")).pid, holder.pid);
    const close = await holder.exitWithoutRelease(); const outside = absentLeaseChild(holder.pid);
    assert.equal(holder.released, undefined); assert.equal((await stat(f.target + ".part")).size, prefix.length);
    timer = setTimeout(() => controller.abort(), 1500);
    assert.equal(await f.cache.ensure(controller.signal, () => {}), f.target);
    assert.deepEqual(f.ranges, ["", "bytes=19000-"]); assert.deepEqual(await readFile(f.target), bytes);
    await assert.rejects(stat(f.target + ".lock"), { code: "ENOENT" });
    await assert.rejects(stat(f.target + ".part"), { code: "ENOENT" });
    t.diagnostic(JSON.stringify({ case: "partial-resume", acquired: holder.acquired,
      scriptSha256: holder.scriptSha256, productionModulePath: holder.productionModulePath, close, outside,
      partialBytesWrittenByEarlierParentRequest: prefix.length, actualModelLoads: 0 }));
  } finally { if (timer) clearTimeout(timer); controller.abort(); await holder?.dispose(); await f.dispose(); }
});
