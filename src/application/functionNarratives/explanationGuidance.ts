/** Shared prose guidance and source numbering for concrete, statement-level explanations. */
import type { FunctionNarrativeContext } from "../../shared/functionNarratives";

/** A source gap may yield no ordered operations; keep its declaration evidence without manufacturing a statement. */
export function buildFunctionNarrativeEmptyRouteGuidance(context: FunctionNarrativeContext, language: "ko" | "en"): string {
  if (!context.sourceFlow?.paths.some(path => !path.steps.length)) return "";
  return language === "ko"
    ? "소스 단계가 비어 있는 경로: steps에는 code 필드를 넣지 마세요. 고정 SOURCE FRAME의 함수 선언 근거를 인용하고 확인된 동작 순서가 없음을 설명하세요. partial 경로의 분기·계산·반환을 만들지 말고 exampleResult는 null로 유지하세요. source-terminal은 구문 없는 암시적 종료이며 실행 관찰이 아닙니다."
    : "STEP-LESS SOURCE ROUTES: omit code from steps. Cite the fixed SOURCE FRAME's owned function declaration and explain that no ordered operations are available. Never invent branches, calculations or returns for a partial route; retain null exampleResult. A source-terminal route with no operations is an implicit end, not an execution observation.";
}

/** Rich tasks distinguish language semantics, concrete causality and nearby alternatives without extra inference. */
export function buildFunctionNarrativeRichGuidance(language: "ko" | "en"): string {
  return (language === "ko" ? [
    "상세 읽기: explanation은 이 한 입력을 시작으로 소스 순서의 조건·계산·호출·반환을 이어 설명합니다. 같은 말을 필드마다 반복하지 마세요.",
    "analysis.pathReason은 이전 조건들까지 함께 만족하는 이유입니다. example 입력을 실제 식에 대입해 비교 결과를 설명하세요. analysis.stateChange는 실제로 도달한 변수 변경·호출·반환과 건너뛴 작업을 순서대로 설명하고, 관찰하지 않은 외부 상태 변화는 미확인으로 남깁니다.",
    "analysis.alternative는 소스에 있는 조건 하나가 달라질 때 어느 분기로 바뀌는지 설명합니다. 비교 경계의 포함/제외, null 여부, Boolean 선택 등 실제 코드의 차이를 짚고 새 조건·업무 규칙을 만들지 마세요. 분기가 없으면 분기 없음과 입력이 계산에 미치는 영향을 설명하세요.",
    "각 step의 syntax는 복사한 code의 언어 의미를 설명합니다. 현재 코드에 있는 연산자, 단락 평가, 선언/재할당, Kotlin의 ?. / ?: / val / var / return 같은 문법만 설명하고 모든 문법을 나열하지 마세요. loweredPredicate는 원문이 아닌 분석기가 낮춘 조건입니다. 예를 들어 Elvis 분기는 원래 구문과 분석 조건을 구분해 읽습니다.",
    "reason은 참이므로 참이라는 반복이 아니라 같은 입력값을 대입한 판단·계산 근거입니다. effect는 해당 구문 직후 바뀐 값과 다음 동작만 설명하세요. 조건 노드에서 아직 실행하지 않은 반환/대입을 완료된 변화로 쓰지 마세요.",
    "nodeTask.reading.priorState는 앞 노드의 모델 예시 after 값입니다. 실행 관찰이 아닙니다. 현재 소스와 원래 입력을 확인해 이 상태를 이어 계산하고 값이 미확인이면 미확인을 유지하세요. nodeTask.example은 경로 전체에서 바꾸지 마세요.",
    "반복 경로는 보이는 방문만 설명하고 임의의 반복 횟수를 만들지 마세요. partial 경로는 확인된 접두부까지만 설명하며 반환·외부 호출 결과를 지어내지 마세요. 가정과 생략/미확인 정보는 명시하세요."
  ] : [
    "Rich reading: explanation follows this single input set through source-ordered decisions, calculations, calls and termination. Do not repeat the same sentence in every field.",
    "analysis.pathReason substitutes the actual example inputs into the predicates and includes the earlier conditions that make this path possible. analysis.stateChange explains reached writes/calls/return and skipped work in order; unknown external state remains unknown.",
    "analysis.alternative explains which source branch changes when one actual predicate changes. Discuss inclusive/exclusive boundaries, nullability or Boolean choices only when evidenced. Do not invent rules. With no branch, explain the absence of branching and how inputs affect the calculation.",
    "Every step's syntax explains its copied code: the actual operators, short circuit, declaration/reassignment or Kotlin ?. / ?: / val / var / return only when present. loweredPredicate is an analyzer-lowered condition, not verbatim source; distinguish that choice from the original syntax. Do not give a generic tutorial.",
    "reason derives the comparison/calculation using the same concrete values, rather than saying true because true. effect describes values immediately after THIS operation and the next work; a condition node must not claim a later return or assignment already happened.",
    "nodeTask.reading.priorState contains earlier MODEL example after-values, not observations. Continue from them using the source and original inputs; keep unknown values unknown. Do not change nodeTask.example across the route.",
    "Describe retained loop visits without inventing iteration counts. A partial route ends at its known prefix; never invent a return or external outcome. State unverified assumptions and missing information."
  ]).join("\n");
}

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
  const { scenarioGraph: _hostGraph, sourceWorksheet: _hostWorksheet, sourceCallReadings: _callProof, sourceCallFlowProof: _callFlowProof, ...batch } = context;
  const cleanStep = ({ graphNodeId: _id, graphOccurrence: _visit, ...step }: NonNullable<FunctionNarrativeContext["sourceFlow"]>["paths"][number]["steps"][number]) => step;
  return { ...batch,
    ...(context.summaryTask ? { summaryTask: (({ sourceAlternative: _sourceProof, sourceFunctionPurpose: _sourcePurpose, knownModelName: _producer, ...task }) => task)(context.summaryTask) } : {}),
    ...(context.sourceFlow ? { sourceFlow: { ...context.sourceFlow, paths: context.sourceFlow.paths.map(({ graph: _identities, ...path }) => ({ ...path, steps: path.steps.map(cleanStep) })) } } : {}),
    ...(context.nodeTask ? { nodeTask: { ...context.nodeTask, targets: context.nodeTask.targets.map(cleanStep) } } : {}),
    snippets: context.snippets.map((snippet) => ({ ...snippet,
    text: snippet.text.split("\n").map((line, index) => `${snippet.startLine + index}: ${line}`).join("\n") })) };
}
