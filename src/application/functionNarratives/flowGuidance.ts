/** Renders bounded syntax routes as readable model input, preserving confidence and source citations. */
import type { FunctionNarrativeContext } from "../../shared/functionNarratives";

/** Keeps source choices and literal value relations explicit in readable model input. */
export function buildFunctionNarrativeFlowGuidance(context: FunctionNarrativeContext, language: "ko" | "en"): string {
  const flow = context.sourceFlow;
  const facts = (context.valueFacts ?? []).map((fact) => {
    const [a, b, c] = fact.operands;
    const calculation = fact.operation === "conditional" ? language === "ko"
      ? `${a}가 true이면 값 ${b}, false이면 값 ${c} 선택` : `choose value ${b} when ${a} is true, value ${c} when false`
      : `${language === "ko" ? ({ add: "+ 연산", subtract: "- 연산", multiply: "* 연산", divide: "/ 연산", modulo: "% 연산" }[fact.operation]) : fact.operation}(${a}, ${b})`;
    return `[${fact.source.snippetId} L${fact.source.startLine}-${fact.source.endLine}] ${fact.target} = ${calculation}`;
  });
  if (!flow?.paths.length && !facts.length) return "";
  const heading = language === "ko" ? "소스 경로 (구문 근거이며 실제 실행·입력 도달 검증이 아님):" : "SOURCE ROUTES (syntax evidence, not execution or input feasibility):";
  const routes = (flow?.paths ?? []).map((path, index) => {
    const lines = path.steps.map((step) => {
      const choice = step.branch ? ` => ${step.branch.outcome}` : "";
      return `  [${step.source.snippetId} L${step.source.startLine}-${step.source.endLine}; ${step.confidence}${step.branch ? "/" + step.branch.confidence : ""}] ${step.code}${choice}`;
    });
    const ending = path.status === "source-terminal" ? language === "ko" ? "이 경로는 여기서 종료. 이후 구문은 이 경로에 포함되지 않음." : "This route ends here; subsequent statements are not on this route."
      : `${language === "ko" ? "여기까지의 부분 경로" : "Partial route only"}: ${path.reason}`;
    return `${language === "ko" ? "경로" : "Route"} ${index + 1} (${path.confidence}):\n${lines.join("\n")}\n  ${ending}`;
  });
  return [heading, ...routes, ...(flow?.limited ? [language === "ko" ? "경로가 제한됨. 도달 가능성과 외부 결과를 단정하지 마세요." : "Routes are limited. Do not assert feasibility or external outcomes."] : []),
    ...(facts.length ? [language === "ko" ? "파서가 확인한 값의 구문 관계:" : "Parser-backed value operations:", ...facts] : [])].join("\n");
}
