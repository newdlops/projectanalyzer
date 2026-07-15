/**
 * Public, host-independent contracts for the two-stage Project Reading Plan.
 *
 * The index answers which source-backed scopes exist without listing their
 * contents. A scope guide is projected only after selection and retains hard
 * caps plus exact omission counts for areas, recommended flows, and steps.
 */

import type {
  EdgeConfidence,
  FrameworkUnitKind,
  SourceRange
} from "../../shared/types";
import type {
  SemanticFlowEntrypointKind,
  SemanticFlowStepKind,
  SemanticFlowStepResolution,
  SemanticFlowStepRole
} from "../semanticFlow";
import type {
  ArchitecturalLayer,
  ArchitecturalLayerConfidence,
  BusinessLogicClassification
} from "../architecturalLayers";

/** Maximum scope summaries shown by the first-stage index. */
export const PROJECT_READING_SCOPE_LIMIT = 3;

/** Maximum framework names retained on one compact scope summary. */
export const PROJECT_READING_FRAMEWORK_LIMIT = 3;

/** Maximum source areas shown after one scope is selected. */
export const PROJECT_READING_AREA_LIMIT = 5;

/** Maximum mapped flows used as evidence-ranked learning paths. */
export const PROJECT_READING_PATH_LIMIT = 3;

/** Maximum source-backed steps retained on one recommended reading path. */
export const PROJECT_READING_STEP_LIMIT = 5;

/** Evidence class supporting one normalized project scope. */
export type ProjectReadingScopeBasis = "application" | "detected" | "source";

/** Exact transport counters for one normalized rootPath scope. */
export type ProjectReadingExecutionCounts = {
  entrypointCount: number;
  mappedCount: number;
  mappingGapCount: number;
  httpRouteCount: number;
  graphqlQueryCount: number;
  graphqlMutationCount: number;
  graphqlSubscriptionCount: number;
  graphqlOtherCount: number;
};

/** One compact, source-backed scope shown in the first-stage guide. */
export type ProjectReadingScopeSummary = {
  /** Stable identity derived from the normalized root key. */
  id: string;
  /** Canonical portable root key used for containment and later lookup. */
  rootPath: string;
  /** Workspace-relative path when the root is inside the workspace. */
  displayPath: string;
  basis: ProjectReadingScopeBasis;
  frameworks: string[];
  frameworkCount: number;
  omittedFrameworkCount: number;
  analyzedFileCount: number;
  callableCount: number;
  execution: ProjectReadingExecutionCounts;
};

/** Bounded initial result; omitted scopes remain addressable by the projector. */
export type ProjectReadingGuideIndex = {
  graphVersion: string;
  workspaceRoot: string;
  scopes: ProjectReadingScopeSummary[];
  totalScopeCount: number;
  omittedScopeCount: number;
};

/** Evidence class for one measured directory inside a selected scope. */
export type ProjectReadingAreaBasis =
  | "workspacePackage"
  | "sourceDirectory"
  | "frameworkRoot"
  | "workspaceRoot";

/** One bounded, non-overlapping source area inside a selected scope. */
export type ProjectReadingSourceArea = {
  id: string;
  rootPath: string;
  displayPath: string;
  basis: ProjectReadingAreaBasis;
  analyzedFileCount: number;
  callableCount: number;
  entrypointCount: number;
  representativeFilePaths: string[];
  omittedFileCount: number;
};

/** GraphQL operation roots preserved separately for guide grouping. */
export type ProjectReadingGraphQLOperationType =
  | "Query"
  | "Mutation"
  | "Subscription"
  | "Other";

/** Transport identity used by recommended reading paths. */
export type ProjectReadingTransport =
  | "http"
  | "graphqlQuery"
  | "graphqlMutation"
  | "graphqlSubscription"
  | "graphqlOther";

/** Evidence-backed reason one selected reading step ends the shown path. */
export type ProjectReadingBoundaryKind =
  | "repository"
  | "model"
  | "externalCall"
  | "sideEffect"
  | "observedTerminal"
  | "unresolvedCall";

/** Structural layer evidence attached to one visible source-reading step. */
export type ProjectReadingArchitecture = {
  layer: "entrypoint" | ArchitecturalLayer;
  confidence: ArchitecturalLayerConfidence;
  businessLogic: BusinessLogicClassification;
  purity: "unknown";
  evidence: string[];
  alternatives: ArchitecturalLayer[];
  conflicted: boolean;
};

/** Reading-only topology hint that never changes intrinsic architecture facts. */
export type ProjectReadingContextInference = {
  role: "workflowBridgeCandidate";
  confidence: "low";
  evidence: string[];
};

/** Orthogonal reading cues; they never strengthen the structural assessment. */
export type ProjectReadingCue =
  | "startHere"
  | "businessLogicCandidate"
  | "workflowBridgeCandidate"
  | "boundary"
  | "evidenceGap";

