/** Real streamed HTTP/filesystem tests for first-use download, resume, integrity and concurrent host leases. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { get, createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createManagedLocalModelCache } from "../../storage/localModels";
import { LocalModelError, type LocalModelDescriptor, type LocalModelProgress } from "../../shared/localModels";
import type { OpenModelDownload } from "../../storage/localModels/download";

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
