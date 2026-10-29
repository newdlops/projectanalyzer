/** Source-grounded prose checks and a separate whole-function purpose contract; no generated text is repaired here. */
import { readNarrativeQualityFacts, type NarrativeQualityFacts } from "../../analyzer/narrativeQuality";
import { FunctionNarrativeError, isFunctionNarrativeLanguage, type FunctionNarrative, type FunctionNarrativeContext } from "../../shared/functionNarratives";

export { readNarrativeQualityFacts } from "../../analyzer/narrativeQuality";

/** Preserve whitespace inside string literals when matching an exact return expression. */
export function findFunctionNarrativeLiteralReturn(facts: NarrativeQualityFacts, code: string): NarrativeQualityFacts["returns"][number] | undefined {
  const expression = /^return\b([\s\S]*)$/u.exec(code.trim().replace(/;$/u, "").trim())?.[1].trim();
  return facts.returns.find(item => item.literalJson !== undefined && item.expression === expression);
}

/** Purpose requests have no selected route, example, completed values or provisional node prose. */
export function createFunctionNarrativePurposeTask(context: FunctionNarrativeContext): FunctionNarrativeContext {
  const { nodePreparation: _preparation, nodeTask: _node, summaryTask: _summary, sourceFlow: _flow,
    scenarioBatch: _batch, checkedExamples: _examples, valueFacts: _values, ...source } = context;
  return { ...source, functionPurposeTask: true };
}

/** Independently qualify a bounded source-wide purpose before it becomes reusable session state. */
export function parseFunctionNarrativePurpose(text: string, context: FunctionNarrativeContext, language: "ko" | "en"): string {
  if (text.length > 2400) throw new FunctionNarrativeError("invalid-response");
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new FunctionNarrativeError("invalid-response"); }
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 1
    || !("summary" in value) || typeof value.summary !== "string" || !value.summary.trim() || value.summary.length > 240) throw new FunctionNarrativeError("invalid-response");
  const summary = value.summary;
  const narrative = { summary, scenarios: [], limitations: [] };
  if (!isFunctionNarrativeLanguage(narrative, language)) throw new FunctionNarrativeError("language-mismatch");
  const facts = readNarrativeQualityFacts(context);
  const outcomes = new Set(facts.returns.flatMap(item => item.literal ? [item.literal] : []));
  // A small literal-result function can name every result without exceeding the
  // summary contract. Larger/abstract results still receive a source-wide task.
  if (facts.closed && outcomes.size > 1 && outcomes.size <= 4 && [...outcomes].every(item => item.length <= 32)
    && [...outcomes].some(item => !summary.toLocaleLowerCase().includes(item.toLocaleLowerCase()))) {
    throw new FunctionNarrativeError("invalid-response", "quality-purpose-coverage");
  }
  const boolean = context.parameters?.filter(parameter => parameter.type === "boolean");
  const unquoted = summary.replace(/`[^`]*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/gu, " ");
  if (facts.closed && outcomes.size > 1 && boolean?.length === 1 && facts.returns.some(item => item.conditions.includes(boolean[0].name + " = true"))
    && !unquoted.includes(boolean[0].name)) throw new FunctionNarrativeError("invalid-response", "quality-purpose-condition");
  assertGroundedDescriptions([value.summary], context);
  return value.summary;
}

