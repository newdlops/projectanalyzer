/** Static empty-argument wording prevents a model from inventing caller-to-callee transfers. */
import type { FunctionCallNarrativeTarget } from "./types";
export function getFunctionCallFixedInputs(target: FunctionCallNarrativeTarget, language: "ko" | "en"): string | undefined {
  return target.arguments?.length === 0 ? language === "ko" ? "명시적으로 전달하는 인자가 없습니다." : "No arguments are passed explicitly." : undefined;
}
