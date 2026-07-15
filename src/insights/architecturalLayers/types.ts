/**
 * Host-independent contracts for evidence-backed callable layer assessments.
 * Layer, business relevance, and purity are deliberately separate axes so a
 * framework `service` hint can never become proof of pure domain logic.
 */

import type { EdgeConfidence, FrameworkUnitKind } from "../../shared/types";

/** Structural layers used consistently by reading and function exploration. */
export type ArchitecturalLayer =
  | "interface"
  | "application"
  | "domain"
  | "dataAccess"
  | "infrastructure"
  | "crossCutting"
  | "test"
  | "unclassified";

/** Confidence in the layer assessment, separate from call-edge confidence. */
export type ArchitecturalLayerConfidence = "high" | "medium" | "low" | "unknown";

/** Conservative learning interpretation of a structurally classified callable. */
export type BusinessLogicClassification =
  | "domainRuleCandidate"
  | "applicationWorkflowCandidate"
  | "notBusinessLogic"
  | "unknown";

/** Purity is not currently proven by the lightweight static analyzer. */
export type FunctionPurity = "unknown";

/** Stable evidence categories retained without leaking path-bearing identities. */
export type ArchitecturalLayerEvidenceKind =
  | "frameworkSemantic"
  | "sourceStructure"
  | "testSource";

/** One bounded reason supporting a layer candidate. */
export type ArchitecturalLayerEvidence = {
  kind: ArchitecturalLayerEvidenceKind;
  ruleId: string;
  supports: ArchitecturalLayer;
  confidence: Exclude<ArchitecturalLayerConfidence, "unknown">;
  description: string;
  bindingConfidence?: EdgeConfidence;
  /** Domain ports have a domain location but are not domain-rule reading targets. */
  excludesBusinessTarget?: boolean;
};

/** Framework fact accepted by the classifier without depending on UI records. */
export type FunctionArchitectureSemanticInput = {
  unitKind: FrameworkUnitKind;
  bindingConfidence?: EdgeConfidence;
};

/** Intrinsic callable facts used to produce a graph-stable assessment. */
export type FunctionArchitectureInput = {
  functionId: string;
  /** Workspace-relative source path; absolute checkout ancestors are excluded. */
  projectRelativePath?: string;
  semantics: readonly FunctionArchitectureSemanticInput[];
};

/** One callable's graph-stable architecture assessment. */
export type FunctionArchitectureAssessment = {
  functionId: string;
  layer: ArchitecturalLayer;
  confidence: ArchitecturalLayerConfidence;
  businessLogic: BusinessLogicClassification;
  purity: FunctionPurity;
  evidence: ArchitecturalLayerEvidence[];
  omittedEvidenceCount: number;
  alternatives: ArchitecturalLayer[];
  conflicted: boolean;
};

/** Coverage counters for one immutable graph snapshot. */
export type FunctionArchitectureSummary = {
  graphVersion: string;
  concreteCallableCount: number;
  classifiedCallableCount: number;
  businessCandidateCount: number;
  conflictedCallableCount: number;
};

/** Graph-wide assessment lookup shared by downstream insight projections. */
export type FunctionArchitectureIndex = {
  graphVersion: string;
  assessments: FunctionArchitectureAssessment[];
  assessmentsByFunctionId: ReadonlyMap<string, FunctionArchitectureAssessment>;
  summary: FunctionArchitectureSummary;
};
