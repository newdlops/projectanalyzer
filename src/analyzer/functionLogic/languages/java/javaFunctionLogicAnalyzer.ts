/**
 * Java Function Logic public adapter. It composes Java syntax semantics with
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
import { parseJavaLezerSource } from "../../../languages/java/javaLezerSyntax";
import { describeJavaControl } from "./javaFunctionLogicControl";
import {
  classifyJavaStatement,
  collectJavaFunctionCallsites,
  createJavaFunctionLogicGaps,
  findSelectedJavaCallable,
  getJavaRootStatements
} from "./javaFunctionLogicSyntax";

const JAVA_FUNCTION_LOGIC_ADAPTER: LezerFunctionLogicAdapter = {
  language: "java",
  findSelectedCallable: findSelectedJavaCallable,
  getRootStatements: getJavaRootStatements,
  classifyStatement: classifyJavaStatement,
  describeControl: describeJavaControl,
  collectCallsites: collectJavaFunctionCallsites,
  createDefaultGaps: createJavaFunctionLogicGaps
};

/** Analyzes one selected Java callable against its current source snapshot. */
export function analyzeJavaFunctionLogic(
  input: FunctionLogicAnalysisInput
): FunctionLogicAnalysis {
  const source = input.sourceText === undefined
    ? undefined
    : parseJavaLezerSource(input.sourceText);
  return analyzeLezerFunctionLogic(input, source, JAVA_FUNCTION_LOGIC_ADAPTER);
}
