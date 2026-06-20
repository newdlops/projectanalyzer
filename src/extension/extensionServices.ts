/**
 * Extension service composition root. This is the only place that wires VS Code
 * adapters to analyzer, storage, and Webview modules.
 */

import * as path from "node:path";
import * as vscode from "vscode";
import type { AnalysisBackend } from "../analyzer/core/analysisBackend";
import { AnalyzerPipeline } from "../analyzer/core/analyzerPipeline";
import { JavaScriptAnalyzer } from "../analyzer/languages/javascript";
import { PythonAnalyzer } from "../analyzer/languages/python";
import { TypeScriptAnalyzer } from "../analyzer/languages/typescript";
import { RustAnalyzerBackend } from "../analyzer/rust/rustAnalyzerBackend";
import { createProjectAnalyzerLogger } from "../observability/logger";
import { MemoryAnalysisCacheStore } from "../storage/cacheStore";
import { readProjectAnalyzerConfig } from "../vscode/configuration";
import { VsCodeWorkspaceFileSystem } from "../vscode/workspaceFileSystem";
import { ExplorerGraphPanelProvider } from "../webview/explorerGraphPanelProvider";
import { ExplorerViewProvider } from "../webview/explorerViewProvider";

/** Runtime services shared by command handlers. */
export type ExtensionServices = {
  analyzer: AnalysisBackend;
  cacheStore: MemoryAnalysisCacheStore;
  explorerGraphPanelProvider: ExplorerGraphPanelProvider;
  explorerViewProvider: ExplorerViewProvider;
};

/**
 * Creates the extension service graph for the current activation.
 */
export function createExtensionServices(context: vscode.ExtensionContext): ExtensionServices {
  const logger = createProjectAnalyzerLogger(context);
  const config = readProjectAnalyzerConfig();
  const fileSystem = new VsCodeWorkspaceFileSystem(config);
  const cacheStore = new MemoryAnalysisCacheStore();
  const fallbackAnalyzer = new AnalyzerPipeline(fileSystem, [
    new TypeScriptAnalyzer(),
    new JavaScriptAnalyzer(),
    new PythonAnalyzer()
  ]);
  const analyzer = new RustAnalyzerBackend({
    engineRoot: path.join(context.extensionUri.fsPath, "engine", "analyzer"),
    getWorkspaceRoot: () => fileSystem.getWorkspaceRoot(),
    maxFileSizeKb: config.maxFileSizeKb,
    fallbackBackend: fallbackAnalyzer,
    logger
  });
  const explorerGraphPanelProvider = new ExplorerGraphPanelProvider({
    context,
    cacheStore,
    config,
    logger
  });
  const explorerViewProvider = new ExplorerViewProvider({
    context,
    analyzer,
    cacheStore,
    config,
    graphPanelProvider: explorerGraphPanelProvider,
    logger
  });

  return {
    analyzer,
    cacheStore,
    explorerGraphPanelProvider,
    explorerViewProvider
  };
}
