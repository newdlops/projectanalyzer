/**
 * Application-layer Tutor planning contracts. These records combine pure
 * declaration facts with graph callsites before opaque protocol projection.
 */

import type {
  FunctionTutorCallsiteTuple,
  FunctionTutorCertainty,
  FunctionTutorDeclarationAnalysis,
  FunctionTutorEvidence,
  FunctionTutorGap,
  FunctionTutorStaticValue
} from "../../../analyzer/functionTutor";
import type { FunctionTutorFactPresentationKey, FunctionTutorSemanticPresentationKey, PresentationParams } from "../../../localization/presentationDescriptors";
import type { FunctionLogicAnalysis } from "../../../analyzer/functionLogic";
import type {
  ArchitecturalLayer,
  ArchitecturalLayerConfidence,
  BusinessLogicClassification
} from "../../../insights/architecturalLayers";
import type {
  SemanticFlowEntrypointKind,
  SemanticFlowStepResolution,
  SemanticFlowStepRole
} from "../../../insights/semanticFlow";

/** One bounded candidate for one declared parameter. */
export type FunctionTutorInputCandidate = {
  id: string;
  parameterId: string;
  value: FunctionTutorStaticValue;
  certainty: FunctionTutorCertainty;
  source: "callsite" | "default" | "literal-type" | "constraint-boundary" | "type-representative" | "unknown";
  evidence: FunctionTutorEvidence[];
};

/** One branch/default target that a representative scenario can cover. */
export type FunctionTutorCoverageObjective = {
  id: string;
  kind: "condition-true" | "condition-false" | "default-input" | "type-baseline";
  parameterId?: string;
  blockId?: string;
  weight: number;
};

/** One complete user-visible input case; values from calls never cross tuples. */
export type FunctionTutorScenarioSeed = {
  id: string;
  ordinal: number;
  title: string;
  source: "callsite" | "default" | "branch" | "type" | "mixed";
  certainty: FunctionTutorCertainty;
  inputs: Array<{
    parameterId: string;
    value: FunctionTutorStaticValue;
    omitted: boolean;
    certainty: FunctionTutorCertainty;
    evidence: FunctionTutorEvidence[];
  }>;
  objectiveIds: string[];
  evidence: FunctionTutorEvidence[];
  gaps: FunctionTutorGap[];
};

/** A source-owned parent of the selected callable, stored before opaque projection. */
export type FunctionTutorOwnerFact = {
  nodeId: string;
  kind: "file" | "module" | "namespace" | "class";
  name: string;
  certainty: FunctionTutorCertainty;
  evidence: FunctionTutorEvidence[];
};

/** Existing architecture-index result adapted without Tutor-specific naming heuristics. */
export type FunctionTutorArchitectureFact = {
  layer: ArchitecturalLayer;
  confidence: ArchitecturalLayerConfidence;
  businessLogic: BusinessLogicClassification;
  conflicted: boolean;
  alternatives: ArchitecturalLayer[];
  evidence: Array<{
    summary: string;
    certainty: FunctionTutorCertainty;
    evidence: FunctionTutorEvidence[];
  }>;
};

/** One bounded source-backed entrypoint-to-selected-function chain. */
export type FunctionTutorEntrypointChainFact = {
  id: string;
  kind: SemanticFlowEntrypointKind;
  label: string;
  framework: string;
  certainty: FunctionTutorCertainty;
  steps: Array<{
    functionId?: string;
    name: string;
    role: SemanticFlowStepRole;
    resolution: SemanticFlowStepResolution;
    certainty: FunctionTutorCertainty;
    evidence: FunctionTutorEvidence[];
  }>;
  evidence: FunctionTutorEvidence[];
};

/** One direct inbound relation, with callsite count rather than runtime frequency. */
export type FunctionTutorCallerFact = {
  nodeId: string;
  name: string;
  qualifiedName: string;
  kind: "function" | "method" | "constructor";
  callCount: number;
  certainty: FunctionTutorCertainty;
  evidence: FunctionTutorEvidence[];
};

/** One direct outbound relation, preserving local/external/unresolved distinction. */
export type FunctionTutorCalleeFact = {
  nodeId: string;
  name: string;
  kind: "local" | "external" | "unresolved";
  relation: "call" | "render" | "event";
  callCount: number;
  certainty: FunctionTutorCertainty;
  sourceBlockId?: string;
  evidence: FunctionTutorEvidence[];
};

