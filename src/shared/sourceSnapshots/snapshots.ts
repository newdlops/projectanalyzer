/** Immutable analyzer inputs with independently computed content identities. */
import { createContentHash } from "../hash";
import type { SourceFile } from "../types";
import type { AnalyzedSourceSnapshot } from "./types";

/**
 * Owns scalar input records before asynchronous parsing or lazy stdin writes.
 * Strings are immutable and shared; this does not copy all workspace text.
 * Caller-provided hashes and sizes are replaced by identities of the actual text.
 */
export function snapshotSourceFiles(files: readonly SourceFile[]): readonly SourceFile[] {
  return createAnalyzedSourceSnapshot(files).files;
}

/** Acquires input ownership and file bindings together with one hash per file. */
export function createAnalyzedSourceSnapshot(files: readonly SourceFile[]): AnalyzedSourceSnapshot {
  const paths = new Set<string>();
  const snapshots = Object.freeze(files.map((file) => {
    if (!file.path || paths.has(file.path)) throw new Error("Duplicate or empty analyzed source path");
    paths.add(file.path);
    return Object.freeze({
      path: file.path,
      languageId: file.languageId,
      content: file.content,
      sizeBytes: Buffer.byteLength(file.content, "utf8"),
      contentHash: createContentHash(file.content)
    });
  }));
  const bindings = Object.freeze(snapshots.map((file) => Object.freeze({
    filePath: file.path, contentHash: file.contentHash, sizeBytes: file.sizeBytes
  })));
  return Object.freeze({ files: snapshots, bindings });
}
