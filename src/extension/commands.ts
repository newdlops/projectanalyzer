/**
 * Command registration and command handlers. Handlers stay thin and delegate
 * analysis, storage, and UI work to injected services.
 */

import * as vscode from "vscode";
import type { GraphViewMode } from "../protocol/messages";
import { createContentHash } from "../shared/hash";
import type { ExtensionServices } from "./extensionServices";

/** VS Code command IDs contributed by the extension manifest. */
const COMMANDS = {
  openExplorer: "projectAnalyzer.openExplorer",
  analyzeWorkspace: "projectAnalyzer.analyzeWorkspace",
  analyzeCurrentFile: "projectAnalyzer.analyzeCurrentFile",
  showCallGraph: "projectAnalyzer.showCallGraph",
  showFileGraph: "projectAnalyzer.showFileGraph",
  showClassGraph: "projectAnalyzer.showClassGraph",
  findCallers: "projectAnalyzer.findCallers",
  findCallees: "projectAnalyzer.findCallees",
  exportGraph: "projectAnalyzer.exportGraph",
  clearCache: "projectAnalyzer.clearCache",
  cancelAnalysis: "projectAnalyzer.cancelAnalysis"
} as const;

/**
 * Registers all Project Analyzer commands with VS Code.
 */
export function registerProjectAnalyzerCommands(
  context: vscode.ExtensionContext,
  services: ExtensionServices
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.openExplorer, async () => {
      await openExplorerSidebar(services, "file");
    }),
    vscode.commands.registerCommand(COMMANDS.analyzeWorkspace, async () => {
      await analyzeWorkspace(services);
    }),
    vscode.commands.registerCommand(COMMANDS.analyzeCurrentFile, async () => {
      await analyzeCurrentFile(services);
    }),
    vscode.commands.registerCommand(COMMANDS.showCallGraph, async () => {
      await openExplorerSidebar(services, "call");
    }),
    vscode.commands.registerCommand(COMMANDS.showFileGraph, async () => {
      await openExplorerSidebar(services, "file");
    }),
    vscode.commands.registerCommand(COMMANDS.showClassGraph, async () => {
      await openExplorerSidebar(services, "class");
    }),
    vscode.commands.registerCommand(COMMANDS.findCallers, () => {
      void vscode.window.showInformationMessage("Find Callers will be implemented with call graph traversal.");
    }),
    vscode.commands.registerCommand(COMMANDS.findCallees, () => {
      void vscode.window.showInformationMessage("Find Callees will be implemented with call graph traversal.");
    }),
    vscode.commands.registerCommand(COMMANDS.exportGraph, () => {
      void vscode.window.showInformationMessage("Graph export will be implemented after graph persistence is available.");
    }),
    vscode.commands.registerCommand(COMMANDS.clearCache, async () => {
      await services.cacheStore.clear();
      await vscode.window.showInformationMessage("Project Analyzer cache cleared.");
    }),
    vscode.commands.registerCommand(COMMANDS.cancelAnalysis, () => {
      void vscode.window.showInformationMessage("Analysis cancellation will be implemented with cancellation tokens.");
    })
  );
}

/**
 * Runs workspace analysis and stores the latest graph for the explorer.
 */
async function analyzeWorkspace(services: ExtensionServices): Promise<void> {
  const result = await services.analyzer.analyzeWorkspace();
  await services.cacheStore.saveLatestGraph(result.graph);
  await services.explorerViewProvider.publishGraph(result.graph);
  await vscode.window.showInformationMessage(
    `Project Analyzer indexed ${result.graph.metadata.fileCount} files.`
  );
}

/**
 * Runs current-file analysis after converting the active document into a source snapshot.
 */
async function analyzeCurrentFile(services: ExtensionServices): Promise<void> {
  const editor = vscode.window.activeTextEditor;

  if (!editor) {
    await vscode.window.showWarningMessage("Open a source file before running current-file analysis.");
    return;
  }

  const document = editor.document;
  const content = document.getText();
  const result = await services.analyzer.analyzeFile({
    path: document.uri.fsPath,
    languageId: document.languageId,
    content,
    sizeBytes: Buffer.byteLength(content, "utf8"),
    contentHash: createContentHash(content)
  });

  await services.cacheStore.saveLatestGraph(result.graph);
  await services.explorerViewProvider.publishGraph(result.graph);
  await vscode.window.showInformationMessage(`Project Analyzer analyzed ${document.fileName}.`);
}

/**
 * Reveals the Project Analyzer sidebar container and sets the requested graph mode.
 */
async function openExplorerSidebar(
  services: ExtensionServices,
  mode: GraphViewMode
): Promise<void> {
  await vscode.commands.executeCommand("workbench.view.extension.projectAnalyzer");
  await services.explorerViewProvider.setMode(mode);
}
