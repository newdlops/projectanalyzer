/**
 * Shared contracts for Function Index core construction and row projection.
 * Keeping these records in a type-only module prevents the reusable core and
 * request-local projector from depending on each other's implementations.
 */

import type { EdgeConfidence, SourceRange } from "../shared/types";

export type FunctionIndexNodeKind =
  | "function"
  | "method"
  | "constructor"
  | "external"
  | "unresolved";

export type FunctionIndexRole = "entrypoint" | "utility" | "external" | "unresolved" | "unknown";
export type FunctionIndexTag = "externalCall" | "unresolvedCall" | "leaf" | "sharedUtility";

/** Direct-call metrics stored for each real, external, or unresolved callable. */
export type FunctionIndexMetrics = {
  directCallerCount: number;
  directCalleeCount: number;
  reachableEntrypointCount: number;
  unresolvedCallCount: number;
  externalCallCount: number;
};

/** Derived callable record used by host-side function views and direct indexes. */
export type FunctionIndexNode = {
  id: string;
  symbolId: string;
  kind: FunctionIndexNodeKind;
  name: string;
  qualifiedName: string;
  filePath: string;
  range?: SourceRange;
  role: FunctionIndexRole;
  tags: FunctionIndexTag[];
  metrics: FunctionIndexMetrics;
  confidence: EdgeConfidence;
};

/** Collapsed direct caller/callee relation keyed by the related callable id. */
export type FunctionIndexRelation = {
  nodeId: string;
  symbolId: string;
  name: string;
  kind: FunctionIndexNodeKind;
  filePath: string;
  edgeIds: string[];
  callCount: number;
  confidences: EdgeConfidence[];
};

/** Completeness and coverage counters surfaced by the Function Explorer. */
export type FunctionIndexSummary = {
  graphVersion: string;
  callableNodeCount: number;
  callEdgeCount: number;
  externalCallableCount: number;
  unresolvedCallableCount: number;
  parserFailureCount: number;
  excludedFileCount: number;
  hiddenByDefaultViewCount: number;
  visibleByDefaultViewCount: number;
  externalCallEdgeCount: number;
  unresolvedCallEdgeCount: number;
  inferredCallEdgeCount: number;
};

/** Generic tree row shape consumed by the existing sidebar renderer. */
export type FunctionIndexTreeRow = {
  id: string;
  label: string;
  name: string;
  detail: string;
  kind: string;
  nodeId?: string;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
};

/** Request-local row expansion and inventory options. */
export type CreateFunctionIndexOptions = {
  expandedTreeIds?: Iterable<string>;
  includeInventoryRows?: boolean;
  inventoryLimit?: number;
};

/** Host-side callable index plus one request's row projections. */
export type FunctionIndex = {
  graphVersion: string;
  nodes: FunctionIndexNode[];
  nodesById: Map<string, FunctionIndexNode>;
  callersByNodeId: Map<string, FunctionIndexRelation[]>;
  calleesByNodeId: Map<string, FunctionIndexRelation[]>;
  metricsByNodeId: Map<string, FunctionIndexMetrics>;
  summary: FunctionIndexSummary;
  flowsRows: FunctionIndexTreeRow[];
  inventoryRows: FunctionIndexTreeRow[];
};

/** Reusable graph-wide core with request-local row projection. */
export type FunctionIndexProjector = {
  graphVersion: string;
  /** Returns the graph-wide node identities reused by bounded host queries. */
  getNodes(): readonly FunctionIndexNode[];
  project(options?: CreateFunctionIndexOptions): FunctionIndex;
};

/** Issue categories retained in the precomputed flow model. */
export type FunctionIndexIssueKind = "external" | "unresolved";

/** One grouped external or unresolved call relation. */
export type FunctionIndexIssueRelation = {
  kind: FunctionIndexIssueKind;
  sourceNode?: FunctionIndexNode;
  sourceLabel: string;
  targetId: string;
  targetNode?: FunctionIndexNode;
  targetLabel: string;
  count: number;
  confidences: Set<EdgeConfidence>;
};

/** One pre-ranked callable used by entrypoint and hotspot sections. */
export type FunctionIndexFlowRecord = {
  node: FunctionIndexNode;
  outgoing: FunctionIndexRelation[];
  incomingCallCount: number;
  outgoingCallCount: number;
};

/** Graph-wide section model reused by every expansion projection. */
export type FunctionIndexFlowModel = {
  entrypoints: FunctionIndexFlowRecord[];
  hotspots: FunctionIndexFlowRecord[];
  hotspotCandidateCount: number;
  externalCalls: FunctionIndexIssueRelation[];
  unresolvedCalls: FunctionIndexIssueRelation[];
  externalCallCount: number;
  unresolvedCallCount: number;
};
