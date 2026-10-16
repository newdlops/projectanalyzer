/** Complete source-operation field geometry and explicit literal/phase provenance. All explanatory slots are free from construction onward. */
import type { FunctionNarrativeFlowStep } from "../../../shared/functionNarratives";
import type { NativeNarrativeSchema } from "../types";
import { rootResultDomain } from "./domains";
import { rootEntryConstraints, rootSourceLiteral } from "./syntax";
import type { NativeRootSourceContext } from "./types";

type Rule = Record<string, any>;
export type SourceCalculatedCell = { domain: NativeNarrativeSchema; knownNull: boolean; provenance: "direct-source-literal" | "direct-source-literal-display" | "parser-owned-entry-choice" };

/** Original locale/length grammar only; never a sentence or an answer derived from source. */
export function rootProseDomain(limit: number, locale: "ko" | "en"): Rule {
  return { type: "string", minLength: 1, maxLength: limit, ...(locale === "ko" ? { pattern: `^[가-힣][^"\\\\\\x00-\\x1F]{0,${limit - 1}}$` } : {}) };
}

/** Static per-slot task directions include the whole original expression and source branch choice, without explaining or evaluating it. */
function operationDescription(target: FunctionNarrativeFlowStep, locale: "ko" | "en"): string {
  const operation = JSON.stringify({ kind: target.kind, code: target.code, ...(target.branch ? { predicateResult: target.branch.outcome } : {}) });
  const timing = target.kind === "mutation" ? locale === "ko" ? "현재 대입의 계산과 저장을 구체적 값으로 설명합니다. 앞 조건의 해설을 반복하지 않습니다." : "Explain this write's calculation and assignment with concrete values, rather than copying the earlier guard explanation."
    : target.kind === "condition" ? locale === "ko" ? "현재 조건식의 판단만 설명합니다. 다음 대입이나 반환은 아직 일어나지 않았습니다." : "Explain this predicate decision only; the next assignment or return has not occurred yet."
      : target.kind === "return" ? locale === "ko" ? "return 뒤의 식 전체에 최신 값을 대입해 계산합니다. reason에 계산식을 쓰고 values의 result.after에 그 계산 결과를 넣습니다. 조건식의 결과나 연산 전 입력값을 반환값으로 복사하지 마세요." : "Substitute the latest values into the ENTIRE return expression. Write its calculation in reason, then put that result in result.after. Never copy the guard result or an operand before applying the return operators."
        : locale === "ko" ? "현재 구문이 앞 상태를 어떻게 사용하는지 설명합니다." : "Explain how this current operation uses the preceding state.";
  return (locale === "ko" ? "이 steps 슬롯의 소스 데이터: " : "Source data for this steps slot: ") + operation + ". " + timing;
}

/** A direct source predicate/entry choice supplies only its fixed syntax relation, never a calculated compound expression. */
function directDecision(context: NativeRootSourceContext, target: FunctionNarrativeFlowStep): string | undefined {
  const nullable = context.language === "kotlin" && target.loweredPredicate?.match(/^([\p{L}_][\p{L}\p{N}_]*) != null$/u);
  if (nullable && target.kind === "condition" && target.code.includes("?:") && target.branch?.confidence === "exact") {
    const constraints = rootEntryConstraints(context); if (constraints.nonNullInputs.has(nullable[1])) return "true"; if (constraints.nullInputs.has(nullable[1])) return "false";
  }
  const direct = /^(.+) = (true|false)$/u.exec(target.branch?.inputCondition ?? "");
  if (!direct || !context.parameters.some(parameter => parameter.name === direct[1])) return undefined;
  const code = target.code.replace(/\s/gu, ""), negated = code === "!" + direct[1] || code === "not" + direct[1];
  if (!negated && code !== direct[1]) return undefined;
  const outcome = String(negated ? direct[2] !== "true" : direct[2] === "true"); return outcome === target.branch?.outcome ? outcome : undefined;
}

