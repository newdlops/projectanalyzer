/** Shared bounds and source-range helpers for framework-specific syntax adapters. */
import type { SourceRange } from "../../shared/types";
import type { FrameworkBehaviorInput, FunctionFrameworkBehavior, FrameworkBehaviorFact } from "./types";

/** Tests an exact source position; no function-name guessing is used for ownership. */
export function containsPosition(range: SourceRange, line: number, character: number): boolean {
  return (line > range.startLine || line === range.startLine && character >= range.startCharacter)
    && (line < range.endLine || line === range.endLine && character <= range.endCharacter);
}

/** Creates one bounded, deterministic fact sink and reports omitted facts explicitly. */
export function createFrameworkFactCollector(input: FrameworkBehaviorInput, framework: FunctionFrameworkBehavior["framework"]) {
  const result: FunctionFrameworkBehavior = { framework, role: "usage", facts: [], omittedCount: 0, limited: false };
  const seen = new Set<string>();
  const limit = Math.max(1, Math.min(24, Math.floor(input.maxFacts ?? 16) || 16));
  return {
    result,
    add(fact: FrameworkBehaviorFact) {
      const key = `${fact.kind}:${fact.range.startLine}:${fact.range.startCharacter}`;
      if (seen.has(key)) return;
      seen.add(key);
      if (result.facts.length >= limit) { result.omittedCount += 1; result.limited = true; return; }
      // This is an evidence caption, not a replacement for the complete source.
      const text = fact.subject.trim();
      result.facts.push({ ...fact, subject: text.length > 300 ? text.slice(0, 299) + "…" : text });
    }
  };
}

/** Project detection is a hint only within the detected package root. */
export function hasFrameworkHint(input: FrameworkBehaviorInput, framework: string): boolean {
  const file = input.functionNode.filePath.replace(/\\/gu, "/");
  return Boolean(input.frameworks?.some((item) => {
    if (!item.rootPath) return false;
    const root = item.rootPath.replace(/\\/gu, "/").replace(/\/$/u, "");
    return item.name.toLowerCase() === framework && file.startsWith(root + "/");
  }));
}
