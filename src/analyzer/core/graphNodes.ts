/**
 * Shared graph node factories used by the analyzer pipeline. Keeping file-node
 * identity centralized prevents language analyzers from inventing incompatible IDs.
 */

import * as path from "node:path";
import { createNodeId } from "../../shared/ids";
import { getFullContentRange } from "../../shared/sourceRange";
import type { SourceFile, SymbolNode } from "../../shared/types";

/**
 * Builds the stable graph ID for a source file node.
 */
export function createFileNodeId(filePath: string): string {
  return createNodeId(["file", filePath]);
}

/**
 * Creates a graph node representing a source file.
 */
export function createFileNode(file: SourceFile, workspaceRoot: string): SymbolNode {
  const range = getFullContentRange(file.content);
  const relativePath = workspaceRoot ? path.relative(workspaceRoot, file.path) : file.path;

  return {
    id: createFileNodeId(file.path),
    kind: "file",
    name: path.basename(file.path),
    qualifiedName: relativePath,
    filePath: file.path,
    range,
    selectionRange: range,
    language: file.languageId,
    metadata: {
      sizeBytes: file.sizeBytes,
      contentHash: file.contentHash
    }
  };
}
