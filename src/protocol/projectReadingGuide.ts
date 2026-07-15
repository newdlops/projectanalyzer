/**
 * Bounded Project Reading Plan messages shared by the Extension Host and
 * Webview. The first payload carries only three scope summaries; source areas
 * and evidence-ranked execution paths cross the boundary after scope selection.
 */

import type { EdgeConfidence } from "../shared/types";
import type { FunctionArchitecturePayload } from "./functionArchitecture";
import type { SourceNodeToken } from "./sourceNavigation";

/** Opaque host-issued identity used to request one lazy scope projection. */
export type ProjectReadingScopePayloadId = `reading-scope:${string}`;

/** Evidence basis used to describe a detected project scope without guessing. */
export type ProjectReadingScopeBasis = "application" | "detected" | "source";

/** Transport counters retained separately inside one normalized root scope. */
export type ProjectReadingExecutionPayload = {
  entrypointCount: number;
  mappedCount: number;
  mappingGapCount: number;
  httpRouteCount: number;
  graphqlQueryCount: number;
  graphqlMutationCount: number;
  graphqlSubscriptionCount: number;
  graphqlOtherCount: number;
};

/** One compact rootPath scope shown on the initial guide screen. */
export type ProjectReadingScopePayload = {
  id: ProjectReadingScopePayloadId;
  displayPath: string;
  basis: ProjectReadingScopeBasis;
  frameworks: string[];
  frameworkCount: number;
  omittedFrameworkCount: number;
  analyzedFileCount: number;
  callableCount: number;
  execution: ProjectReadingExecutionPayload;
};

/** Initial human-oriented payload with a hard three-scope display budget. */
export type ProjectReadingGuidePayload = {
  graphVersion: string;
  headline: string;
  detail: string;
  scopes: ProjectReadingScopePayload[];
  candidateScopeCount: number;
  omittedScopeCount: number;
};

/** A measured source directory or framework root inside the selected scope. */
export type ProjectReadingAreaPayload = {
  id: string;
  displayPath: string;
  basis: "workspacePackage" | "sourceDirectory" | "frameworkRoot" | "workspaceRoot";
  analyzedFileCount: number;
  callableCount: number;
  entrypointCount: number;
  /** Bounded workspace-relative examples; these are display text, not navigation targets. */
  representativeFilePaths: string[];
};

/** One source-backed step in a recommended learning path. */
export type ProjectReadingStepPayload = {
  stages: Array<"entrypoint" | "handler" | "intermediate" | "boundary">;
  role: string;
  label: string;
  /** Workspace-relative `file:line` text, or a filename-only safe abbreviation. */
  sourceLocation?: string;
  /** Distinguishes definitions, edge-local call sites, and framework mapping evidence. */
  sourceLocationKind?: "definition" | "callsite" | "evidence";
  /** Snapshot-local opaque token; analyzer function identities never cross this boundary. */
  sourceToken?: SourceNodeToken;
  architecture: FunctionArchitecturePayload;
  contextInference?: {
    role: "workflowBridgeCandidate";
    confidence: "low";
    evidence: string[];
  };
  readingCues: Array<
    | "startHere"
    | "businessLogicCandidate"
    | "workflowBridgeCandidate"
    | "boundary"
    | "evidenceGap"
  >;
  boundaryKind?:
    | "repository"
    | "model"
    | "externalCall"
    | "sideEffect"
    | "observedTerminal"
    | "unresolvedCall";
};

/** Why one mapped entrypoint is useful for learning and what remains unknown. */
export type ProjectReadingRecommendationPayload = {
  businessReach:
    | "domainCandidateReached"
    | "applicationCandidateReached"
    | "workflowBridgeCandidateReached"
    | "noCandidateObserved"
    | "analysisLimited";
  targetStepIndex?: number;
  explanation: string;
  whyRecommended: string[];
  unknowns: string[];
};

/** One evidence-ranked learning flow; ranking is not runtime importance. */
export type ProjectReadingFlowPayload = {
  id: string;
  transport:
    | "http"
    | "graphqlQuery"
    | "graphqlMutation"
    | "graphqlSubscription"
    | "graphqlOther";
  framework: string;
  name: string;
  confidence?: EdgeConfidence;
  traceStatus: "mapped" | "limited" | "unresolved";
  recommendation: ProjectReadingRecommendationPayload;
  steps: ProjectReadingStepPayload[];
  omittedStepCount: number;
  depthLimitReached: boolean;
  stepLimitReached: boolean;
  unresolvedCallCount: number;
};

/** Lazy detail payload emitted only for the scope explicitly chosen by a user. */
export type ProjectScopeReadingGuidePayload = {
  graphVersion: string;
  scope: ProjectReadingScopePayload;
  areas: ProjectReadingAreaPayload[];
  candidateAreaCount: number;
  omittedAreaCount: number;
  recommendedFlows: ProjectReadingFlowPayload[];
  eligibleFlowCount: number;
  omittedFlowCount: number;
  unmappedEntrypointCount: number;
};

/** Correlated lazy-scope failure that cannot clear a newer scope request. */
export type ProjectReadingGuideScopeFailurePayload = {
  graphVersion: string;
  scopeId: ProjectReadingScopePayloadId;
  message: string;
};
