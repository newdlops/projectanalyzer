/**
 * Runtime validation for messages crossing from Webview JavaScript into the
 * extension host. The validators mirror WebviewRequest without depending on
 * VS Code so protocol boundaries can reject malformed values before dispatch.
 */

import type {
  FunctionExplorerFilters,
  FunctionExplorerPayloadOptions,
  FunctionExplorerTraversalOptions
} from "./functionExplorer";
import type { WebviewRequest } from "./messages";
import type { ProjectReadingScopePayloadId } from "./projectReadingGuide";

/** Successful or rejected result returned by the Webview request validator. */
export type WebviewRequestValidationResult =
  | { ok: true; value: WebviewRequest }
  | { ok: false; reason: string; receivedType?: string };

const GRAPH_VIEW_MODES = ["call", "file", "class"] as const;
const EXPORT_FORMATS = ["json", "graphml", "mermaid", "dot", "svg", "png", "markdown"] as const;
const FUNCTION_SECTIONS = [
  "entrypoints",
  "frameworkHandlers",
  "hotspots",
  "selected",
  "unresolvedExternal",
  "allFunctions"
] as const;
const FUNCTION_ROLES = [
  "entrypoint",
  "routeHandler",
  "resolver",
  "controller",
  "service",
  "repository",
  "modelOperation",
  "serializer",
  "schema",
  "component",
  "hook",
  "eventHandler",
  "cliCommand",
  "test",
  "utility",
  "adapter",
  "factory",
  "lifecycle",
  "external",
  "unresolved",
  "unknown"
] as const;
const FUNCTION_TAGS = [
  "async",
  "exported",
  "defaultExport",
  "private",
  "public",
  "recursive",
  "cycleMember",
  "leaf",
  "orchestrator",
  "sharedUtility",
  "sideEffect",
  "database",
  "network",
  "filesystem",
  "process",
  "frameworkDispatch",
  "dynamicCall",
  "externalCall",
  "unresolvedCall",
  "testOnly"
] as const;
const EDGE_CONFIDENCES = ["exact", "resolved", "inferred", "unresolved"] as const;
const FUNCTION_SORT_KEYS = ["relevance", "path", "name", "fan-in", "fan-out", "unresolved"] as const;

/**
 * Validates an untrusted Webview value and returns a typed request only after
 * its complete request-specific payload has passed validation.
 */
export function validateWebviewRequest(value: unknown): WebviewRequestValidationResult {
  try {
    return validateReadableWebviewRequest(value);
  } catch {
    // Access to hostile objects (for example, throwing Proxy getters) must not
    // escape the protocol boundary or interrupt extension-host message flow.
    return { ok: false, reason: "request could not be inspected safely" };
  }
}

/** Type-guard shorthand for callers that only need an acceptance decision. */
export function isWebviewRequest(value: unknown): value is WebviewRequest {
  return validateWebviewRequest(value).ok;
}

/** Dispatches validation based on the request discriminator. */
function validateReadableWebviewRequest(value: unknown): WebviewRequestValidationResult {
  if (!isRecord(value)) {
    return invalid("request must be an object");
  }

  const type = value.type;
  if (typeof type !== "string") {
    return invalid("request type must be a string");
  }

  const payload = value.payload;
  let payloadIsValid = false;

  switch (type) {
    case "ui/ready":
    case "graph/openPanel":
    case "graph/showWorkspaceScope":
    case "analysis/cancel":
    case "cache/clear":
      payloadIsValid = isEmptyRecord(payload);
      break;
    case "graph/load":
      payloadIsValid = isGraphLoadPayload(payload);
      break;
    case "graph/loadStructure":
      payloadIsValid = isRecord(payload) && typeof payload.graphVersion === "string";
      break;
    case "graph/focusNode":
    case "node/openSource":
      payloadIsValid = isNodeIdentityPayload(payload);
      break;
    case "graph/expand":
      payloadIsValid = isExpandPayload(payload);
      break;
    case "analysis/run":
      payloadIsValid = isRecord(payload) && isOneOf(payload.scope, ["workspace", "currentFile"]);
      break;
    case "node/showRelationship":
      payloadIsValid =
        isRecord(payload) &&
        typeof payload.nodeId === "string" &&
        isOneOf(payload.direction, ["callers", "callees"]);
      break;
    case "project/readingGuideScope":
      payloadIsValid =
        isRecord(payload) &&
        typeof payload.graphVersion === "string" &&
        isProjectReadingScopePayloadId(payload.scopeId);
      break;
    case "project/loadOverview":
      payloadIsValid = isRecord(payload) && typeof payload.graphVersion === "string";
      break;
    case "search/query":
      payloadIsValid = isRecord(payload) && typeof payload.query === "string";
      break;
    case "export/run":
      payloadIsValid = isRecord(payload) && isOneOf(payload.format, EXPORT_FORMATS);
      break;
    case "function/index":
      payloadIsValid = isFunctionIndexPayload(payload);
      break;
    case "function/sectionRows":
      payloadIsValid = isFunctionSectionRowsPayload(payload);
      break;
    case "function/expand":
      payloadIsValid = isFunctionExpandPayload(payload);
      break;
    case "function/search":
      payloadIsValid = isFunctionSearchPayload(payload);
      break;
    case "function/select":
      payloadIsValid = isFunctionSelectPayload(payload);
      break;
    case "function/inventory":
      payloadIsValid = isFunctionInventoryPayload(payload);
      break;
    case "telemetry/log":
      payloadIsValid = isWebviewLogPayload(payload);
      break;
    default:
      return invalid("request type is not supported", type);
  }

  if (!payloadIsValid) {
    return invalid("request payload is invalid", type);
  }

  return { ok: true, value: value as WebviewRequest };
}

