/** Public framework-analysis API; adapters never execute source or access files. */
import { analyzeReactBehavior } from "./reactBehavior";
import { analyzeDjangoBehavior } from "./djangoBehavior";
import type { FrameworkBehaviorInput, FunctionFrameworkBehavior } from "./types";

export type { FrameworkBehaviorInput, FunctionFrameworkBehavior, FrameworkBehaviorFact } from "./types";

/** Analyzes a selected callable only; unsupported or unreadable source stays unclassified. */
export function analyzeFunctionFrameworkBehavior(input: FrameworkBehaviorInput): FunctionFrameworkBehavior | undefined {
  if (!input.sourceText || input.sourceText.length > 1_000_000) return undefined;
  try {
    if (input.functionNode.language === "python" || input.functionNode.filePath.endsWith(".py")) return analyzeDjangoBehavior(input);
    if (/\.[cm]?[jt]sx?$/u.test(input.functionNode.filePath)) return analyzeReactBehavior(input);
  } catch {
    // Optional framework interpretation must not take down the primary logic
    // view when malformed editor input exceeds a parser's own recovery limits.
    return undefined;
  }
  return undefined;
}
