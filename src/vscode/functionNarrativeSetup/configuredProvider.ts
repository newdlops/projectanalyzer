/** Inert configuration adapter: source readings precede lazy, source-free model preparation and bounded inference. */
import { stat } from "node:fs/promises";
import type * as vscode from "vscode";
import { FunctionNarrativeError, scheduleFunctionNarrativePreparation, scheduleFunctionNarrativeRequest,
  buildSourceFunctionNarrativeResponse,
  type FunctionNarrativeOperationOptions, type FunctionNarrativeProvider } from "../../application/functionNarratives";
import { getGlobalModelTaskManager, type ModelTaskManager } from "../../shared/modelTasks";
import { createLocalFunctionNarrativeProvider } from "../../llm/functionNarratives";
import { LocalModelError, type ManagedLocalModelCache } from "../../shared/localModels";
import { createVsCodeFunctionNarrativeProvider, type FunctionNarrativeVsCodeApi } from "../functionNarrativeProvider";
import { resolveLocalBinary } from "./localBinary";

export type ConfiguredNarrativeApi = FunctionNarrativeVsCodeApi & {
  workspace: Pick<typeof vscode.workspace, "getConfiguration">;
  window: FunctionNarrativeVsCodeApi["window"] & Pick<typeof vscode.window, "withProgress" | "showErrorMessage">;
  ProgressLocation: typeof vscode.ProgressLocation;
};
type LocalFactory = typeof createLocalFunctionNarrativeProvider;
type ProviderSettings = { provider: "local" | "vscode"; binary: string; model: string };
/** The actual provider's resource scope begins at required model preparation/inference and closes with the owning action. */
type RunScope = { closed: boolean; ready?: Promise<void>; finish?: () => void; lease?: Promise<void> };

