/** Action-owned whole-source call context ports; browser tokens and full file I/O remain supplied by the Host. */
import type { FunctionLogicAnalysis } from "../../../analyzer/functionLogic";
import type { FunctionNarrativeContext } from "../../../shared/functionNarratives";
import type { FunctionCallReading } from "../../../shared/functionCallNarratives";
import type { NarrativeSourceLease } from "../../../shared/narrativeSources";
import type { ProjectGraph, SourceRange, SymbolNode } from "../../../shared/types";
import type { SourceNodeToken } from "../../../protocol/sourceNavigation";
import type { CodeFlowEvidenceToken } from "../../../protocol/functionLogic";

export type CapturedFunctionCallPlanOptions = {
  graph: ProjectGraph; analysis: FunctionLogicAnalysis; source: string; lease: NarrativeSourceLease; primarySnippetId: string;
  maxDepth?: number;
  createSourceToken(id: string): SourceNodeToken | undefined;
  resolveSourceToken(token: SourceNodeToken): SymbolNode | undefined;
  createEvidenceToken(filePath: string, range: SourceRange): CodeFlowEvidenceToken | undefined;
  resolveEvidenceToken(token: CodeFlowEvidenceToken): { filePath: string; range: SourceRange } | undefined;
  readSourceText(filePath: string, signal: AbortSignal): Promise<string | undefined>;
};
/** This factory lives only while its exact capture is owned. It never starts a model or supplies an answer/prose callback. */
export type CapturedFunctionCallPlan = {
  readonly count: number;
  context(offset: number, earlier: readonly FunctionCallReading[], signal: AbortSignal): Promise<FunctionNarrativeContext>;
};
