/** Shared prose guidance and source numbering for concrete, statement-level explanations. */
import type { FunctionNarrativeContext } from "../../shared/functionNarratives";

/** Asks for connected prose without unrelated code examples that small models can copy. */
export function buildFunctionNarrativeExplanationGuidance(language: "ko" | "en"): string {
  return (language === "ko" ? [
    "자세한 해설 규칙: summary는 함수의 목적, 주요 입력의 역할과 남기는 결과를 2~4문장으로 설명하세요.",
    "explanation은 각 시나리오를 3~6개의 완전한 문장으로 이어 쓰는 한 문단입니다. 입력 조건부터 분기 판단의 이유, 실제 계산과 값의 변화, 건너뛰는 작업, 반환 결과 순으로 자연스럽게 설명하세요. 제목·항목·불릿을 문단에 넣지 마세요.",
    "steps는 실제 구문을 순서대로 읽는 해설입니다. 입력 예시만 나열하거나 함수 이름을 바꿔 말한 단계는 해설이 아닙니다.",
    "각 단계는 1~3문장으로 동작, 분기 판단의 이유, 값이나 상태의 변화와 다음 진행을 설명하세요. source는 그 동작의 정확한 줄로 좁히세요.",
    "when에 구체적인 입력이나 상태를 두고, steps에서 조건이 true/false가 되는 이유와 이후에 어떤 구문을 실행하는지 설명하세요.",
    "시나리오 하나는 입력값 한 세트만 사용하세요. 서로 다른 입력 예시를 합치지 마세요. >와 >=를 구분하고, 경계값에서 >는 false임을 확인하세요. 조기 반환 뒤의 계산은 실행되지 않습니다.",
    "sourceFlow가 있으면 paths의 각 경로를 별개의 시나리오로 읽으세요. steps.code는 소스 구문, branch.outcome은 그 경로에서 해당 조건의 true/false 선택입니다. 선택과 맞는 입력을 정하고 그 경로의 구문만 설명하세요. source-terminal은 소스 반환/종료에 도달한다는 뜻이며 실행 검증이 아닙니다. partial 경로는 확인된 부분까지만 설명하세요.",
    "valueFacts는 파서가 확인한 값의 구문 관계입니다. 계산식의 연산자와 상수를 그대로 해석하세요. +는 더하기입니다. checkedExamples가 있으면 그 입력·판단·반환값을 그대로 사용하세요. 이는 지원 범위 안의 정적 계산이며 실제 실행 결과가 아닙니다.",
    "text는 동작, reason은 입력에 근거한 분기 판단과 계산 근거, effect는 값의 변화와 다음 진행을 담습니다. 함수 호출 예시를 step으로 쓰지 마세요.",
    "조기 반환이나 예외는 반환값과 뒤에서 건너뛰는 작업을 명시하세요. 외부 호출의 실제 결과, 확인되지 않은 상태 변화와 실행 횟수는 단정하지 마세요.",
    "SOURCE DATA에 있는 식별자와 반환값만 사용하세요. explanation과 소스 근거 steps는 같은 입력과 같은 결과를 설명해야 합니다. 의미 없이 단계를 늘리지 마세요."
  ] : [
    "Detailed explanation rules: use 2-4 sentences in summary for purpose, the roles of key inputs and the result or effect.",
    "explanation is one connected paragraph of 3-6 complete sentences per scenario. Start with inputs, explain each branch decision, concrete calculations and value changes, skipped work, then the returned result. Do not use headings, labels or bullets in the paragraph.",
    "Steps explain actual statements in source order. An input example alone or a paraphrase of the function name is not an explanation.",
    "Use 1-3 sentences per step to describe the operation, why a branch decision follows, value/state changes and what happens next. Cite the narrow lines of that operation.",
    "Put concrete inputs or state in when. In steps explain why a condition is true/false and which subsequent statements run.",
    "Each scenario uses one fixed input set. Do not combine different input examples. Distinguish > from >=; equality makes > false. Calculations after an early return are skipped.",
    "When sourceFlow exists, read each paths route as a separate scenario. steps.code is source syntax; branch.outcome selects true/false for that predicate on this route. Choose matching inputs and explain only statements on that route. source-terminal means reaching a source return/exit, not verified execution. Explain partial routes only through their known prefix.",
    "valueFacts are parser-backed value operations. Preserve their operators and constants: + is addition. Use the exact inputs, decisions and terminal values of checkedExamples when present. These are supported static calculations, not actual execution.",
    "text names the operation, reason derives the branch decision/calculation from the inputs, and effect explains value changes and next work. A function-call example is not a step.",
    "For an early return or exception, describe the returned value and the later work skipped. Do not assert unknown external outcomes, state changes or iteration counts.",
    "Use only identifiers and return values from SOURCE DATA. explanation and the cited steps must describe the same input set and result. Do not add meaningless steps."
  ]).join("\n");
}

/** Adds original one-based line labels to a copy; source excerpt ownership remains unchanged. */
export function numberFunctionNarrativeContext(context: FunctionNarrativeContext): FunctionNarrativeContext {
  // Only this batch's routes belong in the prompt, never the entire Host plan.
  const { scenarioGraph: _hostGraph, ...batch } = context;
  const cleanStep = ({ graphNodeId: _id, graphOccurrence: _visit, ...step }: NonNullable<FunctionNarrativeContext["sourceFlow"]>["paths"][number]["steps"][number]) => step;
  return { ...batch,
    ...(context.sourceFlow ? { sourceFlow: { ...context.sourceFlow, paths: context.sourceFlow.paths.map(({ graph: _identities, ...path }) => ({ ...path, steps: path.steps.map(cleanStep) })) } } : {}),
    ...(context.nodeTask ? { nodeTask: { ...context.nodeTask, targets: context.nodeTask.targets.map(cleanStep) } } : {}),
    snippets: context.snippets.map((snippet) => ({ ...snippet,
    text: snippet.text.split("\n").map((line, index) => `${snippet.startLine + index}: ${line}`).join("\n") })) };
}