/** Validates the common graph-load payload. */
function isGraphLoadPayload(value: unknown): boolean {
  return (
    isRecord(value) &&
    isOneOf(value.mode, GRAPH_VIEW_MODES) &&
    isOptionalString(value.rootNodeId) &&
    isNonNegativeInteger(value.depth)
  );
}

/** Validates payloads containing a graph node identity. */
function isNodeIdentityPayload(value: unknown): boolean {
  return isRecord(value) && typeof value.nodeId === "string";
}

/** Validates graph expansion depth and node identity. */
function isExpandPayload(value: unknown): boolean {
  return isRecord(value) && typeof value.nodeId === "string" && isNonNegativeInteger(value.depth);
}

/** Validates the Function Explorer index request and its partial options. */
function isFunctionIndexPayload(value: unknown): boolean {
  return (
    isRecord(value) &&
    isOptionalString(value.graphVersion) &&
    (value.options === undefined || isFunctionPayloadOptions(value.options))
  );
}

/** Validates lazy section pagination, projection, and filter fields. */
function isFunctionSectionRowsPayload(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.graphVersion === "string" &&
    isOneOf(value.sectionId, FUNCTION_SECTIONS) &&
    isNonNegativeInteger(value.limit) &&
    isOptionalString(value.cursor) &&
    isOptionalStringArray(value.expandedRowIds) &&
    isOptionalFunctionFilters(value.filters) &&
    isOptionalEnum(value.sortBy, FUNCTION_SORT_KEYS) &&
    isOptionalString(value.selectedFunctionId)
  );
}

/** Validates Function Explorer row expansion controls. */
function isFunctionExpandPayload(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.graphVersion === "string" &&
    isOneOf(value.sectionId, FUNCTION_SECTIONS) &&
    typeof value.rowId === "string" &&
    (value.options === undefined || isTraversalOptions(value.options))
  );
}

/** Validates Function Explorer search pagination and filters. */
function isFunctionSearchPayload(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.graphVersion === "string" &&
    typeof value.query === "string" &&
    isNonNegativeInteger(value.limit) &&
    isOptionalString(value.cursor) &&
    isOptionalFunctionFilters(value.filters)
  );
}

/** Validates selected-function relationship traversal controls. */
function isFunctionSelectPayload(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.graphVersion === "string" &&
    typeof value.functionId === "string" &&
    (value.options === undefined || isTraversalOptions(value.options))
  );
}

/** Validates virtual Function Explorer inventory pagination and sorting. */
function isFunctionInventoryPayload(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.graphVersion === "string" &&
    isNonNegativeInteger(value.limit) &&
    isOptionalString(value.cursor) &&
    isOptionalFunctionFilters(value.filters) &&
    isOptionalEnum(value.sortBy, FUNCTION_SORT_KEYS)
  );
}

