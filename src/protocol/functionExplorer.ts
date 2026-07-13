/**
 * Function Explorer protocol contracts shared by the extension host and
 * Webview. These types describe JSON-serializable payloads only; index builders
 * may use Map or Set internally but must project them to arrays and plain
 * objects before posting messages.
 */

import type { EdgeConfidence, SourceRange } from "../shared/types";

/** Primitive values accepted in Function Explorer protocol metadata. */
export type FunctionExplorerJsonPrimitive = string | number | boolean | null;

/** JSON value used for extensible protocol metadata without allowing Map/Set. */
export type FunctionExplorerJsonValue =
  | FunctionExplorerJsonPrimitive
  | FunctionExplorerJsonValue[]
  | { [key: string]: FunctionExplorerJsonValue };

/** Top-level Function accordion sections addressed by row and chunk requests. */
export type FunctionExplorerSectionId =
  | "entrypoints"
  | "frameworkHandlers"
  | "hotspots"
  | "selected"
  | "unresolvedExternal"
  | "allFunctions";

/** Function-like node categories rendered by Function Explorer rows. */
export type FunctionExplorerFunctionKind =
  | "function"
  | "method"
  | "constructor"
  | "handler"
  | "external"
  | "unresolved";

/** Semantic role assigned to a callable by the Function Explorer index. */
export type FunctionExplorerRole =
  | "entrypoint"
  | "routeHandler"
  | "resolver"
  | "controller"
  | "service"
  | "repository"
  | "modelOperation"
  | "serializer"
  | "schema"
  | "component"
  | "hook"
  | "eventHandler"
  | "cliCommand"
  | "test"
  | "utility"
  | "adapter"
  | "factory"
  | "lifecycle"
  | "external"
  | "unresolved"
  | "unknown";

/** Lightweight tags that explain function behavior, origin, or risk signals. */
export type FunctionExplorerTag =
  | "async"
  | "exported"
  | "defaultExport"
  | "private"
  | "public"
  | "recursive"
  | "cycleMember"
  | "leaf"
  | "orchestrator"
  | "sharedUtility"
  | "sideEffect"
  | "database"
  | "network"
  | "filesystem"
  | "process"
  | "frameworkDispatch"
  | "dynamicCall"
  | "externalCall"
  | "unresolvedCall"
  | "testOnly";

/** Numeric relationship metrics precomputed for a callable index entry. */
export type FunctionExplorerMetrics = {
  directCallerCount: number;
  directCalleeCount: number;
  reachableEntrypointCount: number;
  unresolvedCallCount: number;
  externalCallCount: number;
  transitiveCallerCount?: number;
  transitiveCalleeCount?: number;
  entrypointDistance?: number;
  cycleSize?: number;
};

/** Sort keys supported by row chunk and inventory requests. */
export type FunctionExplorerSortKey =
  | "relevance"
  | "path"
  | "name"
  | "fan-in"
  | "fan-out"
  | "unresolved";

/** Filters sent by the Webview when requesting a row projection or inventory. */
export type FunctionExplorerFilters = {
  query?: string;
  filePath?: string;
  roles?: FunctionExplorerRole[];
  frameworks?: string[];
  confidences?: EdgeConfidence[];
  tags?: FunctionExplorerTag[];
  includeExternal?: boolean;
  includeUnresolved?: boolean;
  includeInferred?: boolean;
  includeTests?: boolean;
  includeGenerated?: boolean;
  includeMigrations?: boolean;
};

/** Traversal options for lazy expansion and selected-function relationship views. */
export type FunctionExplorerTraversalOptions = {
  direction: "callers" | "callees" | "both";
  maxDepth: number;
  maxRows: number;
  includeExternal?: boolean;
  includeUnresolved?: boolean;
  includeInferred?: boolean;
  includeTests?: boolean;
  stopAtFrameworkBoundary?: boolean;
  stopAtExternal?: boolean;
};

/** Summary fields that make hidden, unresolved, and inferred data explicit. */
export type FunctionExplorerSummary = {
  graphVersion: string;
  generatedAt: string;
  analyzedFileCount: number;
  skippedFileCount: number;
  parserFailureCount: number;
  excludedFileCount: number;
  callableNodeCount: number;
  callEdgeCount: number;
  externalCallableCount: number;
  unresolvedCallableCount: number;
  externalCallEdgeCount: number;
  unresolvedCallEdgeCount: number;
  inferredCallEdgeCount: number;
  visibleByDefaultViewCount: number;
  hiddenByDefaultViewCount: number;
  hiddenByCollapsedBranchCount: number;
  hiddenByActiveFilterCount: number;
};

