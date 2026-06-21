/**
 * VS Code workspace fingerprint adapter for analysis cache invalidation.
 *
 * Workspace cache keys are intentionally cheap to compute: file path, size, and
 * mtime identify saved files, while dirty open documents contribute content
 * hashes so unsaved editor changes do not accidentally reuse a stale graph.
 */

import * as path from "node:path";
import * as vscode from "vscode";
import type { ProjectAnalyzerConfig } from "./configuration";
import { createWorkspaceGlob } from "./workspaceFileSystem";
import { createContentHash } from "../shared/hash";

const DEFAULT_FIND_LIMIT = 10_000;
const WORKSPACE_CACHE_KEY_VERSION = "workspace-cache-v1";

/** Creates the cache key for the current saved and dirty workspace state. */
export async function createWorkspaceAnalysisCacheKey(
  workspaceRoot: string,
  config: ProjectAnalyzerConfig
): Promise<string> {
  const includePattern = createWorkspaceGlob(config.include);
  const excludePattern = createWorkspaceGlob(config.exclude);
  const maxSizeBytes = config.maxFileSizeKb * 1024;
  const uris = await vscode.workspace.findFiles(includePattern, excludePattern, DEFAULT_FIND_LIMIT);
  const files = [];

  for (const uri of uris.sort((left, right) => left.fsPath.localeCompare(right.fsPath))) {
    const stat = await vscode.workspace.fs.stat(uri);

    if (stat.size > maxSizeBytes) {
      continue;
    }

    files.push({
      path: workspaceRelativePath(workspaceRoot, uri.fsPath),
      size: stat.size,
      mtime: stat.mtime
    });
  }

  const dirtyDocuments = vscode.workspace.textDocuments
    .filter((document) => document.isDirty && document.uri.scheme === "file")
    .filter((document) => isInsideWorkspace(workspaceRoot, document.uri.fsPath))
    .map((document) => ({
      path: workspaceRelativePath(workspaceRoot, document.uri.fsPath),
      languageId: document.languageId,
      contentHash: createContentHash(document.getText())
    }))
    .sort((left, right) => left.path.localeCompare(right.path));

  return createContentHash(
    JSON.stringify({
      version: WORKSPACE_CACHE_KEY_VERSION,
      workspaceRoot: normalizePath(workspaceRoot),
      include: config.include,
      exclude: config.exclude,
      maxFileSizeKb: config.maxFileSizeKb,
      files,
      dirtyDocuments
    })
  );
}

/** Creates a cache key for one current-file analysis request. */
export function createCurrentFileAnalysisCacheKey(input: {
  workspaceRoot: string;
  path: string;
  languageId: string;
  contentHash: string;
}): string {
  return createContentHash(
    JSON.stringify({
      version: "current-file-cache-v1",
      workspaceRoot: normalizePath(input.workspaceRoot),
      path: normalizePath(input.path),
      languageId: input.languageId,
      contentHash: input.contentHash
    })
  );
}

/** Returns a normalized path relative to the workspace when possible. */
function workspaceRelativePath(workspaceRoot: string, filePath: string): string {
  const relative = path.relative(workspaceRoot, filePath);
  return normalizePath(relative && !relative.startsWith("..") ? relative : filePath);
}

/** Returns whether a file path is under the active workspace root. */
function isInsideWorkspace(workspaceRoot: string, filePath: string): boolean {
  const relative = path.relative(workspaceRoot, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** Normalizes path separators before hashing. */
function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}
