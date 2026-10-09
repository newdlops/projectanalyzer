/** Source-issued reaching conditions do not require generative reasoning or become observed execution. */
import type { FunctionCallNarrativeTarget } from "./types";
import { isFunctionCallNarrativeTextLanguage } from "./validation";

/** Preserve every guard/loop, dispatch uncertainty and deferred boundary; long facts retain the model contract. */
export function getFunctionCallFixedReason(target: FunctionCallNarrativeTarget, language: "ko" | "en"): string | undefined {
  const ko = language === "ko";
  const facts: string[] = [];
  if (target.guards.length) facts.push((ko ? "제공된 조건: " : "Supplied conditions: ")
    + target.guards.map(guard => `\`${guard.expression}\` → ${guard.outcome}`).join(", ") + ".");
  if (target.loops.length) facts.push((ko ? "반복 범위: " : "Loop scope: ") + target.loops.map(loop => `\`${loop}\``).join(", ") + ".");
  if (!facts.length) facts.push(ko ? "제공된 호출 관계에 추가 조건·반복 범위가 없습니다." : "No additional condition or loop is supplied for this relationship.");
  if (target.deferred || target.relation !== "call") facts.push(ko ? "등록·렌더 경계이며 즉시 실행을 뜻하지 않습니다." : "A registration/render boundary does not establish immediate execution.");
  else facts.push(ko ? "정적 관계이며 실제 도달·실행은 관찰하지 않았습니다." : "This is a static relationship, not an observed reach or execution.");
  if (target.confidence !== "exact" || target.sourceKind === "method") facts.push(ko ? "실제 대상 dispatch는 미확인입니다." : "Actual target dispatch is unverified.");
  const text = facts.join(" ");
  return text.length <= 180 && !/[\x00-\x1F\x7F]/u.test(text)
    && isFunctionCallNarrativeTextLanguage(text, language) ? text : undefined;
}
