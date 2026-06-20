/**
 * VS Code extension activation entrypoint. It creates runtime services and
 * registers GUI views.
 */

import * as vscode from "vscode";
import { createExtensionServices } from "./extensionServices";
import { registerProjectAnalyzerViews } from "./views";

/**
 * Activates Project Analyzer for the current VS Code extension host session.
 */
export function activate(context: vscode.ExtensionContext): void {
  const services = createExtensionServices(context);
  registerProjectAnalyzerViews(context, services);
}

/**
 * Deactivation hook reserved for future analyzer worker cleanup.
 */
export function deactivate(): void {
  return;
}
