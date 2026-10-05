/** Script checks for model-authored prose; source expressions and quoted code retain their original language. */
import type { FunctionNarrative } from "./types";

/** Rejects an English-only Korean response before it can be labeled or cached as Korean. This is not a semantic evaluator. */
export function isFunctionNarrativeLanguage(narrative: FunctionNarrative, language: "ko" | "en", sourceLiterals?: readonly string[]): boolean {
  const prose = (text: string) => {
    // Quoted return strings and inline code may intentionally use another script.
    const words = text.replace(/`[^`]*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/gu, " ");
    return language === "ko" ? (words.match(/[가-힣]/gu)?.length ?? 0) >= 2
      : /[A-Za-z]/u.test(words) && !/[가-힣]/u.test(words);
  };
  const descriptions = [narrative.summary, ...narrative.limitations];
  for (const scenario of narrative.scenarios) {
    descriptions.push(scenario.explanation ?? scenario.steps.map((step) => step.text).join(" "), ...scenario.assumptions);
    for (const step of [...scenario.steps, ...(scenario.nodeDetails ?? [])]) {
      if (step.reason !== undefined) descriptions.push(step.reason);
      if (step.effect !== undefined) descriptions.push(step.effect);
    }
  }
  if (!descriptions.every(prose)) return false;
  // The browser has bounds, not raw source. The Host additionally checks free
  // labels and operations, exempting only expressions owned by its snapshot.
  if (!sourceLiterals) return true;
  const literals = new Set(sourceLiterals.map((text) => text.trim()));
  const compatible = (text: string) => literals.has(text.trim()) || prose(text)
    || sourceLiterals.some((literal) => literal.includes(text.trim()));
  return narrative.scenarios.every((scenario) => compatible(scenario.title) && scenario.when.every(compatible)
    && compatible(scenario.outcome) && [...scenario.steps, ...(scenario.nodeDetails ?? [])].every((step) => compatible(step.text)));
}
