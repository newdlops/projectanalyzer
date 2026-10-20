/** Cross-window download leases and process-local recovery of failed releases across cache lifecycles. */
import { randomUUID } from "node:crypto";
import { open, readFile, rm, stat } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { LocalModelError } from "../../shared/localModels";

type PendingRelease = { release: () => Promise<void>; attempt?: Promise<void> };
// Only leases whose actual owner has begun releasing them enter this registry.
// Active transfers stay exclusive. Tokens retain small callbacks, never model bytes.
const pendingReleases = new Map<string, PendingRelease>();

/** Acquires an exclusive PID/token lease, waiting abortably for another extension host. */
export async function acquireDownloadLease(filePath: string, signal: AbortSignal, waiting: () => void | Promise<void>): Promise<() => Promise<void>> {
  const token = randomUUID();
  const deadline = Date.now() + 30 * 60 * 1000;
  while (!signal.aborted) {
    try {
      const file = await open(filePath, "wx", 0o600);
      try { await file.writeFile(JSON.stringify({ pid: process.pid, token })); }
      catch (error) { await rm(filePath, { force: true }); throw error; }
      finally { await file.close(); }
      const release = async () => {
        const owner = await readOwner(filePath, true);
        if (owner?.token === token) await rm(filePath, { force: true });
      };
      return () => retainRelease(token, release);
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error;
      const owner = await readOwner(filePath);
      if (owner?.pid === process.pid && pendingReleases.has(owner.token)) {
        // The former cache may already be disposed. Retry only a release its
        // owner actually requested; a live active transfer cannot be reclaimed.
        await retryRelease(owner.token); continue;
      }
      if (owner && !isAlive(owner.pid)) { await rm(filePath, { force: true }); continue; }
      // A creator may still be writing metadata. Only recover malformed leases after a grace period.
      if (!owner) {
        const info = await stat(filePath).catch((error) => { if (hasCode(error, "ENOENT")) return undefined; throw error; });
        if (!info) continue;
        if (Date.now() - info.mtimeMs > 30000) { await rm(filePath, { force: true }); continue; }
      }
      if (Date.now() >= deadline) throw new LocalModelError("busy");
      await waiting();
      try { await delay(250, undefined, { signal }); }
      catch { throw new LocalModelError("cancelled"); }
    }
  }
  throw new LocalModelError("cancelled");
}

/** Retain the same release callback until actual success, including after its cache instance is disposed. */
function retainRelease(token: string, release: () => Promise<void>): Promise<void> {
  if (!pendingReleases.has(token)) pendingReleases.set(token, { release });
  return retryRelease(token);
}

/** Share one attempt for each real lease token; failures stay retryable and cannot race another removal. */
async function retryRelease(token: string): Promise<void> {
  const pending = pendingReleases.get(token);
  if (!pending) return;
  if (pending.attempt) return pending.attempt;
  const attempt = Promise.resolve().then(pending.release).then(() => {
    if (pendingReleases.get(token) === pending) pendingReleases.delete(token);
  });
  pending.attempt = attempt;
  try { await attempt; }
  finally { if (pending.attempt === attempt) pending.attempt = undefined; }
}

/** Missing metadata can race a creator; I/O errors cannot prove absence or successful release. */
async function readOwner(filePath: string, strict = false): Promise<{ pid: number; token: string } | undefined> {
  let contents: string;
  try { contents = await readFile(filePath, "utf8"); }
  catch (error) { if (hasCode(error, "ENOENT")) return undefined; throw error; }
  let value;
  try {
    value = JSON.parse(contents);
  } catch {
    if (strict) throw new LocalModelError("storage");
    return undefined; // A contending creator may still be writing its metadata.
  }
  if (value && typeof value === "object" && Number.isSafeInteger(value.pid) && value.pid > 0 && typeof value.token === "string") return value;
  if (strict) throw new LocalModelError("storage");
  return undefined;
}
function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return !hasCode(error, "ESRCH"); }
}
export function hasCode(error: unknown, code: string): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === code;
}
