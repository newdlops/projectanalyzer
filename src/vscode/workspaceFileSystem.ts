/**
 * VS Code-backed workspace file system adapter. It converts VS Code documents
 * and workspace searches into analyzer-friendly SourceFile snapshots.
 */

import * as vscode from "vscode";
import type { SourceFile } from "../shared/types";
import type { WorkspaceFileSystem } from "../analyzer/core/workspaceScanner";
import type { ProjectAnalyzerConfig } from "./configuration";
import { createContentHash } from "../shared/hash";

/** Maximum number of files returned by the initial scaffold scan. */
const DEFAULT_FIND_LIMIT = 10_000;

/**
 * File system adapter backed by VS Code workspace APIs.
 */
export class VsCodeWorkspaceFileSystem implements WorkspaceFileSystem {
  public constructor(private readonly config: ProjectAnalyzerConfig) {}

  /**
   * Returns the first workspace folder root. Multi-root handling is planned as a
   * later design decision in SPEC.
   */
  public getWorkspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  /**
   * Finds configured source files and converts them into SourceFile snapshots.
   */
  public async findSourceFiles(): Promise<SourceFile[]> {
    const files: SourceFile[] = [];
    const includePattern = createWorkspaceGlob(this.config.include);
    const excludePattern = createWorkspaceGlob(this.config.exclude);
    const uris = await vscode.workspace.findFiles(includePattern, excludePattern, DEFAULT_FIND_LIMIT);

    for (const uri of uris) {
      const document = await vscode.workspace.openTextDocument(uri);
      const content = document.getText();
      const sizeBytes = Buffer.byteLength(content, "utf8");
      const maxSizeBytes = this.config.maxFileSizeKb * 1024;

      if (sizeBytes > maxSizeBytes) {
        continue;
      }

      files.push({
        path: uri.fsPath,
        languageId: document.languageId,
        content,
        sizeBytes,
        contentHash: createContentHash(content)
      });
    }

    return files;
  }
}

/**
 * Creates a VS Code workspace glob from one or more configured patterns.
 */
export function createWorkspaceGlob(patterns: readonly string[]): string {
  if (patterns.length === 0) {
    return "";
  }

  if (patterns.length === 1) {
    return patterns[0];
  }

  return `{${patterns.join(",")}}`;
}
