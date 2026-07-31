/** VS Code command adapter for opening project-level Module Flow. */

import * as vscode from "vscode";
import type { ModuleFlowLaunchResultPayload } from "../../protocol/moduleFlow";
import type { ModuleVisualizerPanelProvider } from "../../webview/moduleVisualizer";
import type { WorkspaceGraphCoordinator } from "../workspaceAnalysis";
import { localizeHost } from "../../localization/uiLanguage";
import { readProjectAnalyzerConfig } from "../../vscode/configuration";

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
  const language = readProjectAnalyzerConfig().uiLanguage;
  try {
    return await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: localizeHost(language, "preparingModule")
      },
      async (): Promise<ModuleFlowLaunchResultPayload> => {
        const resolution = await services.workspaceGraphCoordinator.resolveWorkspaceGraph();
        if (resolution.status === "unavailable") {
          const message = localizeHost(language, "openWorkspace");
          await vscode.window.showInformationMessage(
            message
          );
          return { outcome: "unavailable", message };
        }
        await services.moduleVisualizerPanelProvider.openGraph(resolution.graph);
        return {
          outcome: "opened",
          message: localizeHost(language, "moduleOpened")
        };
      }
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : undefined;
    const message = localizeHost(language, "moduleFailed", { detail: detail ?? localizeHost(language, "unknownVisualizationFailure") });
    await vscode.window.showErrorMessage(
      message
    );
    return { outcome: "failed", message, ...(detail ? { detail } : {}) };
  }
}

/** Produces concise user-facing failures without exposing extension internals. */
