/** Builds native Markdown hovers with owned structure and escaped, untrusted model text. */
import type * as vscode from "vscode";
import type { FunctionNarrativeSourceAnnotation, FunctionNarrativeSourcePresentation } from "../../shared/functionNarratives";

/** Groups conditions/outcomes once per scenario while preserving every cited step's complete explanation. */
export function createNarrativeSourceHover(api: typeof vscode, presentation: FunctionNarrativeSourcePresentation, annotation: FunctionNarrativeSourceAnnotation): vscode.MarkdownString {
  const ko = presentation.language === "ko";
  const hover = new api.MarkdownString();
  hover.isTrusted = false; hover.supportHtml = false;
  const paragraph = (text: string) => { hover.appendText(text); hover.appendMarkdown("\n\n"); };
  const facts = (label: string, values: string[]) => {
    if (values.length) { paragraph(label); for (const value of values) { hover.appendMarkdown("- "); paragraph(value); } }
  };
  paragraph((ko ? "LLM 추론 · 실제 실행 미검증" : "LLM inference · execution unverified") + " · " + presentation.modelName
    + " · " + (ko ? "생성 언어: 한국어" : "Generated in English"));
  hover.appendMarkdown("### "); paragraph(presentation.functionName);
  paragraph(presentation.narrative.summary);
  const scenarios = new Map<number, typeof annotation.references>();
  for (const reference of annotation.references) {
    const references = scenarios.get(reference.scenarioIndex) ?? [];
    references.push(reference); scenarios.set(reference.scenarioIndex, references);
  }
  for (const [index, references] of scenarios) {
    const scenario = references[0].scenario;
    hover.appendMarkdown("---\n\n### "); paragraph(`${index + 1}. ${scenario.title}`);
    facts(ko ? "조건" : "Conditions", scenario.when);
    for (const reference of references) {
      hover.appendMarkdown("**"); hover.appendText(`LLM ${reference.label} · L${reference.step.source.startLine}–${reference.step.source.endLine}`);
      hover.appendMarkdown("**\n\n"); paragraph(reference.step.text);
      facts(ko ? "판단 근거" : "Reason", reference.step.reason ? [reference.step.reason] : []);
      facts(ko ? "값과 흐름의 변화" : "Effect", reference.step.effect ? [reference.step.effect] : []);
    }
    facts(ko ? "예상 결과" : "Expected outcome", [scenario.outcome]);
    facts(ko ? "가정" : "Assumptions", scenario.assumptions);
  }
  facts(ko ? "미확인 부분" : "Missing information", presentation.narrative.limitations);
  return hover;
}
