/** Native setup regressions exercise machine settings, download cancellation and a source-free preparation boundary. */
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { createConfiguredNarrativeProvider, type ConfiguredNarrativeApi } from "../../vscode/functionNarrativeSetup";
import { FunctionNarrativeError } from "../../application/functionNarratives";
import { analyzeFunctionLogic } from "../../analyzer/functionLogic";
import { buildFunctionNarrativeContext, bindFunctionNarrativeGraph, parseFunctionNarrative, numberFunctionNarrativeContext,
  type FunctionNarrativeProvider } from "../../application/functionNarratives";
import { FunctionNarrativeScenarioSession } from "../../webview/codeFlow/functionNarrativeScenarioSession";
import { FunctionNarrativesHostDelivery } from "../../webview/codeFlow/functionNarrativesHostDelivery";
import { ModelTaskManager } from "../../shared/modelTasks";
import { LocalModelError, type ManagedLocalModelCache } from "../../shared/localModels";
import type { FunctionNarrative, FunctionNarrativeContext } from "../../shared/functionNarratives";
import type { FunctionNarrativesResponse } from "../../protocol/functionNarratives";
import type { SymbolNode } from "../../shared/types";

const context: FunctionNarrativeContext = { functionName: "inspect", language: "kotlin", limited: false,
  snippets: [{ id: "root", role: "function", startLine: 1, endLine: 1, text: 'fun inspect() = "ready"', truncated: false }] };

/** Only external VS Code/model ports are substituted; native setup and executable preflight are real. */
function fixture(options: { modelPath?: string; binary?: string; provider?: string; cancel?: boolean; fail?: "integrity" | "storage";
  localProvider?: FunctionNarrativeProvider; manager?: ModelTaskManager } = {}) {
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
  const provider = createConfiguredNarrativeProvider(api, models, (settings) => { observed.local.push(settings); return options.localProvider ?? { async generate() { observed.inferences++; return { modelName: "Local", text: "local" }; } }; }, options.manager);
  return { provider, observed, config };
}

