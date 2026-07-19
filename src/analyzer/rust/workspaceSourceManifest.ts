/**
 * Binary workspace-source manifest shared with the dependency-free Rust engine.
 * Length-prefixed UTF-8 fields preserve arbitrary paths and unsaved source text
 * without relying on command-line argument limits or newline escaping.
 */

import type { SourceFile } from "../../shared/types";

/** Protocol marker read as the first line by the Rust manifest parser. */
const WORKSPACE_SOURCE_MANIFEST_VERSION = "project-analyzer-workspace-v1";

/** Lazy stdin payload that avoids duplicating all workspace source bytes. */
export type WorkspaceSourceManifestInput = {
  byteLength: number;
  chunks: Iterable<Buffer>;
};

/**
 * Serializes the exact source snapshots selected by the workspace adapter.
 * Records are path-sorted so graph output remains stable when VS Code returns
 * workspace search results in a different order.
 */
export function createWorkspaceSourceManifest(files: readonly SourceFile[]): Buffer {
  const input = createWorkspaceSourceManifestInput(files);
  return Buffer.concat([...input.chunks], input.byteLength);
}

/**
 * Creates a replayable, path-sorted stream of manifest chunks. Content buffers
 * are allocated only when the child process requests them through backpressure.
 */
export function createWorkspaceSourceManifestInput(
  files: readonly SourceFile[]
): WorkspaceSourceManifestInput {
  const sortedFiles = [...files].sort((left, right) => {
    if (left.path === right.path) {
      return 0;
    }
    return left.path < right.path ? -1 : 1;
  });
  const header = Buffer.from(
    `${WORKSPACE_SOURCE_MANIFEST_VERSION}\n${sortedFiles.length}\n`,
    "utf8"
  );
  let byteLength = header.length;
  for (const file of sortedFiles) {
    const pathLength = Buffer.byteLength(file.path, "utf8");
    const languageLength = Buffer.byteLength(normalizeEngineLanguageId(file.languageId), "utf8");
    const contentLength = Buffer.byteLength(file.content, "utf8");
    byteLength += Buffer.byteLength(`${pathLength}\n${languageLength}\n${contentLength}\n`, "ascii")
      + pathLength
      + languageLength
      + contentLength;
  }

  return {
    byteLength,
    chunks: {
      *[Symbol.iterator](): Iterator<Buffer> {
        yield header;
        for (const file of sortedFiles) {
          const pathBytes = Buffer.from(file.path, "utf8");
          const languageBytes = Buffer.from(normalizeEngineLanguageId(file.languageId), "utf8");
          const contentBytes = Buffer.from(file.content, "utf8");
          yield Buffer.from(
            `${pathBytes.length}\n${languageBytes.length}\n${contentBytes.length}\n`,
            "ascii"
          );
          yield pathBytes;
          yield languageBytes;
          yield contentBytes;
        }
      }
    }
  };
}

/** Maps VS Code's JSX language IDs to the engine's JavaScript-like families. */
function normalizeEngineLanguageId(languageId: string): string {
  switch (languageId) {
    case "typescriptreact":
      return "typescript";
    case "javascriptreact":
      return "javascript";
    default:
      return languageId;
  }
}
