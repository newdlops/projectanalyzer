/**
 * Public, host-independent contracts for the two-stage Project Reading Guide.
 *
 * The index answers which source-backed scopes exist without listing their
 * contents. A scope guide is projected only after selection and retains hard
 * caps plus exact omission counts for areas, representative flows, and steps.
 */

import type {
  EdgeConfidence,
  SourceRange
} from "../../shared/types";
import type {
  SemanticFlowEntrypointKind,
  SemanticFlowStepKind,
  SemanticFlowStepResolution,
  SemanticFlowStepRole
} from "../semanticFlow";

/** Maximum scope summaries shown by the first-stage index. */
export const PROJECT_READING_SCOPE_LIMIT = 3;

/** Maximum framework names retained on one compact scope summary. */
export const PROJECT_READING_FRAMEWORK_LIMIT = 3;

/** Maximum source areas shown after one scope is selected. */
export const PROJECT_READING_AREA_LIMIT = 5;

/** Maximum mapped flows used as deterministic reading examples. */
export const PROJECT_READING_PATH_LIMIT = 3;

/** Maximum source-backed steps retained on one representative reading path. */
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

/** Transport identity used by representative reading paths. */
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
  boundaryKind?: ProjectReadingBoundaryKind;
};

/** Trace state stated only from mapping, traversal, and unresolved evidence. */
export type ProjectReadingTraceStatus = "mapped" | "limited" | "unresolved";

/** One deterministic mapped flow used as a bounded source-reading example. */
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
  steps: ProjectReadingStep[];
  totalStepCount: number;
  omittedStepCount: number;
  depthLimitReached: boolean;
  stepLimitReached: boolean;
  unresolvedCallCount: number;
};

/** Lazy second-stage result for one explicitly selected scope. */
export type ProjectScopeReadingGuide = {
  graphVersion: string;
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
};
