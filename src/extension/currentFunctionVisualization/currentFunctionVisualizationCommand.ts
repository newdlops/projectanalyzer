/**
 * VS Code command adapter for visualizing the callable at the active cursor. It
 * snapshots dirty source, runs bounded current-file analysis, and opens Function
 * Logic in its dedicated editor tab.
 */

import * as vscode from "vscode";
import { findFunctionAtPosition } from "../../analyzer/functionLogic";
import { createContentHash } from "../../shared/hash";
import type { SourceFile } from "../../shared/types";
import type { ExtensionServices } from "../extensionServices";
import { resolveCurrentFunctionGraph } from "./currentFunctionGraph";
import { localizeHost } from "../../localization/uiLanguage";
import { readProjectAnalyzerConfig } from "../../vscode/configuration";

/** Public command identity contributed to the editor context menu. */
export const VISUALIZE_CURRENT_FUNCTION_COMMAND =
  "projectAnalyzer.visualizeCurrentFunction";

/** Registers the editor-bound command for the extension-host lifecycle. */
export function registerCurrentFunctionVisualizationCommand(
  context: vscode.ExtensionContext,
  services: ExtensionServices
): void {
  context.subscriptions.push(
    vscode.commands.registerTextEditorCommand(
      VISUALIZE_CURRENT_FUNCTION_COMMAND,
      async (editor) => visualizeCurrentFunction(editor, services)
    )
  );
}

/** Resolves, analyzes, and opens the current function without requiring a save. */
export async function visualizeCurrentFunction(
  editor: vscode.TextEditor,
  services: ExtensionServices
): Promise<void> {
  const document = editor.document;
  const language = readProjectAnalyzerConfig().uiLanguage;
  if (document.isUntitled) {
    await vscode.window.showInformationMessage(
      localizeHost(language, "saveSourceFirst")
    );
    return;
  }

  const sourceText = document.getText();
  const cursor = editor.selection.active;
  const target = findFunctionAtPosition({
    filePath: document.uri.fsPath,
    languageId: document.languageId,
    sourceText,
    position: { line: cursor.line, character: cursor.character }
  });
  if (!target) {
    await vscode.window.showInformationMessage(
      localizeHost(language, "placeCursor")
    );
    return;
  }

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: localizeHost(language, "visualizing", { name: target.name })
      },
      async () => {
        const sourceFile = createSourceFileSnapshot(document, sourceText);
        const result = await services.analyzer.analyzeFile(sourceFile);
        const resolution = resolveCurrentFunctionGraph(result.graph, target);

        await services.functionVisualizerPanelProvider.openFunction(
          resolution.graph,
          resolution.node.id,
          sourceText
        );
      }
    );
  } catch (error) {
    await vscode.window.showErrorMessage(
      localizeHost(language, "visualizeFailed", { detail: formatError(error, language) })
    );
  }
}

/** Creates the analyzer input from one immutable editor source snapshot. */
function createSourceFileSnapshot(
  document: vscode.TextDocument,
  content: string
): SourceFile {
  return {
    path: document.uri.fsPath,
    languageId: document.languageId,
    content,
    sizeBytes: Buffer.byteLength(content, "utf8"),
    contentHash: createContentHash(content)
  };
}

/** Produces concise user-facing failures without exposing extension internals. */
function formatError(error: unknown, language: "en" | "ko"): string {
  // External Error detail remains literal; only the owned fallback is localized.
  return error instanceof Error ? error.message : localizeHost(language, "unknownVisualizationFailure");
}