/** Rich captured-source prose has separate roles: syntax explains semantics; assumptions contain actual unknowns. */
export function assertFunctionNarrativeQuality(narrative: FunctionNarrative, context: FunctionNarrativeContext): void {
  if (!context.sourceEvidence || context.detailLevel !== "rich" || context.callTask) return;
  const facts = readNarrativeQualityFacts(context);
  const prose = context.nodePreparation || context.nodeTask ? [] : [narrative.summary, ...narrative.limitations];
  for (const scenario of narrative.scenarios) {
    if (facts.closed && scenario.assumptions.length) throw new FunctionNarrativeError("invalid-response", "quality-known-assumption");
    if (!context.nodePreparation && !context.nodeTask) prose.push(scenario.explanation ?? "", ...scenario.assumptions,
      ...Object.values(scenario.analysis ?? {}));
    for (const step of scenario.steps) {
      if (step.syntax) {
        const snippet = context.snippets.find(item => item.id === step.source.snippetId);
        const source = snippet?.text.split(/\r\n|\r|\n/u).slice(step.source.startLine - snippet.startLine,
          step.source.endLine - snippet.startLine + 1).join("\n");
        const syntax = normalizeCode(step.syntax);
        if (syntax && (normalizeCode(step.code ?? "") === syntax || normalizeCode(source ?? "").includes(syntax))) {
          throw new FunctionNarrativeError("invalid-response", "quality-code-only-syntax");
        }
      }
      const returned = step.source.snippetId === context.snippets.find(snippet => snippet.role === "function")?.id
        ? findFunctionNarrativeLiteralReturn(facts, step.code ?? "") : undefined;
      const result = step.values?.find(row => row.name === "result");
      if (returned && result && result.after !== returned.literalJson) {
        throw new FunctionNarrativeError("invalid-response", "quality-literal-result");
      }
      const invocation = facts.closed && facts.identityInvocations.find(item => item.statement.trim().replace(/;$/u, "")
        === (step.code ?? "").trim().replace(/;$/u, ""));
      if (invocation && invocation.argumentJson !== undefined && invocation.followingCondition
        && /^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(invocation.followingCondition)) {
        const condition = invocation.followingCondition.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
        const reason = step.reason ?? "";
        if (new RegExp(condition + ".{0,40}(?:이므로|때문에)|(?:because|since)\\s+" + condition + "\\b", "iu").test(reason)
          && !/관계없이|무관|않|regardless|independent/iu.test(reason)) throw new FunctionNarrativeError("invalid-response", "quality-call-order");
      }
      prose.push(step.text, step.syntax ?? "", step.reason ?? "", step.effect ?? "");
    }
  }
  assertGroundedDescriptions(prose, context);
  if (facts.closed && facts.hasElse === false && prose.some(text => /\belse\s+(?:block|branch)\b|else\s*(?:블록|구문|분기)/iu.test(text)
    && !/(?:no|without)\s+else\b|else\s*(?:블록|구문|분기).{0,8}(?:없|않)/iu.test(text))) {
    throw new FunctionNarrativeError("invalid-response", "quality-invented-else");
  }
}

