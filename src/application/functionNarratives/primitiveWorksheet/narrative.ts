/** Exact source narratives retain concrete operation order; the local model supplies the function-wide purpose once. */
import type { FunctionNarrative, FunctionNarrativeContext, FunctionNarrativeFlowPath, FunctionNarrativeExample } from "../../../shared/functionNarratives";
import { createFunctionNarrativeScenarioIterator } from "../scenarioIterator";
import { buildFunctionNarrativeScenarioFrames } from "../scenarioFrames";
import { getPrimitiveWorksheetAnalysis, readCompletedPrimitiveTrace, traceSourceWorksheet } from "./index";
import type { PrimitiveTrace } from "./trace";

type Alternative = NonNullable<FunctionNarrativeContext["summaryTask"]>["sourceAlternative"];

/** Looks at at most 32 nearby routes/64 graph levels; this never caps the session's lazy full-path enumeration. */
export function selectPrimitiveNarrativeAlternative(context: FunctionNarrativeContext, path: FunctionNarrativeFlowPath,
  inputs: FunctionNarrativeExample["inputs"], language: "ko" | "en"): Alternative {
  if (context.limited || context.snippets.some(snippet => snippet.truncated || snippet.role === "helper" && !context.sourceWorksheet?.owns(context))) return undefined;
  const decisions = path.steps.filter(step => step.branch);
  if (!decisions.length) {
    const trace = traceSourceWorksheet(context, path, undefined, language, inputs);
    // A zero-input, unbranched function has no different input example.
    return trace ? { path, inputs: trace.inputs } : !context.parameters?.length ? { path, inputs } : undefined;
  }
  const iterator = createFunctionNarrativeScenarioIterator(context, { maxDepth: 64 });
  if (!iterator) return undefined;
  let best: Alternative, bestPrefix = -1;
  for (let count = 0; count < 32; count++) {
    const candidate = iterator.next();
    if (candidate.done) break;
    const alternative = candidate.value, other = alternative.steps.filter(step => step.branch);
    let shared = 0;
    while (shared < Math.min(decisions.length, other.length) && decisions[shared].code === other[shared].code
      && decisions[shared].source.startLine === other[shared].source.startLine
      && decisions[shared].branch!.outcome === other[shared].branch!.outcome) shared++;
    if (shared === decisions.length && shared === other.length || shared <= bestPrefix) continue;
    const trace = traceSourceWorksheet(context, alternative, undefined, language);
    if (trace) { best = { path: alternative, inputs: trace.inputs }; bestPrefix = shared; }
  }
  return best;
}

