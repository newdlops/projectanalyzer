/**
 * VS Code extension activation entrypoint. It creates runtime services and
 * registers GUI views.
 */

import * as vscode from "vscode";
import { createExtensionServices } from "./extensionServices";
import { registerCurrentFunctionVisualizationCommand } from "./currentFunctionVisualization";
import { registerModuleVisualizationCommand } from "./moduleVisualization";
import { registerProjectAnalyzerViews } from "./views";
import { readProjectAnalyzerConfig } from "../vscode/configuration";

/**
 * Activates Project Analyzer for the current VS Code extension host session.
 */
export function activate(context: vscode.ExtensionContext): void {
  const services = createExtensionServices(context);
  registerProjectAnalyzerViews(context, services);
  registerCurrentFunctionVisualizationCommand(context, services);
  registerModuleVisualizationCommand(context, services);
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
    if (!event.affectsConfiguration("projectAnalyzer.uiLanguage")) return;
    const language = readProjectAnalyzerConfig().uiLanguage;
    void services.explorerViewProvider.updateUiLanguage(language);
    void services.functionVisualizerPanelProvider.updateUiLanguage(language);
    void services.explorerGraphPanelProvider.updateUiLanguage(language);
    void services.moduleVisualizerPanelProvider.updateUiLanguage(language);
  }));
}

/**
 * Deactivation hook reserved for future analyzer worker cleanup.
 */
export function deactivate(): void {
  return;
}
