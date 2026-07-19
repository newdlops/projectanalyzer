/** VS Code command adapter for opening project-level Module Flow. */

import * as vscode from "vscode";
import type { ModuleFlowLaunchResultPayload } from "../../protocol/moduleFlow";
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
): Promise<ModuleFlowLaunchResultPayload> {
  try {
    return await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: "Code Flow: preparing project module flow"
      },
      async (): Promise<ModuleFlowLaunchResultPayload> => {
        const resolution = await services.workspaceGraphCoordinator.resolveWorkspaceGraph();
        if (resolution.status === "unavailable") {
          const message = "Open a workspace folder before visualizing project Module Flow.";
          await vscode.window.showInformationMessage(
            message
          );
          return { outcome: "unavailable", message };
        }
        await services.moduleVisualizerPanelProvider.openGraph(resolution.graph);
        return {
          outcome: "opened",
          message: "Module Flow opened in an editor tab."
        };
      }
    );
  } catch (error) {
    const message = `Could not open project Module Flow: ${formatError(error)}`;
    await vscode.window.showErrorMessage(
      message
    );
    return { outcome: "failed", message };
  }
}

/** Produces concise user-facing failures without exposing extension internals. */
function formatError(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown visualization failure";
}
