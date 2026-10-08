/** Closed primitive expression syntax and source-range slicing shared by caller and callee proofs; never evaluates source. */
import type { SourceRange } from "../../shared/types";

/** Unknown external names are source references, never looked-up values or primitive proof. */
export type FunctionCallSourceExpressionFacts = { expression: string; accesses: string[]; externalReads?: string[]; awaits?: number };
/** These tokens introduce syntax/transfer semantics, not an unresolved value binding. */
const externalReadReserved = new Set(["this", "super", "new", "await", "yield", "return", "throw", "typeof", "void", "delete", "instanceof", "in", "is", "as", "null", "undefined", "true", "false"]);

/** Accept only bounded symbolic primitive leaves/operators; calls, members, writes and captured names fail closed. */
export function readFunctionCallSourceExpression(source: string, parameters: Set<string>): string | undefined {
  return readExpression(source, parameters, false)?.expression;
}

/** Known lexical roots may have source-authored member paths; getter/dispatch/state semantics remain unknown. Strict callers never opt in. */
export function readFunctionCallSourceObjectExpression(source: string, names: Set<string>, options?: { externalReads?: boolean; methodReceiver?: boolean; asyncAwait?: boolean }): FunctionCallSourceExpressionFacts | undefined {
  return readExpression(source, names, true, options?.externalReads === true, options?.methodReceiver === true, options?.asyncAwait === true);
}

/** The opt-in syntax reader records whole paths without looking up a property or promoting it to a primitive value. */
function readExpression(source: string, parameters: Set<string>, members: boolean, external = false, methodReceiver = false, asyncAwait = false): FunctionCallSourceExpressionFacts | undefined {
  if (!source || source.length > 120) return;
  const tokens: string[] = [], accesses: string[] = [], externalReads: string[] = []; let cursor = 0, depth = 0, tokenCount = 0, needsValue = true, awaits = 0;
  const token = /(?:"(?:[^"\\\r\n]|\\.)*"|'(?:[^'\\\r\n]|\\.)*'|(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?|[\p{L}_$][\p{L}\p{N}_$]*(?:\s*\.\s*[\p{L}_$][\p{L}\p{N}_$]*)*|===|!==|==|!=|<=|>=|&&|\|\||[()+*/%<>!+-])/uy;
  while (cursor < source.length) {
    if (/\s/u.test(source[cursor])) { cursor++; continue; }
    if (["++", "--"].includes(source.slice(cursor, cursor + 2))) return;
    token.lastIndex = cursor; const match = token.exec(source); if (!match) return;
    const text = match[0]; cursor = token.lastIndex; let weight = 1;
    if (text === "(") { if (!needsValue || ++depth > 16) return; }
    else if (text === ")") { if (needsValue || depth-- <= 0) return; }
    else if (["!", "+", "-"].includes(text) && needsValue) { /* Unary operators consume no value yet. */ }
    else if (text === "await" && asyncAwait) {
      if (!needsValue) return;
      // Retain each keyword under the existing token budget. Awaited values,
      // thenable behavior, rejection and continuation timing remain unknown.
      awaits++;
    }
    else if (["+", "-", "*", "/", "%", "<", ">", "<=", ">=", "===", "!==", "==", "!=", "&&", "||"].includes(text)) {
      if (needsValue) return; needsValue = true;
    } else {
      if (!needsValue) return;
      if (/[\p{L}_$]/u.test(text[0])) {
        if (text.includes(".")) {
          if (!members) return;
          const path = text.split(/\s*\.\s*/u);
          if (path.length > 17 || externalReadReserved.has(path[0]) && !(path[0] === "this" && methodReceiver)) return;
          if (!parameters.has(path[0]) && path[0] !== "this") { if (!external) return; externalReads.push(path[0]); }
          // Compound member tokens still consume every identifier and dot from
          // the original 64-token budget rather than hiding work in one token.
          weight = path.length * 2 - 1;
          accesses.push(text);
        } else if (text === "this") {
          if (!methodReceiver || !members) return;
          accesses.push(text);
        } else if (!parameters.has(text) && !["true", "false"].includes(text)) {
          if (!external || externalReadReserved.has(text)) return;
          externalReads.push(text);
        }
      }
      needsValue = false;
    }
    tokenCount += weight; if (tokenCount > 64) return;
    tokens.push(text);
  }
  return !needsValue && depth === 0 ? { expression: accesses.length || externalReads.length || awaits ? source.trim() : tokens.join(" "), accesses,
    ...(externalReads.length ? { externalReads } : {}), ...(awaits ? { awaits } : {}) } : undefined;
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
