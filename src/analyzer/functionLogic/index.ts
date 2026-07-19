/** Public analyzer surface for function-local structured control flow. */

export { analyzeFunctionLogic } from "./typescriptFunctionLogicAnalyzer";
export type {
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
