/** Exact source narratives retain concrete operation order; the local model supplies the function-wide purpose once. */
import type { FunctionNarrative, FunctionNarrativeContext, FunctionNarrativeFlowPath, FunctionNarrativeExample } from "../../../shared/functionNarratives";
import { createFunctionNarrativeScenarioIterator } from "../scenarioIterator";
import { buildFunctionNarrativeScenarioFrames } from "../scenarioFrames";
import { getPrimitiveWorksheetAnalysis, readCompletedPrimitiveTrace, readCompletedSourceTrace, traceSourceWorksheet } from "./index";
import type { PrimitiveTrace } from "./trace";

type Alternative = NonNullable<FunctionNarrativeContext["summaryTask"]>["sourceAlternative"];

/** Whole-graph recipes retain every operation and call uncertainty; other function meanings remain model work. */
export function buildFunctionNarrativeSourcePurpose(original: FunctionNarrativeContext, task: FunctionNarrativeContext,
  language: "ko" | "en"): string | undefined {
  const loop = buildFunctionNarrativeLoopPurpose(original, task, language);
  if (loop) return loop;
  const graph = original.scenarioGraph, current = readCompletedSourceTrace(task, language), alternative = task.summaryTask?.sourceAlternative;
  if (!graph || original.limited || !current?.unverifiedCalls?.length || !alternative
    || original.snippets.some(snippet => snippet.truncated || snippet.role === "helper")
    || graph.nodes.some(node => node.confidence !== "exact" || node.next.some(edge => edge.confidence !== "exact"
      || edge.target < 0 || edge.target >= graph.nodes.length))) return;
  const other = traceSourceWorksheet(original, alternative.path, alternative.inputs, language);
  if (!other?.unverifiedCalls?.length) return;
  const nodes = graph.nodes.filter(node => !["entry", "exit"].includes(node.kind)), path = task.sourceFlow!.paths[0];
  if (nodes.length !== path.steps.length || nodes.some(node => !node.step || !["mutation", "call", "return"].includes(node.kind)
    || !path.steps.some(step => step.kind === node.kind && step.code === node.step!.code
      && JSON.stringify(step.source) === JSON.stringify(node.step!.source))) || nodes.filter(node => node.kind === "return").length !== 1) return;
  // The recipe explicitly describes calculations before calls. Interleaved work
  // or additional return expressions keep the model rather than being reordered.
  const firstCall = path.steps.findIndex(step => step.kind === "call"), last = path.steps.at(-1)!;
  if (firstCall < 0 || path.steps.slice(firstCall).some(step => !["call", "return"].includes(step.kind))) return;
  const counter = /^return\s+([\p{L}_$][\p{L}\p{N}_$]*)\s*;?$/u.exec(last.code)?.[1];
  const writes = path.steps.slice(0, firstCall);
  if (!counter || writes.some(step => step.kind !== "mutation" || step.writeTargets?.length !== 1 || step.writeTargets[0] !== counter)) return;
  const declaration = writes.length && /^(?:val|var|let|const)\s+([\p{L}_$][\p{L}\p{N}_$]*)\s*=\s*(.+?)\s*;?$/u.exec(writes[0].code);
  if (writes.length && !declaration || !writes.length && !original.parameters?.some(parameter => parameter.name === counter)) return;
  const ko = language === "ko", updates = writes.slice(1).map(step => step.code.replace(/;$/u, ""));
  const initialization = declaration ? ko ? `${declaration[2]}로 ${counter}를 초기화합니다. ` : `Initialize ${counter} with ${declaration[2]}; ` : "";
  const calculations = updates.length ? ko ? `${updates.join(", ")}를 소스 순서대로 계산합니다. ` : `apply ${updates.join(", ")} in order. ` : "";
  const calls = current.unverifiedCalls.map(code => code.replace(/;$/u, "")).join(", ");
  const text = initialization + calculations + (ko ? `${calls}를 호출합니다. 호출이 정상 복귀하고 지역 값을 유지하면 ${counter}를 반환합니다. 호출 내부 동작은 미확인입니다.`
    : `Call ${calls}; return ${counter} if calls return normally and preserve local values. Call internals are unknown.`);
  return text.length <= 240 ? text : undefined;
}