/** Bounded contextual evidence used to answer the first and fourth Guide questions. */
export type FunctionTutorCodebaseContext = {
  documentation?: FunctionTutorDeclarationAnalysis["documentation"];
  owners: FunctionTutorOwnerFact[];
  architecture?: FunctionTutorArchitectureFact;
  entrypoints: FunctionTutorEntrypointChainFact[];
  callers: FunctionTutorCallerFact[];
  callees: FunctionTutorCalleeFact[];
  counts: {
    totalEntrypointCount: number;
    omittedEntrypointCount: number;
    totalCallerCount: number;
    omittedCallerCount: number;
    totalLocalCalleeCount: number;
    totalExternalCalleeCount: number;
    totalUnresolvedCalleeCount: number;
    omittedCalleeCount: number;
  };
  gaps: FunctionTutorGap[];
};

/** Stable fact categories rendered in one Function Guide answer. */
export type FunctionTutorGuideFactKind =
  | "documentation" | "owner" | "architecture" | "entrypoint" | "caller"
  | "parameter" | "decision" | "loop" | "value-change" | "call" | "render"
  | "event" | "effect" | "embedded" | "return" | "throw" | "exit" | "scenario" | "gap";

/** A factual claim plus optional graph/source targets. */
export type FunctionTutorGuideFact = {
  id: string;
  kind: FunctionTutorGuideFactKind;
  label: string;
  /** Browser-owned semantic label; source-backed names remain interpolation params. */
  labelPresentationKey?: FunctionTutorSemanticPresentationKey;
  labelPresentationParams?: PresentationParams;
  detail: string;
  presentationKey?: FunctionTutorFactPresentationKey;
  certainty: FunctionTutorCertainty;
  blockIds: string[];
  edgeIds: string[];
  evidence: FunctionTutorEvidence[];
};

export type FunctionTutorGuideChapterKind = "place" | "inputs" | "decisions" | "work" | "outcomes";
export type FunctionTutorGuideChapterStatus = "ready" | "partial" | "unavailable";

/** One fixed question in the source-backed Function Guide. */
export type FunctionTutorGuideChapter = {
  id: string;
  ordinal: 1 | 2 | 3 | 4 | 5;
  kind: FunctionTutorGuideChapterKind;
  question: string;
  questionKey?: FunctionTutorGuideChapterKind;
  status: FunctionTutorGuideChapterStatus;
  answer: {
    text: string;
    counts: Record<string, number>;
  };
  answerKey?: FunctionTutorGuideChapterKind;
  facts: FunctionTutorGuideFact[];
  preferredLens: "flow" | "values" | "calls" | "effects";
  primaryBlockId?: string;
  attentionBlockIds: string[];
  attentionEdgeIds: string[];
  gapIds: string[];
};

/** Always-five question reading plan built entirely from structured static facts. */
export type FunctionTutorGuidePlan = {
  chapters: [
    FunctionTutorGuideChapter,
    FunctionTutorGuideChapter,
    FunctionTutorGuideChapter,
    FunctionTutorGuideChapter,
    FunctionTutorGuideChapter
  ];
  initialChapterId: string;
  summary: {
    readyChapterCount: number;
    partialChapterCount: number;
    unavailableChapterCount: number;
  };
};

/** Complete application result consumed by protocol projection. */
export type FunctionTutorBuildModel = {
  declaration: FunctionTutorDeclarationAnalysis;
  functionLogic: FunctionLogicAnalysis;
  callsites: FunctionTutorCallsiteTuple[];
  candidatesByParameter: Map<string, FunctionTutorInputCandidate[]>;
  objectives: FunctionTutorCoverageObjective[];
  seeds: FunctionTutorScenarioSeed[];
  context: FunctionTutorCodebaseContext;
  guide: FunctionTutorGuidePlan;
  availability: FunctionTutorGuideChapterStatus;
  gaps: FunctionTutorGap[];
  summary: {
    exactCallsiteTupleCount: number;
    plannedCoverageCount: number;
    totalObjectiveCount: number;
    limited: boolean;
  };
};
