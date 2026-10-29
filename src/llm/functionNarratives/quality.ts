/** Local decoding combines checked source readings with model-authored purpose and operation prose. */
import type { FunctionNarrativeContext } from "../../shared/functionNarratives";
import { readNarrativeQualityFacts, findFunctionNarrativeLiteralReturn, buildFunctionNarrativeQualityReading } from "../../application/functionNarratives";

/** Constrain actual unknowns only when the analyzer recognizes the entire closed primitive/identity-call scope. */
export function createLocalNarrativeQualitySchema(schema: Record<string, unknown>, context: FunctionNarrativeContext, language: "ko" | "en" = "en"): Record<string, unknown> {
  if (!context.sourceEvidence || context.callTask) return schema;
  const result = structuredClone(schema);
  const facts = readNarrativeQualityFacts(context);
  const closed = facts.closed;
  const reading = buildFunctionNarrativeQualityReading(context, language);
  const pending: unknown[] = [result]; const visited = new Set<object>();
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== "object" || visited.has(value)) continue;
    visited.add(value);
    if (visited.size > 10000) throw new RangeError("Narrative schema quality budget exceeded");
    if (!Array.isArray(value)) {
      const fields = value as Record<string, unknown>;
      // Only schema properties are visited as such; const source/step payloads
      // are evidence, never schemas to rewrite.
      if (fields.properties && typeof fields.properties === "object") {
        const properties = fields.properties as Record<string, any>;
        if (closed) for (const name of ["assumptions", "limitations"]) if (properties[name]) properties[name] = { const: [] };
        if (properties.syntax && !Object.hasOwn(properties.syntax, "const")) properties.syntax.description =
          "Explain the language semantics in a sentence. Code alone is invalid; the exact code has its own field.";
        if (reading && properties.analysis && properties.explanation) {
          properties.analysis = { const: reading.analysis }; properties.explanation = { const: reading.explanation };
        }
        const literal = properties.source?.const?.snippetId === context.snippets.find(snippet => snippet.role === "function")?.id
          ? findFunctionNarrativeLiteralReturn(facts, String(properties.code?.const ?? "")) : undefined;
        if (literal?.literalJson !== undefined && !Object.hasOwn(properties.values ?? {}, "const")) {
          if (closed && properties.syntax && properties.text && properties.reason && properties.effect) {
            const ko = language === "ko", value = literal.expression;
            const prose = ko ? { syntax: `return은 리터럴 ${value} 값을 호출자에게 반환하고 함수를 종료합니다.`,
              text: `도달한 반환문은 ${value} 값을 반환합니다.`, reason: `현재 소스 경로가 이 반환문에 도달했으며 반환식은 리터럴 ${value}입니다.`,
              effect: `함수가 종료되고 호출자가 ${value} 값을 받습니다.` }
              : { syntax: `return sends the literal ${value} to the caller and ends the function.`, text: `This statement returns ${value}.`,
                reason: `This source route reaches the return whose expression is the literal ${value}.`, effect: `The function ends and passes ${value} to its caller.` };
            const caps = { syntax: 160, text: 120, reason: 180, effect: 160 };
            if (Object.entries(prose).every(([name, text]) => text.length <= caps[name as keyof typeof caps])) {
              for (const [name, text] of Object.entries(prose)) properties[name] = { const: text };
            }
          }
          const rows = properties.values?.items;
          for (const row of Array.isArray(rows) ? rows : rows ? [rows] : []) {
            // A literal is already source data. Constrain only the actual JSON
            // value; syntax/reason/effect still come from the model. Wire decode
            // restores this value before the existing portable JSON encoder.
            if (row.properties?.name?.const === "result") row.properties.after = { const: JSON.parse(literal.literalJson) };
          }
        }
        const invocation = closed && facts.identityInvocations.find(item => item.statement.trim().replace(/;$/u, "")
          === String(properties.code?.const ?? "").trim().replace(/;$/u, ""));
        if (invocation && invocation.argumentJson !== undefined && !Object.hasOwn(properties.values ?? {}, "const")) {
          const rows = properties.values?.items;
          for (const row of Array.isArray(rows) ? rows : rows ? [rows] : []) if (row.properties?.name?.const === invocation.binding) {
            const value: unknown = JSON.parse(invocation.argumentJson);
            row.properties.after = { const: row.properties.after?.type === "string" ? typeof value === "string" ? value : invocation.argumentJson : value };
          }
        }
        const paths = context.sourceFlow?.paths;
        const condition = closed && paths?.length === 1 && paths[0].steps.find(step => step.kind === "condition" && step.confidence === "exact"
          && step.code === properties.code?.const && step.branch?.confidence === "exact"
          && context.parameters?.some(parameter => parameter.name === step.code && parameter.type === "boolean"));
        if (condition && ["true", "false"].includes(condition.branch!.outcome) && properties.values) {
          properties.values = { const: [{ name: condition.code, before: condition.branch!.outcome, after: condition.branch!.outcome }] };
        }
      }
      pending.push(...Object.entries(fields).filter(([key]) => key !== "const" && key !== "enum").map(([, item]) => item));
    } else pending.push(...value);
  }
  return result;
}

