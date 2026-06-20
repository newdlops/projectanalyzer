/**
 * Source range helpers shared by analyzer implementations and graph builders.
 */

import type { SourceRange } from "./types";

/**
 * Returns a zero-based full-file range for a source text snapshot.
 */
export function getFullContentRange(content: string): SourceRange {
  const lines = content.split(/\r\n|\r|\n/);
  const lastLineIndex = Math.max(0, lines.length - 1);
  const lastLine = lines[lastLineIndex] ?? "";

  return {
    startLine: 0,
    startCharacter: 0,
    endLine: lastLineIndex,
    endCharacter: lastLine.length
  };
}
