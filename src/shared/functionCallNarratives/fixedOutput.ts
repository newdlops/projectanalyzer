/** Compact owned source-return syntax prevents omitted catch operands; semantic interpretation remains a model responsibility. */
import type { FunctionCallNarrativeTarget } from "./types";
import { isFunctionCallNarrativeTextLanguage } from "./validation";
import { formatFunctionCallSyntaxSite } from "./syntaxText";

/** Preserve every lexical site and exact caller use; never compute a result or claim which abrupt return completes. */
export function getFunctionCallFixedOutput(target: FunctionCallNarrativeTarget, language: "ko" | "en"): string | undefined {
  const syntax = target.returnSyntax, use = target.resultUse;
  if (!syntax || syntax.limited || !syntax.syntaxOnly || !syntax.sites.length || !use || target.deferred || target.relation !== "call") return;
  const ko = language === "ko";
  const sites = syntax.sites.map(site => formatFunctionCallSyntaxSite(site.code, site.regions)).join("; ");
  const callerUse = use.kind === "return" ? ko ? "정상 복귀 시 부모가 " + (use.awaited ? "await한 결과를 " : "호출 결과를 ") + "반환합니다."
    : "On normal completion, the parent returns the " + (use.awaited ? "awaited " : "call ") + "result."
    : use.kind === "binding" && use.name ? ko ? `정상 복귀 시 ${use.awaited ? "await한 결과를 " : ""}지역 \`${use.name}\`에 저장합니다.`
      : `On normal completion, store the ${use.awaited ? "awaited " : ""}result in local \`${use.name}\`.`
      : use.kind === "discard" ? ko ? `이 호출부는 ${use.awaited ? "await한 " : ""}결과를 저장·반환하지 않습니다.`
        : `This callsite discards the ${use.awaited ? "awaited " : ""}result.`
        : undefined;
  if (!callerUse) return;
  const prefix = target.confidence !== "exact" || target.sourceKind === "method" ? ko ? "후보 원문 반환: " : "Candidate source returns: " : ko ? "원문 반환: " : "Source returns: ";
  const text = prefix + sites + ". " + callerUse + (ko ? " 실제 최종 값·완료는 미확인입니다." : " Final values/completion are unknown.");
  return text.length <= 180 && !/[\x00-\x1F\x7F]/u.test(text)
    && isFunctionCallNarrativeTextLanguage(text, language) ? text : undefined;
}
