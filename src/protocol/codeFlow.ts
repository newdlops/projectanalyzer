/**
 * JSON-only contracts for the flow-first product surface. The protocol keeps
 * graph identities and host paths behind opaque, snapshot-local references.
 */

import type { EdgeConfidence } from "../shared/types";
import type { ArchitecturalLayerPayload } from "./functionArchitecture";
import type { SourceNodeToken } from "./sourceNavigation";
import type {
  CodeFlowOpenEvidenceRequest,
  FunctionLogicPayload
} from "./functionLogic";

/** Opaque identity for one entrypoint or symbol-centered flow projection. */
export type CodeFlowId = `code-flow:${string}`;

/** User-facing stages that reinforce the product's reusable reading frame. */
export type CodeFlowStage = "boundary" | "path" | "decision" | "effect" | "unknown";

/** Entrypoint categories available from the initial flow catalog. */
export type CodeFlowEntrypointKind = "httpRoute" | "graphqlOperation";

/** Why a flow detail exists and which start mode should remain active. */
export type CodeFlowDetailKind = "entrypoint" | "symbol" | "functionLogic";

/** Source resolution shown without turning a callsite into a definition. */
export type CodeFlowResolution = "concrete" | "external" | "unresolved";

/** Stable gap vocabulary rendered as normal, explainable product state. */
export type CodeFlowGapReason =
  | "ambiguous"
  | "handlerNotMapped"
  | "depthLimit"
  | "stepLimit"
  | "entrypointNotFound"
  | "cycleOrDuplicate"
  | "sourceUnavailable"
  | "functionBodyNotFound"
  | "languageUnsupported"
  | "analysisLimitation";

/** Bounded request for searching supported entrypoint flows. */
export type CodeFlowCatalogRequest = {
  graphVersion: string;
  requestId: number;
  query: string;
  limit: number;
};

/** Request for opening a catalog entrypoint as a detailed flow. */
export type CodeFlowSelectRequest = {
  graphVersion: string;
  flowId: CodeFlowId;
};

/** Request for building context around one Host-issued concrete source token. */
export type CodeFlowSelectSourceRequest = {
  graphVersion: string;
  sourceToken: SourceNodeToken;
};

/** Requests owned by the CodeFlow vertical slice. */
export type CodeFlowRequest =
  | { type: "codeFlow/catalog"; payload: CodeFlowCatalogRequest }
  | { type: "codeFlow/select"; payload: CodeFlowSelectRequest }
  | { type: "codeFlow/selectSource"; payload: CodeFlowSelectSourceRequest }
  | { type: "codeFlow/openEvidence"; payload: CodeFlowOpenEvidenceRequest };

/** One compact entrypoint result rendered before its call steps are requested. */
export type CodeFlowCatalogItem = {
  id: CodeFlowId;
  kind: CodeFlowEntrypointKind;
  name: string;
  framework: string;
  scopeLabel?: string;
  detail: string;
  confidence?: EdgeConfidence;
  mapped: boolean;
  gapCount: number;
};

/** Coverage counters that explain what the bounded catalog represents. */
export type CodeFlowCatalogSummary = {
  entrypointCount: number;
  routeCount: number;
  operationCount: number;
  mappedCount: number;
  gapCount: number;
};

/** Correlated catalog page used for initial suggestions and text narrowing. */
export type CodeFlowCatalogPayload = {
  graphVersion: string;
  requestId: number;
  query: string;
  items: CodeFlowCatalogItem[];
  totalMatchCount: number;
  omittedMatchCount: number;
  summary: CodeFlowCatalogSummary;
};

/** One source-backed or explicitly unresolved step inside the Flow Reader. */
export type CodeFlowStepPayload = {
  id: string;
  parentId?: string;
  stage: CodeFlowStage;
  label: string;
  detail: string;
  depth: number;
  relation?: "calls" | "starts";
  confidence?: EdgeConfidence;
  resolution: CodeFlowResolution;
  architectureLayer?: ArchitecturalLayerPayload;
  sourceToken?: SourceNodeToken;
  sourceLocation?: string;
  evidenceLabel: string;
};

/** Visible explanation for an incomplete or deliberately bounded projection. */
export type CodeFlowGapPayload = {
  id: string;
  reason: CodeFlowGapReason;
  label: string;
  detail: string;
};

/** Small counters used to orient the reader without becoming a dashboard. */
export type CodeFlowDetailSummary = {
  stepCount: number;
  concreteStepCount: number;
  decisionStepCount: number;
  effectStepCount: number;
  unknownStepCount: number;
  gapCount: number;
};

/** Complete bounded projection for one entrypoint or selected function. */
export type CodeFlowDetailPayload = {
  graphVersion: string;
  id: CodeFlowId;
  kind: CodeFlowDetailKind;
  title: string;
  subtitle: string;
  semantics: "static";
  focusStepId?: string;
  steps: CodeFlowStepPayload[];
  logic?: FunctionLogicPayload;
  origins: CodeFlowCatalogItem[];
  gaps: CodeFlowGapPayload[];
  summary: CodeFlowDetailSummary;
};

/** Display-safe reason why an otherwise valid flow request could not complete. */
export type CodeFlowFailurePayload = {
  graphVersion: string;
  code:
    | "staleGraph"
    | "flowNotFound"
    | "sourceNotFound"
    | "sourceNotCallable"
    | "evidenceNotFound";
  message: string;
};
