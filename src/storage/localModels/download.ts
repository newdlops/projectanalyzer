/** Streaming HTTPS adapter with bounded redirects, cancellation and a socket idle deadline. */
import { get } from "node:https";
import type { IncomingMessage } from "node:http";
import { LocalModelError } from "../../shared/localModels";

export type ModelDownloadResponse = {
  status: number;
  headers: { contentRange?: string; contentLength?: string };
  chunks: AsyncIterable<Uint8Array>;
  close(): void;
};
/** Injectable external network boundary; the cache still owns size/hash/range validation. */
export type OpenModelDownload = (url: string, offset: number, signal: AbortSignal) => Promise<ModelDownloadResponse>;

/** Follows only HTTPS redirects; no source, credentials or API keys are sent. */
export const openModelDownload: OpenModelDownload = async (url, offset, signal) => {
  let current = new URL(url);
  for (let redirects = 0; redirects <= 8; redirects++) {
    if (signal.aborted) throw new LocalModelError("cancelled");
    if (current.protocol !== "https:") throw new LocalModelError("download");
    const response = await request(current, offset, signal);
    if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
      const location = response.headers.location;
      response.destroy();
      if (!location) throw new LocalModelError("download");
      current = new URL(location, current);
      continue;
    }
    return { status: response.statusCode ?? 0, headers: { contentRange: response.headers["content-range"], contentLength: response.headers["content-length"] },
      chunks: response, close: () => response.destroy() };
  }
  throw new LocalModelError("download");
};

/** Node HTTPS stays compatible with the extension host's proxy support and enforces normal TLS validation. */
function request(url: URL, offset: number, signal: AbortSignal): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const download = get(url, { signal, headers: { "Accept-Encoding": "identity", ...(offset ? { Range: `bytes=${offset}-` } : {}) } }, resolve);
    // This is an inactivity bound, not a total limit for a multi-gigabyte transfer.
    download.setTimeout(60000, () => download.destroy(new LocalModelError("download")));
    download.on("error", reject);
  });
}
