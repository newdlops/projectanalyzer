/**
 * JSON-only contracts for the project-level Module Flow visualizer.
 *
 * The protocol deliberately projects host-side module, relation, graph-node, and
 * source-range identities as snapshot-local opaque references. Requests carry
 * explicit budgets so an untrusted Webview cannot ask the Extension Host to
 * serialize or traverse an unbounded project graph.
 */

import type { EdgeConfidence } from "../shared/types";
import type { ArchitecturalLayerPayload } from "./functionArchitecture";
import type { SourceNodeToken } from "./sourceNavigation";

/** Hard request budget for one initial module scene. */
export const MODULE_FLOW_LIST_MAX_MODULES = 80;

/** Dense module graphs receive an independent edge budget. */
export const MODULE_FLOW_LIST_MAX_EDGES = 160;

/** Module detail never returns an unbounded neighborhood. */
export const MODULE_FLOW_DETAIL_MAX_RELATIONS = 40;

/** The domain index currently retains at most five anchors per relation. */
export const MODULE_FLOW_DETAIL_MAX_EVIDENCE = 5;

/** One expansion stays small enough to animate and lay out in the existing tab. */
export const MODULE_FLOW_EXPAND_MAX_NODES = 48;

/** Expansion edges are capped separately because call boundaries may be dense. */
export const MODULE_FLOW_EXPAND_MAX_EDGES = 96;

/** Opaque snapshot-local identity for one project responsibility boundary. */
export type ModuleFlowModuleId = `module-flow-module:${string}`;

/** Opaque identity for one edge already projected into a Module Flow scene. */
export type ModuleFlowEdgeId = `module-flow-edge:${string}`;

/** Opaque canvas identity for a function exposed by lazy module expansion. */
export type ModuleFlowFunctionId = `module-flow-function:${string}`;

/** Opaque Host-authorized callsite or framework-evidence source range. */
export type ModuleFlowEvidenceToken = `module-flow-evidence:${string}`;

/** Canvas identities accepted as relation endpoints. */
export type ModuleFlowNodeId = ModuleFlowModuleId | ModuleFlowFunctionId;

/** User-selected relation lens for the module scene. */
export type ModuleFlowViewMode = "execution" | "dependency" | "boundary";

/** Browser-visible module-boundary basis, separate from language modules. */
export type ModuleFlowModuleBasis =
  | "workspacePackage"
  | "frameworkRoot"
  | "sourceArea"
  | "workspaceRoot"
  | "externalBoundary";

/** Module-level relation vocabulary preserved from the Host-side insight. */
export type ModuleFlowRelationKind =
  | "calls"
  | "imports"
  | "exports"
  | "routesTo"
  | "usesModel"
  | "renders"
  | "injects"
  | "configures"
  | "extends";

/** Exact confidence buckets; uncertainty is never collapsed to one label. */
export type ModuleFlowConfidenceCounts = Record<EdgeConfidence, number>;

/** One relation kind and its evidence count on a pair-aggregated visual edge. */
export type ModuleFlowRelationCountPayload = {
  kind: ModuleFlowRelationKind;
  count: number;
};

/** Compact direct metrics rendered inside a variable-size module box. */
export type ModuleFlowModuleMetricsPayload = {
  analyzedFileCount: number;
  descendantFileCount: number;
  callableCount: number;
  descendantCallableCount: number;
  frameworkUnitCount: number;
  entrypointCount: number;
  incomingEvidenceCount: number;
  outgoingEvidenceCount: number;
};

/** One project module projected without canonical roots or analyzer identities. */
export type ModuleFlowModuleNodePayload = {
  id: ModuleFlowModuleId;
  kind: "module";
  label: string;
  detail: string;
  /** Workspace-relative display text only; never an absolute Host path. */
  locationLabel?: string;
  parentId?: ModuleFlowModuleId;
  basis: ModuleFlowModuleBasis;
  confidence: EdgeConfidence;
  external: boolean;
  ecosystems: string[];
  frameworks: string[];
  metrics: ModuleFlowModuleMetricsPayload;
  expandable: {
    childModules: boolean;
    boundaryFunctions: boolean;
  };
};

