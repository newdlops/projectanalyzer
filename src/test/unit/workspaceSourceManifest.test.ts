/**
 * Unit tests for the dependency-free Rust workspace source manifest contract.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { SourceFile } from "../../shared/types";
import { createWorkspaceSourceManifest } from "../../analyzer/rust/workspaceSourceManifest";

/** Reads one newline-terminated ASCII integer from a manifest buffer. */
function readLength(buffer: Buffer, cursor: { offset: number }): number {
  const newline = buffer.indexOf(0x0a, cursor.offset);
  assert.notEqual(newline, -1, "length header must end with a newline");
  const value = Number.parseInt(buffer.toString("ascii", cursor.offset, newline), 10);
  cursor.offset = newline + 1;
  return value;
}

/** Reads one length-prefixed UTF-8 field from a manifest buffer. */
function readField(buffer: Buffer, cursor: { offset: number }, length: number): string {
  const value = buffer.toString("utf8", cursor.offset, cursor.offset + length);
  cursor.offset += length;
  return value;
}

/** Creates a compact source snapshot for protocol tests. */
function source(path: string, languageId: string, content: string): SourceFile {
  return {
    path,
    languageId,
    content,
    sizeBytes: Buffer.byteLength(content, "utf8"),
    contentHash: "unused-by-manifest"
  };
}

test("workspace source manifest preserves content and uses stable path order", () => {
  const manifest = createWorkspaceSourceManifest([
    source("/workspace/z.py", "python", "value = '\0'\n"),
    source("/workspace/가.tsx", "typescriptreact", "export const View = () => null;\n")
  ]);
  const cursor = { offset: 0 };
  const versionEnd = manifest.indexOf(0x0a);

  assert.equal(manifest.toString("utf8", 0, versionEnd), "project-analyzer-workspace-v1");
  cursor.offset = versionEnd + 1;
  assert.equal(readLength(manifest, cursor), 2);

  const firstLengths = [
    readLength(manifest, cursor),
    readLength(manifest, cursor),
    readLength(manifest, cursor)
  ];
  assert.equal(readField(manifest, cursor, firstLengths[0]), "/workspace/z.py");
  assert.equal(readField(manifest, cursor, firstLengths[1]), "python");
  assert.equal(readField(manifest, cursor, firstLengths[2]), "value = '\0'\n");

  const secondLengths = [
    readLength(manifest, cursor),
    readLength(manifest, cursor),
    readLength(manifest, cursor)
  ];
  assert.equal(readField(manifest, cursor, secondLengths[0]), "/workspace/가.tsx");
  assert.equal(readField(manifest, cursor, secondLengths[1]), "typescript");
  assert.equal(readField(manifest, cursor, secondLengths[2]), "export const View = () => null;\n");
  assert.equal(cursor.offset, manifest.length);
});
