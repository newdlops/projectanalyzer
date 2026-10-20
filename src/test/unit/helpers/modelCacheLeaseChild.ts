/** Real Node filesystem-lease holder for cross-process cache tests; no model, network or readiness fixture is loaded. */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

const script = `
const { acquireDownloadLease } = require(process.argv[1]);
function notify(value) {
  return new Promise((resolve, reject) => process.send(value, error => error ? reject(error) : resolve()));
}
function fail(error) {
  process.stderr.write(String(error.stack || error) + "\\n");
  process.exitCode = 1;
  if (process.connected) process.disconnect();
}
(async () => {
  const release = await acquireDownloadLease(process.argv[2], new AbortController().signal, () => {});
  process.once("message", message => {
    (async () => {
      if (message.action === "release") {
        await release();
        await notify({ event: "lease-released", pid: process.pid });
      } else if (message.action !== "exit-without-release") throw new Error("Unknown lease test command");
      process.disconnect();
    })().catch(fail);
  });
  await notify({ event: "lease-acquired", pid: process.pid, filePath: process.argv[2] });
})().catch(fail);
`;

type CloseEvent = { code: number | null; signal: NodeJS.Signals | null };
type AcquiredMessage = { event: "lease-acquired"; pid: number; filePath: string };
type ReleasedMessage = { event: "lease-released"; pid: number };

/** A distinct actual child owns only this test's filesystem lease until explicitly released or exited. */
export interface ModelCacheLeaseChild {
  readonly pid: number;
  readonly acquired: AcquiredMessage;
  readonly released: ReleasedMessage | undefined;
  readonly scriptSha256: string;
  readonly productionModulePath: string;
  release(): Promise<CloseEvent>;
  exitWithoutRelease(): Promise<CloseEvent>;
  /** Reap only this spawned inert child on test failure; normal cases must already prove closed0. */
  dispose(): Promise<void>;
}

/** Bound observation time and clear its timer on every outcome; timeout never means the child exited. */
async function bounded<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(message)), milliseconds);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

/** Start the real production lease API in another Node process and authenticate its actual IPC PID/path. */
export async function startModelCacheLeaseChild(filePath: string): Promise<ModelCacheLeaseChild> {
  const productionModulePath = require.resolve("../../../storage/localModels/downloadLease");
  const child = spawn(process.execPath, ["-e", script, productionModulePath, filePath], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  let closedEvent: CloseEvent | undefined, released: ReleasedMessage | undefined, protocolError: Error | undefined, stderr = "";
  let resolveClosed!: (value: CloseEvent) => void, resolveAcquired!: (value: AcquiredMessage) => void, rejectAcquired!: (error: Error) => void;
  const closed = new Promise<CloseEvent>((resolve) => { resolveClosed = resolve; });
  const acquired = new Promise<AcquiredMessage>((resolve, reject) => { resolveAcquired = resolve; rejectAcquired = reject; });
  child.stderr!.setEncoding("utf8"); child.stderr!.on("data", (data: string) => { stderr += data; });
  child.on("error", rejectAcquired);
  child.on("close", (code, signal) => {
    closedEvent = { code, signal }; resolveClosed(closedEvent);
    rejectAcquired(new Error(`Lease child closed before acquisition: ${code}/${signal}: ${stderr}`));
  });
  child.on("message", (value) => {
    if (value && typeof value === "object" && "event" in value && value.event === "lease-acquired") {
      if (!("pid" in value) || typeof value.pid !== "number" || !Number.isSafeInteger(value.pid) || value.pid <= 0
          || value.pid !== child.pid || !("filePath" in value) || value.filePath !== filePath) {
        rejectAcquired(new Error("Actual lease child IPC identity differs"));
      } else resolveAcquired(value as AcquiredMessage);
    } else if (value && typeof value === "object" && "event" in value && value.event === "lease-released") {
      if (!("pid" in value) || value.pid !== child.pid) protocolError = new Error("Actual lease release IPC identity differs");
      else released = value as ReleasedMessage;
    }
  });

  /** Keep the same child handle; on failure reap only the process this helper actually spawned. */
  async function dispose(): Promise<void> {
    if (closedEvent) return;
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    try { await bounded(closed, 1000, "Lease child still live after SIGTERM"); }
    catch {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await bounded(closed, 3000, "Lease child close remains unproven");
    }
  }

  /** Dispatch one real IPC command and await the genuine close event; never synthesize a terminal. */
  async function finish(action: "release" | "exit-without-release"): Promise<CloseEvent> {
    if (closedEvent) throw new Error("Lease child already closed");
    await new Promise<void>((resolve, reject) => child.send({ action }, error => error ? reject(error) : resolve()));
    const result = await bounded(closed, 3000, "Lease child close observation expired");
    if (result.code !== 0 || result.signal !== null) throw new Error(`Lease child failed: ${result.code}/${result.signal}: ${stderr}`);
    if (protocolError) throw protocolError;
    if (action === "release" && !released) throw new Error("Closed child never emitted its actual successful release message");
    return result;
  }

  try {
    const message = await bounded(acquired, 3000, "Lease child acquisition observation expired");
    return { pid: message.pid, acquired: message, get released() { return released; },
      scriptSha256: createHash("sha256").update(script).digest("hex"), productionModulePath,
      release: () => finish("release"), exitWithoutRelease: () => finish("exit-without-release"), dispose };
  } catch (error) { await dispose(); throw error; }
}
