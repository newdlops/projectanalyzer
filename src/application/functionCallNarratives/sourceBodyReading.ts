/** Locale prose for independently proved callee paths; retains every symbolic step and condition without evaluating values. */
import type { FunctionCallSourceFacts, FunctionCallSourceBodyStep } from "../../analyzer/functionCalls";

const condition = (step: FunctionCallSourceBodyStep) => "`" + step.source + "` = " + step.outcome;
const code = (source: string) => "`" + source + "`";

/** Factor only identical source-owned prefix steps; every alternative's remaining steps stay explicit and ordered. */
export function renderFunctionCallSourceBody(facts: FunctionCallSourceFacts, ko: boolean): string {
  const paths = facts.bodyPaths;
  if (!paths) return code(facts.returnExpression);
  const callValues = paths.some(path => path.some(step => step.kind !== "call" && step.calls?.length));
  const external = paths.some(path => path.some(step => step.externalReads?.length));
  const opaque = Boolean(facts.opaqueParameters?.length);
  const accesses = facts.methodSource || opaque || external || paths.some(path => path.some(step => step.accesses?.length));
  let common = 0;
  while (common < paths[0].length && paths.every(path => path[common]?.key === paths[0][common].key
    && path[common]?.outcome === paths[0][common].outcome)) common++;
  const render = (steps: FunctionCallSourceBodyStep[]) => steps.map(step => step.kind === "condition" ? condition(step)
    : step.kind === "return" ? (ko ? "반환 " : "return ") + code(step.source)
      : step.kind === "call" ? (ko ? "호출 " : "call ") + code(step.source) + (accesses ? "" : ko ? " (내부 미확인; 정상 복귀·지역 값 유지 가정)" : " (body unreviewed; assume normal return/local preservation)")
        : code(step.source)).join(" → ");
  const prefix = render(paths[0].slice(0, common));
  const body = paths.length === 1 ? prefix : (prefix ? prefix + " → " : "") + "[" + paths.map(path => render(path.slice(common))).join("; ") + "]";
  return body + (facts.methodSource ? ko ? " (후보 원문; 수신자/값·디스패치/getter·상태/효과 미확인; 정상 완료 가정)"
    : " (candidate source; receiver/values/dispatch/getters/state/effects unknown; normal completion assumed)"
    : opaque ? ko ? " (선언 타입만 확인; 입력 값/타입·연산자·상태/효과 미확인; 정상 완료 가정)"
    : " (declared types only; input values/types, operators/state/effects unknown; normal completion assumed)"
    : external ? ko ? " (정상 완료 가정; 외부 값/상태·디스패치·getter·결과/효과 미확인)"
    : " (external values/state/dispatch/getters/effects unknown; normal completion assumed)"
    : accesses ? ko ? " (정상 완료 가정; 디스패치·getter·상태 변화·결과 타입/값·효과 미확인)"
    : " (normal completion assumed; dispatch/getters/state/types/values/effects unknown)"
    : callValues ? ko ? " (호출 결과 타입·값·효과 미확인; 정상 복귀·지역 값 유지 가정)"
    : " (call results/types/effects unreviewed; assume normal return/local preservation)" : "");
}

/** Return alternatives keep their own callee guards, independent of the caller's reaching conditions. */
export function renderFunctionCallSourceReturns(facts: FunctionCallSourceFacts): string {
  return facts.bodyPaths!.map(path => {
    const guards = path.filter(step => step.kind === "condition").map(condition).join(" & ");
    return (guards ? guards + " → " : "") + code(path.find(step => step.kind === "return")!.source);
  }).join("; ");
}

