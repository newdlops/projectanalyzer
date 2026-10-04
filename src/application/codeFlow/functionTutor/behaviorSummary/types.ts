/** Source-owned behavior facts; only projection may replace locations with Webview identities. */
import type { FunctionTutorCertainty, FunctionTutorEvidence } from "../../../../analyzer/functionTutor";
import type { FunctionLogicEdgeKind } from "../../../../analyzer/functionLogic";
import type { FunctionTutorSummaryPresentationKey, FunctionLogicGapPresentationKey, FunctionTutorGapPresentationKey, PresentationParams } from "../../../../localization/presentationDescriptors";

export type FunctionBehaviorSummaryScope = "source" | "conditional" | "repeated" | "finally";
export type FunctionBehaviorSummaryKind = "parameter" | "condition" | "loop" | "switch" | "try" | "call" | "external-call" | "unresolved-call" | "write" | "effect" | "return" | "throw" | "exit";

/** A syntax-proven prerequisite, never an evaluated boolean or an execution observation. */
export type FunctionBehaviorSummaryCondition = {
  blockId: string;
  edgeId: string;
  outcome: FunctionLogicEdgeKind;
  sourcePreview: string;
};

/** Shared claim identity and bounded graph/source references used by every Summary section. */
export type FunctionBehaviorSummaryItem = {
  id: string;
  kind: FunctionBehaviorSummaryKind;
  sourcePreview: string;
  presentationKey: FunctionTutorSummaryPresentationKey;
  presentationParams?: PresentationParams;
  certainty: FunctionTutorCertainty;
  scope: FunctionBehaviorSummaryScope;
  conditions: FunctionBehaviorSummaryCondition[];
  blockIds: string[];
  edgeIds: string[];
  evidence: FunctionTutorEvidence[];
  /** Source branch alternatives describe structure rather than a single ordered route. */
  alternatives?: Array<{ edgeId: string; outcome: FunctionLogicEdgeKind; sourcePreview: string; blockIds: string[] }>;
};

export type FunctionBehaviorSummaryInput = FunctionBehaviorSummaryItem & {
  name: string;
  typeText?: string;
  defaultText?: string;
  optional: boolean;
  rest: boolean;
};

/** Bounded declaration/control facts already available to the Tutor; planning performs no I/O. */
export type FunctionBehaviorSummary = {
  schema: 1;
  status: "ready" | "partial" | "unavailable";
  purpose: {
    basis: "documentation" | "structure";
    sourcePreview?: string;
    presentationKey?: FunctionTutorSummaryPresentationKey;
    presentationParams?: PresentationParams;
    certainty: FunctionTutorCertainty;
    evidence: FunctionTutorEvidence[];
  };
  inputs: FunctionBehaviorSummaryInput[];
  outcomes: FunctionBehaviorSummaryItem[];
  steps: FunctionBehaviorSummaryItem[];
  impacts: FunctionBehaviorSummaryItem[];
  gaps: Array<{ id: string; presentationKey: FunctionTutorSummaryPresentationKey | FunctionLogicGapPresentationKey | FunctionTutorGapPresentationKey; presentationParams?: PresentationParams; sourcePreview?: string; blockIds: string[]; evidence: FunctionTutorEvidence[] }>;
  omittedCounts: { inputs: number; outcomes: number; steps: number; impacts: number; gaps: number };
  limited: boolean;
};
