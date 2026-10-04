/** Selects the innermost executable Kotlin declaration using UTF-16 source spans. */
import type { FunctionCursorTarget, FunctionCursorTargetInput } from "../../types";
import {
  collectKotlinCallables, kotlinNodeRange, kotlinOffsetsRange,
  kotlinPositionOffset, parseKotlinSource, setKotlinSyntaxCachePreferredPath
} from "../../../languages/kotlin";

/** Resolves dirty editor text without executing Kotlin or entering lambda bodies. */
export function findKotlinFunctionAtPosition(input: FunctionCursorTargetInput): FunctionCursorTarget | undefined {
  if (input.languageId.toLowerCase() !== "kotlin" && !/\.kts?$/iu.test(input.filePath)) return undefined;
  setKotlinSyntaxCachePreferredPath(input.filePath);
  const source = parseKotlinSource(input.sourceText, input.filePath);
  const offset = kotlinPositionOffset(source, input.position);
  const selected = collectKotlinCallables(source)
    .filter((callable) => callable.node.from <= offset && offset <= callable.node.to)
    .sort((left, right) => (left.node.to - left.node.from) - (right.node.to - right.node.from)
      || right.qualifiedName.split(".").length - left.qualifiedName.split(".").length)[0];
  if (!selected) return undefined;
  return {
    kind: selected.kind, name: selected.name, qualifiedName: selected.qualifiedName,
    filePath: input.filePath, language: "kotlin", anonymous: false,
    range: kotlinNodeRange(source, selected.node),
    selectionRange: kotlinOffsetsRange(source, selected.selectionFrom, selected.selectionTo)
  };
}