/** Per-section availability summary used before lazy rows are requested. */
export type FunctionExplorerSectionSummary = {
  id: FunctionExplorerSectionId;
  title: string;
  totalRowCount: number;
  visibleRowCount: number;
  hiddenRowCount: number;
  hasMore: boolean;
  nextCursor?: string;
};

/** Row categories rendered by the Function Explorer tree or virtual inventory. */
export type FunctionExplorerRowKind =
  | "section"
  | "bucket"
  | "function"
  | "relation"
  | "call"
  | "diagnostic"
  | "more"
  | "empty";

/** Relationship represented by a row when it is tied to a source and target. */
export type FunctionExplorerRowRelation =
  | "caller"
  | "callee"
  | "entrypointPath"
  | "downstream"
  | "external"
  | "unresolved";

/**
 * Flat row projection consumed by the Webview. Rows carry enough identity and
 * pagination state for lazy expansion without requiring the full project graph.
 */
export type FunctionExplorerRow = {
  id: string;
  sectionId: FunctionExplorerSectionId;
  kind: FunctionExplorerRowKind;
  label: string;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
  parentId?: string;
  functionId?: string;
  symbolId?: string;
  edgeIds?: string[];
  relation?: FunctionExplorerRowRelation;
  detail?: string;
  filePath?: string;
  range?: SourceRange;
  functionKind?: FunctionExplorerFunctionKind;
  role?: FunctionExplorerRole;
  tags?: FunctionExplorerTag[];
  metrics?: FunctionExplorerMetrics;
  confidence?: EdgeConfidence;
  childCursor?: string;
  metadata?: { [key: string]: FunctionExplorerJsonValue };
};

/** Options echoed with an index-loaded payload so the Webview can diff state. */
export type FunctionExplorerPayloadOptions = {
  requestedSections: FunctionExplorerSectionId[];
  initialRowLimit: number;
  expandedRowIds?: string[];
  filters?: FunctionExplorerFilters;
  sortBy?: FunctionExplorerSortKey;
  selectedFunctionId?: string;
};

/** Initial Function Explorer index payload sent from Extension Host to Webview. */
export type FunctionExplorerPayload = {
  graphVersion: string;
  workspaceRoot: string;
  summary: FunctionExplorerSummary;
  sections: FunctionExplorerSectionSummary[];
  rows: FunctionExplorerRow[];
  options: FunctionExplorerPayloadOptions;
  nextCursor?: string;
};

/** Request for building or reusing the Function Explorer index for a graph. */
export type FunctionExplorerIndexRequest = {
  graphVersion?: string;
  options?: Partial<FunctionExplorerPayloadOptions>;
};

/** Request for one lazy section row chunk. */
export type FunctionExplorerSectionRowsRequest = {
  graphVersion: string;
  sectionId: FunctionExplorerSectionId;
  limit: number;
  cursor?: string;
  expandedRowIds?: string[];
  filters?: FunctionExplorerFilters;
  sortBy?: FunctionExplorerSortKey;
  selectedFunctionId?: string;
};

/** Request for expanding a specific row with traversal controls. */
export type FunctionExplorerExpandRequest = {
  graphVersion: string;
  sectionId: FunctionExplorerSectionId;
  rowId: string;
  options?: FunctionExplorerTraversalOptions;
};

/** Request for searching functions without loading the full inventory. */
export type FunctionExplorerSearchRequest = {
  graphVersion: string;
  query: string;
  limit: number;
  cursor?: string;
  filters?: FunctionExplorerFilters;
};

/** Request for selected-function relationship and path details. */
export type FunctionExplorerSelectRequest = {
  graphVersion: string;
  functionId: string;
  options?: FunctionExplorerTraversalOptions;
};

/** Request for a virtual-list page from the complete function inventory. */
export type FunctionExplorerInventoryRequest = {
  graphVersion: string;
  limit: number;
  cursor?: string;
  filters?: FunctionExplorerFilters;
  sortBy?: FunctionExplorerSortKey;
};

/** Webview-to-extension requests reserved for Function Explorer Phase 2+. */
export type FunctionExplorerRequest =
  | { type: "function/index"; payload: FunctionExplorerIndexRequest }
  | { type: "function/sectionRows"; payload: FunctionExplorerSectionRowsRequest }
  | { type: "function/expand"; payload: FunctionExplorerExpandRequest }
  | { type: "function/search"; payload: FunctionExplorerSearchRequest }
  | { type: "function/select"; payload: FunctionExplorerSelectRequest }
  | { type: "function/inventory"; payload: FunctionExplorerInventoryRequest };
