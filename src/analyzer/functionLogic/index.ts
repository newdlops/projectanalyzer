/** Public analyzer surface for function-local structured control flow. */

export { analyzeFunctionLogic } from "./functionLogicAnalyzer";
export { findFunctionAtPosition } from "./functionCursorResolver";
export type {
  FunctionCursorPosition,
  FunctionCursorTarget,
  FunctionCursorTargetInput,
  FunctionLogicAnalysis,
  FunctionLogicAnalysisInput,
  FunctionLogicBlock,
  FunctionLogicBlockKind,
  FunctionLogicCallsite,
  FunctionLogicConfidence,
  FunctionLogicEdge,
  FunctionLogicEdgeKind,
  FunctionLogicGap,
  FunctionLogicLanguage,
  FunctionLogicSummary
} from "./types";
export type {
  FunctionLogicValueChange,
  FunctionLogicValueChangeOperation,
  FunctionLogicValueTargetKind
} from "./valueChanges";
