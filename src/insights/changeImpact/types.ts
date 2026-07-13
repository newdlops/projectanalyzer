/**
 * Public types for bounded function change-impact analysis.
 *
 * These records expose reverse call paths and affected semantic route flows
 * without depending on VS Code, Webview, or transport-layer concepts.
 */

import type { EdgeConfidence, SourceRange } from "../../shared/types";
import type { SemanticFlowEntrypointKind } from "../semanticFlow";

/** Bounds applied independently to one reverse call-graph traversal. */
export type AnalyzeChangeImpactOptions = {
  /** Maximum number of call edges followed from the changed function. */
  maxDepth?: number;
  /** Maximum number of unique concrete callers retained in the result. */
  maxSteps?: number;
};

/** One concrete callable that directly or indirectly reaches the target. */
export type ChangeImpactCaller = {
  functionId: string;
  depth: number;
  callsFunctionId: string;
  callEdgeId: string;
  edgeConfidence: EdgeConfidence;
  /** Weakest call-edge confidence along pathFunctionIds. */
  confidence: EdgeConfidence;
  /** Caller-first path ending at the changed target function. */
  pathFunctionIds: string[];
  name: string;
  qualifiedName: string;
  filePath: string;
  range: SourceRange;
};

/** A route flow whose selected handler can reach the changed target. */
export type AffectedSemanticFlow = {
  flowId: string;
  entrypointKind: SemanticFlowEntrypointKind;
  entrypointUnitId: string;
  /** HTTP-only compatibility identity. */
  routeUnitId?: string;
  framework: string;
  name: string;
  handlerFunctionId: string;
  /** Number of calls from the selected handler to the changed target. */
  impactDepth: number;
  /** Handler-first path ending at the changed target function. */
  pathFunctionIds: string[];
  /** Weakest route-mapping and call-path confidence, when available. */
  confidence?: EdgeConfidence;
};

/** Stable reasons why a bounded traversal did not inspect every caller. */
export type ChangeImpactDiagnosticReason = "depthLimit" | "stepLimit";

/** One deterministic frontier omitted by a configured traversal bound. */
export type ChangeImpactDiagnostic = {
  reason: ChangeImpactDiagnosticReason;
  message: string;
  sourceFunctionId: string;
  omittedFunctionIds: string[];
  limit: number;
};

/** Aggregate counters for one change-impact analysis. */
export type ChangeImpactSummary = {
  callerCount: number;
  directCallerCount: number;
  indirectCallerCount: number;
  affectedFlowCount: number;
  truncated: boolean;
};

/** Complete deterministic result for one changed function identity. */
export type ChangeImpactAnalysis = {
  graphVersion: string;
  targetFunctionId: string;
  targetFound: boolean;
  callers: ChangeImpactCaller[];
  directCallers: ChangeImpactCaller[];
  indirectCallers: ChangeImpactCaller[];
  affectedFlows: AffectedSemanticFlow[];
  diagnostics: ChangeImpactDiagnostic[];
  summary: ChangeImpactSummary;
};
