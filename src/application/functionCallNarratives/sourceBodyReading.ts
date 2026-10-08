/** Locale prose for independently proved callee paths; retains every symbolic step and condition without evaluating values. */
import type { FunctionCallSourceFacts, FunctionCallSourceBodyStep } from "../../analyzer/functionCalls";

const condition = (step: FunctionCallSourceBodyStep) => "`" + step.source + "` = " + step.outcome;
const code = (source: string) => "`" + source + "`";

/** Factor only identical source-owned prefix steps; every alternative's remaining steps stay explicit and ordered. */
export function renderFunctionCallSourceBody(facts: FunctionCallSourceFacts, ko: boolean): string {
  const paths = facts.bodyPaths;
  if (!paths) return code(facts.returnExpression);
  const callValues = paths.some(path => path.some(step => step.kind !== "call" && step.calls?.length));
  let common = 0;
  while (common < paths[0].length && paths.every(path => path[common]?.key === paths[0][common].key
    && path[common]?.outcome === paths[0][common].outcome)) common++;
  const render = (steps: FunctionCallSourceBodyStep[]) => steps.map(step => step.kind === "condition" ? condition(step)
    : step.kind === "return" ? (ko ? "반환 " : "return ") + code(step.source)
      : step.kind === "call" ? (ko ? "호출 " : "call ") + code(step.source) + (ko ? " (내부 미확인; 정상 복귀·지역 값 유지 가정)" : " (body unreviewed; assume normal return/local preservation)")
        : code(step.source)).join(" → ");
  const prefix = render(paths[0].slice(0, common));
  const body = paths.length === 1 ? prefix : (prefix ? prefix + " → " : "") + "[" + paths.map(path => render(path.slice(common))).join("; ") + "]";
  return body + (callValues ? ko ? " (호출 결과 타입·값·효과 미확인; 정상 복귀·지역 값 유지 가정)"
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
  const seen = new Set<string>(), changes: string[] = [], calls: string[] = [];
  const callValues = facts.bodyPaths.some(path => path.some(step => step.kind !== "call" && step.calls?.length));
  for (const path of facts.bodyPaths) {
    const guards: string[] = [];
    for (const step of path) {
      if (["change", "call"].includes(step.kind) || step.calls?.length) {
        const key = JSON.stringify([step.key, guards]);
        if (!seen.has(key)) {
          seen.add(key); (step.kind === "change" ? changes : calls).push((guards.length ? guards.join(" & ") + ": " : "") + code(step.source));
        }
      }
      // Calling a predicate precedes its outcome; only earlier path guards
      // qualify that invocation, never the decision it is about to produce.
      if (step.kind === "condition") guards.push(condition(step));
    }
  }
  const local = changes.length ? (ko ? "지역 변경: " : "Local changes: ") + changes.join("; ") + ". " : "";
  if (calls.length || callValues) return local + (calls.length ? (callValues ? ko ? "호출 포함 식: " : "Call expressions: " : ko ? "호출: " : "Calls: ") + calls.join("; ") + ". " : "")
    + (callValues ? ko ? "호출 내부·결과 타입/값·외부 효과 미확인; 정상 복귀·지역 값 유지 가정."
      : "Call bodies/results/types/effects unreviewed; assume normal return/local preservation."
      : ko ? "내부 구현·외부 효과 미확인; 정상 복귀·지역 값 유지 가정." : "Bodies/effects unreviewed; assume normal return/local preservation.");
  return changes.length ? local + (ko ? "명시적 외부 쓰기·다른 호출 없음; 실제 효과 미관찰." : "No explicit external writes/calls; effects unobserved.") : undefined;
}
