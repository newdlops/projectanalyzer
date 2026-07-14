/**
 * Public domain contracts for the bounded Project Brief and Risk Radar.
 *
 * Every field is derived from ProjectGraph records or an already-built
 * SemanticFlowIndex. The contracts intentionally avoid protocol, Webview, and
 * VS Code concepts so presentation layers can format the same facts safely.
 */

import type {
  DetectedFramework,
  EdgeConfidence,
  SourceRange
} from "../../shared/types";
import type { SemanticFlowEntrypointKind } from "../semanticFlow";

/** Maximum number of execution groups retained in the Project Brief. */
export const PROJECT_BRIEF_ENTRYPOINT_GROUP_LIMIT = 3;

/** Maximum number of evidence-backed signals retained in the Risk Radar. */
export const PROJECT_RISK_RADAR_ITEM_LIMIT = 5;

/** Maximum retained identities for each evidence field on one Radar signal. */
export const PROJECT_RISK_EVIDENCE_IDENTITY_LIMIT = 8;

/** Repository scope facts taken directly from graph metadata and nodes. */
export type ProjectBriefScope = {
  analyzedFileCount: number;
  symbolCount: number;
  callableCount: number;
  callEdgeCount: number;
};

/** One implementation language with optional analyzer-provided proportions. */
export type ProjectBriefLanguage = {
  language: string;
  fileCount?: number;
  percentage?: number;
};

/** One detected framework scope, preserving its declared evidence confidence. */
export type ProjectBriefFrameworkRoot = {
  name: string;
  ecosystem?: string;
  category: DetectedFramework["category"];
  confidence?: DetectedFramework["confidence"];
  rootPath: string;
};

/** Bounded stack summary that remains honest about omitted display entries. */
export type ProjectBriefStack = {
  languages: ProjectBriefLanguage[];
  frameworkRoots: ProjectBriefFrameworkRoot[];
};

/** GraphQL root operation categories supported by analyzer-qualified names. */
export type ProjectBriefGraphQLOperationType =
  | "Query"
  | "Mutation"
  | "Subscription"
  | "Other";

/** One framework/root/kind execution group represented in the brief. */
export type ProjectBriefEntrypointGroup = {
  id: string;
  framework: string;
  rootPath: string;
  entrypointKind: SemanticFlowEntrypointKind;
  operationType?: ProjectBriefGraphQLOperationType;
  entrypointCount: number;
  mappedCount: number;
  mappingGapCount: number;
  representativeEntrypointUnitIds: string[];
};

/** Entrypoint counts plus a hard-capped representative group projection. */
export type ProjectBriefExecutionSurface = {
  entrypointCount: number;
  routeCount: number;
  operationCount: number;
  mappedCount: number;
  mappingGapCount: number;
  groups: ProjectBriefEntrypointGroup[];
  omittedGroupCount: number;
  omittedEntrypointCount: number;
};

/** Known analysis limitations without claiming unmeasured repository coverage. */
export type ProjectBriefAnalysisCoverage = {
  errorDiagnosticCount: number;
  warningDiagnosticCount: number;
  infoDiagnosticCount: number;
  unresolvedCallEdgeCount: number;
  inferredCallEdgeCount: number;
  ambiguousEntrypointCount: number;
  handlerNotMappedCount: number;
  traversalLimitGapCount: number;
};

/** Compact first-read repository facts. */
export type ProjectBrief = {
  graphVersion: string;
  scope: ProjectBriefScope;
  stack: ProjectBriefStack;
  executionSurface: ProjectBriefExecutionSurface;
  analysisCoverage: ProjectBriefAnalysisCoverage;
};

/** Source location attached only when analyzer evidence supplies one. */
export type ProjectRiskLocation = {
  filePath: string;
  range?: SourceRange;
};

/** Stable identities behind one Risk Radar signal. */
export type ProjectRiskEvidence = {
  diagnosticIndexes: number[];
  entrypointUnitIds: string[];
  frameworkUnitIds: string[];
  sourceFunctionIds: string[];
  targetFunctionIds: string[];
  omittedFunctionIds: string[];
  edgeIds: string[];
};

/** Shared fields for measured coverage and execution signals. */
export type ProjectRiskItemBase = {
  id: string;
  kind: "analysisCoverage" | "entrypointCoverage" | "unresolvedExecution";
  evidenceCount: number;
  affectedEntrypointCount: number;
  confidence?: EdgeConfidence;
  location?: ProjectRiskLocation;
  evidence: ProjectRiskEvidence;
};

/** Parser, analyzer, or bounded-traversal coverage evidence. */
export type ProjectAnalysisCoverageRisk = ProjectRiskItemBase & {
  kind: "analysisCoverage";
  errorDiagnosticCount: number;
  warningDiagnosticCount: number;
  traversalLimitGapCount: number;
};

/** Ambiguous or absent handler/resolver mappings within one framework root. */
export type ProjectEntrypointCoverageRisk = ProjectRiskItemBase & {
  kind: "entrypointCoverage";
  framework: string;
  rootPath: string;
  ambiguousCount: number;
  handlerNotMappedCount: number;
};

/** Unresolved call evidence reached inside one or more mapped bounded flows. */
export type ProjectUnresolvedExecutionRisk = ProjectRiskItemBase & {
  kind: "unresolvedExecution";
  sourceFunctionId?: string;
  sourceFunctionName?: string;
  unresolvedCallCount: number;
};

/** Evidence-backed P0 Risk Radar item; no item asserts a runtime defect. */
export type ProjectRiskItem =
  | ProjectAnalysisCoverageRisk
  | ProjectEntrypointCoverageRisk
  | ProjectUnresolvedExecutionRisk;

/** Bounded Risk Radar with an explicit omitted candidate count. */
export type ProjectRiskRadar = {
  graphVersion: string;
  items: ProjectRiskItem[];
  candidateItemCount: number;
  omittedItemCount: number;
};

/** Complete Project Overview domain result. */
export type ProjectOverview = {
  graphVersion: string;
  brief: ProjectBrief;
  radar: ProjectRiskRadar;
};
