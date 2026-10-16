/** Bounded local-file reads with actual handle ownership and stable file identity. */
import { open } from "node:fs/promises";
import type { BigIntStats } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import { SourceCaptureError, requireSourceActive, type SourceDocumentSnapshot } from "../../shared/narrativeSources";

/** Nanosecond metadata plus inode/device detect replacement during one read. */
function revision(stat: BigIntStats): string {
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(":");
}

/**
 * Reads a whole file with one64KiB input buffer, closing its handle on every exit.
 * Growth beyond the budget throws before more text is retained. No editor cache
 * is opened, and disappearance/access denial returns unavailable explicitly.
 */
export async function readSourceFileSnapshot(filePath: string, maximumBytes: number, signal: AbortSignal): Promise<SourceDocumentSnapshot | undefined> {
  requireSourceActive(signal);
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) throw new RangeError("Positive source-file byte limit required");
  let handle: Awaited<ReturnType<typeof open>>;
  try { handle = await open(filePath, "r"); }
  catch (error) {
    requireSourceActive(signal);
    if (["ENOENT", "ENOTDIR", "EACCES", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "")) return undefined;
    throw error;
  }
  try {
    requireSourceActive(signal);
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) return undefined;
    if (before.size > BigInt(maximumBytes)) throw new SourceCaptureError("context-too-large", "Whole source file exceeds its byte limit");
    const decoder = new StringDecoder("utf8"), chunks: string[] = [];
    const buffer = Buffer.allocUnsafe(Math.min(65_536, maximumBytes + 1));
    let bytes = 0;
    while (true) {
      requireSourceActive(signal);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      requireSourceActive(signal);
      if (!bytesRead) break;
      bytes += bytesRead;
      if (bytes > maximumBytes) throw new SourceCaptureError("context-too-large", "Whole source grew beyond its byte limit");
      chunks.push(decoder.write(buffer.subarray(0, bytesRead)));
    }
    chunks.push(decoder.end());
    const after = await handle.stat({ bigint: true });
    requireSourceActive(signal);
    if (revision(before) !== revision(after) || BigInt(bytes) !== after.size) {
      throw new SourceCaptureError("source-changed", "Source file changed while reading");
    }
    const text = chunks.join("");
    if (Buffer.byteLength(text, "utf8") > maximumBytes) throw new SourceCaptureError("context-too-large", "Decoded whole source exceeds its byte limit");
    return { filePath, text, revision: "file:" + revision(after) };
  } finally { await handle.close(); }
}
