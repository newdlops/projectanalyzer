/**
 * Shared VS Code host actions used by sidebar and graph-panel Webviews. Keeping
 * these helpers outside providers avoids duplicating editor and export logic.
 */

import * as crypto from "node:crypto";
import * as vscode from "vscode";
import { localizeHost, type UiLanguage } from "../localization/uiLanguage";
import type { ProjectGraph, SymbolNode } from "../shared/types";

/** Reads the current editor document snapshot, including unsaved changes. */
export async function readSourceText(filePath: string): Promise<string | undefined> {
  try {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
    return document.getText();
  } catch {
    return undefined;
  }
}

/**
 * Exports the graph to a user-selected JSON file and returns locale-neutral success data.
 */
export async function exportGraphToJson(
  graph: ProjectGraph,
  language: UiLanguage
): Promise<{ nodeCount: number } | undefined> {
  const uri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file("project-analyzer-graph.json"),
    filters: {
      JSON: ["json"]
    },
    saveLabel: localizeHost(language, "exportGraph")
  });

  if (!uri) {
    return undefined;
  }

  const serializedGraph = JSON.stringify(graph, null, 2);
  await vscode.workspace.fs.writeFile(uri, Buffer.from(serializedGraph, "utf8"));
  return { nodeCount: graph.nodes.length };
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