/** Production Kotlin parser, graph identities and source contracts; only machine/model ports are substituted above. */
function sourceContext(loop = true, defaulted = false): FunctionNarrativeContext {
  const template = loop ? 'fun inspect(amount: Int): Int {\n var adjusted = amount\n do { adjusted += 1 } while (adjusted < 3)\n return adjusted\n}'
    : 'fun inspect(enabled: Boolean, amount: Int): Int {\n if (!enabled) return 0\n val adjusted = amount + 5\n return adjusted\n}';
  const source = defaulted ? template.replace("enabled: Boolean", "enabled: Boolean = true") : template;
  const lines = source.split("\n"), node: SymbolNode = { id: "setup-source", name: "inspect", qualifiedName: "inspect", kind: "function", language: "kotlin",
    filePath: "/fixture/inspect.kt", range: { startLine: 0, startCharacter: 0, endLine: lines.length - 1, endCharacter: lines.at(-1)!.length },
    selectionRange: { startLine: 0, startCharacter: 4, endLine: 0, endCharacter: 11 } };
  const logic = analyzeFunctionLogic({ functionNode: node, sourceText: source });
  return bindFunctionNarrativeGraph({ ...buildFunctionNarrativeContext(node, source, [], logic), detailLevel: "rich",
    parameters: loop ? [{ name: "amount", type: "Int" }] : [{ name: "enabled", type: "Boolean" }, { name: "amount", type: "Int" }],
    valueNames: ["enabled", "amount", "adjusted", "condition", "result"] }, logic.blocks.map((_, index) => "function-logic-block:" + index.toString(16).padStart(32, "0")), []);
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

test("explicit local readiness is delegated inside the owning run while source-reading preparation stays lazy", async () => {
  const manager = new ModelTaskManager(), signal = new AbortController().signal;
  let active = false, preparations = 0, releases = 0;
  const localProvider: FunctionNarrativeProvider = {
    async withRun(_language, _signal, operation) {
      active = true;
      try { return await operation(); }
      finally { active = false; releases++; }
    },
    async prepare(_language, incoming) { assert.equal(active, true); assert.equal(incoming, signal); preparations++; },
    async generate() { throw new Error("Readiness must not generate source text."); }
  };
  const f = fixture({ localProvider, manager });
  try {
    await f.provider.withRun!("en", signal, async () => {
      await f.provider.prepare!("en", signal, { sourceReading: true });
      assert.equal(preparations, 0); assert.equal(f.observed.ensures, 0);
      await f.provider.prepare!("en", signal);
      assert.equal(preparations, 1); assert.equal(releases, 0);
    });
    assert.equal(releases, 1); assert.equal(active, false);
  } finally { await manager.dispose(); }
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

test("the real complete Host reads source-proved loop and guard pages without a runner, weights, model factory or preparation task", async () => {
  for (const loop of [true, false]) {
    const manager = new ModelTaskManager(), f = fixture({ binary: "/missing/llama-completion", modelPath: "/missing/weights.gguf", fail: "integrity", manager });
    const messages: FunctionNarrativesResponse[] = [], request = { flowId: `code-flow:${"d".repeat(32)}` as const, graphVersion: "source-fixture", requestId: 1 };
    const delivery = new FunctionNarrativesHostDelivery({ provider: f.provider, getLanguage: () => "ko", isActive: () => true,
      createPageStore() { const pages = new Map<number, FunctionNarrative>(); return { async write(index, narrative) { pages.set(index, narrative); },
        async read(index) { return pages.get(index); }, async dispose() { pages.clear(); } }; },
      createEvidence: () => `code-evidence:${"e".repeat(64)}`, async postMessage(message) {
        if (message.type === "codeFlow/functionNarrativesLoaded") messages.push(message.payload);
      } });
    try {
      delivery.register(request.flowId, request.graphVersion, sourceContext(loop), "/fixture/inspect.kt");
      await delivery.request(request);
      assert.equal(messages.at(-1)!.status, "ready"); assert.equal(messages.at(-1)!.coverage!.completed, 2);
      assert.equal(messages.at(-1)!.modelName, "소스 분석"); assert.equal(messages.at(-1)!.narrative!.scenarios[0].example!.result, loop ? "3" : "0");
      await delivery.request({ ...request, requestId: 2, pageIndex: 1, pageLanguage: "ko" });
      assert.equal(messages.at(-1)!.narrative!.scenarios[0].example!.result, loop ? "11" : "15");
      assert.equal(f.observed.ensures, 0); assert.equal(f.observed.local.length, 0); assert.equal(f.observed.inferences, 0);
      assert.deepEqual(f.observed.titles, []); assert.deepEqual(f.observed.errors, []); assert.deepEqual(manager.snapshot().history, []);
    } finally { delivery.clear(); await manager.dispose(); }
  }
});

test("deferred preparation snapshots machine choices and starts automatic preparation only when a model-dependent stage is reached", async () => {
  const manager = new ModelTaskManager(), f = fixture({ manager }), signal = new AbortController().signal;
  try {
    await f.provider.prepare!("ko", signal, { sourceReading: true });
    assert.equal(f.observed.ensures, 0); assert.equal(f.provider.supportsFinalSummary!(signal), true);
    f.config.provider = "vscode"; f.config.localBinary = "/missing/new-runner";
    await f.provider.withRun!("ko", signal, async () => { await f.provider.generate(context, "ko", signal); await f.provider.generate(context, "ko", signal); });
    assert.equal(f.observed.ensures, 1); assert.equal(f.observed.inferences, 2); assert.equal(f.observed.selections, 0);
    assert.equal(f.observed.local[0].binaryPath, process.execPath);
    assert.deepEqual(manager.snapshot().history.map(task => task.kind), ["prepare", "inference", "inference"]);
  } finally { await manager.dispose(); }
});

test("a lazily acquired provider scope stays active across inference and asynchronous storage, then finishes cleanup before action resolution", async () => {
  let active = false, scopes = 0, releases = 0, inferences = 0;
  const manager = new ModelTaskManager(), local: FunctionNarrativeProvider = {
    async withRun(_language, _signal, operation) {
      assert.equal(this, local); active = true; scopes++;
      try { return await operation(); }
      finally { await new Promise<void>(resolve => setImmediate(resolve)); active = false; releases++; }
    }, async generate() { assert.equal(active, true); inferences++; return { modelName: "Scoped", text: "local" }; }
  }, f = fixture({ localProvider: local, manager }), signal = new AbortController().signal;
  try {
    await f.provider.prepare!("en", signal, { sourceReading: true });
    await f.provider.withRun!("en", signal, async () => {
      assert.equal(scopes, 0);
      await f.provider.generate(context, "en", signal);
      await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(active, true);
      await f.provider.withRun!("en", signal, () => f.provider.generate(context, "en", signal));
    });
    assert.equal(inferences, 2); assert.equal(scopes, 1); assert.equal(releases, 1); assert.equal(active, false);
  } finally { await manager.dispose(); }
});

test("cancellation and failure during a lazy action release its provider scope and never publish a success", async () => {
  for (const cancel of [false, true]) {
    const manager = new ModelTaskManager(); let released = false;
    const local: FunctionNarrativeProvider = { async withRun(_language, _signal, operation) { try { return await operation(); } finally { released = true; } },
      async generate() { return { modelName: "Scoped", text: "local" }; } };
    const f = fixture({ localProvider: local, manager }), controller = new AbortController();
    try {
      await assert.rejects(f.provider.withRun!("en", controller.signal, async () => {
        await f.provider.generate(context, "en", controller.signal);
        if (cancel) { controller.abort(); await f.provider.generate(context, "en", controller.signal); }
        throw new FunctionNarrativeError("invalid-response");
      }), (error) => error instanceof FunctionNarrativeError && error.code === (cancel ? "cancelled" : "invalid-response"));
      assert.equal(released, true);
    } finally { await manager.dispose(); }
  }
});

test("a scope acquisition failure preserves its category without inference or an unhandled retention promise", async () => {
  const manager = new ModelTaskManager(); let inferences = 0;
  const f = fixture({ manager, localProvider: { async withRun() { throw new FunctionNarrativeError("unavailable", "scope-fixture"); },
    async generate() { inferences++; return { modelName: "Scoped", text: "local" }; } } });
  try {
    const signal = new AbortController().signal;
    await assert.rejects(f.provider.withRun!("en", signal, () => f.provider.generate(context, "en", signal)),
      (error) => error instanceof FunctionNarrativeError && error.code === "unavailable");
    assert.equal(inferences, 0);
  } finally { await manager.dispose(); }
});

test("source pages resume with the original model purpose producer without repeating model setup or exposing producer metadata in prompts", async () => {
  const manager = new ModelTaskManager(); let purposes = 0;
  const local: FunctionNarrativeProvider = { supportsFinalSummary: () => true, async generate(task, language) {
    assert.ok(task.summaryTask); purposes++;
    const { buildPrimitiveNarrativeSynthesis } = await import("../../application/functionNarratives");
    const synthesis = buildPrimitiveNarrativeSynthesis(task, language); assert.ok(synthesis);
    return { modelName: "Original model", text: JSON.stringify({ ...synthesis, summary: "활성 여부에 따라 0을 조기 반환하거나 amount에 5를 더해 반환합니다." }) };
  } }, f = fixture({ localProvider: local, manager }), pages = new Map<number, FunctionNarrative>();
  // Defaults remain outside the body-only purpose contract; this fixture still
  // requires a real model purpose and verifies its cached producer lifecycle.
  const session = new FunctionNarrativeScenarioSession(sourceContext(false, true), { async write(index, value) { pages.set(index, value); },
    async read(index) { return pages.get(index); }, async dispose() { pages.clear(); } });
  try {
    await session.analyzeNext(f.provider, "ko", new AbortController().signal, { reselectModel: false });
    assert.equal(purposes, 1); assert.equal(f.observed.ensures, 1);
    f.config.localBinary = "/missing/runner-after-first-page"; f.config.localModel = "/missing/model-after-first-page";
    await session.analyzeNext(f.provider, "ko", new AbortController().signal, { reselectModel: false });
    assert.equal(session.complete, true); assert.equal(purposes, 1); assert.equal(f.observed.ensures, 1);
    const cached = await session.readPage(1); assert.equal(cached!.modelName, "Original model"); assert.equal(cached!.narrative.scenarios[0].example!.result, "15");
    const privateTask = { ...sourceContext(), summaryTask: { inputs: [], steps: [], completed: [], omittedValues: 0,
      knownFunctionSummary: "Cached purpose", knownModelName: "Private producer" } };
    assert.equal(numberFunctionNarrativeContext(privateTask).summaryTask!.knownModelName, undefined);
  } finally { await session.dispose(); await manager.dispose(); }
});

test("source fast paths still validate independently and honor explicit connected-model choice", async () => {
  const f = fixture({ binary: "/missing/runner" }), signal = new AbortController().signal;
  const { FunctionNarrativeScenarioRun } = await import("../../application/functionNarratives");
  const batch = new FunctionNarrativeScenarioRun(sourceContext()).nextBatch()!, preparation = { ...batch, nodePreparation: true };
  const response = await f.provider.generate(preparation, "ko", signal, { validate(value) { parseFunctionNarrative(value.text, preparation, "ko"); } });
  assert.equal(response.modelName, "소스 분석"); assert.equal(f.observed.ensures, 0);
  await assert.rejects(f.provider.generate(preparation, "ko", signal, { validate() { throw new FunctionNarrativeError("invalid-response"); } }), /invalid-response/u);
  const connected = fixture({ provider: "vscode", binary: "/missing/runner" });
  assert.equal((await connected.provider.generate(preparation, "ko", new AbortController().signal)).text, "connected");
  assert.equal(connected.observed.selections, 1); assert.equal(connected.observed.ensures, 0);
});

test("disposing the shared manager also rejects deferred source generation and prevents a new action from starting", async () => {
  const manager = new ModelTaskManager(), f = fixture({ binary: "/missing/runner", manager });
  const { FunctionNarrativeScenarioRun } = await import("../../application/functionNarratives");
  const batch = new FunctionNarrativeScenarioRun(sourceContext()).nextBatch()!, preparation = { ...batch, nodePreparation: true };
  const signal = new AbortController().signal; await manager.dispose();
  let entered = false;
  await assert.rejects(f.provider.prepare!("ko", signal, { sourceReading: true }), /cancelled/u);
  await assert.rejects(f.provider.generate(preparation, "ko", signal), /cancelled/u);
  await assert.rejects(f.provider.withRun!("ko", signal, async () => { entered = true; }), /cancelled/u);
  assert.equal(entered, false); assert.equal(f.observed.ensures, 0); assert.equal(f.observed.inferences, 0);
});
