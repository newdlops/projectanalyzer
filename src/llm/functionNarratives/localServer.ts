/** One scheduler-owned local model serves consecutive requests through a private Unix socket, then exits on idle. */
import { spawn, type ChildProcess } from "node:child_process";
import { access, mkdtemp, writeFile, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { request } from "node:http";
import type { ModelTaskManager, ModelTaskResource } from "../../shared/modelTasks";
import { FunctionNarrativeError } from "../../shared/functionNarratives";
import { detectLocalNarrativeAcceleration } from "./localAcceleration";

type ServerOptions = { binaryPath: string; modelPath: string };
export type LocalNarrativeMetrics = { promptTokens: number; cachedTokens: number; outputTokens: number; promptMs: number; outputMs: number;
  /** Full response latency after model readiness, including template/transport work, in milliseconds. */
  generationMs: number };
type Json = Record<string, any>;
const servers = new WeakMap<ModelTaskManager, Map<string, LocalNarrativeServer>>();

/** Only official CLI names opt into a preinstalled companion; custom runners and Windows keep the CLI boundary. */
export async function getLocalNarrativeServer(manager: ModelTaskManager, options: ServerOptions): Promise<LocalNarrativeServer | undefined> {
  if (process.platform === "win32" || !/^(?:llama-completion|llama-cli)$/u.test(basename(options.binaryPath))) return undefined;
  const binaryPath = join(dirname(options.binaryPath), "llama-server");
  if (!await access(binaryPath, constants.X_OK).then(() => true, () => false)) return undefined;
  const key = binaryPath + "\0" + options.modelPath;
  let pool = servers.get(manager);
  if (!pool) { pool = new Map(); servers.set(manager, pool); }
  let server = pool.get(key);
  if (!server) { server = new LocalNarrativeServer({ binaryPath, modelPath: options.modelPath }); pool.set(key, server); }
  // Inactive controllers retain only paths. The manager owns the sole live process.
  while (pool.size > 8) pool.delete(pool.keys().next().value!);
  return server;
}

/** Process lifetime is external to an individual response but remains under one FIFO resource owner. */
export class LocalNarrativeServer implements ModelTaskResource {
  private directory?: string;
  private socket?: string;
  private key?: string;
  private child?: ChildProcess;
  private closed?: Promise<void>;
  private starting?: Promise<void>;
  private diagnostics = "";
  private exitError?: FunctionNarrativeError;
  private acceleration?: string[];
  private prepared = false;
  public constructor(private readonly options: ServerOptions) {}

  /** True only after the runner health check; idle cleanup clears it with the owned process. */
  public get isPrepared(): boolean { return this.prepared; }

  /** Model prompts stay in memory; no TCP listener, shell interpolation or source in process arguments. */
  public async generate(prompt: string | readonly string[], system: string, schema: Record<string, unknown>, signal: AbortSignal,
    onMetrics?: (metrics: LocalNarrativeMetrics) => void): Promise<string> {
    await this.prepare(signal);
    const started = performance.now();
    const template = await this.json("POST", "/apply-template", { messages: [{ role: "system", content: system },
      ...(typeof prompt === "string" ? [prompt] : prompt).map(content => ({ role: "user", content }))] }, signal);
    if (typeof template.body.prompt !== "string") throw new FunctionNarrativeError("failed", "runner-template");
    // The tool-free ChatML fallback does not include Qwen3.5's official
    // non-thinking assistant prefix. Complete that prefix before constrained
    // generation, rather than forcing JSON inside an unfinished thinking turn.
    const promptText = /^qwen3\.5-/iu.test(basename(this.options.modelPath))
      && template.body.prompt.endsWith("<|im_start|>assistant\n")
      ? template.body.prompt + "<think>\n\n</think>\n\n" : template.body.prompt;
    const reply = await this.json("POST", "/completion", { prompt: promptText, json_schema: schema,
      // Raw completion does not infer ChatML message spans from its prompt.
      // These exact delimiters let recurrent checkpoints retain source evidence
      // before the changing final user message; other templates stay untouched.
      ...(/^qwen3[.\-]/iu.test(basename(this.options.modelPath)) ? { message_delimiters:
        ["system", "user", "assistant"].map(role => ({ role, delimiter: "<|im_start|>" + role + "\n" })) } : {}),
      n_predict: 2400, temperature: 0.2, seed: 42, cache_prompt: true, id_slot: 0, stream: false }, signal);
    if (reply.status !== 200) {
      const detail = classifyRunnerFailure(JSON.stringify(reply.body.error ?? {})) ?? "runner-response";
      throw new FunctionNarrativeError(detail === "input-window" ? "context-too-large" : "failed", detail);
    }
    if (reply.body.truncated) throw new FunctionNarrativeError("context-too-large", "input-window");
    if (typeof reply.body.content !== "string" || reply.body.content.length > 24000) {
      throw new FunctionNarrativeError("invalid-response", "output-limit");
    }
    const timing = reply.body.timings;
    if (timing && onMetrics) {
      try { onMetrics({ promptTokens: timing.prompt_n ?? 0, cachedTokens: timing.cache_n ?? 0,
        outputTokens: timing.predicted_n ?? 0, promptMs: timing.prompt_ms ?? 0, outputMs: timing.predicted_ms ?? 0,
        generationMs: performance.now() - started }); }
      catch { /* A source-free measurement observer cannot invalidate model work. */ }
    }
    return reply.body.content.trim();
  }

  /** Await process reaping before deleting private socket/key files or allowing another model to load. */
  public async release(): Promise<void> {
    const child = this.child;
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      const force = setTimeout(() => child.kill("SIGKILL"), 2000); force.unref();
      try { await this.closed; } finally { clearTimeout(force); }
    } else await this.closed;
    const directory = this.directory;
    this.child = undefined; this.closed = undefined; this.starting = undefined; this.directory = undefined;
    this.socket = undefined; this.key = undefined; this.exitError = undefined; this.diagnostics = ""; this.prepared = false;
    if (directory) await rm(directory, { recursive: true, force: true });
  }

  /** Source-free readiness runs under the scheduler's preparation lease; it never generates a token. */
  public prepare(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(new FunctionNarrativeError("cancelled"));
    if (!this.starting) this.starting = this.start(signal).then(() => { this.prepared = true; });
    return this.starting;
  }
  /** Source-free loading is bounded by the caller's execution deadline, never started during activation. */
  private async start(signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw new FunctionNarrativeError("cancelled");
    const acceleration = this.acceleration ?? await detectLocalNarrativeAcceleration(this.options.binaryPath, signal);
    if (signal.aborted) throw new FunctionNarrativeError("cancelled");
    this.acceleration ??= acceleration;
    // Short names also fit macOS's small Unix-socket path limit under tmpdir().
    this.directory = await mkdtemp(join(tmpdir(), "fn-"));
    this.socket = join(this.directory, "m.sock"); this.key = randomBytes(32).toString("hex");
    const keyPath = join(this.directory, "key");
    await writeFile(keyPath, this.key + "\n", { mode: 0o600 });
    if (signal.aborted) throw new FunctionNarrativeError("cancelled");
    const args = ["--model", this.options.modelPath, "--host", this.socket, "--api-key-file", keyPath, "--no-webui",
      "--offline", "--no-warmup", "--ctx-size", "8192", "--parallel", "1", "--threads", "2", "--threads-batch", "2", "--threads-http", "1", "--poll", "0",
      ...this.acceleration,
      ...(/^qwen3[.\-]/iu.test(basename(this.options.modelPath)) ? ["--chat-template", "chatml", "--no-jinja", "--reasoning", "off"] : [])];
    // The watchdog observes parent-pipe EOF too, so a crashed/reloaded Host
    // cannot leave a server holding model memory indefinitely.
    const child = this.child = spawn(process.execPath, [join(__dirname, "localServerWatchdog.js"), this.options.binaryPath, JSON.stringify(args), this.directory],
      { shell: false, windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, stdio: ["pipe", "ignore", "pipe"] });
    this.closed = new Promise(resolve => {
      child.once("error", () => { this.exitError = new FunctionNarrativeError("failed", "spawn-failed"); });
      child.once("close", code => {
        this.exitError ??= new FunctionNarrativeError("failed", classifyRunnerFailure(this.diagnostics) ?? "exit-" + (code ?? "signal"));
        resolve();
      });
    });
    child.stderr!.setEncoding("utf8"); child.stderr!.on("data", part => { this.diagnostics = (this.diagnostics + part).slice(-8192); });
    while (true) {
      if (signal.aborted) throw new FunctionNarrativeError("cancelled");
      if (this.exitError) throw this.exitError;
      const health = await this.json("GET", "/health", undefined, signal).catch(() => {
        if (signal.aborted) throw new FunctionNarrativeError("cancelled");
        if (this.exitError) throw this.exitError;
        return { status: 503, body: {} };
      });
      if (health.status === 200) return;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(done, 100);
        const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(new FunctionNarrativeError("cancelled")); };
        function done() { signal.removeEventListener("abort", abort); resolve(); }
        signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort();
      });
    }
  }

  /** Direct Unix-socket HTTP bypasses proxies; response bodies and connection waits are bounded. */
  private json(method: string, path: string, body: unknown, signal: AbortSignal): Promise<{ status: number; body: Json }> {
    if (signal.aborted) return Promise.reject(new FunctionNarrativeError("cancelled"));
    return new Promise((resolve, reject) => {
      const text = body === undefined ? undefined : JSON.stringify(body);
      const connection = request({ socketPath: this.socket, path, method, signal,
        headers: { Authorization: "Bearer " + this.key, "Content-Type": "application/json", ...(text ? { "Content-Length": Buffer.byteLength(text) } : {}) } }, response => {
        const chunks: Buffer[] = []; let bytes = 0;
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 196608) { connection.destroy(); reject(new FunctionNarrativeError("invalid-response", "output-limit")); }
          else chunks.push(chunk);
        });
        response.on("error", () => reject(new FunctionNarrativeError("failed", "runner-connection")));
        response.on("end", () => {
          try { resolve({ status: response.statusCode ?? 500, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) }); }
          catch { reject(new FunctionNarrativeError("invalid-response")); }
        });
      });
      connection.setTimeout(method === "GET" ? 1000 : 180000, () => connection.destroy());
      connection.on("error", () => reject(signal.aborted ? new FunctionNarrativeError("cancelled") : new FunctionNarrativeError("failed", "runner-connection")));
      connection.end(text);
    });
  }
}

/** Controlled recovery categories are shared by both local process transports. */
export function classifyRunnerFailure(diagnostics: string): string | undefined {
  if (/prompt[^\n]*(?:too long|exceeds)|context (?:size|window)[^\n]*(?:exceed|too small)/iu.test(diagnostics)) return "input-window";
  if (/out of memory|cannot allocate|failed to allocate|bad_alloc|insufficient memory/iu.test(diagnostics)) return "memory-allocation";
  if (/failed to (?:load|open) (?:model|gguf)|invalid gguf|error loading model/iu.test(diagnostics)) return "model-load";
  if (/unrecognized (?:argument|option)|unknown (?:argument|option)|invalid (?:argument|option)/iu.test(diagnostics)) return "runner-arguments";
  if (/JSON schema (?:conversion failed|error)|failed to (?:parse|build) grammar|error (?:parsing|building) grammar|grammar[^\n]*(?:error|invalid)/iu.test(diagnostics)) return "response-grammar";
  return undefined;
}
