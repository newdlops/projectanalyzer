/** Input-quality evidence records describe only the supported static execution prefix. */
import type { FunctionTutorStaticValue } from "../types";

/** A concrete input may prove a prefix without proving later external behavior. */
export type FunctionTutorInputEvaluation = {
  status: "verified" | "partial";
  blockIds: string[];
  edgeIds: string[];
  decisions: Array<{ blockId: string; edgeId: string; outcome: string }>;
  terminal?: { blockId: string; kind: string; value?: FunctionTutorStaticValue };
  reason?: "unknown-input" | "unsupported-expression" | "external-state" | "control-gap" | "loop-budget" | "step-budget" | "language-gap";
};

export type FunctionTutorInputAssignment = { parameterId: string; value: FunctionTutorStaticValue; omitted?: boolean };

/** A reached numeric comparison, after prior operations; no label exists for an unreached block. */
export type FunctionTutorDecisionObservation = {
  blockId: string;
  operator: string;
  left: number;
  right: number;
  outcome: boolean;
};
