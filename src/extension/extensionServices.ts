/**
 * Extension service composition root. This is the only place that wires VS Code
 * adapters to analyzer, storage, and Webview modules.
 */

import * as vscode from "vscode";
import { AnalyzerPipeline } from "../analyzer/core/analyzerPipeline";
import { JavaScriptAnalyzer } from "../analyzer/languages/javascript";
import { PythonAnalyzer } from "../analyzer/languages/python";
import { TypeScriptAnalyzer } from "../analyzer/languages/typescript";
import { MemoryAnalysisCacheStore } from "../storage/cacheStore";
import { readProjectAnalyzerConfig } from "../vscode/configuration";
import { VsCodeWorkspaceFileSystem } from "../vscode/workspaceFileSystem";
import { ExplorerPanel } from "../webview/explorerPanel";

/** Runtime services shared by command handlers. */
export type ExtensionServices = {
  analyzer: AnalyzerPipeline;
  cacheStore: MemoryAnalysisCacheStore;
  explorerPanel: ExplorerPanel;
};

/**
 * Creates the extension service graph for the current activation.
 */
export function createExtensionServices(context: vscode.ExtensionContext): ExtensionServices {
  const config = readProjectAnalyzerConfig();
  const fileSystem = new VsCodeWorkspaceFileSystem(config);
  const cacheStore = new MemoryAnalysisCacheStore();
  const analyzer = new AnalyzerPipeline(fileSystem, [
    new TypeScriptAnalyzer(),
    new JavaScriptAnalyzer(),
    new PythonAnalyzer()
  ]);
  const explorerPanel = new ExplorerPanel({ context, cacheStore });

  return {
    analyzer,
    cacheStore,
    explorerPanel
  };
}
