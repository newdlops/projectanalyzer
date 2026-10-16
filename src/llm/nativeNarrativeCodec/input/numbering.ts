/** One-pass source line labels preserve CRLF/CR/LF and UTF16 text exactly. Numbering never truncates source or creates an execution trace. */
import { FunctionNarrativeError } from "../../../shared/functionNarratives";
import { requireInput } from "./data";

/** Label every supplied source line, including a final empty line, while keeping each original line-ending sequence. */
export function numberNativeSourceLines(text: string, startLine: number): string {
  requireInput(typeof text === "string" && Number.isSafeInteger(startLine) && startLine >= 1); const output: string[] = []; let first = 0, line = startLine, bytes = 0;
  const append = (end: number) => { requireInput(Number.isSafeInteger(line)); const part = String(line++) + ": " + text.slice(first, end); bytes += Buffer.byteLength(part);
    // Every packed format retains at least one whole copy of this string. This lower bound cannot fit the original member budget.
    if (bytes > 196608) throw new FunctionNarrativeError("context-too-large", "native-input-source-bytes"); output.push(part); first = end; };
  for (let index = 0; index < text.length; index++) { if (text[index] !== "\r" && text[index] !== "\n") continue; if (text[index] === "\r" && text[index + 1] === "\n") index++; append(index + 1); }
  append(text.length); return output.join("");
}
