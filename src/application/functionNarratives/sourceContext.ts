/** Selects bounded excerpts from one immutable source snapshot; no filesystem reads or graph traversal. */
import type { SourceRange, SymbolNode } from "../../shared/types";
import type { FunctionNarrativeContext, FunctionNarrativeSnippet } from "../../shared/functionNarratives";

/** Root-first excerpts preserve original one-based lines, including a separate truncated tail. */
export function buildFunctionNarrativeContext(node: SymbolNode, source: string, related: readonly SymbolNode[] = []): FunctionNarrativeContext {
  const lines = source.split(/\r?\n/);
  const snippets: FunctionNarrativeSnippet[] = [];
  let remaining = 18000;
  let limited = false;
  const start = Math.max(0, node.range.startLine);
  const end = Math.min(lines.length - 1, node.range.endLine - (node.range.endCharacter === 0 ? 1 : 0));
  /** Each excerpt consumes the shared character budget and retains only the actual source-line range. */
  const append = (id: string, role: FunctionNarrativeSnippet["role"], from: number, to: number, lineLimit: number, characterLimit: number, boundary?: SourceRange): boolean => {
    from = Math.max(0, from); to = Math.min(lines.length - 1, to);
    if (from > to || remaining <= 0 || snippets.length >= 5) return false;
    const chunks: string[] = [];
    let characters = 0;
    let last = from - 1;
    const budget = Math.min(characterLimit, remaining);
    // Inline declarations can share a source line; keep adjacent functions out of the root excerpt.
    const ownedLine = (line: number) => lines[line].slice(boundary && line === boundary.startLine ? boundary.startCharacter : 0,
      boundary && line === boundary.endLine ? boundary.endCharacter : undefined);
    for (let line = from; line <= to && line < from + lineLimit; line += 1) {
      const text = ownedLine(line);
      const separator = chunks.length ? 1 : 0;
      if (characters + separator + text.length > budget) {
        if (!chunks.length) { chunks.push(text.slice(0, budget)); characters = budget; last = line; }
        break;
      }
      chunks.push(text); characters += separator + text.length; last = line;
    }
    if (!chunks.length) return false;
    const truncated = last < to || chunks[chunks.length - 1].length < ownedLine(last).length;
    limited ||= truncated;
    remaining -= characters;
    snippets.push({ id, role, startLine: from + 1, endLine: last + 1, text: chunks.join("\n"), truncated });
    return !truncated;
  };
  const completeRoot = append("root", "function", start, end, 160, 10000, node.range);
  if (!completeRoot && end > (snippets[0]?.endLine ?? start + 1) - 1) append("root-tail", "function", Math.max(start, end - 19), end, 20, 2000, node.range);
  append("nearby", "nearby", start - 16, start - 1, 16, 2000);
  const visited = new Set([node.id]);
  for (const candidate of related) {
    if (visited.has(candidate.id) || candidate.filePath !== node.filePath) continue;
    visited.add(candidate.id);
    if (snippets.length >= 5) { limited = true; break; }
    append("helper-" + visited.size, "helper", candidate.range.startLine, candidate.range.endLine - (candidate.range.endCharacter === 0 ? 1 : 0), 60, 2000, candidate.range);
  }
  return { functionName: node.name.slice(0, 240), language: node.language.slice(0, 40), snippets, limited };
}
