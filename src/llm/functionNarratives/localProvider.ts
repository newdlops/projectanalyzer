/** On-demand local GGUF inference; a process owns model memory for one explicit request. */
import { spawn } from "node:child_process";
import { access, mkdtemp, writeFile, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { FunctionNarrativeError, scheduleFunctionNarrativeRequest, type FunctionNarrativeProvider } from "../../application/functionNarratives";
import { getGlobalModelTaskManager, type ModelTaskManager } from "../../shared/modelTasks";
import { createLocalNarrativeSchema } from "./responseSchema";
import { buildLocalNarrativePrompt, buildLocalNarrativeSystemPrompt } from "./localPrompt";
import { normalizeLocalNarrativeResponse } from "./localResponse";
export type LocalFunctionNarrativeOptions = { binaryPath: string; modelPath: string; taskManager?: ModelTaskManager };

/** No daemon, model download or activation-time work. Concurrent surfaces share one request queue. */
export function createLocalFunctionNarrativeProvider(options: LocalFunctionNarrativeOptions): FunctionNarrativeProvider {
  const manager = options.taskManager ?? getGlobalModelTaskManager();
  return { managesDeadlines: true, generate(context, language, signal, generation) {
    return scheduleFunctionNarrativeRequest(manager, context.functionName, signal, async signal => {
    let directory: string | undefined;
    try {
      if (!options.binaryPath || !options.modelPath) throw new FunctionNarrativeError("unavailable");
      await access(options.modelPath).catch(() => { throw new FunctionNarrativeError("unavailable", "model-not-found"); });
      if (signal.aborted) throw new FunctionNarrativeError("cancelled");
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
        "--temp", "0.2", "--seed", "42", "--json-schema-file", schemaFile], signal);
      return { modelName: ("Local · " + basename(options.modelPath, ".gguf")).slice(0, 100), text: normalizeLocalNarrativeResponse(text, context) };
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true });
    }
    }, generation);
  } };
}

/** Output is bounded, prompts stay out of argv, and cancellation waits for process exit before reuse. */
function runLocalModel(binaryPath: string, args: string[], signal: AbortSignal): Promise<string> {
  if (signal.aborted) return Promise.reject(new FunctionNarrativeError("cancelled"));
  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "", diagnostics = ""; let oversized = false; let killTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      child.kill("SIGTERM");
      if (!killTimer) { killTimer = setTimeout(() => child.kill("SIGKILL"), 500); killTimer.unref(); }
    };
    const cleanup = () => { signal.removeEventListener("abort", stop); if (killTimer) clearTimeout(killTimer); };
    signal.addEventListener("abort", stop, { once: true });
    child.stdout.setEncoding("utf8"); child.stdout.on("data", (part: string) => {
      if (output.length + part.length > 24000) { oversized = true; stop(); } else if (!oversized) output += part;
    });
    // Inspect only a bounded diagnostic tail. Neither it nor exception text is
    // logged/returned; the queue retains controlled categories only.
    child.stderr.setEncoding("utf8"); child.stderr.on("data", (part: string) => { diagnostics = (diagnostics + part).slice(-8192); });
    child.once("error", (error: NodeJS.ErrnoException) => { cleanup(); reject(new FunctionNarrativeError(error.code === "ENOENT" ? "unavailable" : "failed", error.code === "ENOENT" ? "runner-not-found" : "spawn-failed")); });
    child.once("close", (code, terminationSignal) => {
      cleanup();
      if (signal.aborted) reject(new FunctionNarrativeError("cancelled"));
      else if (oversized) reject(new FunctionNarrativeError("invalid-response", "output-limit"));
      else if (code !== 0) {
        const category = classifyRunnerFailure(diagnostics);
        reject(new FunctionNarrativeError(category === "input-window" ? "context-too-large" : "failed",
          category ?? (code === null ? "signal-" + String(terminationSignal).toLowerCase() : "exit-" + code)));
      }
      else resolve(output.trim().replace(/\s*\[end of text\]\s*$/u, ""));
    });
  });
}

/** Controlled, actionable diagnostics replace generic connection guidance without exposing stderr. */
function classifyRunnerFailure(diagnostics: string): string | undefined {
  if (/prompt[^\n]*(?:too long|exceeds)|context (?:size|window)[^\n]*(?:exceed|too small)/iu.test(diagnostics)) return "input-window";
  if (/out of memory|cannot allocate|failed to allocate|bad_alloc|insufficient memory/iu.test(diagnostics)) return "memory-allocation";
  if (/failed to (?:load|open) (?:model|gguf)|invalid gguf|error loading model/iu.test(diagnostics)) return "model-load";
  if (/unrecognized (?:argument|option)|unknown (?:argument|option)|invalid (?:argument|option)/iu.test(diagnostics)) return "runner-arguments";
  if (/JSON schema (?:conversion failed|error)|failed to (?:parse|build) grammar|error (?:parsing|building) grammar|grammar[^\n]*(?:error|invalid)/iu.test(diagnostics)) return "response-grammar";
  return undefined;
}