/** Neutral contracts suppress name-based business guesses without authoring the model's final prose. */
export function buildLocalNarrativeQualityGuidance(context: FunctionNarrativeContext, language: "ko" | "en"): string {
  if (!context.sourceEvidence || context.callTask) return "";
  const facts = readNarrativeQualityFacts(context);
  const rules = language === "ko"
    ? "syntax는 원문 코드와 별도로 언어 구문의 의미를 설명하는 문장입니다. 소스를 그대로 복사하지 마세요. 입력 선택과 소스에 명시된 사실은 가정이 아닙니다. 아래는 실행 결과가 아닌 소스 구문 사실입니다. identityCalls의 helper는 지정된 인수를 그대로 반환하며 조회·검색을 하지 않습니다. 함수명이나 문자열 이름으로 업무 의미를 추측하지 마세요."
    : "syntax is a sentence explaining language semantics, separate from the exact code field. Do not copy code into syntax. Chosen inputs and source-known facts are not assumptions. The following are source-syntax facts, not execution observations. Each identityCalls helper returns the indicated argument unchanged, without retrieval or lookup. Do not infer business behavior from names or string labels.";
  const valueRules = language === "ko"
    ? " 반환 노드의 result.after는 실제 JSON 값이며 문자열에 인코딩용 따옴표를 한 번 더 넣지 않습니다. 다른 값 행도 before/after에는 값만 쓰고 설명은 reason/effect에 씁니다. 소스에 없는 else 블록이나 result라는 지역 변수 대입을 만들지 마세요. 같은 도달 블록에서 if 앞의 호출은 그 if의 참/거짓 선택보다 먼저 실행됩니다."
    : " A return node's result.after is an actual JSON value; do not add encoding quotes inside strings. Other before/after rows contain values only; explanations belong in reason/effect. Do not invent an else block or a local assignment to the synthetic result label. Within the same reached block, a call before an if executes before that decision.";
  const calls = facts.identityInvocations.map(call => language === "ko"
    ? `${call.statement}: ${call.helper}는 인수 ${call.argument}를 그대로 반환하고 ${call.binding}에 그 값을 저장합니다.`
      + (call.followingCondition ? ` ${call.followingCondition}의 조건 판단은 이 호출 뒤입니다. 조건이 참이기 때문에 또는 거짓이기 때문에 이 호출을 한다고 설명하지 마세요.` : "")
    : `${call.statement}: ${call.helper} returns its argument ${call.argument} unchanged into ${call.binding}.`
      + (call.followingCondition ? ` The ${call.followingCondition} decision occurs AFTER this call; it does not cause the call.` : ""));
  return "\n" + rules + valueRules + (facts.closed ? language === "ko" ? " 이 범위의 Boolean 조건은 값으로 분기하며 런타임 타입 검사가 아닙니다. 미확인 외부 정보는 없으므로 assumptions/limitations는 []입니다."
    : " Boolean conditions in this scope branch on values, rather than checking runtime types. There is no missing external information; assumptions/limitations are []." : "")
    + "\n" + calls.join("\n")
    + "\nSOURCE PROSE FACTS:\n" + JSON.stringify(facts);
}
