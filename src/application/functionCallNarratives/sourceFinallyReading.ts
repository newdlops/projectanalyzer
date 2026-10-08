/** Cleanup prose retains saved-return ordering and unknown effects/throws; source descriptions never execute try/finally. */
import type { FunctionCallSourceFacts } from "../../analyzer/functionCalls";

const code = (source: string) => "`" + source + "`";
const cleanup = (facts: FunctionCallSourceFacts) => facts.finalizers!.map(step => code(step.source)).join(" → ");

/** Every cleanup statement is preserved; normal return is conditional on both expression evaluation and cleanup completion. */
export function renderFunctionCallFinallyBody(facts: FunctionCallSourceFacts, ko: boolean, compact: boolean): string | undefined {
  if (!facts.finalizers?.length) return;
  const expression = code(facts.returnExpression), calls = cleanup(facts);
  if (compact && !ko) return `Save ${expression} in try → finally ${calls} → return saved result if normal (values/effects/throws unknown)`;
  return ko ? `try에서 ${expression} 평가·보관 → finally ${calls} → 정상 완료 시 보관 결과 반환`
    + (compact ? " (값/상태·효과·예외 미확인)" : " (finally는 try를 벗어날 때 수행; 값/참조 상태·호출 내부/효과·예외 미확인)")
    : `Evaluate/save ${expression} in try → finally ${calls} → return saved result on normal completion`
      + (compact ? " (values/effects/throws unknown)" : " (finally runs when leaving try; values/reference state, call bodies/effects/throws unknown)");
}

/** Explains the saved source expression, without claiming a cleanup call always completes or cannot replace the return with a throw. */
export function renderFunctionCallFinallyOutput(facts: FunctionCallSourceFacts, ko: boolean): string | undefined {
  if (!facts.finalizers?.length) return;
  const use = facts.use.kind === "return" ? ko ? "부모에서 반환" : "return from parent"
    : facts.use.kind === "binding" ? ko ? `지역 ${code(facts.use.name!)}에 저장` : `store in local ${code(facts.use.name!)}`
      : ko ? "이 호출부에서 버림" : "discard at this callsite";
  return ko ? `반환식 ${code(facts.returnExpression)}을 먼저 평가·보관합니다. finally가 정상 완료하면 보관 결과를 ${use}합니다. 값/상태·정리 효과·예외는 미확인입니다.`
    : `Save source ${code(facts.returnExpression)} before finally; if it completes normally, ${use}. Values/state, cleanup effects/throws unknown.`;
}

/** All cleanup expressions retain authored arguments, repeated occurrences and source order, without inventing logging/storage meaning. */
export function renderFunctionCallFinallyEffects(facts: FunctionCallSourceFacts, ko: boolean): string | undefined {
  if (!facts.finalizers?.length) return;
  return (ko ? "try 이탈 시 finally: " : "On leaving try, finally: ") + cleanup(facts)
    + (ko ? ". 호출 내부·값/참조 상태·효과·예외 미확인. 정상 완료해야 보관 결과를 반환합니다."
      : ". Bodies/values/reference state/effects/throws unknown; normal completion required.");
}
