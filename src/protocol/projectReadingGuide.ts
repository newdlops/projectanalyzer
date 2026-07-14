/**
 * Bounded Project Reading Guide messages shared by the Extension Host and
 * Webview. The first payload carries only three scope summaries; source areas
 * and representative execution paths cross the boundary after scope selection.
 */

import type { EdgeConfidence } from "../shared/types";

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
};

/** One source-backed step in a representative execution path. */
export type ProjectReadingStepPayload = {
  stages: Array<"entrypoint" | "handler" | "intermediate" | "boundary">;
  role: string;
  label: string;
  functionId?: string;
  boundaryKind?:
    | "repository"
    | "model"
    | "externalCall"
    | "sideEffect"
    | "observedTerminal"
    | "unresolvedCall";
};

/** One representative, not importance-ranked, mapped flow for a selected scope. */
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
  representativeFlows: ProjectReadingFlowPayload[];
  eligibleFlowCount: number;
  omittedFlowCount: number;
  unmappedEntrypointCount: number;
};
