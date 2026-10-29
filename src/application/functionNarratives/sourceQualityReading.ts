/** Bounded causal prose for one completely recognized Boolean/literal recipe; unsupported bodies remain model-authored. */
import type { FunctionNarrativeContext, FunctionNarrativeScenario } from "../../shared/functionNarratives";
import { readNarrativeQualityFacts } from "../../analyzer/narrativeQuality";

/** Every body statement must belong to the independent AST recipe, not merely the selected example route. */
export function buildFunctionNarrativeQualityReading(context: FunctionNarrativeContext, language: "ko" | "en"):
  { explanation: string; analysis: NonNullable<FunctionNarrativeScenario["analysis"]> } | undefined {
  const facts = readNarrativeQualityFacts(context), recipe = facts.simpleBooleanReturn;
  if (!facts.closed || !recipe || !context.summaryTask || context.sourceFlow?.paths.length !== 1
    || context.sourceFlow.paths[0].status !== "source-terminal" || context.sourceFlow.paths[0].confidence !== "exact"
    || context.sourceFlow.paths[0].steps.some(step => step.confidence !== "exact")) return;
  const input = context.summaryTask.inputs.find(item => item.name === recipe.parameter)?.json;
  if (input !== "true" && input !== "false") return;
  const ko = language === "ko", taken = input === "true";
  const calls = facts.identityInvocations.map(call => ko
    ? `${call.helper}(${call.argument})를 호출하고 반환된 ${call.argument} 값을 ${call.binding}에 저장합니다.`
    : `Call ${call.helper}(${call.argument}) and store its unchanged argument in ${call.binding}.`).join(" ");
  const route = (truth: boolean) => ko ? truth
    ? `${recipe.parameter}가 true이므로 ${recipe.trueStatement}를 실행하고 함수가 종료됩니다.`
    : `${recipe.parameter}가 false이므로 참 본문의 ${recipe.trueStatement}를 건너뛰고 ${recipe.falseStatement}를 실행합니다.`
    : truth ? `${recipe.parameter} is true, so execute ${recipe.trueStatement} and exit.`
      : `${recipe.parameter} is false, so skip the true-arm ${recipe.trueStatement} and execute ${recipe.falseStatement}`;
  const analysis = { pathReason: route(taken),
    stateChange: [calls, ko ? `호출자에게 ${taken ? recipe.trueStatement : recipe.falseStatement}의 리터럴 값을 반환합니다.`
      : `Return the literal in ${taken ? recipe.trueStatement : recipe.falseStatement} to the caller.`].filter(Boolean).join(" "),
    alternative: (ko ? `${recipe.parameter}를 ${!taken}로 바꾸면 ` : `Change ${recipe.parameter} to ${!taken}: `) + route(!taken) };
  const explanation = [calls, route(taken)].filter(Boolean).join(" ");
  // Refuse the whole recipe rather than clipping ordered work to fit a field.
  if (explanation.length > 600 || Object.values(analysis).some(text => text.length > 220)) return;
  return { explanation, analysis };
}
