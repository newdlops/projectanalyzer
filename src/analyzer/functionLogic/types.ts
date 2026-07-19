/**
 * Host-independent function-logic contracts. They describe structured control
 * flow inside one callable and retain exact source ranges without UI tokens.
 */

import type { SourceRange, SymbolNode } from "../../shared/types";
import type { FunctionLogicValueChange } from "./valueChanges/types";

export type {
  FunctionLogicValueChange,
  FunctionLogicValueChangeOperation,
  FunctionLogicValueTargetKind
} from "./valueChanges/types";

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

/** Language adapters that can produce function-internal control flow. */
export type FunctionLogicLanguage =
  | "typescript"
  | "javascript"
  | "python"
  | "java"
  | "unsupported";

/** One statement or synthetic entry/exit block inside the selected function. */
export type FunctionLogicBlock = {
  id: string;
  kind: FunctionLogicBlockKind;
  label: string;
  detail: string;
  depth: number;
  branchLabel?: string;
  confidence: FunctionLogicConfidence;
  /** Exact writes and conservative receiver changes visible inside this block. */
  valueChanges?: FunctionLogicValueChange[];
  filePath: string;
  range: SourceRange;
};

/** One direct call expression found inside the selected callable's own AST body. */
export type FunctionLogicCallsite = {
  filePath: string;
  range: SourceRange;
  calleeName: string;
  calleeText: string;
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

/** Counts derived from visible blocks and exact call expressions in this analysis. */
export type FunctionLogicSummary = {
  blockCount: number;
  branchCount: number;
  loopCount: number;
  callCount: number;
  effectCount: number;
  mutationCount: number;
  valueChangeCount: number;
  exitCount: number;
};

/** Complete static internal-flow result for one concrete callable. */
export type FunctionLogicAnalysis = {
  functionNode: SymbolNode;
  language: FunctionLogicLanguage;
  signature: string;
  /** Parser-proven lexical class/type owner used only for conservative call matching. */
  lexicalOwnerQualifiedName?: string;
  blocks: FunctionLogicBlock[];
  edges: FunctionLogicEdge[];
  callsites: FunctionLogicCallsite[];
  gaps: FunctionLogicGap[];
  summary: FunctionLogicSummary;
};

/** Input remains explicit so source acquisition stays outside pure analysis. */
export type FunctionLogicAnalysisInput = {
  functionNode: SymbolNode;
  sourceText?: string;
  maxBlocks?: number;
};

/** Zero-based editor position used by the host-independent cursor resolver. */
export type FunctionCursorPosition = {
  line: number;
  character: number;
};

/** Exact callable declaration selected from the current source syntax. */
export type FunctionCursorTarget = {
  kind: "function" | "method" | "constructor";
  name: string;
  qualifiedName: string;
  filePath: string;
  language: string;
  range: SourceRange;
  selectionRange: SourceRange;
  anonymous: boolean;
};

/** Source snapshot and cursor coordinates supplied by the editor adapter. */
export type FunctionCursorTargetInput = {
  filePath: string;
  languageId: string;
  sourceText: string;
  position: FunctionCursorPosition;
};
