/** Exact source-route worksheets retain statement order, immediate values and language syntax without a model round-trip. */
import type { FunctionNarrativeContext, FunctionNarrativeFlowPath, FunctionNarrativeFlowStep, FunctionNarrativeStep } from "../../../shared/functionNarratives";
import { readPrimitiveExpression, type Primitive } from "./expression";

export type PrimitiveTrace = { inputs: Array<{ name: string; json: string }>; steps: FunctionNarrativeStep[]; result: string;
  /** Source-ordered operand substitutions keep summary reasons concrete without reparsing prose. */
  substitutions: string[];
  /** Unexecuted external calls make the resulting calculation conditional on normal completion, never a pure-source proof. */
  unverifiedCalls?: string[] };

/** Closed paths require every operation; opt-in standalone calls retain explicit normal-return/local-state assumptions without certifying their bodies. */
export function tracePrimitiveRoute(context: FunctionNarrativeContext, path: FunctionNarrativeFlowPath,
  inputs: ReadonlyMap<string, Primitive>, language: "ko" | "en", allowUnverifiedCalls = false): PrimitiveTrace | undefined {
  const integer = context.language === "kotlin", ko = language === "ko";
  if (path.confidence !== "exact" || path.status !== "source-terminal" || path.steps.length > 32) return undefined;
  if (!context.parameters || inputs.size !== context.parameters.length || context.parameters.some(parameter => {
    const type = parameter.type?.replace(/\s/gu, "") ?? "", value = inputs.get(parameter.name);
    if (!inputs.has(parameter.name)) return true;
    if (value === null) return !type.endsWith("?");
    return /^(?:Int\??|number)$/u.test(type) ? typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER
      || /^Int/u.test(type) && (!Number.isInteger(value) || value < -2147483648 || value > 2147483647)
      : /^(?:Boolean\??|boolean)$/u.test(type) ? typeof value !== "boolean"
        : /^(?:String\??|string)$/u.test(type) ? typeof value !== "string" || value.length > 40 : true;
  })) return undefined;
  const state = new Map(inputs), steps: FunctionNarrativeStep[] = [], visited = new Set<string>(), substitutions: string[] = [];
  const immutable = new Set(context.language === "kotlin" ? inputs.keys() : []);
  const loopRoute = path.steps.some(step => step.kind === "loop");
  if (allowUnverifiedCalls && loopRoute) return undefined;
  const unverifiedCalls: string[] = [];
  let result: string | undefined;
  for (let index = 0; index < path.steps.length; index++) {
    const target = path.steps[index];
    if (target.confidence !== "exact" || result !== undefined) return undefined;
    const identity = target.graphNodeId ?? target.source.snippetId + ":" + target.source.startLine + ":" + target.kind;
    // Same-node visits are safe only in a complete loop route and with changed
    // state. A stationary cycle is rejected; the source-operation budget still
    // bounds all repeated visits and no iteration is inferred or omitted.
    const visitKey = loopRoute ? identity + ":" + JSON.stringify([...state]) : identity;
    if (visited.has(visitKey)) return undefined; visited.add(visitKey);
    if (allowUnverifiedCalls && target.kind === "call") {
      const reading = readPrimitiveCall(target, state, integer, language, path.steps[index + 1]?.code);
      if (!reading || unverifiedCalls.length >= 4 || context.valueNames?.length && !context.valueNames.includes("result")) return undefined;
      const step = unverifiedCalls.length ? withPrimitiveCallAssumption(reading.step, language) : reading.step;
      if (!step) return undefined;
      steps.push(step); substitutions.push(reading.substituted); unverifiedCalls.push(target.code);
      // All state is primitive and the source scope guard excludes captured
      // local closures. Ordinary calls receive values, not binding references.
      // Normal return and preservation of locals are explicit assumptions:
      // unknown bodies (including JS caller introspection) are never certified.
      continue;
    }
    let expression = target.code.replace(/;\s*$/u, "").trim(), name = "condition", before = ko ? "미평가" : "not evaluated";
    let declaration: string | undefined, compound: string | undefined;
    const isPredicate = target.kind === "condition" || target.kind === "loop";
    const expected = target.branch?.outcome === "iterate" ? "true" : ["exit", "repeat-exit"].includes(target.branch?.outcome ?? "") ? "false" : target.branch?.outcome;
    if (isPredicate) {
      if (target.branch?.confidence !== "exact" || !["true", "false"].includes(expected ?? "")) return undefined;
      expression = target.loweredPredicate ?? expression;
    } else if (target.kind === "return") {
      const match = /^return\s+(.+)$/u.exec(expression); if (!match) return undefined;
      expression = match[1]; name = "result"; before = ko ? "반환 전" : "not returned";
    } else if (target.kind === "mutation" && target.writeTargets?.length === 1) {
      name = target.writeTargets[0];
      const write = /^(?:(val|var|let|const)\s+)?([\p{L}_$][\p{L}\p{N}_$]*)\s*(?:=|([+*/%-])=)\s*(.+)$/u.exec(expression);
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
    if (isPredicate) {
      if (typeof reading.value !== "boolean" || String(reading.value) !== expected) return undefined;
    } else if (target.kind === "return") result = after;
    else { state.set(name, reading.value); if (declaration === "val" || declaration === "const") immutable.add(name); }
    const next = path.steps[index + 1]?.code;
    const syntax = target.kind === "loop" ? ko ? "반복 조건은 이 방문의 현재 값으로 본문 진행 또는 반복 종료를 판단합니다." : "The loop predicate selects its body or exit using this visit's current values."
      : target.kind === "condition" ? target.loweredPredicate && target.code.includes("?:")
      ? ko ? "Elvis 연산자는 null 여부를 판단해 사용할 피연산자 하나를 선택합니다." : "Elvis tests nullability and selects exactly one operand."
      : ko ? "조건식의 Boolean 결과로 다음 소스 경로를 선택합니다." : "The predicate's Boolean result selects the next source route."
      : target.kind === "return" ? ko ? "return은 식 전체의 값을 반환하고 현재 함수의 진행을 끝냅니다." : "Return yields the whole expression's value and ends this function."
        : declaration ? ko ? `${declaration}는 ${["val", "const"].includes(declaration) ? "재대입할 수 없는" : "재대입할 수 있는"} 지역 변수를 선언합니다.`
          : `${declaration} declares a ${["val", "const"].includes(declaration) ? "non-reassignable" : "reassignable"} local binding.`
          : compound ? ko ? `${compound}=는 기존 값에 ${compound} 연산을 적용한 뒤 같은 변수에 저장합니다.` : `${compound}= applies ${compound} to the current value and stores it in the same binding.`
            : ko ? "대입은 선택한 식의 값을 현재 지역 변수에 저장합니다." : "Assignment stores the selected expression's value in the local binding.";
    const terms: Record<string, [string, string]> = { "+": ["덧셈", "addition"], "-": ["뺄셈", "subtraction"], "*": ["곱셈", "multiplication"],
      "/": [integer ? "정수 나눗셈: 소수 부분을 0 방향으로 버림" : "나눗셈", integer ? "integer division truncates toward zero" : "division"],
      "%": ["나머지", "remainder"],
      "u-": ["수치 부호 반전", "numeric negation"], "u+": ["수치 값 유지", "numeric identity"],
      "s+": ["문자열 연결", "string concatenation"],
      "!": ["Boolean 부정", "Boolean negation"], ">": ["초과 비교", "greater-than comparison"], ">=": ["이상 비교", "inclusive lower-bound comparison"],
      "<": ["미만 비교", "less-than comparison"], "<=": ["이하 비교", "inclusive upper-bound comparison"],
      "==": ["동등 비교", "equality"], "===": ["엄격한 동등 비교", "strict equality"], "!=": ["다름 비교", "inequality"], "!==": ["엄격한 다름 비교", "strict inequality"],
      "&&": ["두 조건의 논리곱", "Boolean conjunction"], "||": ["두 조건의 논리합", "Boolean disjunction"] };
    const operations = reading.operations.map(op => `${op.startsWith("u") || op === "s+" ? op.slice(1) : op}: ${terms[op][ko ? 0 : 1]}`).join(", ");
    const step: FunctionNarrativeStep = { code: target.code, source: target.source, syntax: syntax + (operations ? " " + operations + "." : ""),
      text: ko ? isPredicate ? `${target.kind === "loop" ? "반복 조건" : "조건"} ${expression}의 결과는 ${after === "true" ? "참" : "거짓"}입니다.`
        : target.kind === "return" ? `식 ${expression}의 값 ${after}를 반환합니다.` : `${name}에 ${after}를 저장합니다.`
        : isPredicate ? `The ${target.kind === "loop" ? "loop predicate" : "predicate"} ${expression} is ${after}.` : target.kind === "return" ? `Return ${after} from ${expression}.` : `Store ${after} in ${name}.`,
      reason: ko ? `현재 예시 값을 대입하면 ${reading.substituted} = ${after}입니다.` : `Substituting the current example gives ${reading.substituted} = ${after}.`,
      effect: target.kind === "return" ? ko ? `지역 값은 그대로 두고 ${after}를 호출자에게 반환합니다.` : `Return ${after} to the caller while preserving local state.`
        : ko ? `${isPredicate ? "판단" : name + " 저장"}을 마쳤고 다음 구문은 ${next ?? "없음"}입니다.`
          : `${isPredicate ? "The decision" : "The write to " + name} is complete; next is ${next ?? "the end of this route"}.`,
      values: [{ name, before, after }] };
    if ((context.valueNames?.length && !context.valueNames.includes(name))
      || [step.syntax!, step.text, step.reason!, step.effect!].some(text => text.length > 150)) return undefined;
    const conditionalStep = unverifiedCalls.length ? withPrimitiveCallAssumption(step, language) : step;
    if (!conditionalStep) return undefined;
    steps.push(conditionalStep); substitutions.push(reading.substituted);
  }
  if (result === undefined) return undefined;
  return { inputs: [...inputs].map(([name, value]) => ({ name, json: JSON.stringify(value) })), steps, result, substitutions,
    ...(unverifiedCalls.length ? { unverifiedCalls } : {}) };
}
/** No user function is invoked. Only a direct, unused-result call with primitive arguments is represented, conditional on normal return. */
export function readPrimitiveCall(target: FunctionNarrativeFlowStep, state: ReadonlyMap<string, Primitive>,
  integer: boolean, language: "ko" | "en", next?: string): { step: FunctionNarrativeStep; substituted: string } | undefined {
  if (target.kind !== "call" || target.branch || target.code.length > 480) return;
  const match = /^([\p{L}_$][\p{L}\p{N}_$]*)\s*\(([\s\S]*)\)\s*;?$/u.exec(target.code.trim());
  // Direct eval can change the caller's local bindings. Local callees can be
  // known non-functions; neither is a conditional external-call recipe.
  if (!match || match[1] === "eval" || state.has(match[1])) return;
  const argumentsText = splitArguments(match[2]);
  if (!argumentsText || argumentsText.length > 8) return;
  const argumentsRead = argumentsText.map(expression => readPrimitiveExpression(expression, state, integer));
  if (argumentsRead.some(reading => !reading)) return;
  const operands = argumentsRead.map(reading => `${reading!.substituted} = ${JSON.stringify(reading!.value)}`).join(", ");
  const ko = language === "ko", unknown = ko ? "미확인" : "unknown";
  const step: FunctionNarrativeStep = { code: target.code, source: target.source,
    syntax: ko ? "함수 호출은 인수 값을 전달합니다. 사용하지 않는 반환값으로 지역 변수를 대입하지 않습니다."
      : "A call passes argument values. Its unused return value does not assign a local binding.",
    text: ko ? argumentsRead.length ? `${argumentsRead.map(reading => JSON.stringify(reading!.value)).join(", ")}을 인수로 전달해 ${match[1]}를 호출합니다.` : `인수 없이 ${match[1]}를 호출합니다.`
      : `Call ${match[1]} with ${argumentsRead.length ? argumentsRead.map(reading => JSON.stringify(reading!.value)).join(", ") : "no arguments"}.`,
    reason: ko ? operands ? `현재 인수의 계산은 ${operands}입니다.` : "이 소스 호출에는 인수가 없습니다."
      : operands ? `Current argument calculations: ${operands}.` : "This source call has no arguments.",
    effect: ko ? `내부 동작·반환·예외는 미확인입니다. 정상 복귀하고 지역 값을 유지하는 경우 다음 구문 ${next ?? "없음"}으로 진행합니다.`
      : `Effects, return and exceptions are unknown. Normal return with local values preserved continues to ${next ?? "the route end"}.`,
    values: [{ name: "result", before: "—", after: unknown }] };
  if ([step.syntax!, step.text, step.reason!, step.effect!].some(text => text.length > 150)) return;
  return { step, substituted: operands || (ko ? "인수 없음" : "no arguments") };
}

/** A focused node must retain its conditional value provenance even when read outside the whole scenario paragraph. */
export function withPrimitiveCallAssumption(step: FunctionNarrativeStep, language: "ko" | "en"): FunctionNarrativeStep | undefined {
  const reason = (language === "ko" ? "앞선 호출의 정상 복귀와 지역 값 유지를 가정합니다. " : "Assume prior calls return normally and preserve locals. ") + step.reason;
  const prefix = language === "ko" ? "앞선 호출이 정상 복귀하고 지역 값을 유지하면, " : "If prior calls return normally and preserve locals, ";
  const text = prefix + step.text;
  // Final structural exit notes inherit the terminal effect. Keep their
  // collapsed reading conditional too; unknown-call effects already qualify
  // their own continuation and must not imply a known external result.
  const unknownCall = step.values?.some(value => value.name === "result" && ["미확인", "unknown"].includes(value.after));
  const effect = unknownCall ? step.effect : prefix + step.effect;
  return reason.length <= 180 && text.length <= 150 && effect!.length <= 150 ? { ...step, text, reason, effect } : undefined;
}

/** Bounded linear scanner separates commas only outside quoted strings and expression parentheses. */
function splitArguments(source: string): string[] | undefined {
  if (!source.trim()) return [];
  const argumentsText: string[] = [];
  let start = 0, depth = 0, quote = "";
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quote) { if (char === "\\") index++; else if (char === quote) quote = ""; continue; }
    if (["\"", "'"].includes(char)) { quote = char; continue; }
    if (char === "(") { if (++depth > 32) return; }
    else if (char === ")") { if (--depth < 0) return; }
    else if (char === "," && depth === 0) { argumentsText.push(source.slice(start, index).trim()); start = index + 1; }
  }
  argumentsText.push(source.slice(start).trim());
  return !quote && depth === 0 && argumentsText.every(Boolean) ? argumentsText : undefined;
}
