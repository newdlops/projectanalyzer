/** Self-contained validation shared by Host parsing and the CSP-safe browser renderer. */
import type { FunctionNarrative, FunctionNarrativeSnippet } from "./types";

/** Rejects excess fields, unbounded prose and evidence outside the supplied excerpts. */
export function isFunctionNarrative(value: unknown, snippets?: readonly Pick<FunctionNarrativeSnippet, "id" | "startLine" | "endLine">[]): value is FunctionNarrative {
  const record = (item: unknown): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item);
  const keys = (item: Record<string, unknown>, allowed: string[]) => Object.keys(item).every((key) => allowed.includes(key));
  const text = (item: unknown, limit: number): item is string => typeof item === "string" && item.trim().length > 0 && item.length <= limit;
  const texts = (items: unknown, count: number) => Array.isArray(items) && items.length <= count && items.every((item) => text(item, 600));
  if (!record(value) || !keys(value, ["summary", "scenarios", "limitations"]) || !text(value.summary, 1200) || !texts(value.limitations, 6)
    || !Array.isArray(value.scenarios) || value.scenarios.length < 1 || value.scenarios.length > 4) return false;
  for (const scenario of value.scenarios) {
    if (!record(scenario) || !keys(scenario, ["title", "when", "steps", "outcome", "assumptions"]) || !text(scenario.title, 160)
      || !texts(scenario.when, 4) || !texts(scenario.assumptions, 4) || !text(scenario.outcome, 600)
      || !Array.isArray(scenario.steps) || scenario.steps.length < 1 || scenario.steps.length > 5) return false;
    for (const step of scenario.steps) {
      if (!record(step) || !keys(step, ["text", "source"]) || !text(step.text, 600) || !record(step.source)
        || !keys(step.source, ["snippetId", "startLine", "endLine"]) || !text(step.source.snippetId, 80)
        || !Number.isSafeInteger(step.source.startLine) || !Number.isSafeInteger(step.source.endLine)) return false;
      const source = step.source as { snippetId: string; startLine: number; endLine: number };
      if (source.startLine < 1 || source.endLine < source.startLine || source.endLine - source.startLine > 20) return false;
      if (snippets && !snippets.some((snippet) => snippet.id === source.snippetId && source.startLine >= snippet.startLine && source.endLine <= snippet.endLine)) return false;
    }
  }
  return true;
}