/** Validates partial index options accepted by function/index. */
function isFunctionPayloadOptions(value: unknown): value is Partial<FunctionExplorerPayloadOptions> {
  return (
    isRecord(value) &&
    (value.requestedSections === undefined || isEnumArray(value.requestedSections, FUNCTION_SECTIONS)) &&
    (value.initialRowLimit === undefined || isNonNegativeInteger(value.initialRowLimit)) &&
    isOptionalStringArray(value.expandedRowIds) &&
    isOptionalFunctionFilters(value.filters) &&
    isOptionalEnum(value.sortBy, FUNCTION_SORT_KEYS) &&
    isOptionalString(value.selectedFunctionId)
  );
}

/** Validates every optional Function Explorer filter when it is present. */
function isFunctionFilters(value: unknown): value is FunctionExplorerFilters {
  return (
    isRecord(value) &&
    isOptionalString(value.query) &&
    isOptionalString(value.filePath) &&
    (value.roles === undefined || isEnumArray(value.roles, FUNCTION_ROLES)) &&
    isOptionalStringArray(value.frameworks) &&
    (value.confidences === undefined || isEnumArray(value.confidences, EDGE_CONFIDENCES)) &&
    (value.tags === undefined || isEnumArray(value.tags, FUNCTION_TAGS)) &&
    isOptionalBoolean(value.includeExternal) &&
    isOptionalBoolean(value.includeUnresolved) &&
    isOptionalBoolean(value.includeInferred) &&
    isOptionalBoolean(value.includeTests) &&
    isOptionalBoolean(value.includeGenerated) &&
    isOptionalBoolean(value.includeMigrations)
  );
}

/** Validates bounded traversal options without traversing graph data. */
function isTraversalOptions(value: unknown): value is FunctionExplorerTraversalOptions {
  return (
    isRecord(value) &&
    isOneOf(value.direction, ["callers", "callees", "both"]) &&
    isNonNegativeInteger(value.maxDepth) &&
    isNonNegativeInteger(value.maxRows) &&
    isOptionalBoolean(value.includeExternal) &&
    isOptionalBoolean(value.includeUnresolved) &&
    isOptionalBoolean(value.includeInferred) &&
    isOptionalBoolean(value.includeTests) &&
    isOptionalBoolean(value.stopAtFrameworkBoundary) &&
    isOptionalBoolean(value.stopAtExternal)
  );
}

/** Validates Webview diagnostic logs before a requested level is dispatched. */
function isWebviewLogPayload(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.fields === undefined || isRecord(value.fields)) &&
    isOneOf(value.level, ["debug", "info", "warn", "error"]) &&
    typeof value.message === "string" &&
    isOneOf(value.source, ["graphPanel", "sidebar"])
  );
}

/** Narrows non-array objects used as protocol records. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Matches Record<string, never> payloads used by signal-only requests. */
function isEmptyRecord(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).length === 0;
}

/** Accepts finite whole numbers suitable for depths, limits, and row counts. */
function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Validates an optional string field. */
function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

/** Accepts only fixed-size opaque scope tokens issued by the host adapter. */
function isProjectReadingScopePayloadId(value: unknown): value is ProjectReadingScopePayloadId {
  return typeof value === "string" && /^reading-scope:[0-9a-f]{24}$/u.test(value);
}

/** Validates an optional boolean field. */
function isOptionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === "boolean";
}

/** Validates optional arrays whose entries must all be strings. */
function isOptionalStringArray(value: unknown): value is string[] | undefined {
  return value === undefined || (Array.isArray(value) && value.every((entry) => typeof entry === "string"));
}

/** Validates optional Function Explorer filter records. */
function isOptionalFunctionFilters(value: unknown): value is FunctionExplorerFilters | undefined {
  return value === undefined || isFunctionFilters(value);
}

/** Checks one string literal against a fixed protocol vocabulary. */
function isOneOf<T extends string>(value: unknown, choices: readonly T[]): value is T {
  return typeof value === "string" && choices.some((choice) => choice === value);
}

/** Validates an optional member of a fixed string vocabulary. */
function isOptionalEnum<T extends string>(value: unknown, choices: readonly T[]): value is T | undefined {
  return value === undefined || isOneOf(value, choices);
}

/** Validates arrays whose entries belong to a fixed string vocabulary. */
function isEnumArray<T extends string>(value: unknown, choices: readonly T[]): value is T[] {
  return Array.isArray(value) && value.every((entry) => isOneOf(entry, choices));
}

/** Creates a stable rejection without retaining arbitrary untrusted payloads. */
function invalid(reason: string, receivedType?: string): WebviewRequestValidationResult {
  return receivedType === undefined ? { ok: false, reason } : { ok: false, reason, receivedType };
}
