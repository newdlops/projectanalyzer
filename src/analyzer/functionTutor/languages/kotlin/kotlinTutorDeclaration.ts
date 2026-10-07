/**
 * Kotlin declaration facts for Function Guide. Explicit inputs, source defaults,
 * and lexical bindings are retained; the program is always symbolic-only and
 * never enters the JavaScript concrete evaluator.
 */
import { createContentHash } from "../../../../shared/hash";
import type { SymbolNode } from "../../../../shared/types";
import type { FunctionLogicAnalysis } from "../../../functionLogic";
import {
  collectKotlinCallables, kotlinNodeRange, kotlinOffsetsRange, parseKotlinSource, setKotlinSyntaxCachePreferredPath,
  type KotlinParameterSyntax
} from "../../../languages/kotlin";
import type {
  FunctionTutorDeclarationAnalysis, FunctionTutorEvidence, FunctionTutorGap,
  FunctionTutorParameterFact
} from "../../types";
import { createKotlinTutorProgram, collectKotlinParameterConstraints } from "./kotlinTutorProgram";
import { kotlinParameterTypeKind, readKotlinDefault } from "./kotlinLiteralFacts";

/** Builds a source declaration and symbolic program from the selected Kotlin snapshot. */
export function analyzeKotlinTutorDeclaration(functionNode: SymbolNode, sourceText: string,
  functionLogic: FunctionLogicAnalysis): FunctionTutorDeclarationAnalysis {
  setKotlinSyntaxCachePreferredPath(functionNode.filePath);
  const source = parseKotlinSource(sourceText, functionNode.filePath);
  const callable = collectKotlinCallables(source).filter((candidate) => candidate.name === functionNode.name)
    .map((candidate) => {
      const position = kotlinOffsetsRange(source, candidate.selectionFrom, candidate.selectionTo);
      return { candidate, distance: Math.abs(position.startLine - functionNode.selectionRange.startLine) * 10000
        + Math.abs(position.startCharacter - functionNode.selectionRange.startCharacter) };
    }).sort((left, right) => left.distance - right.distance)[0]?.candidate;
  const gaps: FunctionTutorGap[] = [{ kind: "language-support",
    summary: "Kotlin scenarios are symbolic-only. Source branches, calls, writes, and exits are shown; Kotlin arithmetic, overloads, receiver behavior, and external outcomes are not evaluated." }];
  if (!callable) gaps.push({ kind: "missing-source", summary: "The Kotlin declaration could not be matched to the current source snapshot." });
  if (callable?.suspend) gaps.push({ kind: "language-support", summary: "This suspend declaration is source-visible; coroutine scheduling and suspension outcomes are unknown." });
  if (source.diagnostics.some((diagnostic) => !callable || (diagnostic.from <= callable.node.to && diagnostic.to >= callable.node.from))) {
    gaps.push({ kind: "language-support", summary: "Kotlin syntax recovery or a parser resource limit makes this declaration partial." });
  }
  const parameters = (callable?.parameters ?? []).map((parameter, index) => createParameterFact(parameter, index,
    functionNode, functionLogic, kotlinNodeRange(source, parameter.node)));
  for (const parameter of parameters) gaps.push(...parameter.gaps);
  const constraints = collectKotlinParameterConstraints(functionLogic, parameters);
  const program = createKotlinTutorProgram(source, functionLogic, parameters, gaps);
  return { functionNode, language: "kotlin", executionKind: "sync", returnTypeText: callable?.returnTypeText, parameters, constraints, program, gaps };
}

/** Nullable types allow null values; only a declared default allows an omitted argument. */
function createParameterFact(parameter: KotlinParameterSyntax, index: number, node: SymbolNode,
  logic: FunctionLogicAnalysis, range: FunctionTutorEvidence["range"]): FunctionTutorParameterFact {
  const id = `kotlin-parameter:${createContentHash(`${node.id}:${index}:${parameter.name}`).slice(0, 24)}`;
  const binding = logic.valueBindings?.find((candidate) => candidate.kind === "parameter" && candidate.name === parameter.name);
  const defaultValue = readKotlinDefault(parameter.defaultText);
  const typeKind = kotlinParameterTypeKind(parameter.typeText);
  const declarationEvidence: FunctionTutorEvidence[] = [];
  const gaps: FunctionTutorGap[] = [];
  if (parameter.typeText) declarationEvidence.push({ kind: "parameter-type", certainty: "exact", filePath: node.filePath,
    range, summary: `Declared Kotlin type: ${parameter.typeText}. Nullable is distinct from argument omission.` });
  if (parameter.defaultText !== undefined) declarationEvidence.push({ kind: "parameter-default", certainty: "exact",
    filePath: node.filePath, range, summary: `Source-authored default: ${parameter.defaultText.slice(0, 240)}.` });
  if (defaultValue?.kind === "unknown") gaps.push({ kind: "unsupported-parameter", parameterId: id,
    summary: `The default for ${parameter.name} is not a safe source literal; its Kotlin value is unknown.` });
  if (typeKind === "unknown") gaps.push({ kind: "unsupported-parameter", parameterId: id,
    summary: `No runtime type model is available for the declared Kotlin input ${parameter.name}.` });
  return { id, bindingId: binding?.id, name: parameter.name, index,
    callingMode: parameter.vararg ? "rest-positional" : "positional", typeKind, typeText: parameter.typeText,
    optional: parameter.defaultText !== undefined, rest: parameter.vararg === true, defaultValue,
    literalValues: /\?\s*$/u.test(parameter.typeText ?? "") ? [{ kind: "null" }] : [],
    memberFacts: [], declarationEvidence, gaps };
}
