/** Actual TLS/socket tests for the production HTTPS adapter, including trust, redirects, cancellation and idle expiry. */
import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { performance } from "node:perf_hooks";
import test, { describe } from "node:test";
import { LocalModelError } from "../../shared/localModels";
import { openModelDownload, type ModelDownloadResponse } from "../../storage/localModels/download";
import { createModelDownloadTlsFixture, observeModelDownloadEvent } from "./helpers/modelDownloadTls";

const bytes = Buffer.from("actual small loopback download fixture");
const isDownload = (error: unknown) => error instanceof LocalModelError && error.code === "download";
const isAbort = (error: unknown) => error instanceof Error && "code" in error && ["ABORT_ERR", "ECONNRESET"].includes(String(error.code));

/** Collect only small real test responses; reject accidental unbounded fixtures. */
async function readAll(response: ModelDownloadResponse): Promise<Buffer> {
  const chunks: Buffer[] = []; let total = 0;
  for await (const chunk of response.chunks) {
    total += chunk.byteLength; assert.ok(total <= 65536); chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** Resolve only from the actual remote socket's close event, never from cancellation intent. */
function socketClose(request: IncomingMessage): Promise<void> {
  return new Promise(resolve => request.socket.once("close", () => resolve()));
}

describe("actual production model HTTPS transport", { concurrency: false }, () => {
  test("streams verified TLS response metadata and requests identity encoding", async () => {
    const f = await createModelDownloadTlsFixture((_request, response) => {
      response.writeHead(200, { "Content-Length": bytes.length }); response.end(bytes);
    });
    let response: ModelDownloadResponse | undefined;
    try {
      response = await openModelDownload(f.url + "/weights", 0, new AbortController().signal);
      assert.equal(response.status, 200); assert.equal(response.headers.contentLength, String(bytes.length));
      assert.deepEqual(await readAll(response), bytes);
      assert.deepEqual(f.requests, [{ url: "/weights", method: "GET", range: undefined, encoding: "identity" }]);
    } finally { response?.close(); await f.dispose(); }
  });

  test("rejects an untrusted real TLS certificate before an HTTP request", async () => {
    const f = await createModelDownloadTlsFixture((_request, response) => response.end(bytes), { trust: false });
    try {
      await assert.rejects(openModelDownload(f.url, 0, new AbortController().signal), (error: unknown) =>
        error instanceof Error && "code" in error && ["DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN"].includes(String(error.code)));
      assert.equal(f.requests.length, 0);
    } finally { await f.dispose(); }
  });

  test("rejects the wrong hostname even when its real certificate is explicitly trusted", async () => {
    const f = await createModelDownloadTlsFixture((_request, response) => response.end(bytes), { certificate: "other-host" });
    try {
      await assert.rejects(openModelDownload(f.url, 0, new AbortController().signal), { code: "ERR_TLS_CERT_ALTNAME_INVALID" });
      assert.equal(f.requests.length, 0);
    } finally { await f.dispose(); }
  });

  test("rejects an initial plain HTTP URL before opening a connection", async () => {
    const f = await createModelDownloadTlsFixture((_request, response) => response.end(bytes));
    try {
      await assert.rejects(openModelDownload(f.url.replace("https:", "http:"), 0, new AbortController().signal), isDownload);
      assert.equal(f.connections, 0); assert.equal(f.requests.length, 0);
    } finally { await f.dispose(); }
  });

  test("rejects a real HTTPS redirect to HTTP before connecting to its target", async () => {
    const f = await createModelDownloadTlsFixture((_request, response) => {
      response.writeHead(302, { Location: "http://127.0.0.1:1/weights" }); response.end();
    });
    try {
      await assert.rejects(openModelDownload(f.url, 0, new AbortController().signal), isDownload);
      assert.equal(f.connections, 1); assert.equal(f.requests.length, 1);
    } finally { await f.dispose(); }
  });

  for (const status of [301, 302, 303, 307, 308]) {
    test(`follows real ${status} relative redirects while preserving the exact Range`, async () => {
      const offset = 7;
      const f = await createModelDownloadTlsFixture((_request, response, call) => {
        if (call === 1) { response.writeHead(status, { Location: "../weights?mirror=1" }); response.end(); }
        else {
          response.writeHead(206, { "Content-Length": bytes.length - offset,
            "Content-Range": `bytes ${offset}-${bytes.length - 1}/${bytes.length}` }); response.end(bytes.subarray(offset));
        }
      });
      let response: ModelDownloadResponse | undefined;
      try {
        response = await openModelDownload(f.url + "/models/start", offset, new AbortController().signal);
        assert.equal(response.status, 206); assert.equal(response.headers.contentRange, `bytes ${offset}-${bytes.length - 1}/${bytes.length}`);
        assert.equal(response.headers.contentLength, String(bytes.length - offset));
        assert.deepEqual(await readAll(response), bytes.subarray(offset));
        assert.deepEqual(f.requests.map(r => r.url), ["/models/start", "/weights?mirror=1"]);
        assert.ok(f.requests.every(r => r.method === "GET" && r.range === `bytes=${offset}-` && r.encoding === "identity"));
      } finally { response?.close(); await f.dispose(); }
    });
  }

  test("permits exactly eight actual redirects before the final response", async () => {
    const f = await createModelDownloadTlsFixture((_request, response, call) => {
      if (call <= 8) { response.writeHead(302, { Location: `/hop-${call}` }); response.end(); }
      else response.end(bytes);
    });
    let response: ModelDownloadResponse | undefined;
    try {
      response = await openModelDownload(f.url, 0, new AbortController().signal);
      assert.deepEqual(await readAll(response), bytes); assert.equal(f.requests.length, 9);
    } finally { response?.close(); await f.dispose(); }
  });

  test("stops a real redirect loop after the ninth request", async () => {
    const f = await createModelDownloadTlsFixture((_request, response) => {
      response.writeHead(302, { Location: "/again" }); response.end();
    });
    try {
      await assert.rejects(openModelDownload(f.url, 0, new AbortController().signal), isDownload);
      assert.equal(f.requests.length, 9);
    } finally { await f.dispose(); }
  });

  test("rejects an actual redirect response without Location", async () => {
    const f = await createModelDownloadTlsFixture((_request, response) => { response.writeHead(302); response.end(); });
    try {
      await assert.rejects(openModelDownload(f.url, 0, new AbortController().signal), isDownload);
      assert.equal(f.requests.length, 1);
    } finally { await f.dispose(); }
  });

  test("cancellation before entry opens no TLS connection", async () => {
    const f = await createModelDownloadTlsFixture((_request, response) => response.end(bytes));
    try {
      const controller = new AbortController(); controller.abort();
      await assert.rejects(openModelDownload(f.url, 0, controller.signal), (error: unknown) => error instanceof LocalModelError && error.code === "cancelled");
      assert.equal(f.connections, 0); assert.equal(f.requests.length, 0);
    } finally { await f.dispose(); }
  });

  test("cancellation while headers are pending closes the actual remote socket", { timeout: 15000 }, async () => {
    let started!: () => void; const requested = new Promise<void>(resolve => { started = resolve; });
    let closed: Promise<void> | undefined;
    const f = await createModelDownloadTlsFixture((request, _response) => { closed = socketClose(request); started(); });
    const controller = new AbortController();
    const pending = openModelDownload(f.url, 0, controller.signal); const rejection = assert.rejects(pending, isAbort);
    try {
      await observeModelDownloadEvent(requested); controller.abort(); await rejection;
      assert.ok(closed); await observeModelDownloadEvent(closed);
    } finally { controller.abort(); await Promise.allSettled([pending, rejection]); await f.dispose(); }
  });

  test("cancellation after received bytes rejects the stream and closes its actual remote socket", { timeout: 15000 }, async () => {
    let closed: Promise<void> | undefined;
    const f = await createModelDownloadTlsFixture((request, response) => {
      closed = socketClose(request); response.writeHead(200, { "Content-Length": bytes.length }); response.write(bytes.subarray(0, 7));
    });
    const controller = new AbortController(); let response: ModelDownloadResponse | undefined;
    try {
      response = await openModelDownload(f.url, 0, controller.signal);
      const iterator = response.chunks[Symbol.asyncIterator](); const first = await observeModelDownloadEvent(iterator.next());
      assert.deepEqual(Buffer.from(first.value!), bytes.subarray(0, 7)); controller.abort();
      await assert.rejects(iterator.next(), isAbort); assert.ok(closed); await observeModelDownloadEvent(closed);
    } finally { controller.abort(); response?.close(); await f.dispose(); }
  });

  test("explicit response close really closes a stalled remote stream and is idempotent", { timeout: 15000 }, async () => {
    let closed: Promise<void> | undefined;
    const f = await createModelDownloadTlsFixture((request, response) => {
      closed = socketClose(request); response.writeHead(200, { "Content-Length": bytes.length }); response.write(bytes.subarray(0, 7));
    });
    let response: ModelDownloadResponse | undefined;
    try {
      response = await openModelDownload(f.url, 0, new AbortController().signal);
      const first = await observeModelDownloadEvent(response.chunks[Symbol.asyncIterator]().next());
      assert.deepEqual(Buffer.from(first.value!), bytes.subarray(0, 7)); response.close(); response.close();
      assert.ok(closed); await observeModelDownloadEvent(closed);
    } finally { response?.close(); await f.dispose(); }
  });

  test("the real sixty-second socket idle deadline terminates a stalled TLS response", { timeout: 80000 }, async (t) => {
    let closed: Promise<void> | undefined;
    const f = await createModelDownloadTlsFixture((request, response) => {
      closed = socketClose(request); response.writeHead(200, { "Content-Length": bytes.length }); response.flushHeaders();
    });
    const controller = new AbortController(); const abort = () => controller.abort();
    t.signal.addEventListener("abort", abort, { once: true });
    let response: ModelDownloadResponse | undefined;
    const start = performance.now();
    try {
      response = await openModelDownload(f.url, 0, controller.signal);
      await assert.rejects(readAll(response));
      const elapsedMs = performance.now() - start;
      assert.ok(elapsedMs >= 59000 && elapsedMs < 80000);
      assert.equal(controller.signal.aborted, false); assert.ok(closed); await observeModelDownloadEvent(closed);
      t.diagnostic(JSON.stringify({ actualIdleExpiryMs: elapsedMs, actualRemoteSocketCloseObserved: true, modelLoads: 0 }));
    } finally { t.signal.removeEventListener("abort", abort); controller.abort(); response?.close(); await f.dispose(); }
  });
});
