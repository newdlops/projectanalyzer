/** On-demand local GGUF inference; a process owns model memory for one explicit request. */
import { spawn } from "node:child_process";
import { access, mkdtemp, writeFile, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { FunctionNarrativeError, type FunctionNarrativeProvider } from "../../application/functionNarratives";
import { createLocalNarrativeSchema } from "./responseSchema";
import { buildLocalNarrativePrompt, buildLocalNarrativeSystemPrompt } from "./localPrompt";
export type LocalFunctionNarrativeOptions = { binaryPath: string; modelPath: string };

// Shared across provider instances so changing model settings cannot load two models at once.
let sequence = 0;
let active: { controller: AbortController; finished: Promise<void> } | undefined;

/** No daemon, model download or activation-time work. Concurrent surfaces share one request queue. */
export function createLocalFunctionNarrativeProvider(options: LocalFunctionNarrativeOptions): FunctionNarrativeProvider {
  return { async generate(context, language, signal) {
    const ticket = ++sequence;
    const prior = active; prior?.controller.abort(); await prior?.finished;
    if (signal.aborted || ticket !== sequence) throw new FunctionNarrativeError("cancelled");
    const controller = new AbortController();
    let finish: () => void = () => {};
    const current = { controller, finished: new Promise<void>((resolve) => { finish = resolve; }) }; active = current;
    const abort = () => controller.abort(); signal.addEventListener("abort", abort, { once: true });
    let directory: string | undefined;
    try {
      if (!options.binaryPath || !options.modelPath) throw new FunctionNarrativeError("unavailable");
      await access(options.modelPath).catch(() => { throw new FunctionNarrativeError("unavailable"); });
      if (controller.signal.aborted) throw new FunctionNarrativeError("cancelled");
      directory = await mkdtemp(join(tmpdir(), "function-narrative-"));
      const promptFile = join(directory, "prompt.txt");
      const systemFile = join(directory, "system.txt");
      const schemaFile = join(directory, "schema.json");
      const prompt = buildLocalNarrativePrompt(context, language);
      await writeFile(promptFile, prompt, { encoding: "utf8", mode: 0o600 });
      await writeFile(systemFile, buildLocalNarrativeSystemPrompt(language), { encoding: "utf8", mode: 0o600 });
      // Fixed grammar fields contain source predicates/operations too. Keep
      // them in the same private lifecycle as prompts, never in process argv.
      await writeFile(schemaFile, JSON.stringify(createLocalNarrativeSchema(context, language)), { encoding: "utf8", mode: 0o600 });
      const text = await runLocalModel(options.binaryPath, ["--model", options.modelPath, "--file", promptFile, "--system-prompt-file", systemFile,
        // The completion runner's Jinja tool-template probe rejects Qwen3.5's
        // current template before inference. These text-only, tool-free requests
        // use its ChatML roles and direct constrained JSON decoding instead.
        ...(/^qwen3[.\-]/iu.test(basename(options.modelPath)) ? ["--chat-template", "chatml", "--no-jinja", "--reasoning", "off"] : []),
        "--single-turn", "--simple-io", "--no-display-prompt", "--no-escape", "--offline", "--no-warmup",
        "--ctx-size", "8192", "--predict", "2400", "--threads", "2", "--threads-batch", "2", "--poll", "0",
        "--temp", "0.2", "--seed", "42", "--json-schema-file", schemaFile], controller.signal);
      return { modelName: ("Local · " + basename(options.modelPath, ".gguf")).slice(0, 100), text };
    } finally {
      signal.removeEventListener("abort", abort);
      try { if (directory) await rm(directory, { recursive: true, force: true }); }
      finally { if (active === current) active = undefined; finish(); }
    }
  } };
}

/** Output is bounded, prompts stay out of argv, and cancellation waits for process exit before reuse. */
function runLocalModel(binaryPath: string, args: string[], signal: AbortSignal): Promise<string> {
  if (signal.aborted) return Promise.reject(new FunctionNarrativeError("cancelled"));
  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; let oversized = false; let killTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      child.kill("SIGTERM");
      if (!killTimer) { killTimer = setTimeout(() => child.kill("SIGKILL"), 500); killTimer.unref(); }
    };
    const cleanup = () => { signal.removeEventListener("abort", stop); if (killTimer) clearTimeout(killTimer); };
    signal.addEventListener("abort", stop, { once: true });
    child.stdout.setEncoding("utf8"); child.stdout.on("data", (part: string) => {
      if (output.length + part.length > 24000) { oversized = true; stop(); } else if (!oversized) output += part;
    });
    // Drain diagnostics without retaining/logging source or model prose in the extension host.
    child.stderr.resume();
    child.once("error", (error: NodeJS.ErrnoException) => { cleanup(); reject(new FunctionNarrativeError(error.code === "ENOENT" ? "unavailable" : "failed")); });
    child.once("close", (code) => {
      cleanup();
      if (signal.aborted) reject(new FunctionNarrativeError("cancelled"));
      else if (oversized) reject(new FunctionNarrativeError("invalid-response"));
      else if (code !== 0) reject(new FunctionNarrativeError("failed"));
      else resolve(output.trim().replace(/\s*\[end of text\]\s*$/u, ""));
    });
  });
}
