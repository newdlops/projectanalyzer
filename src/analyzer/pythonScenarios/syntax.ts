/** Source-only Python literal and child helpers. Parsing never imports or runs a workspace module. */
import type { SyntaxNode } from "@lezer/common";
import type { PythonValue } from "../../shared/pythonScenario/types";

export function pythonChildren(node: SyntaxNode): SyntaxNode[] {
  const children: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) children.push(child);
  return children;
}
/** Decodes a finite literal grammar, retaining Python raw-string regex escapes. */
export function pythonLiteral(text: string): PythonValue | undefined {
  if (text === "True" || text === "False") return text === "True";
  if (text === "None") return null;
  if (/^(?:\d[\d_]*(?:\.\d[\d_]*)?|\d+(?:[eE][+-]?\d+))$/u.test(text)) {
    const value = Number(text.replace(/_/gu, "")); return Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER ? value : undefined;
  }
  const match = /^([rRuU]?)("""|'''|"|')([\s\S]*)\2$/u.exec(text);
  if (!match) return;
  if (match[1].toLowerCase() === "r") return match[3];
  let invalid = false;
  const value = match[3].replace(/\\(\r?\n|x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|.)/gu, (_, escape: string) => {
    const fixed: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", a: "\x07", "\\": "\\", "'": "'", '"': '"', "\n": "", "\r\n": "" };
    if (escape in fixed) return fixed[escape];
    if (/^[xu][0-9a-fA-F]+$/u.test(escape)) return String.fromCodePoint(parseInt(escape.slice(1), 16));
    if (/^[0-9UNxu]/u.test(escape)) invalid = true;
    return "\\" + escape;
  });
  return invalid || value.length > 512 ? undefined : value;
}
