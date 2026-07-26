/**
 * Extension service composition root. This is the only place that wires VS Code
 * adapters to analyzer, storage, and Webview modules.
 */

import * as path from "node:path";
import * as vscode from "vscode";
import type { AnalysisBackend } from "../analyzer/core/analysisBackend";
import { AnalyzerPipeline } from "../analyzer/core/analyzerPipeline";
import { FunctionalLanguageAnalyzer } from "../analyzer/languages/functional";
import { JavaScriptAnalyzer } from "../analyzer/languages/javascript";
import { JavaAnalyzer } from "../analyzer/languages/java";
import { PythonAnalyzer } from "../analyzer/languages/python";
import { TypeScriptAnalyzer } from "../analyzer/languages/typescript";
import { RustAnalyzerBackend } from "../analyzer/rust/rustAnalyzerBackend";
import { createProjectAnalyzerLogger } from "../observability/logger";
import { FileAnalysisCacheStore, MemoryAnalysisCacheStore, type AnalysisCacheStore } from "../storage/cacheStore";
import { readProjectAnalyzerConfig } from "../vscode/configuration";
import { SourceHighlightService } from "../vscode/sourceHighlightService";
import { createWorkspaceAnalysisCacheKey } from "../vscode/workspaceFingerprint";
import { VsCodeWorkspaceFileSystem } from "../vscode/workspaceFileSystem";
import { ExplorerGraphPanelProvider } from "../webview/explorerGraphPanelProvider";
import { ExplorerViewProvider } from "../webview/explorerViewProvider";
import { FunctionVisualizerPanelProvider } from "../webview/functionVisualizer";
import { ModuleVisualizerPanelProvider } from "../webview/moduleVisualizer";
import { openModuleFlow } from "./moduleVisualization";
import { WorkspaceGraphCoordinator } from "./workspaceAnalysis";

/** Runtime services shared by command handlers. */
export type ExtensionServices = {
  analyzer: AnalysisBackend;
  cacheStore: AnalysisCacheStore;
  explorerGraphPanelProvider: ExplorerGraphPanelProvider;
  explorerViewProvider: ExplorerViewProvider;
  functionVisualizerPanelProvider: FunctionVisualizerPanelProvider;
  moduleVisualizerPanelProvider: ModuleVisualizerPanelProvider;
  sourceHighlighter: SourceHighlightService;
  workspaceGraphCoordinator: WorkspaceGraphCoordinator;
};

/**
 * Creates the extension service graph for the current activation.
 */
export function createExtensionServices(context: vscode.ExtensionContext): ExtensionServices {
  const logger = createProjectAnalyzerLogger(context);
  const config = readProjectAnalyzerConfig();
  const sourceHighlighter = new SourceHighlightService();
  context.subscriptions.push(sourceHighlighter);
  const fileSystem = new VsCodeWorkspaceFileSystem(config);
  const storageDirectory = context.storageUri?.fsPath ?? context.globalStorageUri.fsPath;
  const cacheStore = config.cache.enabled
    ? new FileAnalysisCacheStore(storageDirectory, config.cache.maxSizeMb)
    // Persistence-disabled mode needs only the graph currently feeding the UI.
    : new MemoryAnalysisCacheStore(1);
  const fallbackAnalyzer = new AnalyzerPipeline(fileSystem, [
    new TypeScriptAnalyzer(),
    new JavaScriptAnalyzer(),
    new PythonAnalyzer(),
    new JavaAnalyzer(),
    new FunctionalLanguageAnalyzer()
  ]);
  const analyzer = new RustAnalyzerBackend({
    engineRoot: path.join(context.extensionUri.fsPath, "engine", "analyzer"),
    workspaceFileSystem: fileSystem,
    maxFileSizeKb: config.maxFileSizeKb,
    fallbackBackend: fallbackAnalyzer,
    logger
  });
  context.subscriptions.push(analyzer);
  const explorerGraphPanelProvider = new ExplorerGraphPanelProvider({
    context,
    cacheStore,
    config,
    logger,
    sourceHighlighter
  });
  const functionVisualizerPanelProvider = new FunctionVisualizerPanelProvider({
    config,
    logger,
    sourceHighlighter
  });
  const workspaceGraphCoordinator = new WorkspaceGraphCoordinator({
    analyzer,
    cacheEnabled: config.cache.enabled,
    cacheStore,
    createWorkspaceCacheKey: (workspaceRoot) =>
      createWorkspaceAnalysisCacheKey(workspaceRoot, config),
    getWorkspaceRoot: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  });
  const moduleVisualizerPanelProvider = new ModuleVisualizerPanelProvider({
    logger,
    sourceHighlighter
  });
  context.subscriptions.push(moduleVisualizerPanelProvider);
  const explorerViewProvider = new ExplorerViewProvider({
    context,
    analyzer,
    cacheStore,
    config,
    functionVisualizerPanelProvider,
    graphPanelProvider: explorerGraphPanelProvider,
    logger,
    openModuleFlow: () => openModuleFlow({
      moduleVisualizerPanelProvider,
      workspaceGraphCoordinator
    }),
    sourceHighlighter,
    workspaceGraphCoordinator
  });

  return {
    analyzer,
    cacheStore,
    explorerGraphPanelProvider,
    explorerViewProvider,
    functionVisualizerPanelProvider,
    moduleVisualizerPanelProvider,
    sourceHighlighter,
    workspaceGraphCoordinator
  };
}
