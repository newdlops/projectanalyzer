/** Native entry point; extension composition injects managed storage instead of exposing it to the Webview. */
import * as vscode from "vscode";
import type { FunctionNarrativeProvider } from "../application/functionNarratives";
import type { ManagedLocalModelCache } from "../shared/localModels";
import { createConfiguredNarrativeProvider } from "./functionNarrativeSetup";
import { getGlobalModelTaskManager, type ModelTaskManager } from "../shared/modelTasks";

/** Machine settings keep workspaces from selecting another executable or silently switching to a remote provider. */
export function createConfiguredFunctionNarrativeProvider(models: ManagedLocalModelCache, manager: ModelTaskManager = getGlobalModelTaskManager()): FunctionNarrativeProvider {
  return createConfiguredNarrativeProvider(vscode, models, undefined, manager);
}
