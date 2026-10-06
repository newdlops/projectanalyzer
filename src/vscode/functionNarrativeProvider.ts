/** VS Code language-model adapter; construction is inert and API work begins only on explicit generation. */
import type * as vscode from "vscode";
import { buildFunctionNarrativePrompt, FunctionNarrativeError, scheduleFunctionNarrativeRequest, type FunctionNarrativeProvider } from "../application/functionNarratives";
import { getGlobalModelTaskManager, type ModelTaskManager } from "../shared/modelTasks";

export type FunctionNarrativeVsCodeApi = Pick<typeof vscode, "lm" | "LanguageModelChatMessage" | "CancellationTokenSource"> & {
  window: Pick<typeof vscode.window, "showQuickPick">;
};

/** Uses installed chat providers. No model is hardcoded, downloaded or contacted during activation. */
export function createVsCodeFunctionNarrativeProvider(api: FunctionNarrativeVsCodeApi, manager: ModelTaskManager = getGlobalModelTaskManager()): FunctionNarrativeProvider {
  let selectedId: string | undefined;
  return { managesDeadlines: true, generate(context, language, signal, options) {
    return scheduleFunctionNarrativeRequest(manager, context.functionName, signal, async signal => {
    if (signal.aborted) throw new FunctionNarrativeError("cancelled");
    if (!api.lm?.selectChatModels) throw new FunctionNarrativeError("unavailable");
    const cancellation = new api.CancellationTokenSource();
    const abort = () => cancellation.cancel();
    signal.addEventListener("abort", abort, { once: true });
    const checkCancelled = () => { if (signal.aborted) throw new FunctionNarrativeError("cancelled"); };
    let iterator: AsyncIterator<string> | undefined;
    try {
      // Model selection may require VS Code consent, so it stays within this explicit user action.
      const models = await abortableModelOperation(api.lm.selectChatModels(), signal);
      checkCancelled();
      if (!models.length) throw new FunctionNarrativeError("unavailable");
      let model = options?.reselectModel ? undefined : models.find((candidate) => candidate.id === selectedId);
      if (!model && models.length === 1) model = models[0];
      if (!model) {
        const selected = await abortableModelOperation(api.window.showQuickPick(models.map((candidate) => ({
          label: candidate.name.slice(0, 120), description: candidate.vendor.slice(0, 80), model: candidate
        })), { title: language === "ko" ? "함수 시나리오를 설명할 모델" : "Model for function scenarios",
          placeHolder: language === "ko" ? "함수와 주변 코드 스니펫을 이 모델에 전달합니다." : "The function and nearby snippets will be sent to this model." }, cancellation.token), signal);
        checkCancelled();
        if (!selected) throw new FunctionNarrativeError("cancelled");
        model = selected.model;
      }
      selectedId = model.id;
      const messages = buildFunctionNarrativePrompt(context, language).map((text) => api.LanguageModelChatMessage.User(text));
      let tokens = 0;
      for (const message of messages) { tokens += await abortableModelOperation(model.countTokens(message, cancellation.token), signal); checkCancelled(); }
      if (!Number.isFinite(tokens) || !Number.isFinite(model.maxInputTokens) || tokens + 512 > model.maxInputTokens) {
        throw new FunctionNarrativeError("context-too-large");
      }
      const response = await abortableModelOperation(model.sendRequest(messages, {
        justification: language === "ko" ? "선택한 함수와 주변 코드로 간단한 동작 시나리오를 설명합니다." : "Explain simple behavior scenarios from the selected function and nearby code."
      }, cancellation.token), signal);
      let text = "";
      iterator = response.text[Symbol.asyncIterator]();
      while (true) {
        const next = await abortableModelOperation(iterator.next(), signal);
        if (next.done) { iterator = undefined; break; }
        const fragment = next.value;
        checkCancelled();
        if (text.length + fragment.length > 24000) { cancellation.cancel(); throw new FunctionNarrativeError("invalid-response"); }
        text += fragment;
      }
      checkCancelled();
      return { modelName: model.name.slice(0, 100), text };
    } catch (error) {
      if (signal.aborted) throw new FunctionNarrativeError("cancelled");
      if (error instanceof FunctionNarrativeError) {
        if (["context-too-large", "denied", "unavailable"].includes(error.code)) selectedId = undefined;
        throw error;
      }
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      selectedId = undefined;
      throw new FunctionNarrativeError(code === "NoPermissions" ? "denied" : code === "NotFound" ? "unavailable" : "failed");
    } finally {
      if (iterator) {
        if (!cancellation.token.isCancellationRequested) cancellation.cancel();
        // A stopped stream should release its producer too. Do not let an
        // uncooperative external return() retain the local queue indefinitely.
        try { void Promise.resolve(iterator.return?.()).catch(() => {}); }
        catch { /* Provider cleanup cannot replace the request's failure. */ }
      }
      signal.removeEventListener("abort", abort);
      cancellation.dispose();
    }
    }, options);
  } };
}

/** Cancels stalled API awaits locally too; provider cancellation remains signalled through VS Code's token. */
async function abortableModelOperation<T>(operation: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new FunctionNarrativeError("cancelled");
  let abort = () => {};
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new FunctionNarrativeError("cancelled")); signal.addEventListener("abort", abort, { once: true });
  });
  try { return await Promise.race([operation, cancelled]); }
  finally { signal.removeEventListener("abort", abort); }
}