/** Preserve every original step/value field and order; only independently visible source literals/choices receive raw-model guards. */
export function rootStepSchema(context: NativeRootSourceContext, target: FunctionNarrativeFlowStep, locale: "ko" | "en", numericWrites: ReadonlySet<FunctionNarrativeFlowStep>): { schema: Rule; calculatedAfter?: SourceCalculatedCell } {
  const display = { type: "string", minLength: 1, maxLength: 120 }, names = context.valueNames;
  const valueItem: Rule = { type: "object", additionalProperties: false, required: ["name", "before", "after"], properties: { name: { type: "string", ...(names?.length ? { enum: names } : { maxLength: 120 }) }, before: display, after: display } };
  let values: Rule = { type: "array", minItems: 1, maxItems: 2, items: valueItem }, calculatedAfter: SourceCalculatedCell | undefined;
  const name = target.kind === "return" ? "result" : target.writeTargets?.length === 1 ? target.writeTargets[0] : undefined;
  if (name && (!names?.length || names.includes(name))) {
    const literal = target.kind === "mutation" && target.confidence === "exact" ? rootSourceLiteral(target.code) : undefined;
    const after = target.kind === "return" ? rootResultDomain(context.language, context.returnTypeText) : literal ? { const: literal.value } : numericWrites.has(target) ? { anyOf: [{ type: "number" }, { type: "null" }] } : display;
    const declares = (code: string) => /^(?:val|var|let|const)\s+([\p{L}_$][\p{L}\p{N}_$]*)\b/u.exec(code)?.[1] === name;
    const declared = declares(target.code) || context.sourceFlow.paths[0].steps.some(step => step.loweredPredicate && step.source.snippetId === target.source.snippetId && step.source.startLine === target.source.startLine && step.source.endLine === target.source.endLine && declares(step.code));
    const first = { ...valueItem, properties: { ...valueItem.properties, name: { const: name }, ...(target.kind === "return" ? { before: { const: locale === "ko" ? "반환 전" : "not returned" } } : declared ? { before: { const: locale === "ko" ? "선언 전" : "not declared" } } : {}), after } };
    values = { ...values, maxItems: 1, items: [first] };
    if (literal) calculatedAfter = { domain: literal.value === null ? rootResultDomain(context.language, context.returnTypeText) : { anyOf: [{ type: typeof literal.value === "number" ? "number" : "boolean" }, { type: "null" }] }, knownNull: literal.value === null, provenance: "direct-source-literal" };
  }
  const decision = directDecision(context, target);
  if (decision !== undefined && (!names?.length || names.includes("condition"))) {
    values = { const: [{ name: "condition", before: locale === "ko" ? "미평가" : "not evaluated", after: decision }] };
    calculatedAfter = { domain: display, knownNull: false, provenance: "parser-owned-entry-choice" };
  }
  const returned = target.kind === "return" && target.confidence === "exact" ? /^return\b\s*(.*?)\s*;?$/u.exec(target.code) : undefined, literalReturn = returned ? rootSourceLiteral(returned[1]) : undefined;
  if (literalReturn && (!names?.length || names.includes("result"))) {
    values = { const: [{ name: "result", before: locale === "ko" ? "반환 전" : "not returned", after: literalReturn.json }] };
    calculatedAfter = { domain: display, knownNull: false, provenance: "direct-source-literal-display" };
  }
  const properties: Rule = { code: { const: target.code }, syntax: rootProseDomain(160, locale), text: rootProseDomain(120, locale), reason: rootProseDomain(180, locale), effect: rootProseDomain(160, locale), source: { const: target.source }, values };
  // The original source-anchored native transport puts immediate values first on every operation, including returns.
  const ordered: Rule = {}, order = ["code", "values", "syntax", "text", "reason", "effect", "source"];
  for (const key of order) ordered[key] = properties[key];
  return { schema: { type: "object", additionalProperties: false, required: ["text", "reason", "effect", "source", "syntax", "values", "code"], properties: ordered, description: operationDescription(target, locale) }, ...(calculatedAfter ? { calculatedAfter } : {}) };
}
