/**
 * Public Function Logic language dispatcher. Each parser adapter owns source
 * semantics while downstream graph projection consumes one stable analysis type.
 */

import type {
  FunctionLogicAnalysis,
  FunctionLogicAnalysisInput
} from "./types";
import { analyzeJavaFunctionLogic } from "./languages/java/javaFunctionLogicAnalyzer";
import { analyzePythonFunctionLogic } from "./languages/python/pythonFunctionLogicAnalyzer";
import { analyzeFunctionLogic as analyzeTypeScriptFunctionLogic } from "./typescriptFunctionLogicAnalyzer";

/** Dispatches one concrete callable to its language-specific logic analyzer. */
export function analyzeFunctionLogic(
  input: FunctionLogicAnalysisInput
): FunctionLogicAnalysis {
  const language = input.functionNode.language.toLowerCase();
  const extension = input.functionNode.filePath.split(".").at(-1)?.toLowerCase();
  if (language === "python" || extension === "py") {
    return analyzePythonFunctionLogic(input);
  }
  if (language === "java" || extension === "java") {
    return analyzeJavaFunctionLogic(input);
  }
  return analyzeTypeScriptFunctionLogic(input);
}
