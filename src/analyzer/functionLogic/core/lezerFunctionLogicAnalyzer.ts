/**
 * Lezer compatibility adapter for the parser-independent Function Logic core.
 * Python and Java retain their existing syntax contracts while Kotlin can reuse
 * the same CFG/data-flow orchestration through its own immutable syntax nodes.
 */
import type { SyntaxNode } from "@lezer/common";
import { hasLezerError, type LezerSource } from "../../core/lezerSource";
import type { FunctionLogicAnalysis, FunctionLogicAnalysisInput } from "../types";
import {
  analyzeStructuredFunctionLogic,
  type StructuredCallableDescriptor,
  type StructuredStatementTask,
  type StructuredStatementSeed,
  type StructuredStatementInput,
  type StructuredControlBranchDescription,
  type StructuredControlDescription,
  type StructuredFunctionLogicAdapter
} from "./structuredFunctionLogicAnalyzer";

export type LezerCallableDescriptor = StructuredCallableDescriptor<SyntaxNode>;
export type LezerStatementTask = StructuredStatementTask<SyntaxNode>;
export type LezerStatementSeed = StructuredStatementSeed<SyntaxNode>;
export type LezerStatementInput = StructuredStatementInput<SyntaxNode>;
export type LezerControlBranchDescription = StructuredControlBranchDescription<SyntaxNode>;
export type LezerControlDescription = StructuredControlDescription<SyntaxNode>;
export type LezerFunctionLogicAdapter = StructuredFunctionLogicAdapter<LezerSource, SyntaxNode>;

/** Builds a bounded CFG with Lezer recovery diagnostics for one source snapshot. */
export function analyzeLezerFunctionLogic(
  input: FunctionLogicAnalysisInput,
  source: LezerSource | undefined,
  adapter: LezerFunctionLogicAdapter
): FunctionLogicAnalysis {
  return analyzeStructuredFunctionLogic(input, source, {
    ...adapter,
    hasParseError: (_source, node) => hasLezerError(node)
  });
}
