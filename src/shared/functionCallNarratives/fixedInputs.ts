/** Static empty lists and checked formal bindings prevent invented caller-to-callee transfers; long/unknown facts stay with the model. */
import type { FunctionCallNarrativeTarget } from "./types";
/** Source-authored nonprimitive type names stay code, including names in a different prose language. */
export function formatFunctionCallDeclaredType(type: string): string {
  return /^(?:number|boolean|string|Int|Double|Boolean|String)$/u.test(type) ? type : "`" + type + "`";
}
export function getFunctionCallFixedInputs(target: FunctionCallNarrativeTarget, language: "ko" | "en"): string | undefined {
  if (target.arguments?.length === 0) return language === "ko" ? "명시적으로 전달하는 인자가 없습니다." : "No arguments are passed explicitly.";
  if (!target.arguments?.length || !target.parameters || target.parameters.length !== target.arguments.length) return;
  const transfers = target.parameters.map((parameter, index) => "`" + target.arguments![index] + "` → `" + parameter.name + "` (" + formatFunctionCallDeclaredType(parameter.type) + ")");
  const conditional = target.confidence === "inferred" ? language === "ko" ? "이 후보가 실제 대상이라면, " : "If this candidate is selected, " : "";
  const text = conditional + (language === "ko" ? "인자 전달: " : "Argument transfer: ") + transfers.join(", ") + ".";
  return text.length <= 180 && !/[\x00-\x08\x0B\x0C\x0E-\x1F]/u.test(text) ? text : undefined;
}
