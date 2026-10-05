/** Native setup regressions exercise machine settings, download cancellation and a source-free preparation boundary. */
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { createConfiguredNarrativeProvider, type ConfiguredNarrativeApi } from "../../vscode/functionNarrativeSetup";
import { FunctionNarrativeError } from "../../application/functionNarratives";
import { LocalModelError, type ManagedLocalModelCache } from "../../shared/localModels";
import type { FunctionNarrativeContext } from "../../shared/functionNarratives";

const context: FunctionNarrativeContext = { functionName: "inspect", language: "kotlin", limited: false,
  snippets: [{ id: "root", role: "function", startLine: 1, endLine: 1, text: 'fun inspect() = "ready"', truncated: false }] };

/** Only external VS Code/model ports are substituted; native setup and executable preflight are real. */
function fixture(options: { modelPath?: string; binary?: string; provider?: string; cancel?: boolean; fail?: "integrity" | "storage" } = {}) {
  const config: Record<string, string> = { localBinary: options.binary ?? process.execPath, localModel: options.modelPath ?? "", provider: options.provider ?? "local" };
  const observed = { ensures: 0, local: [] as Array<{ binaryPath: string; modelPath: string }>, inferences: 0, progress: [] as Array<{ message?: string; increment?: number }>, titles: [] as string[], errors: [] as string[], selections: 0 };
  const api = {
    workspace: { getConfiguration(section: string) { assert.equal(section, "projectAnalyzer.functionNarratives"); return { get(key: string, fallback: string) { return config[key] ?? fallback; } }; } },
    ProgressLocation: { Notification: 15 },
    window: { async withProgress<T>(settings: { title: string; cancellable: boolean }, task: (reporter: unknown, token: unknown) => Promise<T>) {
      observed.titles.push(settings.title); assert.equal(settings.cancellable, true);
      const listeners = new Set<() => void>();
      const token = { isCancellationRequested: false, onCancellationRequested(callback: () => void) { listeners.add(callback); return { dispose() { listeners.delete(callback); } }; } };
      return task({ report(value: { message?: string; increment?: number }) { observed.progress.push(value); if (options.cancel) { token.isCancellationRequested = true; for (const callback of listeners) callback(); } } }, token);
    }, showErrorMessage(message: string) { observed.errors.push(message); return Promise.resolve(undefined); }, async showQuickPick() { return undefined; } },
    lm: { async selectChatModels() { observed.selections++; return [{ id: "connected", name: "Connected", maxInputTokens: 16000, async countTokens() { return 10; }, async sendRequest() { return { text: (async function*() { yield "connected"; })() }; } }]; } },
    LanguageModelChatMessage: { User(content: string) { return { content }; } },
    CancellationTokenSource: class { token = {}; cancel() {} dispose() {} }
  } as unknown as ConfiguredNarrativeApi;
  const models: ManagedLocalModelCache = { model: { id: "fixture", name: "Fixture", fileName: "fixture.gguf", url: "https://example.invalid", bytes: 2740937888, sha256: "a".repeat(64) },
    async ensure(signal, report) { observed.ensures++; report({ phase: "downloading", completedBytes: 500000000, totalBytes: 2740937888 });
      if (signal.aborted) throw new LocalModelError("cancelled"); if (options.fail) throw new LocalModelError(options.fail); return "/managed/fixture.gguf"; }, dispose() {} };
  const provider = createConfiguredNarrativeProvider(api, models, (settings) => { observed.local.push(settings); return { async generate() { observed.inferences++; return { modelName: "Local", text: "local" }; } }; });
  return { provider, observed, config };
}

test("first explicit local setup downloads automatically, remains source-free and binds settings across batches", async () => {
  const f = fixture(); const controller = new AbortController();
  assert.equal(f.observed.ensures, 0); assert.equal(f.observed.inferences, 0);
  await f.provider.prepare!("ko", controller.signal);
  assert.equal(f.observed.ensures, 1); assert.equal(f.observed.inferences, 0);
  assert.match(f.observed.titles[0], /로컬 모델 준비.*2\.74 GB/); assert.match(f.observed.progress[0].message!, /다운로드/);
  f.config.provider = "vscode";
  await f.provider.generate(context, "ko", controller.signal); await f.provider.generate(context, "ko", controller.signal);
  assert.equal(f.observed.ensures, 1); assert.equal(f.observed.selections, 0); assert.equal(f.observed.inferences, 2);
  assert.deepEqual(f.observed.local, [{ binaryPath: process.execPath, modelPath: "/managed/fixture.gguf" }]);
});

test("a configured existing GGUF skips managed download and native progress", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pa-configured-model-")); const modelPath = path.join(directory, "custom.gguf");
  try {
    await writeFile(modelPath, "GGUF"); const f = fixture({ modelPath });
    await f.provider.generate(context, "en", new AbortController().signal);
    assert.equal(f.observed.ensures, 0); assert.deepEqual(f.observed.titles, []); assert.equal(f.observed.local[0].modelPath, modelPath);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("a missing configured model falls back to automatic preparation without rewriting machine settings", async () => {
  const f = fixture({ modelPath: "/missing/fixture.gguf" }); await f.provider.prepare!("en", new AbortController().signal);
  assert.equal(f.observed.ensures, 1); assert.equal(f.config.localModel, "/missing/fixture.gguf");
});

test("a missing runner fails before any multi-gigabyte download", async () => {
  const f = fixture({ binary: "/missing/llama-completion" });
  await assert.rejects(f.provider.prepare!("ko", new AbortController().signal), (error) => error instanceof FunctionNarrativeError && error.code === "unavailable");
  assert.equal(f.observed.ensures, 0); assert.equal(f.observed.inferences, 0);
});

test("native notification cancellation stops setup without starting inference or showing a failure alert", async () => {
  const f = fixture({ cancel: true });
  await assert.rejects(f.provider.prepare!("ko", new AbortController().signal), (error) => error instanceof FunctionNarrativeError && error.code === "cancelled");
  assert.equal(f.observed.inferences, 0); assert.deepEqual(f.observed.errors, []);
});

test("integrity and storage failures produce localized retry guidance and download-failed status", async () => {
  for (const fail of ["integrity", "storage"] as const) {
    const f = fixture({ fail });
    await assert.rejects(f.provider.prepare!("ko", new AbortController().signal), (error) => error instanceof FunctionNarrativeError && error.code === "download-failed");
    assert.match(f.observed.errors[0], fail === "integrity" ? /체크섬/ : /공간.*권한/); assert.equal(f.observed.inferences, 0);
  }
});

test("connected VS Code provider bypasses runner/model setup and contacts a model only during generation", async () => {
  const f = fixture({ provider: "vscode", binary: "/missing/llama-completion" }); const signal = new AbortController().signal;
  await f.provider.prepare!("en", signal); assert.equal(f.observed.selections, 0);
  assert.equal((await f.provider.generate(context, "en", signal)).text, "connected");
  assert.equal(f.observed.ensures, 0); assert.equal(f.observed.local.length, 0); assert.equal(f.observed.selections, 1);
});
