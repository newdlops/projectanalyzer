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
  if (document.isUntitled) {
    await vscode.window.showInformationMessage(
      "Save this TypeScript or JavaScript file before visualizing its function flow."
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
      "Place the cursor inside a TypeScript or JavaScript function, method, constructor, or callback."
    );
    return;
  }

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: `Code Flow: visualizing ${target.name}`
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
      `Could not visualize the current function: ${formatError(error)}`
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
function formatError(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown visualization failure";
}
