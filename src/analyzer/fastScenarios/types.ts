/** Lightweight source-guided input inference contracts; no network weights or project execution. */
import type { FunctionTutorDeclarationAnalysis, FunctionTutorInputAssignment, FunctionTutorStaticValue } from "../functionTutor";

export type FastScenarioProblem = {
  declaration: FunctionTutorDeclarationAnalysis;
  /** Complete caller tuples remain correlated; mutations never become observed calls. */
  examples: FunctionTutorInputAssignment[][];
  domains: Array<{ parameterId: string; values: FunctionTutorStaticValue[] }>;
};
export type FastScenarioBoundary = {
  blockId: string;
  occurrence?: number;
  inputs: FunctionTutorInputAssignment[];
  neighbor: FunctionTutorInputAssignment[];
};
export type FastScenarioReport = {
  evaluations: number;
  elapsedMs: number;
  cacheHit: boolean;
  limitReached: boolean;
};
export type FastScenarioResult = { boundaries: FastScenarioBoundary[]; report: FastScenarioReport };
export type FastScenarioOptions = { signal?: AbortSignal; maxEvaluations?: number };
