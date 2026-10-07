/** On-demand local GGUF inference; the FIFO owner reuses a preinstalled server and reaps it on idle or cancellation. */
import { spawn } from "node:child_process";
import { access, mkdtemp, writeFile, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { FunctionNarrativeError, scheduleFunctionNarrativeRequest, type FunctionNarrativeProvider } from "../../application/functionNarratives";
import { getGlobalModelTaskManager, type ModelTaskManager } from "../../shared/modelTasks";
import { createLocalNarrativeSchema } from "./responseSchema";
import { buildLocalNarrativePrompt, buildLocalNarrativeSystemPrompt } from "./localPrompt";
import { normalizeLocalNarrativeResponse } from "./localResponse";
import { createLocalNarrativeWire } from "./localWire";
import { classifyRunnerFailure, getLocalNarrativeServer, type LocalNarrativeMetrics, type LocalNarrativeServer } from "./localServer";
export type LocalFunctionNarrativeOptions = { binaryPath: string; modelPath: string; taskManager?: ModelTaskManager; onMetrics?(metrics: LocalNarrativeMetrics): void };

/** No activation-time model work. A missing companion/custom runner retains bounded CLI execution. */
export function createLocalFunctionNarrativeProvider(options: LocalFunctionNarrativeOptions): FunctionNarrativeProvider {
  const manager = options.taskManager ?? getGlobalModelTaskManager();
  let serverProbe: Promise<LocalNarrativeServer | undefined> | undefined;
  return { managesDeadlines: true, async generate(context, language, signal, generation) {
    const server = await (serverProbe ??= getLocalNarrativeServer(manager, options));
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
      const fullSchema = createLocalNarrativeSchema(context, language);
      const wire = context.detailLevel === "rich" || context.callTask ? createLocalNarrativeWire(fullSchema) : undefined;
      const prompt = buildLocalNarrativePrompt(context, language, wire?.schema);
      if (server) {
        const text = await server.generate(prompt, buildLocalNarrativeSystemPrompt(language), wire?.schema ?? fullSchema, signal, options.onMetrics);
        return { modelName: ("Local · " + basename(options.modelPath, ".gguf")).slice(0, 100), text: normalizeLocalNarrativeResponse(wire?.decode(text) ?? text, context) };
      }
      await writeFile(promptFile, prompt, { encoding: "utf8", mode: 0o600 });
      await writeFile(systemFile, buildLocalNarrativeSystemPrompt(language), { encoding: "utf8", mode: 0o600 });
      // Fixed grammar fields contain source predicates/operations too. Keep
      // them in the same private lifecycle as prompts, never in process argv.
      await writeFile(schemaFile, JSON.stringify(wire?.schema ?? fullSchema), { encoding: "utf8", mode: 0o600 });
      const text = await runLocalModel(options.binaryPath, ["--model", options.modelPath, "--file", promptFile, "--system-prompt-file", systemFile,
        // The completion runner's Jinja tool-template probe rejects Qwen3.5's
        // current template before inference. These text-only, tool-free requests
        // use its ChatML roles and direct constrained JSON decoding instead.
        ...(/^qwen3[.\-]/iu.test(basename(options.modelPath)) ? ["--chat-template", "chatml", "--no-jinja", "--reasoning", "off"] : []),
        "--single-turn", "--simple-io", "--no-display-prompt", "--no-escape", "--offline", "--no-warmup",
        "--ctx-size", "8192", "--predict", "2400", "--threads", "2", "--threads-batch", "2", "--poll", "0",
        "--temp", "0.2", "--seed", "42", "--json-schema-file", schemaFile], signal);
      return { modelName: ("Local · " + basename(options.modelPath, ".gguf")).slice(0, 100), text: normalizeLocalNarrativeResponse(wire?.decode(text) ?? text, context) };
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true });
    }
    }, { ...generation, resource: server });
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
