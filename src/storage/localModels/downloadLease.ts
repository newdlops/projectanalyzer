/** Cross-window download leases and process-local recovery of failed releases across cache lifecycles. */
import { randomUUID } from "node:crypto";
import { open, readFile, rm, stat } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { LocalModelError } from "../../shared/localModels";
import { hasCode, isProcessAlive } from "./downloadLease/filesystem";
import { withLeaseGate } from "./downloadLease/gate";
import { hasPendingCleanup, retainCleanup, retryCleanup } from "./downloadLease/pendingCleanup";

export { hasCode } from "./downloadLease/filesystem";
type Release = () => Promise<void>;
type Attempt = { kind: "acquired"; release: Release } | { kind: "retry" } | { kind: "waiting" }
  | { kind: "cleanup"; token: string };

/** Acquires an exclusive PID/token lease, waiting abortably for another extension host. */
export async function acquireDownloadLease(filePath: string, signal: AbortSignal, waiting: () => void | Promise<void>): Promise<() => Promise<void>> {
  const token = randomUUID();
  const deadline = Date.now() + 30 * 60 * 1000;
  while (!signal.aborted) {
    // Inspecting a live lease needs no writes. In particular, an already waiting
    // cache must remain pending while its peer temporarily cannot unlink files.
    const current = await readOwner(filePath);
    if (current?.pid === process.pid && hasPendingCleanup(filePath, current.token)) {
      await retryCleanup(filePath, current.token); continue;
    }
    if (current && isProcessAlive(current.pid)) { await wait(signal, deadline, waiting); continue; }
    let newlyOwnedRelease: Release | undefined;
    let attempt: Attempt;
    try {
      attempt = await withLeaseGate<Attempt>(filePath, signal, deadline, waiting, async () => {
        try {
          const file = await open(filePath, "wx", 0o600);
          try {
            await file.writeFile(JSON.stringify({ pid: process.pid, token }));
            newlyOwnedRelease = ownedRelease(filePath, token);
          } catch (error) { await rm(filePath, { force: true }); throw error; }
          finally { await file.close(); }
          return { kind: "acquired", release: newlyOwnedRelease! };
        } catch (error) { if (!hasCode(error, "EEXIST")) throw error; }
        // Re-read after entering the cross-process gate. The earlier dead-owner
        // snapshot cannot authorize unlinking a lease another requester now owns.
        const owner = await readOwner(filePath);
        if (owner?.pid === process.pid && hasPendingCleanup(filePath, owner.token)) return { kind: "cleanup", token: owner.token };
        if (owner && !isProcessAlive(owner.pid)) { await rm(filePath, { force: true }); return { kind: "retry" }; }
        if (!owner) {
          const info = await stat(filePath).catch((error) => { if (hasCode(error, "ENOENT")) return undefined; throw error; });
          if (!info) return { kind: "retry" };
          if (Date.now() - info.mtimeMs > 30000) { await rm(filePath, { force: true }); return { kind: "retry" }; }
        }
        return { kind: "waiting" };
      });
    } catch (error) {
      // A successful wx may precede a failed gate cleanup. Revoke that undelivered
      // lease, retaining its release if cleanup still fails, before reporting error.
      try { await newlyOwnedRelease?.(); } catch { /* Owner-requested cleanup stays retained. */ }
      throw error;
    }
    if (attempt.kind === "acquired") {
      if (!signal.aborted) return attempt.release;
      try { await attempt.release(); } catch { /* Preserve cancellation; cleanup stays retained. */ }
      throw new LocalModelError("cancelled");
    }
    // Release callbacks acquire their own gate. Retry them only after this
    // transaction has left the gate, avoiding reentrant acquisition/deadlock.
    if (attempt.kind === "cleanup") await retryCleanup(filePath, attempt.token);
    else if (attempt.kind === "waiting") await wait(signal, deadline, waiting);
  }
  throw new LocalModelError("cancelled");
}

/** Owner cleanup is independent of request cancellation and serializes with every shared-path mutation. */
function ownedRelease(filePath: string, token: string): Release {
  return () => retainCleanup(filePath, token, () => withLeaseGate(filePath, new AbortController().signal,
    Date.now() + 30 * 60 * 1000, () => {}, async () => {
      const owner = await readOwner(filePath, true);
      if (owner?.token === token) await rm(filePath, { force: true });
    }));
}

/** Waiting preserves the acquisition's original deadline and revokes promptly on cancellation. */
async function wait(signal: AbortSignal, deadline: number, waiting: () => void | Promise<void>): Promise<void> {
  if (Date.now() >= deadline) throw new LocalModelError("busy");
  await waiting();
  try { await delay(250, undefined, { signal }); }
  catch { throw new LocalModelError("cancelled"); }
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
