/** Real integration of the default HTTPS downloader, managed cache, checksum verification and abortable leases. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { describe } from "node:test";
import { LocalModelError, type LocalModelDescriptor, type LocalModelProgress } from "../../shared/localModels";
import { createManagedLocalModelCache } from "../../storage/localModels";
import { createModelDownloadTlsFixture, observeModelDownloadEvent } from "./helpers/modelDownloadTls";

const bytes = Buffer.from("GGUF actual TLS cached weights ".repeat(2048));
const isFailure = (code: LocalModelError["code"]) => (error: unknown) => error instanceof LocalModelError && error.code === code;

/** Connects both production components: deliberately omit the optional downloader injection. */
async function fixture(handler: Parameters<typeof createModelDownloadTlsFixture>[0],
  options: Parameters<typeof createModelDownloadTlsFixture>[1] = {}) {
  const tls = await createModelDownloadTlsFixture(handler, options);
  try {
    const directory = await mkdtemp(join(tmpdir(), "pa-default-https-cache-"));
    const model: LocalModelDescriptor = { id: "tls-cache-fixture", name: "TLS cache fixture", fileName: "weights.gguf",
      url: tls.url + "/weights", bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
    const cache = createManagedLocalModelCache(directory, model);
    const target = join(directory, "models", model.id, model.fileName);
    return { tls, directory, model, cache, target, async dispose() {
      cache.dispose(); await tls.dispose(); await rm(directory, { recursive: true, force: true });
    } };
  } catch (error) { await tls.dispose(); throw error; }
}

/** Return a real validated Range response using only the current request's actual offset. */
function resumeResponse(request: Parameters<Parameters<typeof createModelDownloadTlsFixture>[0]>[0],
  response: Parameters<Parameters<typeof createModelDownloadTlsFixture>[0]>[1]): void {
  const offset = Number(request.headers.range?.match(/^bytes=(\d+)-$/)?.[1] ?? 0);
  response.writeHead(offset ? 206 : 200, { "Content-Length": bytes.length - offset,
    ...(offset ? { "Content-Range": `bytes ${offset}-${bytes.length - 1}/${bytes.length}` } : {}) });
  response.end(bytes.subarray(offset));
}

describe("managed cache with the actual default HTTPS downloader", { concurrency: false }, () => {
  test("first explicit request downloads, verifies and atomically publishes; a replacement cache reuses it", async () => {
    const f = await fixture(resumeResponse); const progress: LocalModelProgress[] = [];
    try {
      assert.deepEqual(await readdir(f.directory), []); assert.equal(f.tls.requests.length, 0);
      assert.equal(await f.cache.ensure(new AbortController().signal, value => progress.push(value)), f.target);
      assert.deepEqual(await readFile(f.target), bytes); assert.equal((await stat(f.target)).mode & 0o777, 0o600);
      assert.deepEqual(await readdir(dirname(f.target)), [f.model.fileName]);
      assert.ok(progress.some(value => value.phase === "downloading" && value.completedBytes > 0));
      assert.ok(progress.some(value => value.phase === "verifying" && value.completedBytes === bytes.length));
      f.cache.dispose();
      const replacement = createManagedLocalModelCache(f.directory, f.model);
      try { assert.equal(await replacement.ensure(new AbortController().signal, () => {}), f.target); }
      finally { replacement.dispose(); }
      assert.deepEqual(f.tls.requests, [{ url: "/weights", method: "GET", range: undefined, encoding: "identity" }]);
    } finally { await f.dispose(); }
  });

  test("actual TLS truncation retains received bytes and resumes through a real redirect with the exact Range", { timeout: 15000 }, async t => {
    let disconnect: (() => void) | undefined, closed: Promise<void> | undefined;
    let receivedBeforeDrop = 0, actualDropRequested = false;
    const f = await fixture((request, response, call) => {
      if (call === 1) {
        closed = new Promise(resolve => request.socket.once("close", () => resolve()));
        disconnect = () => { actualDropRequested = true; request.socket.destroy(); };
        response.writeHead(200, { "Content-Length": bytes.length }); response.write(bytes.subarray(0, 19000));
      }
      else if (request.url === "/weights") { response.writeHead(307, { Location: "/cdn/weights" }); response.end(); }
      else resumeResponse(request, response);
    });
    try {
      await assert.rejects(f.cache.ensure(t.signal, value => {
        // End the real transport only after production code confirms bytes were stored.
        if (value.phase === "downloading" && value.completedBytes > 0 && !receivedBeforeDrop) {
          receivedBeforeDrop = value.completedBytes; disconnect?.();
        }
      }), isFailure("download"));
      assert.equal(actualDropRequested, true); assert.ok(receivedBeforeDrop > 0);
      assert.ok(closed); await observeModelDownloadEvent(closed);
      const retained = (await stat(f.target + ".part")).size;
      assert.ok(retained >= receivedBeforeDrop && retained <= 19000);
      assert.deepEqual(await readFile(f.target + ".part"), bytes.subarray(0, retained));
      await assert.rejects(stat(f.target), { code: "ENOENT" });
      await assert.rejects(stat(f.target + ".lock"), { code: "ENOENT" });
      f.cache.dispose(); const replacement = createManagedLocalModelCache(f.directory, f.model);
      try { assert.equal(await replacement.ensure(t.signal, () => {}), f.target); }
      finally { replacement.dispose(); }
      assert.deepEqual(await readFile(f.target), bytes);
      assert.deepEqual(f.tls.requests.map(value => value.url), ["/weights", "/weights", "/cdn/weights"]);
      assert.deepEqual(f.tls.requests.map(value => value.range), [undefined, `bytes=${retained}-`, `bytes=${retained}-`]);
      assert.ok(f.tls.requests.every(value => value.encoding === "identity"));
      await assert.rejects(stat(f.target + ".part"), { code: "ENOENT" });
      await assert.rejects(stat(f.target + ".lock"), { code: "ENOENT" });
      t.diagnostic(JSON.stringify({ actualReceivedBeforeForcedTlsDrop: receivedBeforeDrop,
        actualRetainedBytesAfterTlsTruncation: retained, actualRedirectedRange: `bytes=${retained}-`,
        actualRemoteSocketCloseObserved: true, modelLoads: 0 }));
    } finally { await f.dispose(); }
  });

  test("a real TLS response with incorrect checksum is removed before a clean explicit retry", async () => {
    const bad = Buffer.from(bytes); bad[17] ^= 0xff;
    const f = await fixture((_request, response, call) => {
      response.writeHead(200, { "Content-Length": bytes.length }); response.end(call === 1 ? bad : bytes);
    });
    try {
      await assert.rejects(f.cache.ensure(new AbortController().signal, () => {}), isFailure("integrity"));
      assert.deepEqual(await readdir(dirname(f.target)), []);
      assert.equal(await f.cache.ensure(new AbortController().signal, () => {}), f.target);
      assert.deepEqual(await readFile(f.target), bytes);
      assert.deepEqual(f.tls.requests.map(value => value.range), [undefined, undefined]);
      assert.deepEqual(await readdir(dirname(f.target)), [f.model.fileName]);
    } finally { await f.dispose(); }
  });

  for (const action of ["parent cancellation", "cache disposal"] as const) {
    test(`${action} closes the real TLS socket, releases its lease and lets a replacement resume`, { timeout: 15000 }, async t => {
      let closed: Promise<void> | undefined;
      const f = await fixture((request, response, call) => {
        if (call > 1) { resumeResponse(request, response); return; }
        closed = new Promise(resolve => request.socket.once("close", () => resolve()));
        response.writeHead(200, { "Content-Length": bytes.length }); response.write(bytes.subarray(0, 7000));
      });
      const controller = new AbortController();
      try {
        await assert.rejects(f.cache.ensure(controller.signal, value => {
          if (value.phase === "downloading" && value.completedBytes > 0) {
            if (action === "parent cancellation") controller.abort(); else f.cache.dispose();
          }
        }), isFailure("cancelled"));
        assert.ok(closed); await observeModelDownloadEvent(closed);
        const retained = (await stat(f.target + ".part")).size;
        assert.ok(retained > 0 && retained <= 7000);
        assert.deepEqual(await readFile(f.target + ".part"), bytes.subarray(0, retained));
        await assert.rejects(stat(f.target), { code: "ENOENT" });
        await assert.rejects(stat(f.target + ".lock"), { code: "ENOENT" });
        f.cache.dispose(); const replacement = createManagedLocalModelCache(f.directory, f.model);
        try { assert.equal(await replacement.ensure(new AbortController().signal, () => {}), f.target); }
        finally { replacement.dispose(); }
        assert.deepEqual(await readFile(f.target), bytes);
        assert.deepEqual(f.tls.requests.map(value => value.range), [undefined, `bytes=${retained}-`]);
        assert.deepEqual(await readdir(dirname(f.target)), [f.model.fileName]);
        t.diagnostic(JSON.stringify({ action, actualRemoteSocketCloseObserved: true, actualRetainedBytes: retained,
          actualLeaseRemovedBeforeRetry: true, modelLoads: 0 }));
      } finally { controller.abort(); await f.dispose(); }
    });
  }

  for (const condition of ["untrusted certificate", "wrong hostname"] as const) {
    test(`${condition} fails privately through the default cache without exposing weights or leaving a lease`, async () => {
      const f = await fixture((_request, response) => response.end(bytes), condition === "untrusted certificate"
        ? { trust: false } : { certificate: "other-host" });
      try {
        await assert.rejects(f.cache.ensure(new AbortController().signal, () => {}), (error: unknown) =>
          error instanceof LocalModelError && error.code === "download" && error.message === "download");
        assert.equal(f.tls.requests.length, 0); assert.deepEqual(await readdir(dirname(f.target)), []);
        await assert.rejects(stat(f.target), { code: "ENOENT" });
        await assert.rejects(stat(f.target + ".part"), { code: "ENOENT" });
        await assert.rejects(stat(f.target + ".lock"), { code: "ENOENT" });
      } finally { await f.dispose(); }
    });
  }
});
