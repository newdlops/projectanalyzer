/** Reusable worked-example teaching and source numbering for concrete, statement-level code explanations. */
import type { FunctionNarrativeContext } from "../../shared/functionNarratives";

/** Teaches explanation style without changing weights or treating the example as evidence for the selected function. */
export function buildFunctionNarrativeExplanationGuidance(language: "ko" | "en"): string {
  return (language === "ko" ? [
    "자세한 해설 규칙: summary는 함수의 목적, 주요 입력의 역할과 남기는 결과를 2~4문장으로 설명하세요.",
    "steps는 실제 구문을 순서대로 읽는 해설입니다. 입력 예시만 나열하거나 함수 이름을 바꿔 말한 단계는 해설이 아닙니다.",
    "각 단계는 1~3문장으로 동작, 분기 판단의 이유, 값이나 상태의 변화와 다음 진행을 설명하세요. source는 그 동작의 정확한 줄로 좁히세요.",
    "when에 구체적인 입력이나 상태를 두고, steps에서 조건이 true/false가 되는 이유와 이후에 어떤 구문을 실행하는지 설명하세요.",
    "시나리오 하나는 입력값 한 세트만 사용하세요. 서로 다른 입력 예시를 합치지 마세요. >와 >=를 구분하고, 경계값에서 >는 false임을 확인하세요. 조기 반환 뒤의 계산은 실행되지 않습니다.",
    "text는 동작, reason은 입력에 근거한 분기 판단과 계산 근거, effect는 값의 변화와 다음 진행을 담습니다. 함수 호출 예시를 step으로 쓰지 마세요.",
    "조기 반환이나 예외는 반환값과 뒤에서 건너뛰는 작업을 명시하세요. 외부 호출의 실제 결과, 확인되지 않은 상태 변화와 실행 횟수는 단정하지 마세요.",
    "해설 예제 (이 예제는 선택한 함수의 소스 근거가 아닙니다): fun gate(active: Boolean): String { if (!active) return \"skip\"; return \"run\" }",
    "부족한 해설: gate(false)를 호출한다. 좋은 해설: active=false이면 !active는 true다. 첫 반환문에서 skip을 돌려주므로 뒤의 run 반환은 실행하지 않는다.",
    '좋은 step JSON: {"text":"!active 조건을 검사한다.","reason":"active=false이므로 !active는 true다.","effect":"skip을 즉시 반환한다. 뒤의 run 반환문은 건너뛴다.","source":{"snippetId":"example","startLine":1,"endLine":1}}',
    "예제의 식별자나 값을 답변에 복사하지 말고, 같은 설명 방식으로 SOURCE DATA의 선택한 함수만 해설하세요. 의미 없이 단계를 늘리지 마세요."
  ] : [
    "Detailed explanation rules: use 2-4 sentences in summary for purpose, the roles of key inputs and the result or effect.",
    "Steps explain actual statements in source order. An input example alone or a paraphrase of the function name is not an explanation.",
    "Use 1-3 sentences per step to describe the operation, why a branch decision follows, value/state changes and what happens next. Cite the narrow lines of that operation.",
    "Put concrete inputs or state in when. In steps explain why a condition is true/false and which subsequent statements run.",
    "Each scenario uses one fixed input set. Do not combine different input examples. Distinguish > from >=; equality makes > false. Calculations after an early return are skipped.",
    "text names the operation, reason derives the branch decision/calculation from the inputs, and effect explains value changes and next work. A function-call example is not a step.",
    "For an early return or exception, describe the returned value and the later work skipped. Do not assert unknown external outcomes, state changes or iteration counts.",
    'Worked explanation example (not source evidence for the selected function): fun gate(active: Boolean): String { if (!active) return "skip"; return "run" }',
    "Weak: call gate(false). Better: active=false makes !active true. The first return produces skip, so the later return of run is skipped.",
    'Good step JSON: {"text":"Test !active.","reason":"active=false makes !active true.","effect":"Return skip immediately; the later return of run is skipped.","source":{"snippetId":"example","startLine":1,"endLine":1}}',
    "Apply this style only to the selected function in SOURCE DATA. Do not copy example identifiers or values into the response. Do not add meaningless steps."
  ]).join("\n");
}

/** Adds original one-based line labels to a copy; source excerpt ownership remains unchanged. */
export function numberFunctionNarrativeContext(context: FunctionNarrativeContext): FunctionNarrativeContext {
  return { ...context, snippets: context.snippets.map((snippet) => ({ ...snippet,
    text: snippet.text.split("\n").map((line, index) => `${snippet.startLine + index}: ${line}`).join("\n") })) };
}