/** One concrete callable exposed only after bounded module expansion. */
export type ModuleFlowFunctionNodePayload = {
  id: ModuleFlowFunctionId;
  kind: "function";
  label: string;
  detail: string;
  locationLabel?: string;
  sourceToken?: SourceNodeToken;
  architectureLayer?: ArchitecturalLayerPayload;
  confidence?: EdgeConfidence;
  incomingBoundaryCount: number;
  outgoingBoundaryCount: number;
};

/** Every node shape that may appear in a complete scene or expansion delta. */
export type ModuleFlowNodePayload =
  | ModuleFlowModuleNodePayload
  | ModuleFlowFunctionNodePayload;

/** Visual semantics distinguish aggregates, containment, and concrete calls. */
export type ModuleFlowEdgePresentationKind = "aggregate" | "contains" | "concreteCall";

/** One bounded visual edge; selected relation kinds for a pair share one route. */
export type ModuleFlowEdgePayload = {
  id: ModuleFlowEdgeId;
  sourceId: ModuleFlowNodeId;
  targetId: ModuleFlowNodeId;
  presentationKind: ModuleFlowEdgePresentationKind;
  relations: ModuleFlowRelationCountPayload[];
  confidenceCounts: ModuleFlowConfidenceCounts;
  evidenceCount: number;
  omittedEvidenceCount: number;
  hasDetails: boolean;
};

/** Exact coverage for the bounded initial scene. */
export type ModuleFlowListSummaryPayload = {
  analyzedFileCount: number;
  ownedFileCount: number;
  totalModuleCount: number;
  visibleModuleCount: number;
  omittedModuleCount: number;
  totalEdgeCount: number;
  visibleEdgeCount: number;
  omittedEdgeCount: number;
  crossModuleEvidenceCount: number;
  internalRelationEvidenceCount: number;
  externalRelationEvidenceCount: number;
  unownedRelationEvidenceCount: number;
};

/** Request for one bounded, flow-oriented project module scene. */
export type ModuleFlowListRequest = {
  graphVersion: string;
  requestId: number;
  mode: ModuleFlowViewMode;
  moduleLimit: number;
  edgeLimit: number;
  includeExternal?: boolean;
  includeInferred?: boolean;
};

/** Initial scene returned without the full Host-side module index. */
export type ModuleFlowListPayload = {
  graphVersion: string;
  requestId: number;
  mode: ModuleFlowViewMode;
  nodes: ModuleFlowModuleNodePayload[];
  edges: ModuleFlowEdgePayload[];
  summary: ModuleFlowListSummaryPayload;
};

/** Detail may address either one module box or one pair-aggregated visual edge. */
export type ModuleFlowDetailTarget =
  | { kind: "module"; id: ModuleFlowModuleId }
  | { kind: "edge"; id: ModuleFlowEdgeId };

/** Request for a bounded module neighborhood or bounded edge evidence sample. */
export type ModuleFlowDetailRequest = {
  graphVersion: string;
  requestId: number;
  target: ModuleFlowDetailTarget;
  relationLimit: number;
  evidenceLimit: number;
};

/** Display-safe explanation for one retained module-boundary signal. */
export type ModuleFlowBoundaryEvidencePayload = {
  kind:
    | "manifest"
    | "explicitRoot"
    | "framework"
    | "frameworkUnit"
    | "sourceArea"
    | "workspace"
    | "external";
  label: string;
};

/** One representative file that may be opened only through its source token. */
export type ModuleFlowSourcePayload = {
  label: string;
  sourceToken?: SourceNodeToken;
};

/** One retained, source-backed evidence row for an aggregated edge. */
export type ModuleFlowEvidencePayload = {
  label: string;
  source: "graphEdge" | "frameworkUnitEdge";
  confidence: EdgeConfidence;
  evidenceToken?: ModuleFlowEvidenceToken;
};

