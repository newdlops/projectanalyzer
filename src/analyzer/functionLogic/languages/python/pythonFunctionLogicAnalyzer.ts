/**
 * Python Function Logic public adapter. It composes Python syntax semantics with
 * the shared Lezer orchestration and language-neutral structured CFG builder.
 */

import type {
  FunctionLogicAnalysis,
  FunctionLogicAnalysisInput
} from "../../types";
import {
  analyzeLezerFunctionLogic,
  type LezerFunctionLogicAdapter
} from "../../core/lezerFunctionLogicAnalyzer";
import { parsePythonLezerSource } from "../../../languages/python/pythonLezerSyntax";
import { describePythonControl } from "./pythonFunctionLogicControl";
import {
  classifyPythonStatement,
  collectPythonFunctionCallsites,
  createPythonFunctionLogicGaps,
  findSelectedPythonCallable,
  getPythonRootStatements
} from "./pythonFunctionLogicSyntax";

const PYTHON_FUNCTION_LOGIC_ADAPTER: LezerFunctionLogicAdapter = {
  language: "python",
  findSelectedCallable: findSelectedPythonCallable,
  getRootStatements: getPythonRootStatements,
  classifyStatement: classifyPythonStatement,
  describeControl: describePythonControl,
  collectCallsites: collectPythonFunctionCallsites,
  createDefaultGaps: createPythonFunctionLogicGaps
};

/** Analyzes one selected Python callable against its current source snapshot. */
export function analyzePythonFunctionLogic(
  input: FunctionLogicAnalysisInput
): FunctionLogicAnalysis {
  const source = input.sourceText === undefined
    ? undefined
    : parsePythonLezerSource(input.sourceText);
  return analyzeLezerFunctionLogic(input, source, PYTHON_FUNCTION_LOGIC_ADAPTER);
}
