/** Private subprocess entry point: parent EOF or shutdown always reaps its one model server before exiting. */
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";

const [binary, serialized, directory] = process.argv.slice(2);
const args: string[] = JSON.parse(serialized);
const child = spawn(binary, args, { shell: false, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
let stopping = false;
let force: ReturnType<typeof setTimeout> | undefined;
/** No idle polling; only parent lifecycle events request model shutdown. */
function stop(): void {
  if (stopping) return;
  stopping = true; child.kill("SIGTERM");
  force = setTimeout(() => child.kill("SIGKILL"), 500); force.unref();
}
child.stderr!.pipe(process.stderr);
child.on("error", () => { process.exitCode = 1; });
child.on("close", async code => {
  if (force) clearTimeout(force);
  // This directory was freshly created by the owning adapter, never a model path.
  await rm(directory, { recursive: true, force: true }).catch(() => {});
  process.exit(stopping ? 0 : code ?? 1);
});
process.stdin.resume(); process.stdin.on("end", stop); process.stdin.on("error", stop);
process.on("SIGTERM", stop); process.on("SIGINT", stop);
