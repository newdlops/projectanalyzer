/** Preserve every explicit source write/call while keeping runtime state, I/O and completion unknown. */
import type { FunctionCallNarrativeTarget } from "./types";
import { formatFunctionCallSyntaxSite } from "./syntaxText";
import { isFunctionCallNarrativeTextLanguage } from "./validation";

/** Complete lexical syntax may own a compact field; omitted/long/deferred evidence retains model generation without truncation. */
export function getFunctionCallFixedEffects(target: FunctionCallNarrativeTarget, language: "ko" | "en"): string | undefined {
  const syntax = target.effectSyntax;
  if (!syntax || !syntax.syntaxOnly || syntax.limited || target.deferred || target.relation !== "call") return;
  const ko = language === "ko", candidate = target.confidence !== "exact" || target.sourceKind === "method";
  const prefix = candidate ? ko ? "후보 원문 구문: " : "Candidate source syntax: " : ko ? "원문 구문: " : "Source syntax: ";
  const sites = syntax.sites.map(site => (site.kind === "write" ? ko ? "쓰기 " : "write " : ko ? "호출 " : "call ")
    + formatFunctionCallSyntaxSite(site.code, site.regions)).join("; ");
  const text = syntax.sites.length ? prefix + sites + (ko ? ". 어휘적 구문 순서이며 실행 순서·실제 효과·완료는 미확인입니다."
    : ". Lexical syntax only; execution order, effects/completion are unknown.")
    : prefix + (ko ? "명시적 쓰기·호출 구문이 없습니다. 암묵적 효과·실제 완료는 미확인입니다."
      : "No explicit write/call syntax. Implicit effects/actual completion are unknown.");
  return text.length <= 180 && !/[\x00-\x1F\x7F]/u.test(text) && isFunctionCallNarrativeTextLanguage(text, language) ? text : undefined;
}
