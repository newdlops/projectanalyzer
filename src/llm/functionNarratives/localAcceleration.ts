/** Optional runner acceleration is enabled only when its own bounded help output advertises every required flag. */
import { execFile } from "node:child_process";

/** Probe on the first scheduled inference, never activation; old/custom runners keep their existing arguments. */
export function detectLocalNarrativeAcceleration(binaryPath: string, signal: AbortSignal): Promise<string[]> {
  return new Promise(resolve => {
    execFile(binaryPath, ["--help"], { shell: false, windowsHide: true, timeout: 5000, maxBuffer: 131072, signal },
      (error, stdout, stderr) => resolve(error ? [] : localNarrativeAccelerationArgs(stdout + "\n" + stderr)));
  });
}

/** Bounded checkpoints retain the original model, grammar, sampling and output limits. */
export function localNarrativeAccelerationArgs(help: string): string[] {
  const supports = (flag: string) => new RegExp("(?:^|\\s)" + flag + "(?:\\s|,|$)", "mu").test(help);
  const args: string[] = [];
  if (["--ctx-checkpoints", "--checkpoint-min-step", "--cache-ram"].every(supports)) {
    // Checkpoint count is independent of the RAM prompt-cache limit. Both are
    // explicitly bounded; no model/source state survives request completion.
    args.push("--ctx-checkpoints", "8", "--checkpoint-min-step", "64", "--cache-ram", "256");
  }
  // Recurrent verification copies a large state for every speculative attempt.
  // Short JSON prose was slower with n-grams in the measured workload.
  if (supports("--spec-type")) args.push("--spec-type", "none");
  return args;
}
