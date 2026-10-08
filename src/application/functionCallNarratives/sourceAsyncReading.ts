/** Source-only Promise/suspend wording preserves invocation, settlement and caller use as distinct facts. */
import type { FunctionCallSourceFacts } from "../../analyzer/functionCalls";

/** Return expressions describe a successful completion contract, never a computed synchronous call result. */
export function renderFunctionCallAsyncOutput(facts: FunctionCallSourceFacts, expression: string, ko: boolean): string | undefined {
  if (!facts.execution && !facts.callerExecution && !facts.use.awaited) return;
  // A synchronous call inside an async parent still has its own immediate
  // storage/discard use; the parent's eventual return is a separate contract.
  if (!facts.execution && !facts.use.awaited && facts.use.kind !== "return") return;
  const use = facts.use.kind === "binding" ? ko ? `지역 \`${facts.use.name}\`에 저장` : `store in local \`${facts.use.name}\``
    : facts.use.kind === "discard" ? ko ? "저장·반환 없이 버림" : "discard without storage or return"
      : facts.callerExecution === "promise" ? ko ? "부모 Promise로 전달" : "pass to the parent Promise"
        : ko ? "부모에서 반환" : "return from the parent";
  if (facts.execution === "promise" && !facts.use.awaited) return ko
    ? `Promise를 ${use}합니다. 성공 이행의 반환 원문: ${expression}. 값·이행/거부·시점은 미확인입니다.`
    : `Promise: ${use}. Source on fulfillment: ${expression}. Values/settlement/timing unknown.`;
  const contract = facts.execution === "suspend" || facts.callerExecution === "suspend" ? ko ? "suspend 정상 완료" : "suspend completion"
    : facts.use.awaited ? ko ? "await 성공 이행" : "await fulfillment" : ko ? "부모 Promise 성공 이행" : "parent Promise fulfillment";
  return ko ? `${contract} 가정에서 원문 ${expression}을 ${use}합니다. 값·중단/거부/취소·시점은 미확인입니다.`
    : `Assume ${contract}: use source ${expression}; ${use}. Values/wait/throw/cancel/timing unknown.`;
}

/** All authored operations remain visible; completion/effects are qualified once to retain existing prose budgets. */
export function renderFunctionCallAsyncEffects(facts: FunctionCallSourceFacts, sourceOperations: string, ko: boolean): string | undefined {
  if (!facts.execution && !facts.callerExecution && !facts.use.awaited) return;
  const reads = facts.callerReads?.expressions.map(read => "`" + read + "`").join(", ");
  const operations = sourceOperations || "`" + facts.returnExpression + "`";
  return (reads ? ko ? `호출부 ${reads}; ` : `Caller ${reads}; ` : "") + (ko ? `원문 ${operations}. ` : `${operations}. `)
    + (ko ? "값/연산자·getter/디스패치·상태/효과·대기/거부/취소/재개 미확인; 정상 완료 가정."
      : "Values/ops/getters/dispatch/state/effects/wait/throw/cancel/resume unknown; completion assumed.");
}

/** A compact body label never substitutes async completion for synchronous primitive proof. */
export function renderFunctionCallAsyncContract(facts: FunctionCallSourceFacts, ko: boolean, compact = false): string | undefined {
  if (compact && facts.execution) return (facts.execution === "promise" ? "Promise" : "suspend") + (ko
    ? facts.execution === "promise" ? "; 성공 이행 가정·결과/효과 미확인" : "; 정상 완료 가정·결과/효과 미확인"
    : facts.execution === "promise" ? "; fulfillment assumed; results/effects unknown" : "; completion assumed; results/effects unknown");
  return facts.execution === "promise" ? ko ? "Promise; 성공 이행 가정·내부 동작/거부/결과/시점/효과 미확인"
    : "Promise; fulfillment assumed; inner bodies/reject/results/time/effects unknown"
    : facts.execution === "suspend" ? ko ? "suspend; 정상 완료 가정·중단/재개/취소/결과/시점/효과 미확인"
      : "suspend; completion assumed; inner bodies/wait/resume/cancel/outcome/time/effects unknown" : undefined;
}
