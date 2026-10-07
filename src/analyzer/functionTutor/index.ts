/** Public static-function-tutor analyzer surface. */

export { analyzeFunctionTutorDeclaration } from "./functionTutorAnalyzer";
export { evaluateFunctionTutorInputs, compileFunctionTutorInputDeclaration } from "./inputEvaluation";
export type { FunctionTutorDecisionObservation, FunctionTutorInputAssignment, FunctionTutorInputEvaluation } from "./inputEvaluation";
export type { FunctionTutorBlockObservation } from "./inputEvaluation/types";
export { createUnavailableFunctionTutorDeclaration } from "./functionTutorUnavailable";
export { analyzeTypeScriptTutorCallsite as analyzeFunctionTutorCallsite } from "./typescriptTutorCallsiteAdapter";
export type {
  FunctionTutorCallsiteInput,
  FunctionTutorCallsiteTuple,
  FunctionTutorCertainty,
  FunctionTutorDeclarationAnalysis,
  FunctionTutorDeclarationInput,
  FunctionTutorDocumentationFact,
  FunctionTutorDocumentationKind,
  FunctionTutorDocumentationTag,
  FunctionTutorEvidence,
  FunctionTutorExpression,
  FunctionTutorGap,
  FunctionTutorOperation,
  FunctionTutorAssignmentTarget,
  FunctionTutorParameterFact,
  FunctionTutorStaticValue
} from "./types";
