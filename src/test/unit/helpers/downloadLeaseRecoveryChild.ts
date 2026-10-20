/** Real cross-process recovery contenders; pauses preserve actual filesystem results, never model readiness. */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

const script = `
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const [modulePath, lockPath, mode, staleText] = process.argv.slice(1);
const controller = new AbortController();
let resume, resumed = false, paused = false, release, finishing = false;
const continued = new Promise(resolve => { resume = resolve; });
function notify(value) {
  return new Promise((resolve, reject) => process.send({ ...value, pid: process.pid }, error => error ? reject(error) : resolve()));
}
function fail(error) {
  process.stderr.write(String(error.stack || error) + "\\n");
  process.exitCode = 1;
  if (process.connected) process.disconnect();
}
const originalRead = fs.readFile;
fs.readFile = async (...args) => {
  const value = await originalRead(...args);
  if (mode === "stale-read" && !paused && args[0] === lockPath && String(value) === staleText) {
    paused = true;
    await notify({ event: "paused", filePath: lockPath, readSha256: createHash("sha256").update(String(value)).digest("hex") });
    await continued;
  }
  return value;
};
const originalOpen = fs.open;
fs.open = async (...args) => {
  const file = await originalOpen(...args);
  if (mode === "choosing" && !paused && path.dirname(String(args[0])) === lockPath + ".queue" && args[1] === "wx") {
    paused = true;
    await notify({ event: "paused", filePath: String(args[0]) });
    await continued;
  }
  return file;
};
process.on("message", message => {
  if (message.action === "continue") { resumed = true; resume(); }
  // This explicit test command leaves the actual on-disk participant behind;
  // observing its real close/ESRCH is required before recovery can proceed.
  else if (message.action === "exit-without-release") process.exit(0);
  else if (message.action === "release") {
    if (!release || finishing) return fail(new Error("Lease is not held"));
    finishing = true;
    release().then(() => notify({ event: "released" })).then(() => process.disconnect()).catch(fail);
  } else fail(new Error("Unknown recovery child command"));
});
process.on("disconnect", () => {
  controller.abort(); resumed = true; resume();
});
(async () => {
  await notify({ event: "started" });
  const { acquireDownloadLease } = require(modulePath);
  release = await acquireDownloadLease(lockPath, controller.signal, async () => {
    if (resumed) await notify({ event: "waiting", filePath: lockPath });
  });
  await notify({ event: "acquired", filePath: lockPath });
})().catch(error => { if (!controller.signal.aborted) fail(error); });
`;

type CloseEvent = { code: number | null; signal: NodeJS.Signals | null };
type ChildEvent = { event: string; pid: number; filePath?: string; readSha256?: string };

/** A real child handle remains available while acquisition is deliberately paused or waiting. */
export interface DownloadLeaseRecoveryChild {
  readonly pid: number;
  readonly scriptSha256: string;
  readonly paused: Promise<ChildEvent>;
  readonly waiting: Promise<ChildEvent>;
  readonly acquired: Promise<ChildEvent>;
  continue(): Promise<void>;
  release(): Promise<CloseEvent>;
  exitWithoutRelease(): Promise<CloseEvent>;
  dispose(): Promise<void>;
}

/** Expiry is only an observation error; cleanup still uses the same actual child handle. */
async function bounded<T>(promise: Promise<T>, milliseconds = 4000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Recovery child observation expired")), milliseconds);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

/** Start the unchanged production lease API in a distinct real Node process and authenticate IPC identity. */
export async function startDownloadLeaseRecoveryChild(filePath: string, mode: "stale-read" | "choosing",
  staleOwnerText = ""): Promise<DownloadLeaseRecoveryChild> {
  const modulePath = require.resolve("../../../storage/localModels/downloadLease");
  const child = spawn(process.execPath, ["-e", script, modulePath, filePath, mode, staleOwnerText],
    { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  const events = new Map<string, { promise: Promise<ChildEvent>; resolve: (value: ChildEvent) => void; reject: (error: Error) => void }>();
  for (const event of ["started", "paused", "waiting", "acquired", "released"]) {
    let resolve!: (value: ChildEvent) => void, reject!: (error: Error) => void;
    const promise = new Promise<ChildEvent>((done, fail) => { resolve = done; reject = fail; });
    void promise.catch(() => {}); events.set(event, { promise, resolve, reject });
  }
  let closeEvent: CloseEvent | undefined, stderr = "";
  let resolveClosed!: (value: CloseEvent) => void;
  const closed = new Promise<CloseEvent>((resolve) => { resolveClosed = resolve; });
  const failEvents = (error: Error) => { for (const event of events.values()) event.reject(error); };
  child.stderr!.setEncoding("utf8"); child.stderr!.on("data", (value: string) => { stderr += value; });
  child.on("error", failEvents);
  child.on("close", (code, signal) => {
    closeEvent = { code, signal }; resolveClosed(closeEvent);
    failEvents(new Error(`Recovery child closed: ${code}/${signal}: ${stderr}`));
  });
  child.on("message", (value) => {
    if (!value || typeof value !== "object" || !("pid" in value) || value.pid !== child.pid
        || !("event" in value) || typeof value.event !== "string" || !events.has(value.event)) {
      failEvents(new Error("Actual recovery child IPC identity differs")); return;
    }
    events.get(value.event)!.resolve(value as ChildEvent);
  });

  /** Only send commands through this exact spawned child; never signal a guessed/reparented PID. */
  async function send(action: string): Promise<void> {
    if (closeEvent) throw new Error("Recovery child already closed");
    await new Promise<void>((resolve, reject) => child.send({ action }, error => error ? reject(error) : resolve()));
  }
  async function finish(action: "release" | "exit-without-release"): Promise<CloseEvent> {
    await send(action);
    const result = await bounded(closed);
    if (result.code !== 0 || result.signal !== null) throw new Error(`Recovery child failed: ${result.code}/${result.signal}: ${stderr}`);
    if (action === "release") await events.get("released")!.promise;
    return result;
  }
  async function dispose(): Promise<void> {
    if (closeEvent) return;
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    try { await bounded(closed, 1000); }
    catch {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await bounded(closed);
    }
  }
  try {
    const started = await bounded(events.get("started")!.promise);
    return { pid: started.pid, scriptSha256: createHash("sha256").update(script).digest("hex"),
      paused: events.get("paused")!.promise, waiting: events.get("waiting")!.promise, acquired: events.get("acquired")!.promise,
      continue: () => send("continue"), release: () => finish("release"),
      exitWithoutRelease: () => finish("exit-without-release"), dispose };
  } catch (error) { await dispose(); throw error; }
}
