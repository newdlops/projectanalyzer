/**
 * Public domain types for HTTP route and GraphQL operation semantic flows.
 *
 * These records describe framework entrypoints, their selected callable
 * handlers, the evidence behind each mapping, and conservative coverage gaps.
 * They intentionally contain no protocol, Webview, or VS Code concepts.
 */

import type {
  EdgeConfidence,
  FrameworkUnitKind,
  SourceRange
} from "../../shared/types";

/** Entrypoint categories kept distinct across transport and schema dispatch. */
export type SemanticFlowEntrypointKind = "httpRoute" | "graphqlOperation";

/** Structural stage represented by an entrypoint-centered semantic flow. */
export type SemanticFlowStepKind = "route" | "operation" | "handler" | "call";

/** Conservative semantic role attached only when graph evidence supports it. */
export type SemanticFlowStepRole =
  | "routeHandler"
  | "resolver"
  | "controller"
  | "service"
  | "repository"
  | "model"
  | "external"
  | "sideEffect"
  | "unknown";

/** Whether a step points at a concrete symbol or a non-local call target. */
export type SemanticFlowStepResolution = "concrete" | "external" | "unresolved";

/** An entrypoint, handler, or call stage traceable to source evidence. */
export type SemanticFlowStep = {
  kind: SemanticFlowStepKind;
  depth: number;
  role: SemanticFlowStepRole;
  resolution: SemanticFlowStepResolution;
  relation?: "calls";
  parentFunctionId?: string;
  callEdgeId?: string;
  confidence?: EdgeConfidence;
  frameworkUnitId?: string;
  functionId?: string;
  framework?: string;
  unitKind?: FrameworkUnitKind;
  name: string;
  qualifiedName?: string;
  functionName?: string;
  functionQualifiedName?: string;
  filePath: string;
  range?: SourceRange;
};

/** Supported reasons why an entrypoint-to-handler mapping is trusted. */
export type SemanticFlowEvidenceKind =
  | "directCallable"
  | "routesTo"
  | "targetCallable";

/** One confidence-bearing fact used to construct a semantic flow. */
export type SemanticFlowEvidence = {
  kind: SemanticFlowEvidenceKind;
  confidence: EdgeConfidence;
  description: string;
  entrypointUnitId: string;
  /** HTTP-only compatibility identity. GraphQL operations leave this absent. */
  routeUnitId?: string;
  frameworkUnitId: string;
  functionId?: string;
  sourceFrameworkUnitId?: string;
  targetFrameworkUnitId?: string;
};

/** Stable coverage categories produced when no unique callable can be chosen. */
export type SemanticFlowCoverageGapReason =
  | "ambiguous"
  | "handlerNotMapped"
  | "depthLimit"
  | "stepLimit";

/** A conservative explanation for an incomplete entrypoint flow. */
export type SemanticFlowCoverageGap = {
  entrypointUnitId: string;
  /** HTTP-only compatibility identity. GraphQL operations leave this absent. */
  routeUnitId?: string;
  reason: SemanticFlowCoverageGapReason;
  message: string;
  candidateFunctionIds: string[];
  targetFrameworkUnitIds: string[];
  sourceFunctionId?: string;
  omittedFunctionIds: string[];
  limit?: number;
};

/** Public traversal bounds for handler-to-callee semantic-flow expansion. */
export type CreateSemanticFlowIndexOptions = {
  /** Maximum number of call edges followed from a selected handler. */
  maxDepth?: number;
  /** Maximum downstream call steps retained for each entrypoint flow. */
  maxSteps?: number;
};

/** One entrypoint and its uniquely supported handler, when available. */
export type SemanticFlow = {
  id: string;
  entrypointKind: SemanticFlowEntrypointKind;
  entrypointUnitId: string;
  /** HTTP-only compatibility identity. GraphQL operations leave this absent. */
  routeUnitId?: string;
  framework: string;
  rootPath: string;
  name: string;
  steps: SemanticFlowStep[];
  evidence: SemanticFlowEvidence[];
  confidence?: EdgeConfidence;
  coverageGaps: SemanticFlowCoverageGap[];
};

/** Coverage counters for one semantic-flow index build. */
export type SemanticFlowSummary = {
  graphVersion: string;
  entrypointCount: number;
  routeCount: number;
  operationCount: number;
  mappedHandlerCount: number;
  ambiguousEntrypointCount: number;
  ambiguousRouteCount: number;
  ambiguousOperationCount: number;
  handlerNotMappedCount: number;
};

/** Indexed entrypoint flows and HTTP-compatible route projections. */
export type SemanticFlowIndex = {
  graphVersion: string;
  flows: SemanticFlow[];
  flowsByEntrypointUnitId: Map<string, SemanticFlow[]>;
  flowsByRouteUnitId: Map<string, SemanticFlow[]>;
  coverageGaps: SemanticFlowCoverageGap[];
  coverageGapsByEntrypointUnitId: Map<string, SemanticFlowCoverageGap[]>;
  coverageGapsByRouteUnitId: Map<string, SemanticFlowCoverageGap[]>;
  summary: SemanticFlowSummary;
};
