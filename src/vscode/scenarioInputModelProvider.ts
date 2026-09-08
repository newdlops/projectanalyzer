/** User-initiated VS Code Language Model adapter; model access and consent stay in VS Code. */
import * as vscode from "vscode";
import { ScenarioInputError, type ScenarioInputProvider } from "../application/scenarioInputs";

/** Creates an inert adapter. Selection and network requests happen only in suggest(). */
export function createScenarioInputModelProvider(): ScenarioInputProvider {
  return {
    async suggest(prompt, language, signal) {
      if (!vscode.lm?.selectChatModels) throw new ScenarioInputError("unavailable");
      const cancellation = new vscode.CancellationTokenSource();
      const cancel = (): void => cancellation.cancel();
      signal.addEventListener("abort", cancel, { once: true });
      try {
        if (signal.aborted) throw new ScenarioInputError("cancelled");
        const models = await vscode.lm.selectChatModels();
        if (signal.aborted) throw new ScenarioInputError("cancelled");
        if (!models.length) throw new ScenarioInputError("unavailable");
        const selected = await vscode.window.showQuickPick(models.map((model) => ({
          label: model.name, description: model.vendor, model
        })), {
          title: language === "ko" ? "에지케이스 입력을 제안할 AI 모델" : "AI model for edge-case inputs",
          placeHolder: language === "ko" ? "선택한 함수와 최대 4개 호출부의 코드를 이 모델에 전달합니다" : "Send the selected function and up to 4 caller snippets to this model",
          ignoreFocusOut: false
        }, cancellation.token);
        if (!selected || signal.aborted) throw new ScenarioInputError("cancelled");
        const message = vscode.LanguageModelChatMessage.User(prompt);
        if (await selected.model.countTokens(message, cancellation.token) > selected.model.maxInputTokens * 0.9) throw new ScenarioInputError("unavailable");
        if (signal.aborted) throw new ScenarioInputError("cancelled");
        const response = await selected.model.sendRequest([message], {}, cancellation.token);
        let text = "";
        for await (const fragment of response.text) {
          if (signal.aborted) throw new ScenarioInputError("cancelled");
          text += fragment;
          if (text.length > 48000) { cancellation.cancel(); throw new ScenarioInputError("invalid-response"); }
        }
        return { modelName: selected.model.name.slice(0, 100), text };
      } catch (error) {
        if (error instanceof ScenarioInputError) throw error;
        if (signal.aborted) throw new ScenarioInputError("cancelled");
        const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
        throw new ScenarioInputError(code === "NoPermissions" ? "denied" : code === "NotFound" ? "unavailable" : "failed");
      } finally {
        signal.removeEventListener("abort", cancel); cancellation.dispose();
      }
    }
  };
}
