/**
 * VS Code source-presentation adapter for graph navigation. It reuses an open
 * source tab whenever possible, owns one shared decoration type, and replaces
 * the previous graph-originated highlight on each source-backed node selection.
 */

import * as vscode from "vscode";
import type { SourceRange, SymbolNode } from "../shared/types";

/**
 * Opens source locations and marks their analyzer-backed range in the editor.
 * The interface keeps Webview providers dependent on presentation behavior,
 * rather than a concrete decoration implementation.
 */
export type SourceHighlighter = {
  revealNode(node: SymbolNode): Promise<void>;
  revealRange(filePath: string, range: SourceRange): Promise<void>;
};

/**
 * Presents one graph selection in VS Code and owns its disposable decoration.
 * Its lifecycle is the extension-host session; a new selection clears the
 * preceding editor decoration so stale graph context never accumulates.
 */
export class SourceHighlightService implements SourceHighlighter, vscode.Disposable {
  /** Shared visual treatment for the exact code range represented by a graph node. */
  private readonly decorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor("editor.wordHighlightStrongBackground"),
    borderColor: new vscode.ThemeColor("editor.wordHighlightStrongBorder"),
    borderStyle: "solid",
    borderWidth: "1px",
    overviewRulerColor: new vscode.ThemeColor("editorOverviewRuler.wordHighlightStrongForeground"),
    overviewRulerLane: vscode.OverviewRulerLane.Center,
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
  });

  /** Editor receiving the active decoration, if its document remains open. */
  private highlightedEditor: vscode.TextEditor | undefined;

  /** Opens a symbol definition and decorates its complete analyzer source range. */
  public async revealNode(node: SymbolNode): Promise<void> {
    await this.reveal(node.filePath, node.range, node.selectionRange);
  }

  /** Opens an exact statement/evidence range and decorates that source statement. */
  public async revealRange(filePath: string, range: SourceRange): Promise<void> {
    await this.reveal(filePath, range, range);
  }

  /** Releases the current editor mark and the VS Code decoration resource. */
  public dispose(): void {
    this.clearHighlight();
    this.decorationType.dispose();
  }

  /**
   * Reuses the target's existing editor tab when present; otherwise opens it,
   * clamps stale ranges, then applies one visible graph-source mark.
   */
  private async reveal(
    filePath: string,
    highlightSourceRange: SourceRange,
    selectionSourceRange: SourceRange
  ): Promise<void> {
    const sourceUri = vscode.Uri.file(filePath);
    const existingTabColumn = findOpenTextTabColumn(sourceUri);
    const document = await vscode.workspace.openTextDocument(sourceUri);
    const editor = existingTabColumn === undefined
      ? await vscode.window.showTextDocument(document)
      : await vscode.window.showTextDocument(document, { viewColumn: existingTabColumn });
    const highlightRange = createDocumentRange(document, highlightSourceRange);
    const selectionRange = createDocumentRange(document, selectionSourceRange);

    this.clearHighlight();
    editor.setDecorations(this.decorationType, [highlightRange]);
    this.highlightedEditor = editor;
    editor.selection = new vscode.Selection(selectionRange.start, selectionRange.end);
    editor.revealRange(highlightRange, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }

  /** Removes the previous graph-originated highlight without touching other decorations. */
  private clearHighlight(): void {
    this.highlightedEditor?.setDecorations(this.decorationType, []);
    this.highlightedEditor = undefined;
  }
}

/** Finds the group containing an open text tab so navigation does not create a duplicate tab. */
function findOpenTextTabColumn(uri: vscode.Uri): vscode.ViewColumn | undefined {
  for (const tabGroup of vscode.window.tabGroups.all) {
    for (const tab of tabGroup.tabs) {
      if (tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === uri.toString()) {
        return tabGroup.viewColumn;
      }
    }
  }
  return undefined;
}

/** Converts an analyzer range to a valid current-document range after source edits. */
function createDocumentRange(document: vscode.TextDocument, sourceRange: SourceRange): vscode.Range {
  const start = clampDocumentPosition(document, sourceRange.startLine, sourceRange.startCharacter);
  const end = clampDocumentPosition(document, sourceRange.endLine, sourceRange.endCharacter);

  if (end.isBefore(start)) {
    return new vscode.Range(start, start);
  }
  if (start.isEqual(end)) {
    return document.lineAt(start.line).range;
  }
  return new vscode.Range(start, end);
}

/** Bounds one possibly stale analyzer offset to a current VS Code document position. */
function clampDocumentPosition(
  document: vscode.TextDocument,
  line: number,
  character: number
): vscode.Position {
  const lastLine = Math.max(0, document.lineCount - 1);
  const safeLine = Math.min(lastLine, Math.max(0, Math.floor(line)));
  const lineLength = document.lineAt(safeLine).range.end.character;
  const safeCharacter = Math.min(lineLength, Math.max(0, Math.floor(character)));
  return new vscode.Position(safeLine, safeCharacter);
}
