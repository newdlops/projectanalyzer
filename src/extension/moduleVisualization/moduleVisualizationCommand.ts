/** VS Code command adapter for opening project-level Module Flow. */

import * as vscode from "vscode";
import type { ModuleVisualizerPanelProvider } from "../../webview/moduleVisualizer";
import type { WorkspaceGraphCoordinator } from "../workspaceAnalysis";

/** Public command identity contributed to the Command Palette and sidebar title. */
export const OPEN_MODULE_FLOW_COMMAND = "projectAnalyzer.openModuleFlow";

/** Narrow collaborators required by the project Module Flow command. */
export type ModuleVisualizationCommandServices = {
  moduleVisualizerPanelProvider: ModuleVisualizerPanelProvider;
  workspaceGraphCoordinator: WorkspaceGraphCoordinator;
};

/** Registers the workspace-scoped command for the extension-host lifecycle. */
export function registerModuleVisualizationCommand(
  context: vscode.ExtensionContext,
  services: ModuleVisualizationCommandServices
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      OPEN_MODULE_FLOW_COMMAND,
      async () => openModuleFlow(services)
    )
  );
}

/** Resolves an exact workspace snapshot and reveals its reusable graph tab. */
export async function openModuleFlow(
  services: ModuleVisualizationCommandServices
): Promise<void> {
  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: "Code Flow: preparing project module flow"
      },
      async () => {
        const resolution = await services.workspaceGraphCoordinator.resolveWorkspaceGraph();
        if (resolution.status === "unavailable") {
          await vscode.window.showInformationMessage(
            "Open a workspace folder before visualizing project Module Flow."
          );
          return;
        }
        await services.moduleVisualizerPanelProvider.openGraph(resolution.graph);
      }
    );
  } catch (error) {
    await vscode.window.showErrorMessage(
      `Could not open project Module Flow: ${formatError(error)}`
    );
  }
}

/** Produces concise user-facing failures without exposing extension internals. */
function formatError(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown visualization failure";
}
