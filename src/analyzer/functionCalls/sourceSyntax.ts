/** Closed primitive expression syntax and source-range slicing shared by caller and callee proofs; never evaluates source. */
import type { SourceRange } from "../../shared/types";

/** Accept only bounded symbolic primitive leaves/operators; calls, members, writes and captured names fail closed. */
export function readFunctionCallSourceExpression(source: string, parameters: Set<string>): string | undefined {
  if (!source || source.length > 120) return;
  const tokens: string[] = []; let cursor = 0, depth = 0, needsValue = true;
  const token = /(?:"(?:[^"\\\r\n]|\\.)*"|'(?:[^'\\\r\n]|\\.)*'|(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?|[\p{L}_$][\p{L}\p{N}_$]*|===|!==|==|!=|<=|>=|&&|\|\||[()+*/%<>!+-])/uy;
  while (cursor < source.length) {
    if (/\s/u.test(source[cursor])) { cursor++; continue; }
    if (["++", "--"].includes(source.slice(cursor, cursor + 2))) return;
    token.lastIndex = cursor; const match = token.exec(source); if (!match) return;
    const text = match[0]; cursor = token.lastIndex;
    if (tokens.length >= 64) return;
    if (text === "(") { if (!needsValue || ++depth > 16) return; }
    else if (text === ")") { if (needsValue || depth-- <= 0) return; }
    else if (["!", "+", "-"].includes(text) && needsValue) { /* Unary operators consume no value yet. */ }
    else if (["+", "-", "*", "/", "%", "<", ">", "<=", ">=", "===", "!==", "==", "!=", "&&", "||"].includes(text)) {
      if (needsValue) return; needsValue = true;
    } else {
      if (!needsValue || /[\p{L}_$]/u.test(text[0]) && !parameters.has(text) && !["true", "false"].includes(text)) return;
      needsValue = false;
    }
    tokens.push(text);
  }
  return !needsValue && depth === 0 ? tokens.join(" ") : undefined;
}

/** Read only requested lines, avoiding a whole-file split for every proof. */
export function readFunctionCallSourceRange(source: string, range: SourceRange): string | undefined {
  let cursor = 0;
  for (let line = 0; line < range.startLine; line++) { const next = source.indexOf("\n", cursor); if (next < 0) return; cursor = next + 1; }
  const start = cursor + range.startCharacter;
  for (let line = range.startLine; line < range.endLine; line++) { const next = source.indexOf("\n", cursor); if (next < 0) return; cursor = next + 1; }
  const end = cursor + range.endCharacter;
  return start <= end && end <= source.length ? source.slice(start, end) : undefined;
}
