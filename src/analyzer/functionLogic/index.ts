/** Public analyzer surface for function-local structured control flow. */

export { analyzeFunctionLogic } from "./typescriptFunctionLogicAnalyzer";
export { findFunctionAtPosition } from "./typescriptFunctionCursorResolver";
export type {
  FunctionCursorPosition,
  FunctionCursorTarget,
  FunctionCursorTargetInput,
  FunctionLogicAnalysis,
  FunctionLogicAnalysisInput,
  FunctionLogicBlock,
  FunctionLogicBlockKind,
  FunctionLogicConfidence,
  FunctionLogicEdge,
  FunctionLogicEdgeKind,
  FunctionLogicGap,
  FunctionLogicSummary
} from "./types";
