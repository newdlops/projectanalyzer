/** Exact source-route worksheets retain statement order, immediate values and language syntax without a model round-trip. */
import type { FunctionNarrativeContext, FunctionNarrativeFlowPath, FunctionNarrativeStep } from "../../../shared/functionNarratives";
import { readPrimitiveExpression, type Primitive } from "./expression";

export type PrimitiveTrace = { inputs: Array<{ name: string; json: string }>; steps: FunctionNarrativeStep[]; result: string;
  /** Source-ordered operand substitutions keep summary reasons concrete without reparsing prose. */
  substitutions: string[] };

/** Only closed primitive paths with unique source occurrences can produce a complete trace; any gap rejects the whole worksheet. */
export function tracePrimitiveRoute(context: FunctionNarrativeContext, path: FunctionNarrativeFlowPath,
  inputs: ReadonlyMap<string, Primitive>, language: "ko" | "en"): PrimitiveTrace | undefined {
  const integer = context.language === "kotlin", ko = language === "ko";
  if (path.confidence !== "exact" || path.status !== "source-terminal" || path.steps.length > 32) return undefined;
  const state = new Map(inputs), steps: FunctionNarrativeStep[] = [], visited = new Set<string>(), substitutions: string[] = [];
  const immutable = new Set(context.language === "kotlin" ? inputs.keys() : []);
  let result: string | undefined;
  for (let index = 0; index < path.steps.length; index++) {
    const target = path.steps[index];
    if (target.confidence !== "exact" || result !== undefined) return undefined;
    const identity = target.graphNodeId ?? target.source.snippetId + ":" + target.source.startLine + ":" + target.kind;
    if (visited.has(identity)) return undefined; visited.add(identity);
    let expression = target.code.replace(/;\s*$/u, "").trim(), name = "condition", before = ko ? "미평가" : "not evaluated";
    let declaration: string | undefined, compound: string | undefined;
    if (target.kind === "condition") {
      if (target.branch?.confidence !== "exact" || !["true", "false"].includes(target.branch.outcome)) return undefined;
      expression = target.loweredPredicate ?? expression;
    } else if (target.kind === "return") {
      const match = /^return\s+(.+)$/u.exec(expression); if (!match) return undefined;
      expression = match[1]; name = "result"; before = ko ? "반환 전" : "not returned";
    } else if (target.kind === "mutation" && target.writeTargets?.length === 1) {
      name = target.writeTargets[0];
      const write = /^(?:(val|var|let|const)\s+)?([\p{L}_$][\p{L}\p{N}_$]*)\s*(?:=|([+*-])=)\s*(.+)$/u.exec(expression);
      if (write?.[2] === name) {
        declaration = write[1]; compound = write[3]; expression = write[4];
        if (declaration && state.has(name)) return undefined; // Scope/shadowing needs binding identities.
        if (compound) expression = name + " " + compound + " ( " + expression + " )";
      } else {
        const guard = path.steps.find(step => step.loweredPredicate && step.code.includes("?:")
          && step.source.snippetId === target.source.snippetId && step.source.startLine === target.source.startLine);
        if (!guard) return undefined;
        declaration = /^(val|var)\s/u.exec(guard.code)?.[1];
      }
      // A bare name absent from the local worksheet may be a global/property
      // write. Never turn that external effect into a local declaration.
      if (!declaration && (!state.has(name) || immutable.has(name))) return undefined;
      before = state.has(name) ? JSON.stringify(state.get(name)) : ko ? "선언 전" : "not declared";
    } else return undefined;
    const reading = readPrimitiveExpression(expression, state, integer); if (!reading) return undefined;
    const after = JSON.stringify(reading.value);
    if (target.kind === "condition") {
      if (typeof reading.value !== "boolean" || String(reading.value) !== target.branch!.outcome) return undefined;
    } else if (target.kind === "return") result = after;
    else { state.set(name, reading.value); if (declaration === "val" || declaration === "const") immutable.add(name); }
    const next = path.steps[index + 1]?.code;
    const syntax = target.kind === "condition" ? target.loweredPredicate && target.code.includes("?:")
      ? ko ? "Elvis 연산자는 null 여부를 판단해 사용할 피연산자 하나를 선택합니다." : "Elvis tests nullability and selects exactly one operand."
      : ko ? "조건식의 Boolean 결과로 다음 소스 경로를 선택합니다." : "The predicate's Boolean result selects the next source route."
      : target.kind === "return" ? ko ? "return은 식 전체의 값을 반환하고 현재 함수의 진행을 끝냅니다." : "Return yields the whole expression's value and ends this function."
        : declaration ? ko ? `${declaration}는 ${["val", "const"].includes(declaration) ? "재대입할 수 없는" : "재대입할 수 있는"} 지역 변수를 선언합니다.`
          : `${declaration} declares a ${["val", "const"].includes(declaration) ? "non-reassignable" : "reassignable"} local binding.`
          : compound ? ko ? `${compound}=는 기존 값에 ${compound} 연산을 적용한 뒤 같은 변수에 저장합니다.` : `${compound}= applies ${compound} to the current value and stores it in the same binding.`
            : ko ? "대입은 선택한 식의 값을 현재 지역 변수에 저장합니다." : "Assignment stores the selected expression's value in the local binding.";
    const terms: Record<string, [string, string]> = { "+": ["덧셈", "addition"], "-": ["뺄셈", "subtraction"], "*": ["곱셈", "multiplication"],
      "u-": ["수치 부호 반전", "numeric negation"], "u+": ["수치 값 유지", "numeric identity"],
      "s+": ["문자열 연결", "string concatenation"],
      "!": ["Boolean 부정", "Boolean negation"], ">": ["초과 비교", "greater-than comparison"], ">=": ["이상 비교", "inclusive lower-bound comparison"],
      "<": ["미만 비교", "less-than comparison"], "<=": ["이하 비교", "inclusive upper-bound comparison"],
      "==": ["동등 비교", "equality"], "===": ["엄격한 동등 비교", "strict equality"], "!=": ["다름 비교", "inequality"], "!==": ["엄격한 다름 비교", "strict inequality"],
      "&&": ["두 조건의 논리곱", "Boolean conjunction"], "||": ["두 조건의 논리합", "Boolean disjunction"] };
    const operations = reading.operations.map(op => `${op.startsWith("u") || op === "s+" ? op.slice(1) : op}: ${terms[op][ko ? 0 : 1]}`).join(", ");
    const step: FunctionNarrativeStep = { code: target.code, source: target.source, syntax: syntax + (operations ? " " + operations + "." : ""),
      text: ko ? target.kind === "condition" ? `조건 ${expression}의 결과는 ${after === "true" ? "참" : "거짓"}입니다.`
        : target.kind === "return" ? `식 ${expression}의 값 ${after}를 반환합니다.` : `${name}에 ${after}를 저장합니다.`
        : target.kind === "condition" ? `The predicate ${expression} is ${after}.` : target.kind === "return" ? `Return ${after} from ${expression}.` : `Store ${after} in ${name}.`,
      reason: ko ? `현재 예시 값을 대입하면 ${reading.substituted} = ${after}입니다.` : `Substituting the current example gives ${reading.substituted} = ${after}.`,
      effect: target.kind === "return" ? ko ? `지역 값은 그대로 두고 ${after}를 호출자에게 반환합니다.` : `Return ${after} to the caller while preserving local state.`
        : ko ? `${target.kind === "condition" ? "판단" : name + " 저장"}을 마쳤고 다음 구문은 ${next ?? "없음"}입니다.`
          : `${target.kind === "condition" ? "The decision" : "The write to " + name} is complete; next is ${next ?? "the end of this route"}.`,
      values: [{ name, before, after }] };
    if ((context.valueNames?.length && !context.valueNames.includes(name))
      || [step.syntax!, step.text, step.reason!, step.effect!].some(text => text.length > 150)) return undefined;
    steps.push(step); substitutions.push(reading.substituted);
  }
  if (result === undefined) return undefined;
  return { inputs: [...inputs].map(([name, value]) => ({ name, json: JSON.stringify(value) })), steps, result, substitutions };
}