/** A signal binds a prepared provider for the entire explicit run, even if settings change between batches. */
export function createConfiguredNarrativeProvider(api: ConfiguredNarrativeApi, models: ManagedLocalModelCache,
  createLocal?: LocalFactory, manager: ModelTaskManager = getGlobalModelTaskManager()): FunctionNarrativeProvider {
  const connected = createVsCodeFunctionNarrativeProvider(api, manager);
  const localFactory = createLocal ?? (options => createLocalFunctionNarrativeProvider({ ...options, taskManager: manager }));
  const prepared = new WeakMap<AbortSignal, Promise<FunctionNarrativeProvider>>();
  const boundProviders = new WeakMap<AbortSignal, FunctionNarrativeProvider>();
  const settings = new WeakMap<AbortSignal, ProviderSettings>();
  const runs = new WeakMap<AbortSignal, RunScope>();
  let local: { key: string; provider: FunctionNarrativeProvider } | undefined;
  const resolve = (language: "ko" | "en", signal: AbortSignal, options?: FunctionNarrativeOperationOptions) => {
    const binding = settingsFor(signal);
    let pending = prepared.get(signal);
    if (!pending) {
      pending = scheduleFunctionNarrativePreparation(manager, signal, operation => choose(binding, language, operation), options)
        .then(provider => { boundProviders.set(signal, provider); return provider; });
      prepared.set(signal, pending);
    }
    return pending;
  };
  return {
    managesDeadlines: true,
    supportsFinalSummary: signal => !signal.aborted && !manager.disposed && (boundProviders.has(signal)
      ? boundProviders.get(signal)?.supportsFinalSummary?.(signal) === true : settingsFor(signal).provider === "local"),
    async withRun(_language, signal, operation) {
      if (signal.aborted || manager.disposed) throw new FunctionNarrativeError("cancelled");
      settingsFor(signal);
      // Nested page scopes share the outer action. Source-only actions never
      // resolve the runtime/model or acquire a model resource lease.
      if (runs.has(signal)) return operation();
      const scope: RunScope = { closed: false }; runs.set(signal, scope);
      let failed = false;
      try { return await operation(); }
      catch (error) { failed = true; throw error; }
      finally {
        scope.closed = true; scope.finish?.();
        try { await scope.lease; }
        catch (error) { if (!failed) throw error; }
        finally { if (runs.get(signal) === scope) runs.delete(signal); }
      }
    },
    async prepare(language, signal, options) {
      if (signal.aborted || manager.disposed) throw new FunctionNarrativeError("cancelled");
      const binding = settingsFor(signal);
      // The complete node-reading pipeline decides necessity from independently
      // validated source. Explicit legacy/model-only preparation still prepares.
      if (options?.sourceReading && binding.provider === "local") return;
      const provider = await resolve(language, signal, options);
      const scope = runs.get(signal);
      if (signal.aborted || scope?.closed) throw new FunctionNarrativeError("cancelled");
      if (binding.provider === "local" && provider.prepare) {
        if (scope) await retain(provider, scope, language, signal);
        await provider.prepare(language, signal, options);
      }
    },
    async generate(context, language, signal, options) {
      if (signal.aborted || manager.disposed) throw new FunctionNarrativeError("cancelled");
      const binding = settingsFor(signal);
      if (binding.provider === "local") {
        const source = buildSourceFunctionNarrativeResponse(context, language);
        if (source) { options?.validate?.(source); return source; }
      }
      const scope = runs.get(signal);
      const provider = await resolve(language, signal, { ...options, label: context.functionName });
      if (signal.aborted || scope?.closed) throw new FunctionNarrativeError("cancelled");
      if (scope) await retain(provider, scope, language, signal);
      if (provider.managesDeadlines) return provider.generate(context, language, signal, options);
      return scheduleFunctionNarrativeRequest(manager, context.functionName, signal,
        operation => provider.generate(context, language, operation, options), options);
    }
  };

  /** Machine choices are captured before source reading; changing settings cannot redirect a later batch in the same action. */
  function settingsFor(signal: AbortSignal): ProviderSettings {
    let binding = settings.get(signal);
    if (!binding) {
      const config = api.workspace.getConfiguration("projectAnalyzer.functionNarratives");
      binding = { provider: config.get<string>("provider", "local") === "vscode" ? "vscode" : "local",
        binary: config.get<string>("localBinary", ""), model: config.get<string>("localModel", "") };
      settings.set(signal, binding);
    }
    return binding;
  }

  /** A deferred callback holds the provider's existing FIFO/resource contract across later pages, source work and storage. */
  function retain(provider: FunctionNarrativeProvider, scope: RunScope, language: "ko" | "en", signal: AbortSignal): Promise<void> {
    if (!provider.withRun) return Promise.resolve();
    if (scope.ready) return scope.ready;
    if (scope.closed || signal.aborted) return Promise.reject(new FunctionNarrativeError("cancelled"));
    let entered!: () => void, rejected!: (error: unknown) => void;
    scope.ready = new Promise<void>((resolve, reject) => { entered = resolve; rejected = reject; });
    const finished = new Promise<void>(resolve => { scope.finish = resolve; });
    scope.lease = Promise.resolve().then(() => provider.withRun!(language, signal, async () => { entered(); await finished; }));
    // Observe rejection immediately, including failed/cancelled acquisition,
    // while preserving its eventual propagation and cleanup at action end.
    scope.lease.then(() => rejected(new FunctionNarrativeError("failed", "resource-scope")), rejected);
    return scope.ready;
  }

  /** Existing configured files are reused; blank/missing paths use the private extension-global cache. */
  async function choose(binding: ProviderSettings, language: "ko" | "en", signal: AbortSignal): Promise<FunctionNarrativeProvider> {
    if (signal.aborted) throw new FunctionNarrativeError("cancelled");
    if (binding.provider === "vscode") return connected;
    const binaryPath = await resolveLocalBinary(binding.binary);
    const configuredModel = binding.model;
    const customExists = configuredModel && (await stat(configuredModel).catch(() => undefined))?.isFile();
    const modelPath = customExists ? configuredModel : await prepareManaged(language, signal);
    if (signal.aborted) throw new FunctionNarrativeError("cancelled");
    const key = binaryPath + "\0" + modelPath;
    if (local?.key !== key) local = { key, provider: localFactory({ binaryPath, modelPath }) };
    return local.provider;
  }

  /** Native and Guide cancellation share the same request; failures leave resumable partials and localized guidance. */
  async function prepareManaged(language: "ko" | "en", signal: AbortSignal): Promise<string> {
    const ko = language === "ko";
    try {
      return await api.window.withProgress({ location: api.ProgressLocation.Notification, cancellable: true,
        title: `${ko ? "로컬 모델 준비" : "Preparing local model"} · ${models.model.name} (${(models.model.bytes / 1e9).toFixed(2)} GB)` }, async (progress, token) => {
        const controller = new AbortController();
        const abort = () => controller.abort();
        signal.addEventListener("abort", abort, { once: true });
        const subscription = token.onCancellationRequested(abort);
        if (signal.aborted || token.isCancellationRequested) controller.abort();
        let percent = 0;
        try {
          const modelPath = await models.ensure(controller.signal, (value) => {
            const next = value.phase === "downloading" ? Math.min(99, Math.floor(value.completedBytes * 100 / value.totalBytes)) : percent;
            const message = value.phase === "waiting" ? (ko ? "다른 창의 모델 준비를 기다리는 중…" : "Waiting for another window to prepare the model…")
              : value.phase === "verifying" ? (ko ? "SHA-256 무결성 확인 중…" : "Verifying SHA-256 integrity…")
                : `${ko ? "다운로드" : "Downloading"} ${(value.completedBytes / 1e9).toFixed(2)} / ${(value.totalBytes / 1e9).toFixed(2)} GB · ${next}%`;
            progress.report({ message, increment: Math.max(0, next - percent) }); percent = Math.max(percent, next);
          });
          if (controller.signal.aborted) throw new LocalModelError("cancelled");
          return modelPath;
        } finally { signal.removeEventListener("abort", abort); subscription.dispose(); }
      });
    } catch (error) {
      if (signal.aborted || error instanceof LocalModelError && error.code === "cancelled") throw new FunctionNarrativeError("cancelled");
      const reason = error instanceof LocalModelError ? error.code : "download";
      const message = reason === "storage" ? (ko ? "모델을 저장할 공간이나 권한이 부족합니다. 약 2.74 GB의 공간을 확보한 뒤 다시 분석하세요." : "The model cache needs disk space and write access. Free about 2.74 GB, then retry analysis.")
        : reason === "integrity" ? (ko ? "모델 체크섬이 일치하지 않아 파일을 사용하지 않았습니다. 다시 분석하면 새로 다운로드합니다." : "The model checksum did not match. Retry analysis to download a fresh file.")
          : (ko ? "모델 다운로드를 완료하지 못했습니다. 네트워크·프록시 설정을 확인한 뒤 다시 분석하면 이어받습니다." : "The model download could not finish. Check network/proxy settings, then retry analysis to resume.");
      void api.window.showErrorMessage(message);
      throw new FunctionNarrativeError("download-failed");
    }
  }
}
