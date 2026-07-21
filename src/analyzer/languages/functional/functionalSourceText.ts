/**
 * UTF-16 source indexing helpers for lightweight functional syntax adapters.
 * They avoid parser dependencies while retaining exact VS Code ranges.
 */

import type { SourceRange } from "../../../shared/types";
import type { FunctionalSourceLine } from "./types";

/** Indexes physical lines once without normalizing CRLF-owned offsets. */
export function createFunctionalSourceLines(text: string): FunctionalSourceLine[] {
  const lines: FunctionalSourceLine[] = [];
  let lineFrom = 0;
  let lineIndex = 0;
  for (let offset = 0; offset <= text.length; offset += 1) {
    if (offset < text.length && text.charCodeAt(offset) !== 10) {
      continue;
    }
    const rawTo = offset > lineFrom && text.charCodeAt(offset - 1) === 13
      ? offset - 1
      : offset;
    const lineText = text.slice(lineFrom, rawTo);
    lines.push({
      index: lineIndex,
      from: lineFrom,
      to: rawTo,
      text: lineText,
      indent: readIndent(lineText)
    });
    lineFrom = offset + 1;
    lineIndex += 1;
  }
  return lines;
}

/** Converts an exact source offset span to a zero-based editor range. */
export function functionalOffsetsRange(
  lines: readonly FunctionalSourceLine[],
  from: number,
  to: number
): SourceRange {
  const start = findFunctionalLine(lines, from);
  const end = findFunctionalLine(lines, to);
  return {
    startLine: start.index,
    startCharacter: Math.max(0, from - start.from),
    endLine: end.index,
    endCharacter: Math.max(0, to - end.from)
  };
}

/** Converts a clamped editor position into a JavaScript/UTF-16 source offset. */
export function functionalPositionOffset(
  lines: readonly FunctionalSourceLine[],
  line: number,
  character: number
): number {
  const selected = lines[Math.min(
    Math.max(0, Math.floor(line)),
    Math.max(0, lines.length - 1)
  )] ?? { from: 0, to: 0 };
  return Math.min(
    selected.to,
    selected.from + Math.max(0, Math.floor(character))
  );
}

/** Returns the physical line containing an offset with bounded binary search. */
export function findFunctionalLine(
  lines: readonly FunctionalSourceLine[],
  rawOffset: number
): FunctionalSourceLine {
  const offset = Math.max(0, Math.floor(rawOffset));
  let low = 0;
  let high = Math.max(0, lines.length - 1);
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const line = lines[middle];
    const nextFrom = lines[middle + 1]?.from ?? Number.MAX_SAFE_INTEGER;
    if (!line || offset < line.from) {
      high = middle - 1;
    } else if (offset >= nextFrom) {
      low = middle + 1;
    } else {
      return line;
    }
  }
  return lines[Math.max(0, Math.min(high, lines.length - 1))]
    ?? { index: 0, from: 0, to: 0, text: "", indent: 0 };
}

/** Trims outer whitespace while preserving internal source lines and offsets. */
export function trimFunctionalSpan(
  text: string,
  from: number,
  to: number
): { from: number; to: number; text: string } {
  let trimmedFrom = Math.max(0, from);
  let trimmedTo = Math.min(text.length, Math.max(trimmedFrom, to));
  while (trimmedFrom < trimmedTo && /\s/u.test(text[trimmedFrom] ?? "")) {
    trimmedFrom += 1;
  }
  while (trimmedTo > trimmedFrom && /\s/u.test(text[trimmedTo - 1] ?? "")) {
    trimmedTo -= 1;
  }
  return {
    from: trimmedFrom,
    to: trimmedTo,
    text: text.slice(trimmedFrom, trimmedTo).replace(/\r\n?/gu, "\n")
  };
}

/** Counts leading spaces and treats tabs as one visual indentation unit. */
function readIndent(line: string): number {
  const match = line.match(/^[ \t]*/u)?.[0] ?? "";
  return match.length;
}
