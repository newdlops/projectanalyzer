/** On-demand local GGUF inference; the FIFO owner reuses a preinstalled server and reaps it on idle or cancellation. */
import { spawn } from "node:child_process";
import { access, mkdtemp, writeFile, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { FunctionNarrativeError, scheduleFunctionNarrativePreparation, scheduleFunctionNarrativeRequest, buildSourceFunctionNarrativeResponse, buildPrimitiveNarrativeSynthesis,
  type FunctionNarrativeOperationOptions, type FunctionNarrativeProvider } from "../../application/functionNarratives";
import { getGlobalModelTaskManager, type ModelTaskManager } from "../../shared/modelTasks";
import { createLocalNarrativeSchema } from "./responseSchema";
import { buildLocalNarrativePrompt, buildLocalNarrativeSystemPrompt, buildLocalNarrativeUserMessages, buildLocalFunctionPurposeMessages } from "./localPrompt";
import { normalizeLocalNarrativeResponse } from "./localResponse";
import { createLocalNarrativeWire } from "./localWire";
import { classifyRunnerFailure, getLocalNarrativeServer, type LocalNarrativeMetrics, type LocalNarrativeServer } from "./localServer";
export type LocalFunctionNarrativeOptions = { binaryPath: string; modelPath: string; taskManager?: ModelTaskManager; onMetrics?(metrics: LocalNarrativeMetrics): void };

/** No activation-time model work. A missing companion/custom runner retains bounded CLI execution. */
export function createLocalFunctionNarrativeProvider(options: LocalFunctionNarrativeOptions): FunctionNarrativeProvider {
  const manager = options.taskManager ?? getGlobalModelTaskManager();
  let serverProbe: Promise<LocalNarrativeServer | undefined> | undefined;
  /** Preparing weights is distinct from reading source; both still share one FIFO resource owner. */
  const prepare = async (_language: "ko" | "en", signal: AbortSignal, preparation?: FunctionNarrativeOperationOptions) => {
    if (signal.aborted || manager.disposed) throw new FunctionNarrativeError("cancelled");
    if (preparation?.sourceReading) return;
    const server = await (serverProbe ??= getLocalNarrativeServer(manager, options));
    if (!server || server.isPrepared) return;
    // An adapter already inside an inference lease must not enqueue behind
    // itself; generate retains its bounded readiness fallback in that case.
    if (manager.isExecuting(signal)) return;
    await scheduleFunctionNarrativePreparation(manager, signal, async operation => {
      await access(options.modelPath).catch(() => { throw new FunctionNarrativeError("unavailable", "model-not-found"); });
      await server.prepare(operation);
    }, preparation, server);
  };
  return { managesDeadlines: true, supportsFinalSummary: () => true,
    prepare,
    async withRun(_language, signal, operation) {
      if (signal.aborted || manager.disposed) throw new FunctionNarrativeError("cancelled");
      const server = await (serverProbe ??= getLocalNarrativeServer(manager, options));
      if (signal.aborted) throw new FunctionNarrativeError("cancelled");
      return server ? manager.withResource(server, operation, signal) : operation();
    }, async generate(context, language, signal, generation) {
    if (signal.aborted || manager.disposed) throw new FunctionNarrativeError("cancelled");
    const source = buildSourceFunctionNarrativeResponse(context, language);
    if (source) return source;
    const synthesis = buildPrimitiveNarrativeSynthesis(context, language);
    const modelName = ("Local · " + basename(options.modelPath, ".gguf")).slice(0, 100);
    if (synthesis && context.summaryTask?.knownFunctionSummary) {
      return { modelName, text: JSON.stringify({ ...synthesis, summary: context.summaryTask.knownFunctionSummary }) };
    }
    const server = await (serverProbe ??= getLocalNarrativeServer(manager, options));
    await prepare(language, signal, { ...generation, sourceReading: false });
    return scheduleFunctionNarrativeRequest(manager, context.functionName, signal, async signal => {
    let directory: string | undefined;
    try {
      if (!options.binaryPath || !options.modelPath) throw new FunctionNarrativeError("unavailable");
      await access(options.modelPath).catch(() => { throw new FunctionNarrativeError("unavailable", "model-not-found"); });
      if (signal.aborted) throw new FunctionNarrativeError("cancelled");
      const fullSchema = createLocalNarrativeSchema(context, language);
      const wire = !synthesis && (context.detailLevel === "rich" || context.callTask) ? createLocalNarrativeWire(fullSchema) : undefined;
      const schema = synthesis ? { type: "object", additionalProperties: false, required: ["summary"],
        properties: { summary: (fullSchema.properties as Record<string, unknown>).summary } } : wire?.schema ?? fullSchema;
      const purposeMessages = synthesis && buildLocalFunctionPurposeMessages(context, language, schema);
      const prompt = purposeMessages ? purposeMessages.join("\n") : buildLocalNarrativePrompt(context, language, wire?.schema);
      const complete = (text: string) => {
        if (!synthesis) return normalizeLocalNarrativeResponse(wire?.decode(text) ?? text, context);
        let purpose: unknown;
        try { purpose = JSON.parse(text); } catch { throw new FunctionNarrativeError("invalid-response"); }
        if (!purpose || typeof purpose !== "object" || Array.isArray(purpose) || Object.keys(purpose).length !== 1
          || !("summary" in purpose) || typeof purpose.summary !== "string" || !purpose.summary.trim() || purpose.summary.length > 240) {
          throw new FunctionNarrativeError("invalid-response");
        }
        return JSON.stringify({ ...synthesis, summary: purpose.summary });
      };
      if (server) {
        // Only the explicit ChatML adapter accepts adjacent user evidence/task
        // messages. Other model templates retain their single-user contract.
        const messages = /^qwen3[.\-]/iu.test(basename(options.modelPath)) ? purposeMessages || buildLocalNarrativeUserMessages(context, language, wire?.schema) : prompt;
        const text = await server.generate(messages,
          buildLocalNarrativeSystemPrompt(language), schema, signal, options.onMetrics);
        return { modelName, text: complete(text) };
      }
      // The socket path uses memory only. Create private prompt files solely
      // when a legacy/custom runner actually needs the CLI fallback.
      directory = await mkdtemp(join(tmpdir(), "function-narrative-"));
      const promptFile = join(directory, "prompt.txt");
      const systemFile = join(directory, "system.txt");
      const schemaFile = join(directory, "schema.json");
      await writeFile(promptFile, prompt, { encoding: "utf8", mode: 0o600 });
      await writeFile(systemFile, buildLocalNarrativeSystemPrompt(language), { encoding: "utf8", mode: 0o600 });
      // Fixed grammar fields contain source predicates/operations too. Keep
      // them in the same private lifecycle as prompts, never in process argv.
      await writeFile(schemaFile, JSON.stringify(schema), { encoding: "utf8", mode: 0o600 });
      const text = await runLocalModel(options.binaryPath, ["--model", options.modelPath, "--file", promptFile, "--system-prompt-file", systemFile,
        // The completion runner's Jinja tool-template probe rejects Qwen3.5's
        // current template before inference. These text-only, tool-free requests
        // use its ChatML roles and direct constrained JSON decoding instead.
        ...(/^qwen3[.\-]/iu.test(basename(options.modelPath)) ? ["--chat-template", "chatml", "--no-jinja", "--reasoning", "off"] : []),
        "--single-turn", "--simple-io", "--no-display-prompt", "--no-escape", "--offline", "--no-warmup",
        "--ctx-size", "8192", "--predict", "2400", "--threads", "2", "--threads-batch", "2", "--poll", "0",
        "--temp", "0.2", "--seed", "42", "--json-schema-file", schemaFile], signal);
      return { modelName, text: complete(text) };
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