/** Module-specific detail with exact omitted counts for every bounded list. */
export type ModuleFlowModuleDetailPayload = {
  kind: "module";
  module: ModuleFlowModuleNodePayload;
  boundaryEvidence: ModuleFlowBoundaryEvidencePayload[];
  internalRelations: ModuleFlowRelationCountPayload[];
  representativeSources: ModuleFlowSourcePayload[];
  omittedSourceCount: number;
  incomingEdges: ModuleFlowEdgePayload[];
  outgoingEdges: ModuleFlowEdgePayload[];
  omittedIncomingEdgeCount: number;
  omittedOutgoingEdgeCount: number;
};

/** Edge-specific detail preserves confidence and bounded source anchors. */
export type ModuleFlowEdgeDetailPayload = {
  kind: "edge";
  edge: ModuleFlowEdgePayload;
  evidence: ModuleFlowEvidencePayload[];
  omittedEvidenceCount: number;
};

/** Correlated result for one detail target. */
export type ModuleFlowDetailPayload = {
  graphVersion: string;
  requestId: number;
  detail: ModuleFlowModuleDetailPayload | ModuleFlowEdgeDetailPayload;
};

/** Lazy expansion categories supported without requesting arbitrary recursion. */
export type ModuleFlowExpansionKind = "childModules" | "boundaryFunctions";

/** Direction used when selecting cross-module boundary callables. */
export type ModuleFlowExpansionDirection = "incoming" | "outgoing" | "both";

/** Request for one bounded, single-layer graph expansion around a module. */
export type ModuleFlowExpandRequest = {
  graphVersion: string;
  requestId: number;
  moduleId: ModuleFlowModuleId;
  expansion: ModuleFlowExpansionKind;
  direction: ModuleFlowExpansionDirection;
  nodeLimit: number;
  edgeLimit: number;
};

/** Exact coverage for a graph delta merged around one stable anchor. */
export type ModuleFlowExpandSummaryPayload = {
  candidateNodeCount: number;
  visibleNodeCount: number;
  omittedNodeCount: number;
  candidateEdgeCount: number;
  visibleEdgeCount: number;
  omittedEdgeCount: number;
};

/** Bounded, idempotent delta used while preserving the anchor's viewport position. */
export type ModuleFlowExpandPayload = {
  graphVersion: string;
  requestId: number;
  anchorModuleId: ModuleFlowModuleId;
  expansion: ModuleFlowExpansionKind;
  nodes: ModuleFlowNodePayload[];
  edges: ModuleFlowEdgePayload[];
  /** Aggregate routes hidden only when this delta completely replaces them. */
  replacedEdgeIds: ModuleFlowEdgeId[];
  summary: ModuleFlowExpandSummaryPayload;
};

/** Source definitions and exact evidence ranges use separate opaque authorities. */
export type ModuleFlowOpenSourceTarget =
  | { kind: "node"; sourceToken: SourceNodeToken }
  | { kind: "evidence"; evidenceToken: ModuleFlowEvidenceToken };

/** Request to reveal source previously authorized for the active snapshot. */
export type ModuleFlowOpenSourceRequest = {
  graphVersion: string;
  requestId: number;
  target: ModuleFlowOpenSourceTarget;
};

/** Requests owned by the Module Flow vertical slice. */
export type ModuleFlowRequest =
  | { type: "moduleFlow/list"; payload: ModuleFlowListRequest }
  | { type: "moduleFlow/detail"; payload: ModuleFlowDetailRequest }
  | { type: "moduleFlow/expand"; payload: ModuleFlowExpandRequest }
  | { type: "moduleFlow/openSource"; payload: ModuleFlowOpenSourceRequest };

/** Correlated display-safe failure for an accepted Module Flow request. */
export type ModuleFlowFailurePayload = {
  graphVersion: string;
  requestId: number;
  operation: "list" | "detail" | "expand" | "openSource";
  code:
    | "staleGraph"
    | "moduleNotFound"
    | "edgeNotFound"
    | "sourceNotFound"
    | "evidenceNotFound"
    | "projectionFailed";
  message: string;
};
