/** VS Code language-model adapter; construction is inert and API work begins only on explicit generation. */
import type * as vscode from "vscode";
import { buildFunctionNarrativePrompt, FunctionNarrativeError, type FunctionNarrativeProvider } from "../application/functionNarratives";

export type FunctionNarrativeVsCodeApi = Pick<typeof vscode, "lm" | "LanguageModelChatMessage" | "CancellationTokenSource"> & {
  window: Pick<typeof vscode.window, "showQuickPick">;
};

/** Uses installed chat providers. No model is hardcoded, downloaded or contacted during activation. */
export function createVsCodeFunctionNarrativeProvider(api: FunctionNarrativeVsCodeApi): FunctionNarrativeProvider {
  let selectedId: string | undefined;
  return { async generate(context, language, signal, options) {
    if (signal.aborted) throw new FunctionNarrativeError("cancelled");
    if (!api.lm?.selectChatModels) throw new FunctionNarrativeError("unavailable");
    const cancellation = new api.CancellationTokenSource();
    const abort = () => cancellation.cancel();
    signal.addEventListener("abort", abort, { once: true });
    const checkCancelled = () => { if (signal.aborted) throw new FunctionNarrativeError("cancelled"); };
    try {
      // Model selection may require VS Code consent, so it stays within this explicit user action.
      const models = await api.lm.selectChatModels();
      checkCancelled();
      if (!models.length) throw new FunctionNarrativeError("unavailable");
      let model = options?.reselectModel ? undefined : models.find((candidate) => candidate.id === selectedId);
      if (!model && models.length === 1) model = models[0];
      if (!model) {
        const selected = await api.window.showQuickPick(models.map((candidate) => ({
          label: candidate.name.slice(0, 120), description: candidate.vendor.slice(0, 80), model: candidate
        })), { title: language === "ko" ? "함수 시나리오를 설명할 모델" : "Model for function scenarios",
          placeHolder: language === "ko" ? "함수와 주변 코드 스니펫을 이 모델에 전달합니다." : "The function and nearby snippets will be sent to this model." }, cancellation.token);
        checkCancelled();
        if (!selected) throw new FunctionNarrativeError("cancelled");
        model = selected.model;
      }
      selectedId = model.id;
      const messages = buildFunctionNarrativePrompt(context, language).map((text) => api.LanguageModelChatMessage.User(text));
      let tokens = 0;
      for (const message of messages) { tokens += await model.countTokens(message, cancellation.token); checkCancelled(); }
      if (!Number.isFinite(tokens) || !Number.isFinite(model.maxInputTokens) || tokens + 512 > model.maxInputTokens) {
        throw new FunctionNarrativeError("context-too-large");
      }
      const response = await model.sendRequest(messages, {
        justification: language === "ko" ? "선택한 함수와 주변 코드로 간단한 동작 시나리오를 설명합니다." : "Explain simple behavior scenarios from the selected function and nearby code."
      }, cancellation.token);
      let text = "";
      for await (const fragment of response.text) {
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
      signal.removeEventListener("abort", abort);
      cancellation.dispose();
    }
  } };
}
