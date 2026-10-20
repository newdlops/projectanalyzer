/** Short cross-process metadata gate; downloads never hold this gate while streaming or hashing.
 *
 * Unique participant files implement choosing/ticket ordering from Lamport's bakery
 * algorithm (https://lamport.azurewebsites.net/pubs/bakery.pdf). Atomic replacement
 * publishes a ticket. A later participant sees existing tickets before choosing its
 * own; equal tickets use the immutable UUID as a tie-breaker. Only dead participants
 * or owner-requested local cleanups can be removed. Unique paths are never reused,
 * avoiding the shared-lock unlink race this gate protects against.
 */
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, rmdir } from "node:fs/promises";
import * as path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { LocalModelError } from "../../../shared/localModels";
import { hasCode, isProcessAlive } from "./filesystem";
import { hasPendingCleanup, retainCleanup, retryCleanup, retryPendingCleanups } from "./pendingCleanup";

type Participant = { pid: number; token: string; ticket: number; choosing: boolean };
const participantName = /^([1-9]\d*)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$/;

/** Run one metadata transaction, then actually release its participant before delivering a result. */
export async function withLeaseGate<T>(leasePath: string, signal: AbortSignal, deadline: number,
  waiting: () => void | Promise<void>, action: () => Promise<T>): Promise<T> {
  const directory = leasePath + ".queue";
  const token = randomUUID();
  const participant: Participant = { pid: process.pid, token, ticket: 0, choosing: true };
  const filePath = path.join(directory, `${process.pid}-${token}.json`);
  let directoryTouched = false, owned = false, failed = false;
  try {
    await retryPendingCleanups(directory);
    // Empty-directory cleanup can race a newcomer before its exclusive file is
    // created. Retry that ENOENT, without changing the original deadline.
    while (!owned) {
      checkEntry(signal, deadline);
      await mkdir(directory, { mode: 0o700 }).catch((error) => { if (!hasCode(error, "EEXIST")) throw error; });
      directoryTouched = true;
      let file;
      try { file = await open(filePath, "wx", 0o600); }
      catch (error) { if (hasCode(error, "ENOENT")) continue; throw error; }
      owned = true;
      try { await file.writeFile(JSON.stringify(participant)); }
      finally { await file.close(); }
    }
    const peers = await participants(directory, token);
    const maximum = peers.reduce((value, peer) => Math.max(value, peer.ticket), 0);
    if (maximum >= Number.MAX_SAFE_INTEGER) throw new LocalModelError("busy");
    participant.ticket = maximum + 1; participant.choosing = false;
    await publishTicket(filePath, participant);
    while (true) {
      checkEntry(signal, deadline);
      const current = await participants(directory, token);
      const blocked = current.some((peer) => peer.choosing || peer.ticket < participant.ticket
        || (peer.ticket === participant.ticket && peer.token < token));
      if (!blocked) { checkEntry(signal, deadline); return await action(); }
      await waiting();
      try { await delay(25, undefined, { signal }); }
      catch { throw new LocalModelError("cancelled"); }
    }
  } catch (error) { failed = true; throw error; }
  finally {
    if (directoryTouched) {
      try {
        await retainCleanup(directory, token, async () => {
          if (owned) await removeParticipant(filePath);
          await removeEmptyDirectory(directory);
        });
      } catch (error) {
        // Failed removal stays retryable across cache replacement/disposal. A
        // cleanup failure must not replace the original transaction failure.
        if (!failed) throw error;
      }
    }
  }
}

/** A complete ticket replaces the choosing record atomically; no peer reads a partially updated ticket. */
async function publishTicket(filePath: string, participant: Participant): Promise<void> {
  const temporary = filePath + ".next";
  const file = await open(temporary, "wx", 0o600);
  try { await file.writeFile(JSON.stringify(participant)); }
  finally { await file.close(); }
  await rename(temporary, filePath);
}

/** Read real participants and retire only unique paths whose actual owner is gone or releasing. */
async function participants(directory: string, ownToken: string): Promise<Participant[]> {
  const result: Participant[] = [];
  const names = await readdir(directory);
  for (const name of names) {
    const match = participantName.exec(name);
    if (!match || match[2] === ownToken) continue;
    const pid = Number(match[1]), token = match[2], filePath = path.join(directory, name);
    if (!Number.isSafeInteger(pid)) throw new LocalModelError("storage");
    if (pid === process.pid && hasPendingCleanup(directory, token)) {
      await retryCleanup(directory, token); continue;
    }
    if (!isProcessAlive(pid)) { await removeParticipant(filePath); continue; }
    let contents: string;
    try { contents = await readFile(filePath, "utf8"); }
    catch (error) { if (hasCode(error, "ENOENT")) continue; throw error; }
    let value: unknown;
    try { value = JSON.parse(contents); }
    catch {
      // The exclusive file exists before its initial choosing write completes.
      // An alive participant with an incomplete record must block, never vanish.
      result.push({ pid, token, ticket: 0, choosing: true }); continue;
    }
    if (!validParticipant(value, pid, token)) throw new LocalModelError("storage");
    result.push(value);
  }
  return result;
}

/** Identity comes from the exclusive filename and must match the complete on-disk record. */
function validParticipant(value: unknown, pid: number, token: string): value is Participant {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<Participant>;
  return record.pid === pid && record.token === token && Number.isSafeInteger(record.ticket)
    && (record.choosing === true ? record.ticket === 0 : record.choosing === false && record.ticket! > 0);
}

/** These names belong to one immutable UUID, so a stale reader cannot remove a successor's participant. */
async function removeParticipant(filePath: string): Promise<void> {
  await rm(filePath + ".next", { force: true });
  await rm(filePath, { force: true });
}

/** Never recursively remove a shared directory. Existing participants make rmdir fail harmlessly. */
async function removeEmptyDirectory(directory: string): Promise<void> {
  try { await rmdir(directory); }
  catch (error) { if (!["ENOENT", "ENOTEMPTY", "EEXIST"].some((code) => hasCode(error, code))) throw error; }
}

/** Deadline is the caller's original wall-clock millisecond bound; joining never resets it. */
function checkEntry(signal: AbortSignal, deadline: number): void {
  if (signal.aborted) throw new LocalModelError("cancelled");
  if (Date.now() >= deadline) throw new LocalModelError("busy");
}
