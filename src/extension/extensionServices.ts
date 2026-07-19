/**
 * Extension service composition root. This is the only place that wires VS Code
 * adapters to analyzer, storage, and Webview modules.
 */

import * as path from "node:path";
import * as vscode from "vscode";
import type { AnalysisBackend } from "../analyzer/core/analysisBackend";
import { AnalyzerPipeline } from "../analyzer/core/analyzerPipeline";
import { JavaScriptAnalyzer } from "../analyzer/languages/javascript";
import { JavaAnalyzer } from "../analyzer/languages/java";
import { PythonAnalyzer } from "../analyzer/languages/python";
import { TypeScriptAnalyzer } from "../analyzer/languages/typescript";
import { RustAnalyzerBackend } from "../analyzer/rust/rustAnalyzerBackend";
import { createProjectAnalyzerLogger } from "../observability/logger";
import { FileAnalysisCacheStore, MemoryAnalysisCacheStore, type AnalysisCacheStore } from "../storage/cacheStore";
import { readProjectAnalyzerConfig } from "../vscode/configuration";
import { createWorkspaceAnalysisCacheKey } from "../vscode/workspaceFingerprint";
import { VsCodeWorkspaceFileSystem } from "../vscode/workspaceFileSystem";
import { ExplorerGraphPanelProvider } from "../webview/explorerGraphPanelProvider";
import { ExplorerViewProvider } from "../webview/explorerViewProvider";
import { FunctionVisualizerPanelProvider } from "../webview/functionVisualizer";
import { ModuleVisualizerPanelProvider } from "../webview/moduleVisualizer";
import { WorkspaceGraphCoordinator } from "./workspaceAnalysis";

/** Runtime services shared by command handlers. */
export type ExtensionServices = {
  analyzer: AnalysisBackend;
  cacheStore: AnalysisCacheStore;
  explorerGraphPanelProvider: ExplorerGraphPanelProvider;
  explorerViewProvider: ExplorerViewProvider;
  functionVisualizerPanelProvider: FunctionVisualizerPanelProvider;
  moduleVisualizerPanelProvider: ModuleVisualizerPanelProvider;
  workspaceGraphCoordinator: WorkspaceGraphCoordinator;
};

/**
 * Creates the extension service graph for the current activation.
 */
export function createExtensionServices(context: vscode.ExtensionContext): ExtensionServices {
  const logger = createProjectAnalyzerLogger(context);
  const config = readProjectAnalyzerConfig();
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
    new JavaAnalyzer()
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
    logger
  });
  const functionVisualizerPanelProvider = new FunctionVisualizerPanelProvider({
    config,
    logger
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
    openFunction: (graph, nodeId) =>
      functionVisualizerPanelProvider.openFunction(graph, nodeId)
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
    workspaceGraphCoordinator
  });

  return {
    analyzer,
    cacheStore,
    explorerGraphPanelProvider,
    explorerViewProvider,
    functionVisualizerPanelProvider,
    moduleVisualizerPanelProvider,
    workspaceGraphCoordinator
  };
}