/** Recognizes the entire simple loop function, not a selected-path guess; every graph operation must belong to the checked recipe. */
export function buildFunctionNarrativeLoopPurpose(original: FunctionNarrativeContext, task: FunctionNarrativeContext,
  language: "ko" | "en"): string | undefined {
  const graph = original.scenarioGraph, other = task.summaryTask?.sourceAlternative;
  // Graph.limited also contains unconditional language/runtime disclaimers.
  // Exact complete visits and every retained node/edge are checked below;
  // omitted/truncated source is independently rejected by the context guard.
  if (!graph || original.limited || !other || !readCompletedPrimitiveTrace(task, language)
    || original.snippets.some(snippet => snippet.truncated || snippet.role === "helper")) return;
  if (graph.nodes.some(node => node.confidence !== "exact" || node.next.some(edge => edge.confidence !== "exact"
    || edge.target < 0 || edge.target >= graph.nodes.length))) return;
  const alternate = traceSourceWorksheet(original, other.path, other.inputs, language);
  if (!alternate) return;
  const nodes = graph.nodes.filter(node => !["entry", "exit"].includes(node.kind));
  if (nodes.some(node => !node.step || node.confidence !== "exact" || !["mutation", "loop", "return"].includes(node.kind))) return;
  const loops = nodes.filter(node => node.kind === "loop"), returns = nodes.filter(node => node.kind === "return");
  if (loops.length !== 1 || returns.length !== 1) return;
  const id = "[\\p{L}_$][\\p{L}\\p{N}_$]*", member = id + "(?:\\." + id + ")*";
  const literal = "[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)";
  const predicate = new RegExp("^(" + member + ")\\s*(?:<|<=|>|>=)\\s*(" + literal + ")$", "u").exec(loops[0].step!.code);
  if (!predicate || !Number.isFinite(Number(predicate[2]))) return;
  const counter = predicate[1], writes = nodes.filter(node => node.kind === "mutation");
  const update = writes.filter(node => new RegExp("^(" + member + ")\\s*[+-]=\\s*" + literal + ";?$", "u").exec(node.step!.code)?.[1] === counter);
  if (update.length !== 1 || ![1, 2].includes(writes.length) || returns[0].step!.code.replace(/;$/u, "").trim() !== "return " + counter) return;
  const initialize = writes.find(node => node !== update[0]);
  const declaration = initialize && new RegExp("^(?:var|let)\\s+(" + id + ")\\s*=\\s*(" + id + ");?$", "u").exec(initialize.step!.code);
  if (initialize && (!declaration || declaration[1] !== counter || !original.parameters?.some(parameter => parameter.name === declaration[2]))
    || !initialize && !original.parameters?.some(parameter => parameter.name === counter.split(".")[0])) return;
  const paths = [task.sourceFlow!.paths[0], other.path];
  const bodyPath = paths.find(path => path.steps.some(step => step.code === update[0].step!.code));
  if (!bodyPath || nodes.some(node => !paths.some(path => path.steps.some(step => step.code === node.step!.code
    && JSON.stringify(step.source) === JSON.stringify(node.step!.source))))) return;
  const firstBody = bodyPath.steps.findIndex(step => step.code === update[0].step!.code), firstTest = bodyPath.steps.findIndex(step => step.kind === "loop");
  const postTest = firstBody < firstTest, ko = language === "ko", condition = loops[0].step!.code, change = update[0].step!.code.replace(/;$/u, "");
  const beginning = declaration ? ko ? `${declaration[2]}를 ${counter}에 저장하고, ` : `Initialize ${counter} from ${declaration[2]}, then ` : "";
  const text = ko ? beginning + (postTest ? `${change} 계산을 먼저 한 번 수행합니다. 이후 ${condition}이 참인 동안 같은 계산을 반복하고, `
    : `${condition}이 참인 동안 ${change}로 값을 변경합니다. `) + `반복이 종료되면 ${counter}를 반환합니다.`
    : beginning + (postTest ? `execute ${change} once before the first test, then repeat while ${condition} is true; `
      : `repeat ${change} while ${condition} is true; `) + `return ${counter} when the loop ends.`;
  return text.length <= 240 ? text : undefined;
}

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
  const current = readCompletedSourceTrace(context, language);
  const analysis = getPrimitiveWorksheetAnalysis(context, language) ?? (current?.unverifiedCalls?.length ? conditionalAnalysis(context, current, language) : undefined);
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
    if (operation.kind === "call") pieces.push(`${current.steps[index].text} ${current.steps[index].reason} ${current.steps[index].effect}`);
    else if (operation.kind === "condition" || operation.kind === "loop") pieces.push(ko
      ? `${operation.kind === "loop" ? "이번 방문의 반복 조건 " : ""}${operation.loweredPredicate ?? operation.code}의 판단은 ${calculation}이며 다음 구문은 ${path.steps[index + 1]!.code}입니다.`
      : `${operation.kind === "loop" ? "This visit's loop predicate " : ""}${operation.loweredPredicate ?? operation.code}: ${calculation}; next is ${path.steps[index + 1]!.code}.`);
    else if (operation.kind === "mutation") {
      const member = operation.code.startsWith(value.name + ".") || operation.code.startsWith(value.name + "[");
      pieces.push(member ? ko ? `${operation.code}로 속성·요소를 변경한 뒤 ${value.name}의 전체 상태는 ${value.before} → ${value.after}입니다. 계산 근거는 ${calculation}입니다.`
        : `${operation.code} changes a property/element; the full ${value.name} state is ${value.before} → ${value.after}. Calculation: ${calculation}.`
        : ko ? `${operation.code}의 ${calculation} 계산 후 지역 값 ${value.name}에 ${value.after} 값을 저장합니다(${value.before} → ${value.after}).`
          : `${operation.code} computes ${calculation}, storing ${value.name}: ${value.before} → ${value.after}.`);
    }
    else pieces.push((current.unverifiedCalls?.length ? ko ? "앞선 호출이 정상 복귀하고 지역 값을 유지하면, " : "If prior calls return normally and preserve locals, " : "")
      + (ko ? `반환 구문 ${operation.code}에서 최신 값으로 ${calculation}을 계산합니다. ${value.after} 값을 반환하고 함수가 끝납니다.`
        : `${operation.code} substitutes the latest values: ${calculation}, returns ${value.after}, and ends this function.`));
  }
  const otherChoices = alternative.path.steps.flatMap((step, index) => step.kind === "condition" || step.kind === "loop"
    ? [`${step.loweredPredicate ?? step.code}=${other!.steps[index].values![0].after}`] : []);
  const otherWrites = alternative.path.steps.flatMap((step, index) => step.kind === "mutation"
    ? [`${other!.steps[index].values![0].name}=${other!.steps[index].values![0].after}`] : []);
  const terminal = alternative.path.steps.at(-1)!;
  const fixedRoute = !current.inputs.length && !otherChoices.length;
  const alternativeText = (fixedRoute ? ko ? `추가 입력과 조건 분기가 없습니다. ${terminal.code}의 계산은 ${other.substitutions.at(-1)} = ${other.result}입니다.`
    : `There are no input choices or conditional branches. ${terminal.code}: ${other.substitutions.at(-1)} = ${other.result}.`
    : ko ? `다른 예시 ${namedInputs(other.inputs) || "입력 없음"}: ${otherChoices.join("; ") || "조건 분기 없음"}. `
    + `${otherWrites.length ? otherWrites.join(" → ") + ". " : ""}${terminal.code}의 계산 ${other.substitutions.at(-1)} = ${other.result}.`
    : `Another example ${namedInputs(other.inputs) || "no inputs"}: ${otherChoices.join("; ") || "no conditional branch"}. `
      + `${otherWrites.length ? otherWrites.join(" → ") + ". " : ""}${terminal.code}: ${other.substitutions.at(-1)} = ${other.result}.`)
    + (other.unverifiedCalls?.length ? ko ? ` ${other.unverifiedCalls.join(", ")}의 정상 복귀와 지역 값 유지를 가정하며, 내부 동작은 미확인입니다.`
      : ` Assuming ${other.unverifiedCalls.join(", ")} returns normally and preserves locals; its internal behavior is unknown.` : "");
  const explanation = pieces.join(" ");
  const calls = [...new Set([...(current.unverifiedCalls ?? []), ...(other.unverifiedCalls ?? [])])];
  const assumptions = current.unverifiedCalls?.length ? [ko ? `${current.unverifiedCalls.join(", ")}이 정상 복귀하고 이 함수의 지역 값을 바꾸지 않는다고 가정합니다.`
    : `Assume ${current.unverifiedCalls.join(", ")} returns normally and does not change this function's local values.`] : [];
  const limitations = calls.length ? [ko ? `${calls.join(", ")}의 내부 동작·반환값·예외·외부 상태 변화는 확인되지 않았습니다. 소스 호출을 실제로 실행하지 않았습니다.`
    : `Internal behavior, return values, exceptions and external state changes of ${calls.join(", ")} are unknown. Source calls were not executed.`] : [];
  // Preserve the complete detail. Long paragraphs/alternatives keep the existing
  // model pipeline rather than silently dropping a condition or calculation.
  if (explanation.length > 1800 || alternativeText.length > 600 || [...assumptions, ...limitations].some(text => text.length > 600)) return undefined;
  const frame = buildFunctionNarrativeScenarioFrames(context)[0];
  if (!frame) return undefined;
  return { limitations, scenarios: [{ title: frame.title, when: frame.when, outcome: frame.outcome, explanation,
    analysis: { pathReason: analysis.pathReason, stateChange: analysis.stateChange, alternative: alternativeText }, assumptions,
    example: { inputs: context.summaryTask.inputs, result: current.result }, steps: context.summaryTask.steps }] };
}