/** Only a proven closed identity-call scope can exclude retrieval semantics. Unknown/I/O helpers stay unknown. */
function assertGroundedDescriptions(descriptions: string[], context: FunctionNarrativeContext): void {
  const facts = readNarrativeQualityFacts(context);
  if (!facts.closed) return;
  for (const description of descriptions) {
    let prose = description.replace(/`[^`]*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/gu, " ");
    let typeProse = prose;
    for (const name of [context.functionName, ...(context.parameters?.map(item => item.name) ?? []), ...facts.identityCalls.map(item => item.name)]) {
      if (/^typecheck\w*$|^타입(?:체크|검사)/iu.test(name)) typeProse = typeProse.replaceAll(name, "[identifier]");
    }
    if (/\btype[- ]?check\w*\b|타입\s*(?:체크|검사)/iu.test(typeProse)
      && !/(?:no|without|not)\s+type[- ]?check|타입\s*(?:체크|검사).{0,8}(?:않|없)/iu.test(typeProse)) {
      throw new FunctionNarrativeError("invalid-response", "quality-invented-type-check");
    }
    if (!facts.identityCalls.length) continue;
    // A helper may itself be named fetch/load. An explicit invocation name is
    // code identity, rather than an asserted retrieval operation.
    for (const helper of facts.identityCalls) {
      const name = helper.name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      prose = prose.replace(new RegExp("(\\b(?:call(?:s|ed)?|invok(?:e|es|ed))(?:\\s+to)?\\s+)" + name + "\\b", "giu"), "$1[helper]")
        .replace(new RegExp("\\b" + name + "(?=\\s*\\()", "gu"), "[helper]")
        .replace(new RegExp(name + "(?=\\s*(?:함수|호출|를|을|의))", "gu"), "[helper]");
    }
    const claims = prose.matchAll(/\b(?:retriev\w*|fetch\w*|load(?:s|ed|ing)?)\b|조회|검색|불러오|가져오/giu);
    for (const claim of claims) {
      const before = prose.slice(Math.max(0, claim.index - 24), claim.index);
      const after = prose.slice(claim.index, claim.index + 30);
      if (/\b(?:not|never|no|without)\s*(?:(?:directly|actually|ever)\s+)?$/iu.test(before) || /(?:않|아니|없)/u.test(after)) continue;
      throw new FunctionNarrativeError("invalid-response", "quality-unsupported-retrieval");
    }
  }
}
function normalizeCode(text: string): string { return text.replace(/`|\s/gu, "").replace(/[;.]+$/u, ""); }

/** A failed role check gets one bounded fresh generation, never a fabricated replacement sentence. */
export function functionNarrativeQualityRepair(error: unknown, language: "ko" | "en"): string | undefined {
  if (!(error instanceof FunctionNarrativeError) || !error.detailCode?.startsWith("quality-")) return;
  const reason = error.detailCode === "quality-code-only-syntax"
    ? language === "ko" ? "syntax에는 코드를 복사하지 말고 선언·호출·분기·반환 구문이 뜻하는 언어 동작을 설명하세요." : "syntax must explain the language meaning of a declaration, call, branch or return, rather than copying code."
    : error.detailCode === "quality-literal-result"
      ? language === "ko" ? "return의 result.after에는 소스 리터럴과 같은 실제 JSON 값을 쓰세요. 문자열에 JSON 인코딩용 따옴표를 추가하지 마세요. 설명은 reason에 씁니다." : "Use the source literal's actual JSON value in return result.after. Do not add JSON-encoding quote characters inside strings. Put explanations in reason."
    : error.detailCode === "quality-invented-else"
      ? language === "ko" ? "이 소스에는 else 블록이 없습니다. 거짓 조건은 참 본문의 반환을 건너뛰고 뒤의 반환문으로 진행합니다." : "This source has no else block. A false condition skips the true-arm return and continues to the following return."
    : error.detailCode === "quality-purpose-condition"
      ? language === "ko" ? "조건에 사용된 매개변수의 정확한 이름을 summary에도 유지하세요. 반환 문자열만 언급하거나 이름을 바꾸지 마세요." : "Keep the exact condition parameter name in summary; do not mention only the quoted results or rename the parameter."
    : error.detailCode === "quality-invented-type-check"
      ? language === "ko" ? "이 함수는 Boolean 값으로 분기하며 런타임 타입 검사를 하지 않습니다. 타입 체크라는 설명을 만들지 마세요." : "This function branches on a Boolean value; it does not perform a runtime type check. Describe the value-based branch."
    : error.detailCode === "quality-call-order"
      ? language === "ko" ? "현재 helper 호출은 뒤의 if 조건을 판단하기 전에 실행됩니다. 호출 reason은 리터럴 인수가 그대로 반환되는 근거이며, 뒤 조건이 참/거짓이기 때문이라고 쓰지 마세요." : "This helper call occurs before the following if decision. Explain its literal argument and identity return; do not make a later Boolean value the cause of this call."
    : error.detailCode === "quality-purpose-coverage"
      ? language === "ko" ? "summary에 모든 서로 다른 반환값과 각각의 조건을 포함하세요." : "Include every distinct return outcome and its condition in summary."
      : error.detailCode === "quality-known-assumption"
        ? language === "ko" ? "소스로 확인된 입력·조건·동작은 assumptions가 아닙니다. 이 닫힌 소스 범위에서는 []를 쓰세요." : "Known inputs, conditions and source behavior are not assumptions. Use [] for this closed source scope."
        : language === "ko" ? "확인된 helper는 인수를 그대로 반환합니다. 조회·검색·불러오기라는 의미를 만들지 말고 실제 반환 동작을 설명하세요." : "The evidenced identity helper returns its argument. Describe that operation without inventing retrieval, fetching or loading."
  return (language === "ko" ? "앞 응답의 품질 검사를 통과하지 못했습니다. 같은 소스와 고정 값을 유지하여 JSON 전체를 다시 작성하세요. "
    : "The previous response failed a prose quality check. Regenerate the entire JSON using the same source and fixed values. ") + reason;
}
