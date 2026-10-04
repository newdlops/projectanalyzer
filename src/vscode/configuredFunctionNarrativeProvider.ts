/** Chooses a user-configured provider and a local GGUF through native VS Code UI only on explicit generation. */
import * as path from "node:path";
import { existsSync } from "node:fs";
import * as vscode from "vscode";
import { FunctionNarrativeError, type FunctionNarrativeProvider } from "../application/functionNarratives";
import { createLocalFunctionNarrativeProvider } from "../llm/functionNarratives";
import { createVsCodeFunctionNarrativeProvider } from "./functionNarrativeProvider";

/** Machine settings keep workspaces from selecting another executable or silently switching to a remote provider. */
export function createConfiguredFunctionNarrativeProvider(): FunctionNarrativeProvider {
  const connected = createVsCodeFunctionNarrativeProvider(vscode);
  let local: { key: string; provider: FunctionNarrativeProvider } | undefined;
  return { async generate(context, language, signal, options) {
    const config = vscode.workspace.getConfiguration("projectAnalyzer.functionNarratives");
    if (config.get<string>("provider", "local") === "vscode") return connected.generate(context, language, signal, options);
    if (signal.aborted) throw new FunctionNarrativeError("cancelled");
    const binaryPath = config.get<string>("localBinary", "") || defaultLocalBinary();
    let modelPath = config.get<string>("localModel", "");
    if (!modelPath || !existsSync(modelPath)) {
      const files = await vscode.window.showOpenDialog({ canSelectMany: false, canSelectFolders: false,
        filters: { "GGUF model": ["gguf"] }, title: language === "ko" ? "함수 시나리오용 로컬 GGUF 모델 선택" : "Select a local GGUF model for function scenarios" });
      if (signal.aborted || !files?.[0]) throw new FunctionNarrativeError("cancelled");
      modelPath = files[0].fsPath;
      await config.update("localModel", modelPath, vscode.ConfigurationTarget.Global);
    }
    const key = binaryPath + "\0" + modelPath;
    if (local?.key !== key) local = { key, provider: createLocalFunctionNarrativeProvider({ binaryPath, modelPath }) };
    return local.provider.generate(context, language, signal, options);
  } };
}

/** Homebrew GUI PATH may omit its bin directory; other platforms use the user's configured PATH. */
function defaultLocalBinary(): string {
  for (const candidate of ["/opt/homebrew/bin/llama-completion", "/usr/local/bin/llama-completion"]) if (existsSync(candidate)) return candidate;
  return process.platform === "win32" ? "llama-completion.exe" : path.basename("llama-completion");
}
