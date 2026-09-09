/** Public contracts for bounded, function-specific neural training and input search. */
import type { FunctionTutorDeclarationAnalysis, FunctionTutorInputAssignment, FunctionTutorStaticValue } from "../functionTutor";

export type NeuralScenarioProblem = {
  declaration: FunctionTutorDeclarationAnalysis;
  /** Whole caller/planner tuples; no observed-call claim is made for mutations. */
  examples: FunctionTutorInputAssignment[][];
  domains: Array<{ parameterId: string; values: FunctionTutorStaticValue[] }>;
};
export type NeuralTrainingReport = {
  trainingSamples: number;
  validationSamples: number;
  dimensions: number;
  heads: number;
  parameters: number;
  epochs: number;
  initialLoss: number;
  finalLoss: number;
  /** Mean absolute error in training-standardized margin units; not confidence. */
  validationError: number;
  evaluations: number;
};
export type NeuralBoundary = {
  blockId: string;
  /** Zero-based occurrence of a condition within the same bounded run. */
  occurrence?: number;
  inputs: FunctionTutorInputAssignment[];
  neighbor: FunctionTutorInputAssignment[];
};
export type NeuralScenarioResult = { boundaries: NeuralBoundary[]; report: NeuralTrainingReport };
export type NeuralScenarioOptions = {
  signal?: AbortSignal;
  seed?: number;
  /** Bounded diagnostic ablation; production always trains. */
  epochs?: number;
};
