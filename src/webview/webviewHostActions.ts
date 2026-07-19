/**
 * Shared VS Code host actions used by sidebar and graph-panel Webviews. Keeping
 * these helpers outside providers avoids duplicating editor and export logic.
 */

import * as crypto from "node:crypto";
import * as vscode from "vscode";
import type { ProjectGraph, SourceRange, SymbolNode } from "../shared/types";

/**
 * Opens a graph node's source range in the active editor group.
 */
export async function openNodeInEditor(node: SymbolNode): Promise<void> {
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(node.filePath));
  const editor = await vscode.window.showTextDocument(document);
  const position = new vscode.Position(node.selectionRange.startLine, node.selectionRange.startCharacter);
  const range = new vscode.Range(
    position,
    new vscode.Position(node.selectionRange.endLine, node.selectionRange.endCharacter)
  );

  editor.selection = new vscode.Selection(range.start, range.end);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

/** Reads the current editor document snapshot, including unsaved changes. */
export async function readSourceText(filePath: string): Promise<string | undefined> {
  try {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
    return document.getText();
  } catch {
    return undefined;
  }
}

/** Opens one Host-approved statement range in the active editor group. */
export async function openSourceLocationInEditor(
  filePath: string,
  sourceRange: SourceRange
): Promise<void> {
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
  const editor = await vscode.window.showTextDocument(document);
  const range = new vscode.Range(
    new vscode.Position(sourceRange.startLine, sourceRange.startCharacter),
    new vscode.Position(sourceRange.endLine, sourceRange.endCharacter)
  );
  editor.selection = new vscode.Selection(range.start, range.end);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

/**
 * Exports the graph to a user-selected JSON file and returns a status message.
 */
export async function exportGraphToJson(graph: ProjectGraph): Promise<string | undefined> {
  const uri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file("project-analyzer-graph.json"),
    filters: {
      JSON: ["json"]
    },
    saveLabel: "Export Graph"
  });

  if (!uri) {
    return undefined;
  }

  const serializedGraph = JSON.stringify(graph, null, 2);
  await vscode.workspace.fs.writeFile(uri, Buffer.from(serializedGraph, "utf8"));
  return `Exported ${graph.nodes.length} nodes`;
}

/**
 * Creates a nonce for Webview script CSP.
 */
export function createNonce(): string {
  return crypto.randomBytes(16).toString("base64");
}

/**
 * Returns the shortest stable display label for status messages.
 */
export function getNodeDisplayName(node: SymbolNode): string {
  return node.name || node.qualifiedName || node.id;
}

/**
 * Formats counted nouns for compact Webview status messages.
 */
export function formatCount(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
