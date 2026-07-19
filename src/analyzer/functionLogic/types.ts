/**
 * Host-independent function-logic contracts. They describe structured control
 * flow inside one callable and retain exact source ranges without UI tokens.
 */

import type { SourceRange, SymbolNode } from "../../shared/types";

/** Statement roles visible in the Function Logic Reader. */
export type FunctionLogicBlockKind =
  | "entry"
  | "condition"
  | "loop"
  | "switch"
  | "try"
  | "call"
  | "effect"
  | "mutation"
  | "operation"
  | "return"
  | "throw"
  | "break"
  | "continue"
  | "exit"
  | "unknown";

/** Directed control transfer between two visible logic blocks. */
export type FunctionLogicEdgeKind =
  | "next"
  | "true"
  | "false"
  | "iterate"
  | "repeat"
  | "exit"
  | "case"
  | "exception"
  | "finally"
  | "return"
  | "throw"
  | "break"
  | "continue";

/** Confidence says whether syntax proves the role or only supports a heuristic. */
export type FunctionLogicConfidence = "exact" | "inferred";

/** One statement or synthetic entry/exit block inside the selected function. */
export type FunctionLogicBlock = {
  id: string;
  kind: FunctionLogicBlockKind;
  label: string;
  detail: string;
  depth: number;
  branchLabel?: string;
  confidence: FunctionLogicConfidence;
  filePath: string;
  range: SourceRange;
};

/** One syntax-backed or conservative control transfer. */
export type FunctionLogicEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  kind: FunctionLogicEdgeKind;
  label?: string;
  confidence: FunctionLogicConfidence;
};

/** Explicit limitation retained with the analysis instead of hidden in UI copy. */
export type FunctionLogicGap = {
  code:
    | "languageUnsupported"
    | "sourceUnavailable"
    | "functionNotFound"
    | "parseLimited"
    | "dynamicBehavior";
  message: string;
};

/** Counts derived only from blocks included in this bounded analysis. */
export type FunctionLogicSummary = {
  blockCount: number;
  branchCount: number;
  loopCount: number;
  callCount: number;
  effectCount: number;
  mutationCount: number;
  exitCount: number;
};

/** Complete static internal-flow result for one concrete callable. */
export type FunctionLogicAnalysis = {
  functionNode: SymbolNode;
  language: "typescript" | "javascript" | "unsupported";
  signature: string;
  blocks: FunctionLogicBlock[];
  edges: FunctionLogicEdge[];
  gaps: FunctionLogicGap[];
  summary: FunctionLogicSummary;
};

/** Input remains explicit so source acquisition stays outside pure analysis. */
export type FunctionLogicAnalysisInput = {
  functionNode: SymbolNode;
  sourceText?: string;
  maxBlocks?: number;
};
