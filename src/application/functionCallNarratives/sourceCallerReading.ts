/** Caller-owned source reads remain separate from callee facts; no argument/receiver value or runtime effect is evaluated. */
import type { FunctionCallSourceFacts } from "../../analyzer/functionCalls";

/** Preserve repeated access occurrences instead of assuming getters return a stable value. */
export function renderFunctionCallSourceCallerEffects(facts: FunctionCallSourceFacts, calleeEffects: string | undefined, ko: boolean): string | undefined {
  if (!facts.callerReads) return calleeEffects;
  const reads = facts.callerReads.expressions.map(read => "`" + read + "`").join(", ");
  const caller = ko ? `호출부 읽기 ${reads}: 값/타입·연산자/getter·상태/효과 미확인; 정상 완료 가정.`
    : `Caller reads ${reads}: values/operators/getters/state/effects unknown; assume normal completion.`;
  // A pure callee has no source writes/calls, but that never proves its caller's
  // argument evaluation free of getters or external effects.
  const callee = calleeEffects ?? (ko ? "대상: 명시적 쓰기/다른 호출 없음." : "Callee: no explicit writes/calls.");
  return caller + " " + callee;
}
