/** Optional runner acceleration is enabled only when its own bounded help output advertises every required flag. */
import { execFile } from "node:child_process";
import { basename } from "node:path";

/** Probe on the first scheduled inference, never activation; old/custom runners keep their existing arguments. */
export function detectLocalNarrativeAcceleration(binaryPath: string, modelPath: string, signal: AbortSignal): Promise<string[]> {
  return new Promise(resolve => {
    execFile(binaryPath, ["--help"], { shell: false, windowsHide: true, timeout: 5000, maxBuffer: 131072, signal },
      (error, stdout, stderr) => resolve(error ? [] : localNarrativeAccelerationArgs(stdout + "\n" + stderr, modelPath)));
  });
}

/** Bounded checkpoints and target-verified n-grams retain the original model, grammar, sampling and output limits. */
export function localNarrativeAccelerationArgs(help: string, modelPath: string): string[] {
  const supports = (flag: string) => new RegExp("(?:^|\\s)" + flag + "(?:\\s|,|$)", "mu").test(help);
  const args: string[] = [];
  if (["--ctx-checkpoints", "--checkpoint-min-step", "--cache-ram"].every(supports)) {
    // Checkpoint count is independent of the RAM prompt-cache limit. Both are
    // explicitly bounded; no model/source state survives request completion.
    args.push("--ctx-checkpoints", "8", "--checkpoint-min-step", "64", "--cache-ram", "256");
  }
  // This setting is measured with the bundled Qwen3.5 worksheet contract. Other
  // models retain ordinary decoding rather than assuming a performance benefit.
  if (/^qwen3\.5[.\-]/iu.test(basename(modelPath)) && /--spec-type[^\r\n]*\bngram-map-k(?=,|\s|$)/u.test(help)
    && ["--spec-type", "--spec-ngram-map-k-size-n", "--spec-ngram-map-k-size-m"].every(supports)) {
    args.push("--spec-type", "ngram-map-k", "--spec-ngram-map-k-size-n", "4", "--spec-ngram-map-k-size-m", "8");
  }
  return args;
}