/** Source facts replace free scenario prose only after current completed state AND the alternate calculation are fully matched. */
export function buildPrimitiveNarrativeSynthesis(context: FunctionNarrativeContext, language: "ko" | "en"):
  Omit<FunctionNarrative, "summary"> | undefined {
  const current = readCompletedPrimitiveTrace(context, language), analysis = getPrimitiveWorksheetAnalysis(context, language);
  if (!current || !analysis || !context.summaryTask?.sourceAlternative) return undefined;
  const path = context.sourceFlow!.paths[0], alternative = context.summaryTask.sourceAlternative;
  let other: PrimitiveTrace | undefined;
  try { other = traceSourceWorksheet(context, alternative.path, alternative.inputs, language); }
  catch { return undefined; }
  if (!other || alternative.path.steps.some(step => !context.snippets.some(snippet => snippet.id === step.source.snippetId
    && snippet.startLine <= step.source.startLine && snippet.endLine >= step.source.endLine))) return undefined;
  const ko = language === "ko", pieces = [ko ? `입력은 ${namedInputs(current.inputs) || "없음"}입니다.`
    : `Inputs: ${namedInputs(current.inputs) || "none"}.`];
  for (let index = 0; index < path.steps.length; index++) {
    const operation = path.steps[index], value = current.steps[index].values![0], calculation = `${current.substitutions[index]} = ${value.after}`;
    if (operation.kind === "condition") pieces.push(ko
      ? `${operation.loweredPredicate ?? operation.code}의 판단은 ${calculation}이며 다음 구문은 ${path.steps[index + 1]!.code}입니다.`
      : `${operation.loweredPredicate ?? operation.code}: ${calculation}; next is ${path.steps[index + 1]!.code}.`);
    else if (operation.kind === "mutation") {
      const member = operation.code.startsWith(value.name + ".") || operation.code.startsWith(value.name + "[");
      pieces.push(member ? ko ? `${operation.code}로 속성·요소를 변경한 뒤 ${value.name}의 전체 상태는 ${value.before} → ${value.after}입니다. 계산 근거는 ${calculation}입니다.`
        : `${operation.code} changes a property/element; the full ${value.name} state is ${value.before} → ${value.after}. Calculation: ${calculation}.`
        : ko ? `${operation.code}의 ${calculation} 계산 후 지역 값 ${value.name}에 ${value.after} 값을 저장합니다(${value.before} → ${value.after}).`
          : `${operation.code} computes ${calculation}, storing ${value.name}: ${value.before} → ${value.after}.`);
    }
    else pieces.push(ko ? `반환 구문 ${operation.code}에서 최신 값으로 ${calculation}을 계산합니다. ${value.after} 값을 반환하고 함수가 끝납니다.`
      : `${operation.code} substitutes the latest values: ${calculation}, returns ${value.after}, and ends this function.`);
  }
  const otherChoices = alternative.path.steps.flatMap((step, index) => step.kind === "condition"
    ? [`${step.loweredPredicate ?? step.code}=${other!.steps[index].values![0].after}`] : []);
  const otherWrites = alternative.path.steps.flatMap((step, index) => step.kind === "mutation"
    ? [`${other!.steps[index].values![0].name}=${other!.steps[index].values![0].after}`] : []);
  const terminal = alternative.path.steps.at(-1)!;
  const fixedRoute = !current.inputs.length && !otherChoices.length;
  const alternativeText = fixedRoute ? ko ? `추가 입력과 조건 분기가 없습니다. ${terminal.code}의 계산은 ${other.substitutions.at(-1)} = ${other.result}입니다.`
    : `There are no input choices or conditional branches. ${terminal.code}: ${other.substitutions.at(-1)} = ${other.result}.`
    : ko ? `다른 예시 ${namedInputs(other.inputs) || "입력 없음"}: ${otherChoices.join("; ") || "조건 분기 없음"}. `
    + `${otherWrites.length ? otherWrites.join(" → ") + ". " : ""}${terminal.code}의 계산 ${other.substitutions.at(-1)} = ${other.result}.`
    : `Another example ${namedInputs(other.inputs) || "no inputs"}: ${otherChoices.join("; ") || "no conditional branch"}. `
      + `${otherWrites.length ? otherWrites.join(" → ") + ". " : ""}${terminal.code}: ${other.substitutions.at(-1)} = ${other.result}.`;
  const explanation = pieces.join(" ");
  // Preserve the complete detail. Long paragraphs/alternatives keep the existing
  // model pipeline rather than silently dropping a condition or calculation.
  if (explanation.length > 1800 || alternativeText.length > 600) return undefined;
  const frame = buildFunctionNarrativeScenarioFrames(context)[0];
  if (!frame) return undefined;
  return { limitations: [], scenarios: [{ title: frame.title, when: frame.when, outcome: frame.outcome, explanation,
    analysis: { pathReason: analysis.pathReason, stateChange: analysis.stateChange, alternative: alternativeText }, assumptions: [],
    example: { inputs: context.summaryTask.inputs, result: current.result }, steps: context.summaryTask.steps }] };
}

/** Fixed typed inputs remain plain display text; no expression, object or source code is executed. */
function namedInputs(inputs: FunctionNarrativeExample["inputs"]): string {
  return inputs.map(input => `${input.name}=${input.json}`).join(", ");
}
