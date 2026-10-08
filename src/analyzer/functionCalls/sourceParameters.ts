/** Declaration-only positional input facts for symbolic call reading; never resolves types or constructs runtime values. */
import type { FunctionTutorDeclarationAnalysis } from "../functionTutor";

/** Opaque inputs keep their authored type while overloads, values and runtime identity remain unknown. */
export type FunctionCallDeclaredParameterFacts = {
  parameters: Array<{ name: string; type: string }>;
  opaqueParameters: string[];
};
const primitiveType = /^(?:number|boolean|string|Int|Double|Boolean|String)$/u;
const identifier = /^[\p{L}_$][\p{L}\p{N}_$]*$/u;

/** Accept complete parser-owned declarations, not a type evaluator's ability to invent a representative input. */
export function readFunctionCallSourceDeclaredParameters(analysis: FunctionTutorDeclarationAnalysis,
  options?: { allowBodyGaps?: boolean }): FunctionCallDeclaredParameterFacts | undefined {
  if (analysis.inputSummarySafe === false || analysis.parameters.length > 8) return;
  const parameters: FunctionCallDeclaredParameterFacts["parameters"] = [], opaqueParameters: string[] = [];
  const names = new Set<string>(), allowedTypeGaps = new Set<typeof analysis.gaps[number]>();
  for (const parameter of analysis.parameters) {
    const type = parameter.typeText;
    if (!identifier.test(parameter.name) || parameter.name.length > 64 || names.has(parameter.name)
      || parameter.optional || parameter.rest || parameter.defaultValue !== undefined || parameter.callingMode !== "positional"
      || !type || type.length > 120 || /[\x00-\x1F`]/u.test(type)
      || parameter.typeKind === "callable" || /=>|->/u.test(type)
      || parameter.declarationEvidence.some(evidence => evidence.kind === "parameter-default")
      || !parameter.declarationEvidence.some(evidence => evidence.kind === "parameter-type" && evidence.certainty === "exact"
        && evidence.filePath === analysis.functionNode.filePath)) return;
    // Kotlin reports the lack of a runtime input model on a named type. Its
    // exact declaration is still readable; all other parameter gaps fail closed.
    for (const gap of parameter.gaps) {
      if (analysis.language !== "kotlin" || parameter.typeKind !== "unknown"
        || gap.kind !== "unsupported-parameter" || gap.parameterId !== parameter.id) return;
      allowedTypeGaps.add(gap);
    }
    names.add(parameter.name); parameters.push({ name: parameter.name, type });
    if (!primitiveType.test(type)) opaqueParameters.push(parameter.name);
  }
  // A formal transfer is independent of unrelated body-program gaps. Whole
  // source readings keep the default strict check; parameter gaps never escape it.
  if (analysis.gaps.some(gap => gap.kind !== "language-support" && !allowedTypeGaps.has(gap)
    && (!options?.allowBodyGaps || gap.kind === "unsupported-parameter"))) return;
  return { parameters, opaqueParameters };
}
