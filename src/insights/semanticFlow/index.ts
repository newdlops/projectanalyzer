/**
 * Public surface for the pure entrypoint-centered semantic-flow domain module.
 * Internal candidate selection and indexing helpers remain private.
 */

export { createSemanticFlowIndex } from "./semanticFlowIndex";
export type {
  SemanticFlow,
  CreateSemanticFlowIndexOptions,
  SemanticFlowCoverageGap,
  SemanticFlowCoverageGapReason,
  SemanticFlowEntrypointKind,
  SemanticFlowEvidence,
  SemanticFlowEvidenceKind,
  SemanticFlowIndex,
  SemanticFlowStep,
  SemanticFlowStepKind,
  SemanticFlowStepResolution,
  SemanticFlowStepRole,
  SemanticFlowSummary
} from "./types";
