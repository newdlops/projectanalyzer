/** Exact CRLF/CR/LF and UTF-16 range extraction without full-file line arrays. */
import type { SourceRange } from "../../shared/types";
import { SourceCaptureError } from "../../shared/narrativeSources";

/** Resolve one parser/VS Code position; invalid coordinates are never clamped. */
function offset(source: string, line: number, character: number): number {
  if (!Number.isSafeInteger(line) || line < 0 || !Number.isSafeInteger(character) || character < 0) {
    throw new SourceCaptureError("invalid-range", "Invalid source coordinate");
  }
  let row = 0, start = 0, cursor = 0;
  for (; cursor < source.length; cursor++) {
    const code = source.charCodeAt(cursor);
    if (code !== 10 && code !== 13) continue;
    if (row === line) break;
    if (code === 13 && source.charCodeAt(cursor + 1) === 10) cursor++;
    row++; start = cursor + 1;
  }
  if (row !== line || character > cursor - start) throw new SourceCaptureError("invalid-range", "Source coordinate is outside its original line");
  return start + character;
}

/** Copy all original UTF-16 units so a small body does not retain a huge file string. */
export function extractWholeSourceRange(source: string, range: SourceRange): string {
  const start = offset(source, range.startLine, range.startCharacter), end = offset(source, range.endLine, range.endCharacter);
  if (end < start) throw new SourceCaptureError("invalid-range", "Source range is reversed");
  return Buffer.from(source.slice(start, end), "utf16le").toString("utf16le");
}
