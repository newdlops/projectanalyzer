/**
 * Public surface for pure function change-impact analysis.
 * Internal reverse traversal and indexing helpers remain private.
 */

export { analyzeChangeImpact } from "./changeImpactAnalysis";
export type {
  AffectedSemanticFlow,
  AnalyzeChangeImpactOptions,
  ChangeImpactAnalysis,
  ChangeImpactCaller,
  ChangeImpactDiagnostic,
  ChangeImpactDiagnosticReason,
  ChangeImpactSummary
} from "./types";
