/** Actual inert subprocesses verify watchdog cleanup when its parent's diagnostic pipe disappears, without model weights. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const watchdogPath = join(__dirname, "../../llm/functionNarratives/localServerWatchdog.js");
// The child deliberately survives broken diagnostics and SIGTERM. Its own short
// lifetime prevents an orphan even when testing a broken watchdog or interrupted test.
const inertChild = `
const fs = require('node:fs');
process.on('SIGTERM', () => {});
process.stderr.on('error', () => {});
setTimeout(() => process.exit(0), 4000);
setInterval(() => process.stderr.write('inert-watchdog-diagnostic\\n'), 10);
fs.writeFileSync(process.argv[1], String(process.pid));
`;

/** Only ESRCH proves absence; an unexpected OS error must not masquerade as a reaped process. */
function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") return false;
    throw error;
  }
}

/** Observe an actual child-authored PID and delivered diagnostics before disconnecting the parent's read end. */
async function observeChild(pidPath: string, bytes: () => number): Promise<number> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const pid = Number(await readFile(pidPath, "utf8").catch(() => ""));
    if (Number.isSafeInteger(pid) && pid > 0 && bytes() > 0) return pid;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("The inert watchdog child did not publish its actual PID and diagnostics.");
}

/** The child's independent lifetime is the fallback cleanup; never signal a possibly reparented grandchild PID. */
async function awaitChildExit(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 600 && isAlive(pid); attempt++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(isAlive(pid), false, "The fixture's independent lifetime must prevent a surviving child.");
}

for (const parentEof of [true, false]) {
  test(`watchdog reaps its actual child after diagnostic EPIPE ${parentEof ? "with parent EOF" : "while parent stdin stays open"}`,
    { skip: process.platform === "win32", timeout: 15000 }, async t => {
      const root = await mkdtemp(join(tmpdir(), "fn-watchdog-"));
      let pid: number | undefined;
      try {
        const directory = await mkdtemp(join(root, "owned-")), pidPath = join(root, "child-pid");
        await writeFile(join(directory, "key"), "test-only\n", { mode: 0o600 });
        const watchdog = spawn(process.execPath, ["--max-old-space-size=32", watchdogPath, process.execPath,
          JSON.stringify(["--max-old-space-size=32", "-e", inertChild, pidPath]), directory], { stdio: ["pipe", "ignore", "pipe"] });
        const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => {
          watchdog.once("close", (code, signal) => resolve({ code, signal }));
        });
        let diagnosticBytes = 0;
        watchdog.stderr!.on("data", (chunk: Buffer) => { diagnosticBytes += chunk.length; });
        watchdog.stderr!.on("error", () => {});
        watchdog.stdin!.on("error", () => {});
        watchdog.on("error", () => {});
        try {
          pid = await observeChild(pidPath, () => diagnosticBytes);
          assert.equal(isAlive(pid), true);
          // Closing the actual pipe's read end induces a genuine EPIPE in the
          // watchdog's forwarding stream; no stream error or child state is mocked.
          watchdog.stderr!.destroy();
          if (parentEof) watchdog.stdin!.end();
          const outcome = await closed;
          const childAliveAtWatchdogClose = isAlive(pid);
          t.diagnostic(JSON.stringify({ actualInertWatchdogLifecycle: true, parentEof, watchdogPid: watchdog.pid,
            childPid: pid, watchdogExit: outcome, childAliveAtWatchdogClose, diagnosticBytes, modelLoads: 0 }));
          assert.deepEqual(outcome, { code: 0, signal: null });
          assert.equal(childAliveAtWatchdogClose, false, "Watchdog exit must follow actual child reaping.");
          await assert.rejects(access(directory), { code: "ENOENT" });
        } finally {
          watchdog.stdin!.end();
          if (watchdog.exitCode === null && watchdog.signalCode === null) watchdog.kill("SIGTERM");
          await closed;
        }
      } finally {
        try { if (pid !== undefined) await awaitChildExit(pid); }
        finally { await rm(root, { recursive: true, force: true }); }
      }
    });
}
