/** Real loopback HTTPS fixtures with test-local trust and owned socket/agent teardown. */
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import https = require("node:https");
import { resolve } from "node:path";
import type { Duplex } from "node:stream";

export type ModelDownloadTlsRequest = { url: string; method: string; range?: string; encoding?: string };
type Handler = (request: IncomingMessage, response: ServerResponse, call: number) => void;

/** Owns one real TLS server and temporarily scopes fixture trust to this isolated test process. */
export async function createModelDownloadTlsFixture(handler: Handler,
  options: { trust?: boolean; certificate?: "loopback" | "other-host" } = {}) {
  const directory = resolve(process.cwd(), "src/test/fixtures/localModelDownloadTls");
  const [key, cert] = await Promise.all([
    readFile(resolve(directory, "public-test-key.pem")),
    readFile(resolve(directory, (options.certificate ?? "loopback") + ".pem"))
  ]);
  const requests: ModelDownloadTlsRequest[] = [];
  const sockets = new Set<Duplex>();
  let connections = 0;
  const server = https.createServer({ key, cert }, (request, response) => {
    requests.push({ url: request.url ?? "", method: request.method ?? "", range: request.headers.range,
      encoding: request.headers["accept-encoding"] });
    handler(request, response, requests.length);
  });
  server.on("connection", (socket) => {
    connections++; sockets.add(socket); socket.once("close", () => sockets.delete(socket));
  });
  server.on("tlsClientError", (_error, socket) => socket.destroy());
  await new Promise<void>((ready, reject) => {
    server.once("error", reject); server.listen(0, "127.0.0.1", () => { server.removeListener("error", reject); ready(); });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Actual TLS listener address is unavailable");
  const previousAgent = https.globalAgent;
  // Verification stays enabled. Only the fixture CA is trusted, in this test worker alone.
  const agent = new https.Agent({ keepAlive: false, ...(options.trust === false ? {} : { ca: cert }) });
  https.globalAgent = agent;
  let closing: Promise<void> | undefined;
  return { url: `https://127.0.0.1:${address.port}`, requests, get connections() { return connections; },
    /** Restore trust and await the actual server close; an observation timeout never implies closure. */
    dispose(): Promise<void> {
      if (!closing) closing = (async () => {
        https.globalAgent = previousAgent; agent.destroy(); server.closeAllConnections();
        for (const socket of sockets) socket.destroy();
        await new Promise<void>((closed, reject) => server.close(error => error ? reject(error) : closed()));
      })();
      return closing;
    }
  };
}

/** Bound event observation without treating a timeout as a successful socket close. */
export async function observeModelDownloadEvent<T>(event: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([event, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Actual transport event was not observed")), 5000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