/** One source-backed step selected from an entrypoint-centered semantic flow. */
export type ProjectReadingStep = {
  kind: SemanticFlowStepKind;
  depth: number;
  role: SemanticFlowStepRole;
  resolution: SemanticFlowStepResolution;
  name: string;
  qualifiedName?: string;
  functionId?: string;
  ownerFunctionId?: string;
  frameworkUnitId?: string;
  callEdgeId?: string;
  filePath: string;
  range?: SourceRange;
  confidence?: EdgeConfidence;
  unitKind?: FrameworkUnitKind;
  architecture: ProjectReadingArchitecture;
  contextInference?: ProjectReadingContextInference;
  readingCues: ProjectReadingCue[];
  boundaryKind?: ProjectReadingBoundaryKind;
};

/** Trace state stated only from mapping, traversal, and unresolved evidence. */
export type ProjectReadingTraceStatus = "mapped" | "limited" | "unresolved";

/** Honest outcome of searching one bounded trace for business-layer candidates. */
export type ProjectReadingBusinessReach =
  | "domainCandidateReached"
  | "applicationCandidateReached"
  | "workflowBridgeCandidateReached"
  | "noCandidateObserved"
  | "analysisLimited";

/** Why this entrypoint is educationally useful and what remains uncertain. */
export type ProjectReadingRecommendation = {
  businessReach: ProjectReadingBusinessReach;
  targetStepIndex?: number;
  explanation: string;
  whyRecommended: string[];
  unknowns: string[];
};

/** One evidence-ranked mapped flow used as a bounded source-reading example. */
export type ProjectReadingPath = {
  id: string;
  scopeId: string;
  entrypointKind: SemanticFlowEntrypointKind;
  entrypointUnitId: string;
  transport: ProjectReadingTransport;
  operationType?: ProjectReadingGraphQLOperationType;
  framework: string;
  name: string;
  confidence?: EdgeConfidence;
  traceStatus: ProjectReadingTraceStatus;
  recommendation: ProjectReadingRecommendation;
  steps: ProjectReadingStep[];
  totalStepCount: number;
  omittedStepCount: number;
  depthLimitReached: boolean;
  stepLimitReached: boolean;
  unresolvedCallCount: number;
};

/** Exact host-side source evidence retained for one primary reading step. */
export type ProjectReadingEvidenceAnchor = {
  locationKind: "definition" | "callsite" | "frameworkEvidence";
  ownerFunctionId?: string;
  filePath: string;
  range: SourceRange;
  label: string;
};

/** One primary-path step enriched without exposing the graph to consumers. */
export type ProjectPrimaryReadingStep = ProjectReadingStep & {
  sourceAnchors: {
    definition?: ProjectReadingEvidenceAnchor;
    incomingCallsite?: ProjectReadingEvidenceAnchor;
    frameworkEvidence?: ProjectReadingEvidenceAnchor;
  };
};

/** The single best bounded path across every normalized project scope. */
export type ProjectPrimaryReadingPath = Omit<ProjectReadingPath, "steps"> & {
  steps: ProjectPrimaryReadingStep[];
};

/** Most concrete next place available when no primary path can be selected. */
export type ProjectPrimaryReadingFallback =
  | {
      kind: "sourceEvidence";
      anchor: ProjectReadingEvidenceAnchor;
    }
  | {
      kind: "prefilteredMappingGaps";
      scopeId?: string;
      reason: "handlerNotMapped" | "resolutionGap";
    }
  | {
      kind: "none";
    };

/** Exact graph-wide counts explaining primary-path availability. */
export type ProjectPrimaryReadingPathDiagnostics = {
  supportedEntrypointCount: number;
  mappedHandlerCount: number;
  mappingGapCount: number;
  eligiblePathCount: number;
  navigableAnchorCount: number;
  fallback: ProjectPrimaryReadingFallback;
};

/** Selected primary path or an honest source-backed unavailable result. */
export type ProjectPrimaryReadingPathResult =
  | {
      graphVersion: string;
      status: "selected";
      path: ProjectPrimaryReadingPath;
      diagnostics: ProjectPrimaryReadingPathDiagnostics;
    }
  | {
      graphVersion: string;
      status: "unavailable";
      diagnostics: ProjectPrimaryReadingPathDiagnostics;
    };

/** Lazy second-stage result for one explicitly selected scope. */
export type ProjectScopeReadingGuide = {
  graphVersion: string;
  /** Host-only root used to derive safe relative source labels at the protocol boundary. */
  workspaceRoot: string;
  scope: ProjectReadingScopeSummary;
  areas: ProjectReadingSourceArea[];
  totalAreaCount: number;
  omittedAreaCount: number;
  readingPaths: ProjectReadingPath[];
  mappedFlowCount: number;
  omittedMappedFlowCount: number;
  unmappedEntrypointCount: number;
};

/** Reusable pure projector over one graph and Semantic Flow snapshot. */
export type ProjectReadingGuideProjector = {
  projectIndex(): ProjectReadingGuideIndex;
  projectScope(scopeId: string): ProjectScopeReadingGuide | undefined;
  projectPrimaryPath(): ProjectPrimaryReadingPathResult;
};