/** These are conditional calculations, never verified call effects; retain the qualifier in both factual fields. */
function conditionalAnalysis(context: FunctionNarrativeContext, trace: PrimitiveTrace, language: "ko" | "en") {
  const ko = language === "ko", path = context.sourceFlow!.paths[0];
  const choices = path.steps.flatMap((step, index) => step.kind === "condition"
    ? [`${step.loweredPredicate ?? step.code} (${trace.substitutions[index]}) = ${trace.steps[index].values![0].after}`] : []);
  const writes = path.steps.flatMap((step, index) => step.kind === "mutation"
    ? trace.steps[index].values!.map(value => `${value.name}: ${value.before} → ${value.after}`) : []);
  const pathReason = ko ? `${choices.length ? "조건 판단: " + choices.join("; ") : "조건 분기 없음"}. 외부 호출이 정상 복귀하고 지역 값을 유지하는 경우 반환문에 도달합니다.`
    : `${choices.length ? "Decisions: " + choices.join("; ") : "No conditional branch"}. The return is reached if external calls return normally and preserve locals.`;
  const stateChange = ko ? `${writes.length ? writes.join("; ") : "지역 값 변경 없음"}. 호출의 정상 복귀·지역 값 유지 가정에서 반환: ${trace.result}. 호출 내부 동작은 미확인입니다.`
    : `${writes.length ? writes.join("; ") : "No local writes"}. Assuming normal calls with locals preserved, return ${trace.result}. Call internals are unknown.`;
  return pathReason.length <= 220 && stateChange.length <= 220 ? { pathReason, stateChange } : undefined;
}

/** Fixed typed inputs remain plain display text; no expression, object or source code is executed. */
function namedInputs(inputs: FunctionNarrativeExample["inputs"]): string {
  return inputs.map(input => `${input.name}=${input.json}`).join(", ");
}
