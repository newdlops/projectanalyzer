/** Cross-window filesystem lease prevents duplicate large transfers; dead owners can be recovered. */
import { randomUUID } from "node:crypto";
import { open, readFile, rm, stat } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { LocalModelError } from "../../shared/localModels";

/** Acquires an exclusive PID/token lease, waiting abortably for another extension host. */
export async function acquireDownloadLease(filePath: string, signal: AbortSignal, waiting: () => void): Promise<() => Promise<void>> {
  const token = randomUUID();
  const deadline = Date.now() + 30 * 60 * 1000;
  while (!signal.aborted) {
    try {
      const file = await open(filePath, "wx", 0o600);
      try { await file.writeFile(JSON.stringify({ pid: process.pid, token })); }
      catch (error) { await rm(filePath, { force: true }); throw error; }
      finally { await file.close(); }
      return async () => {
        const owner = await readOwner(filePath);
        if (owner?.token === token) await rm(filePath, { force: true });
      };
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error;
      const owner = await readOwner(filePath);
      if (owner && !isAlive(owner.pid)) { await rm(filePath, { force: true }); continue; }
      // A creator may still be writing metadata. Only recover malformed leases after a grace period.
      if (!owner) {
        const info = await stat(filePath).catch(() => undefined);
        if (!info) continue;
        if (Date.now() - info.mtimeMs > 30000) { await rm(filePath, { force: true }); continue; }
      }
      if (Date.now() >= deadline) throw new LocalModelError("busy");
      waiting();
      try { await delay(250, undefined, { signal }); }
      catch { throw new LocalModelError("cancelled"); }
    }
  }
  throw new LocalModelError("cancelled");
}

/** Invalid/missing metadata is never treated as a live owner. */
async function readOwner(filePath: string): Promise<{ pid: number; token: string } | undefined> {
  try {
    const value = JSON.parse(await readFile(filePath, "utf8"));
    if (Number.isSafeInteger(value.pid) && value.pid > 0 && typeof value.token === "string") return value;
  } catch { /* Contending owner may have removed or not yet written the lease. */ }
  return undefined;
}
function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return !hasCode(error, "ESRCH"); }
}
export function hasCode(error: unknown, code: string): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === code;
}
