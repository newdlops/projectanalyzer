/** Inert configuration adapter: source-free managed preparation precedes bounded model inference. */
import { stat } from "node:fs/promises";
import type * as vscode from "vscode";
import { FunctionNarrativeError, scheduleFunctionNarrativePreparation, scheduleFunctionNarrativeRequest,
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

/** A signal binds a prepared provider for the entire explicit run, even if settings change between batches. */
export function createConfiguredNarrativeProvider(api: ConfiguredNarrativeApi, models: ManagedLocalModelCache,
  createLocal?: LocalFactory, manager: ModelTaskManager = getGlobalModelTaskManager()): FunctionNarrativeProvider {
  const connected = createVsCodeFunctionNarrativeProvider(api, manager);
  const localFactory = createLocal ?? (options => createLocalFunctionNarrativeProvider({ ...options, taskManager: manager }));
  const prepared = new WeakMap<AbortSignal, Promise<FunctionNarrativeProvider>>();
  let local: { key: string; provider: FunctionNarrativeProvider } | undefined;
  const resolve = (language: "ko" | "en", signal: AbortSignal, options?: FunctionNarrativeOperationOptions) => {
    let pending = prepared.get(signal);
    if (!pending) {
      pending = scheduleFunctionNarrativePreparation(manager, signal, operation => choose(language, operation), options);
      prepared.set(signal, pending);
    }
    return pending;
  };
  return {
    managesDeadlines: true,
    async prepare(language, signal, options) { await resolve(language, signal, options); },
    async generate(context, language, signal, options) {
      const provider = await resolve(language, signal, { ...options, label: context.functionName });
      if (signal.aborted) throw new FunctionNarrativeError("cancelled");
      if (provider.managesDeadlines) return provider.generate(context, language, signal, options);
      return scheduleFunctionNarrativeRequest(manager, context.functionName, signal,
        operation => provider.generate(context, language, operation, options), options);
    }
  };

  /** Existing configured files are reused; blank/missing paths use the private extension-global cache. */
  async function choose(language: "ko" | "en", signal: AbortSignal): Promise<FunctionNarrativeProvider> {
    if (signal.aborted) throw new FunctionNarrativeError("cancelled");
    const config = api.workspace.getConfiguration("projectAnalyzer.functionNarratives");
    if (config.get<string>("provider", "local") === "vscode") return connected;
    const binaryPath = await resolveLocalBinary(config.get<string>("localBinary", ""));
    const configuredModel = config.get<string>("localModel", "");
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