/** Keep conditional local changes and duplicate statement occurrences; a source key prevents accidental text deduplication. */
export function renderFunctionCallSourceEffects(facts: FunctionCallSourceFacts, ko: boolean): string | undefined {
  if (!facts.bodyPaths) return;
  const { changes, calls, operations } = collectSourceOperations(facts);
  const callValues = facts.bodyPaths.some(path => path.some(step => step.kind !== "call" && step.calls?.length));
  const external = facts.bodyPaths.some(path => path.some(step => step.externalReads?.length));
  const opaque = Boolean(facts.opaqueParameters?.length);
  const accesses = opaque || external || facts.bodyPaths.some(path => path.some(step => step.accesses?.length));
  const local = changes.length ? (ko ? "지역 변경: " : "Local changes: ") + changes.join("; ") + ". " : "";
  if (facts.methodSource) return operations.join("; ") + (ko
    ? ". 후보 원문; 수신자/값·연산자/getter·디스패치·상태/효과 미확인; 정상 완료 가정."
    : ". Candidate source; receiver/values/operators/getters/dispatch/state/effects unknown; normal completion assumed.");
  if (opaque) return operations.join("; ") + (ko
    ? ". 선언 타입만 확인; 입력 값/런타임 타입·연산자/디스패치·getter·외부 상태/효과 미확인; 정상 완료 가정."
    : ". Declared types; values/types/operators/getters/dispatch/state/effects unknown; assume normal completion.");
  if (external) return operations.join("; ") + (ko
    ? ". 외부 읽기·디스패치·getter·상태 변화·결과 타입/값·효과 미확인; 정상 완료 가정."
    : ". External reads/dispatch/getters/state/types/values/effects unknown; normal completion assumed.");
  if (accesses) return operations.join("; ") + (ko
    ? ". 디스패치·getter·객체/외부 상태 변화·결과 타입/값·효과 미확인; 정상 완료 가정."
    : ". Dispatch/getters/state/result types/values/effects unknown; normal completion assumed.");
  if (calls.length || callValues) return local + (calls.length ? (callValues ? ko ? "호출 포함 식: " : "Call expressions: " : ko ? "호출: " : "Calls: ") + calls.join("; ") + ". " : "")
    + (callValues ? ko ? "호출 내부·결과 타입/값·외부 효과 미확인; 정상 복귀·지역 값 유지 가정."
      : "Call bodies/results/types/effects unreviewed; assume normal return/local preservation."
      : ko ? "내부 구현·외부 효과 미확인; 정상 복귀·지역 값 유지 가정." : "Bodies/effects unreviewed; assume normal return/local preservation.");
  return changes.length ? local + (ko ? "명시적 외부 쓰기·다른 호출 없음; 실제 효과 미관찰." : "No explicit external writes/calls; effects unobserved.") : undefined;
}

/** All original method operations remain available when caller/callee uncertainty is written once in a bounded field. */
export function renderFunctionCallSourceOperations(facts: FunctionCallSourceFacts): string {
  return collectSourceOperations(facts).operations.join("; ");
}

/** Source keys and earlier guards preserve repeated statements and evaluation before the predicate outcome. */
function collectSourceOperations(facts: FunctionCallSourceFacts): { changes: string[]; calls: string[]; operations: string[] } {
  const seen = new Set<string>(), changes: string[] = [], calls: string[] = [], operations: string[] = [];
  const opaque = Boolean(facts.opaqueParameters?.length);
  if (!facts.bodyPaths) return { changes, calls, operations };
  for (const path of facts.bodyPaths) {
    const guards: string[] = [];
    for (const step of path) {
      if (facts.methodSource || opaque || ["change", "call"].includes(step.kind) || step.calls?.length || step.accesses?.length || step.externalReads?.length) {
        const key = JSON.stringify([step.key, guards]);
        if (!seen.has(key)) {
          const operation = (guards.length ? guards.join(" & ") + ": " : "") + code(step.source);
          seen.add(key); (step.kind === "change" ? changes : calls).push(operation); operations.push(operation);
        }
      }
      // Calling a predicate precedes its outcome; only earlier path guards
      // qualify that invocation, never the decision it is about to produce.
      if (step.kind === "condition") guards.push(condition(step));
    }
  }
  return { changes, calls, operations };
}
