/** Persistent managed GGUF cache: streaming resume, integrity verification and atomic completion. */
import * as path from "node:path";
import { createHash, type Hash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, rename, rm, stat, statfs } from "node:fs/promises";
import { LocalModelError, type LocalModelDescriptor, type LocalModelProgress, type ManagedLocalModelCache } from "../../shared/localModels";
import { acquireDownloadLease, hasCode } from "./downloadLease";
import { openModelDownload, type OpenModelDownload } from "./download";

/** Construction does no I/O. The caller supplies extension-global storage, never a workspace path. */
export function createManagedLocalModelCache(storageDirectory: string, model: LocalModelDescriptor, download: OpenModelDownload = openModelDownload): ManagedLocalModelCache {
  const directory = path.join(storageDirectory, "models", model.id);
  const target = path.join(directory, model.fileName);
  const partial = target + ".part";
  const active = new Set<AbortController>();
  let disposed = false;
  // Recheck file identity cheaply within a host; a changed file must pass SHA-256 again.
  let verifiedStamp: string | undefined;
  return { model, dispose() { disposed = true; for (const controller of active) controller.abort(); },
    async ensure(parentSignal, report) {
      if (disposed || parentSignal.aborted) throw new LocalModelError("cancelled");
      const controller = new AbortController(); active.add(controller);
      const abort = () => controller.abort(); parentSignal.addEventListener("abort", abort, { once: true });
      const signal = controller.signal;
      let release: (() => Promise<void>) | undefined;
      let lastReport = 0;
      const progress = (phase: LocalModelProgress["phase"], completedBytes: number, force = false) => {
        const now = Date.now();
        if (force || now - lastReport >= 250) { lastReport = now; report({ phase, completedBytes, totalBytes: model.bytes }); }
      };
      try {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        release = await acquireDownloadLease(target + ".lock", signal, () => progress("waiting", 0));
        checkCancelled(signal);
        const currentStamp = await fileStamp(target);
        if (currentStamp && currentStamp === verifiedStamp) return target;
        if (currentStamp) {
          if (await validFile(target, model, signal, (bytes) => progress("verifying", bytes))) {
            verifiedStamp = await fileStamp(target); return target;
          }
          await rm(target, { force: true });
        }
        let offset = (await stat(partial).catch((error) => { if (hasCode(error, "ENOENT")) return undefined; throw error; }))?.size ?? 0;
        if (offset > model.bytes) { await rm(partial, { force: true }); offset = 0; }
        // A cancelled final verification can complete without another network request.
        if (offset === model.bytes) {
          if (await validFile(partial, model, signal, (bytes) => progress("verifying", bytes))) {
            await rename(partial, target); verifiedStamp = await fileStamp(target); return target;
          }
          await rm(partial, { force: true }); offset = 0;
        }
        const disk = await statfs(directory);
        if (disk.bavail * disk.bsize < model.bytes - offset + 16 * 1024 * 1024) throw new LocalModelError("storage");
        await transfer(partial, offset, model, download, signal, progress);
        checkCancelled(signal);
        await rename(partial, target);
        verifiedStamp = await fileStamp(target);
        return target;
      } catch (error) {
        if (signal.aborted) throw new LocalModelError("cancelled");
        if (error instanceof LocalModelError) throw error;
        if (["ENOSPC", "EACCES", "EPERM", "EROFS"].some((code) => hasCode(error, code))) throw new LocalModelError("storage");
        throw new LocalModelError("download");
      } finally {
        await release?.(); parentSignal.removeEventListener("abort", abort); active.delete(controller);
      }
    }
  };
}

/** Appends only a valid Range response; a server returning 200 safely restarts from zero. */
async function transfer(filePath: string, offset: number, model: LocalModelDescriptor, download: OpenModelDownload, signal: AbortSignal,
  report: (phase: LocalModelProgress["phase"], bytes: number, force?: boolean) => void): Promise<void> {
  let hash = createHash("sha256");
  if (offset) await hashFile(filePath, hash, signal, (bytes) => report("verifying", bytes));
  const response = await download(model.url, offset, signal);
  let file: Awaited<ReturnType<typeof open>> | undefined;
  try {
    checkCancelled(signal);
    if (response.status === 200) { offset = 0; hash = createHash("sha256"); }
    else if (response.status !== 206 || !validRange(response.headers.contentRange, offset, model.bytes)) throw new LocalModelError("download");
    if (response.headers.contentLength !== undefined && Number(response.headers.contentLength) !== model.bytes - offset) throw new LocalModelError("download");
    file = await open(filePath, offset ? "a" : "w", 0o600);
    let bytes = offset;
    report("downloading", bytes, true);
    for await (const chunk of response.chunks) {
      checkCancelled(signal);
      if (bytes + chunk.byteLength > model.bytes) throw new LocalModelError("integrity");
      // FileHandle.write can be short; do not hash/report bytes that were never stored.
      let written = 0;
      while (written < chunk.byteLength) {
        const result = await file.write(chunk, written, chunk.byteLength - written);
        if (!result.bytesWritten) throw new LocalModelError("storage");
        written += result.bytesWritten;
      }
      bytes += chunk.byteLength; hash.update(chunk);
      // A delayed headers callback can consume the first chunk within the throttle window.
      // Always report the first received bytes so short/stalled transfers remain visibly cancellable.
      report("downloading", bytes, bytes === offset + chunk.byteLength);
    }
    checkCancelled(signal);
    report("verifying", bytes, true);
    if (bytes !== model.bytes) throw new LocalModelError("download");
    if (hash.digest("hex") !== model.sha256) throw new LocalModelError("integrity");
    await file.sync();
  } catch (error) {
    // Network/cancellation partials can resume. Corrupt/oversized content cannot.
    if (error instanceof LocalModelError && error.code === "integrity") {
      await file?.close(); file = undefined; await rm(filePath, { force: true });
    }
    throw error;
  } finally { response.close(); await file?.close(); }
}

async function validFile(filePath: string, model: LocalModelDescriptor, signal: AbortSignal, report: (bytes: number) => void): Promise<boolean> {
  if ((await stat(filePath)).size !== model.bytes) return false;
  const hash = createHash("sha256");
  await hashFile(filePath, hash, signal, report);
  return hash.digest("hex") === model.sha256;
}
/** Hashes with bounded buffers, including a retained prefix before a resumed transfer. */
async function hashFile(filePath: string, hash: Hash, signal: AbortSignal, report: (bytes: number) => void): Promise<void> {
  const stream = createReadStream(filePath, { highWaterMark: 256 * 1024, signal });
  let bytes = 0;
  for await (const chunk of stream) { checkCancelled(signal); hash.update(chunk); bytes += chunk.length; report(bytes); }
  checkCancelled(signal);
}
function validRange(header: string | undefined, start: number, total: number): boolean {
  return header === `bytes ${start}-${total - 1}/${total}`;
}
async function fileStamp(filePath: string): Promise<string | undefined> {
  const info = await stat(filePath).catch((error) => { if (hasCode(error, "ENOENT")) return undefined; throw error; });
  return info ? `${info.size}:${info.mtimeMs}:${info.ctimeMs}:${info.ino}` : undefined;
}
function checkCancelled(signal: AbortSignal): void { if (signal.aborted) throw new LocalModelError("cancelled"); }
