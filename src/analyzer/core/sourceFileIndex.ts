/**
 * Workspace source-path index shared by analyzer plugins during one graph build.
 * It is constructed once per snapshot so per-file edge extraction does not
 * repeatedly allocate an O(workspace files) lookup map.
 */

import * as path from "node:path";

/** Builds normalized absolute-path lookup for local relationship resolution. */
export function createSourceFilePathIndex(
  sourceFiles: readonly { path: string }[]
): ReadonlyMap<string, string> {
  return new Map(sourceFiles.map((file) => [normalizeSourceFilePath(file.path), file.path]));
}

/** Normalizes one source path using the active platform's resolution rules. */
export function normalizeSourceFilePath(filePath: string): string {
  return path.resolve(filePath);
}
