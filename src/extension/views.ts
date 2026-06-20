/**
 * View registration for GUI surfaces contributed by Project Analyzer.
 */

import * as vscode from "vscode";
import { ExplorerViewProvider } from "../webview/explorerViewProvider";
import type { ExtensionServices } from "./extensionServices";

/**
 * Registers the sidebar Structure Explorer Webview view.
 */
export function registerProjectAnalyzerViews(
  context: vscode.ExtensionContext,
  services: ExtensionServices
): void {
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ExplorerViewProvider.viewType,
      services.explorerViewProvider,
      {
        webviewOptions: {
          retainContextWhenHidden: true
        }
      }
    )
  );
}
