/**
 * VS Code extension activation entrypoint. It creates runtime services and
 * registers GUI views.
 */

import * as vscode from "vscode";
import { createExtensionServices, type ExtensionServices } from "./extensionServices";
import { registerCurrentFunctionVisualizationCommand } from "./currentFunctionVisualization";
import { registerModuleVisualizationCommand } from "./moduleVisualization";
import { registerProjectAnalyzerViews } from "./views";
import { readProjectAnalyzerConfig } from "../vscode/configuration";
/** Current activation owns the global task manager's awaited shutdown. */
let activeServices: ExtensionServices | undefined;

/**
 * Activates Project Analyzer for the current VS Code extension host session.
 */
export function activate(context: vscode.ExtensionContext): void {
  const services = createExtensionServices(context);
  activeServices = services;
  registerProjectAnalyzerViews(context, services);
  registerCurrentFunctionVisualizationCommand(context, services);
  registerModuleVisualizationCommand(context, services);
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
    if (!event.affectsConfiguration("projectAnalyzer.uiLanguage")) return;
    const language = readProjectAnalyzerConfig().uiLanguage;
    services.modelTasksUi.updateLanguage(language);
    void services.explorerViewProvider.updateUiLanguage(language);
    void services.functionVisualizerPanelProvider.updateUiLanguage(language);
    void services.explorerGraphPanelProvider.updateUiLanguage(language);
    void services.moduleVisualizerPanelProvider.updateUiLanguage(language);
  }));
}

/**
 * Shutdown awaits the active model's process cleanup after revoking queued work.
 */
export async function deactivate(): Promise<void> {
  const services = activeServices; activeServices = undefined;
  await services?.modelTasks.dispose();
}
