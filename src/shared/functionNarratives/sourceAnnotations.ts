/** Portable source-presentation contract and bounded grouping for already validated model explanations. */
import type { FunctionNarrative, FunctionNarrativeScenario, FunctionNarrativeSnippet, FunctionNarrativeStep } from "./types";
import { isFunctionNarrative } from "./validation";

/** Host-only identity binds prose to one immutable whole-file snapshot; no raw path reaches the model. */
export type FunctionNarrativeSourcePresentation = {
  filePath: string;
  sourceHash: string;
  contextId: string;
  functionName: string;
  language: "ko" | "en";
  modelName: string;
  narrative: FunctionNarrative;
  snippets: readonly FunctionNarrativeSnippet[];
  /** Stable global numbering when this presentation is a bounded page from a complete run. */
  scenarioOffset?: number;
};

/** Each surface owns a presenter; clearing another surface cannot remove the current result. */
export type FunctionNarrativeSourcePresenter = {
  show(presentation: FunctionNarrativeSourcePresentation): void;
  clear(): void;
};

export type FunctionNarrativeSourceReference = {
  label: string;
  scenarioIndex: number;
  scenario: FunctionNarrativeScenario;
  step: FunctionNarrativeStep;
};
export type FunctionNarrativeSourceAnnotation = { line: number; hint: string; references: FunctionNarrativeSourceReference[] };

/** Groups shared source lines, retains all twenty possible references, and abbreviates only inline text. */
export function buildFunctionNarrativeSourceAnnotations(narrative: FunctionNarrative, snippets: readonly FunctionNarrativeSnippet[], scenarioOffset = 0): FunctionNarrativeSourceAnnotation[] {
  if (!isFunctionNarrative(narrative, snippets) || !Number.isSafeInteger(scenarioOffset) || scenarioOffset < 0) return [];
  const lines = new Map<number, FunctionNarrativeSourceAnnotation>();
  for (let scenarioIndex = 0; scenarioIndex < narrative.scenarios.length; scenarioIndex += 1) {
    const scenario = narrative.scenarios[scenarioIndex];
    for (let stepIndex = 0; stepIndex < scenario.steps.length; stepIndex += 1) {
      const step = scenario.steps[stepIndex];
      const annotation = lines.get(step.source.startLine) ?? { line: step.source.startLine, hint: "", references: [] };
      annotation.references.push({ label: `${scenarioOffset + scenarioIndex + 1}.${stepIndex + 1}`, scenarioIndex: scenarioOffset + scenarioIndex, scenario, step });
      lines.set(annotation.line, annotation);
    }
  }
  for (const annotation of lines.values()) {
    const labels = annotation.references.slice(0, 3).map((reference) => reference.label).join(", ");
    const extra = annotation.references.length > 3 ? ` +${annotation.references.length - 3}` : "";
    const prose = annotation.references[0].step.text.replace(/\s+/gu, " ").trim();
    const shortened = prose.slice(0, 70).replace(/[\uD800-\uDBFF]$/u, "");
    annotation.hint = `LLM ${labels}${extra} · ${shortened}${shortened.length < prose.length ? "…" : ""}`;
  }
  return [...lines.values()].sort((a, b) => a.line - b.line);
}
