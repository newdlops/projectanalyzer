/**
 * Function Explorer row adapter for framework-dispatched handler semantics.
 *
 * The semantic matcher owns framework-specific evidence. This module only
 * projects those per-function matches into stable, expandable protocol rows.
 */

import type {
  FunctionExplorerFunctionKind,
  FunctionExplorerJsonValue,
  FunctionExplorerRole,
  FunctionExplorerRow,
  FunctionExplorerTag
} from "../protocol/functionExplorer";
import type { EdgeConfidence, FrameworkUnit, ProjectGraph, SourceRange, SymbolKind, SymbolNode } from "../shared/types";
import { createFunctionFrameworkSemantics } from "./functionFrameworkSemantics";

/** Root row id used by Function Flows expansion state for framework handlers. */
export const FRAMEWORK_HANDLER_ROWS_ROOT_ID = "function-flows:framework-handlers";

/** Options for projecting framework handler semantics into Function Explorer rows. */
export type CreateFrameworkHandlerRowsOptions = {
  expandedRowIds?: Iterable<string>;
  limit?: number;
};

/** Bounded row result plus pre-limit row counts for section summaries. */
export type FrameworkHandlerRowsResult = {
  rows: FunctionExplorerRow[];
  visibleRowCount: number;
  totalRowCount: number;
};

type RawFrameworkSemanticMatch = {
  functionId: string;
  frameworkUnitId: string;
  framework?: string;
  unitKind?: string;
  role?: string;
  tags: string[];
  evidence: FunctionExplorerJsonValue[];
  confidence?: string;
};

type FrameworkHandlerRecord = {
  functionId: string;
  symbolId: string;
  label: string;
  filePath: string;
  range?: SourceRange;
  functionKind: FunctionExplorerFunctionKind;
  framework: string;
  frameworkUnitId: string;
  frameworkUnitKind: string;
  frameworkUnitLabel: string;
  role: FunctionExplorerRole;
  tags: FunctionExplorerTag[];
  evidence: FunctionExplorerJsonValue[];
  confidence: EdgeConfidence;
};

type FrameworkRecordGroup = {
  framework: string;
  records: FrameworkHandlerRecord[];
  unitKindGroups: UnitKindRecordGroup[];
};

type UnitKindRecordGroup = {
  unitKind: string;
  records: FrameworkHandlerRecord[];
};

const VALID_ROLES = new Set<FunctionExplorerRole>([
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
]);

const VALID_TAGS = new Set<FunctionExplorerTag>([
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
]);

const CONFIDENCE_ORDER: EdgeConfidence[] = ["exact", "resolved", "inferred", "unresolved"];
const DEFAULT_CONFIDENCE: EdgeConfidence = "inferred";

/**
 * Converts framework-function semantic matches into a `frameworkHandlers`
 * Function Explorer section. Expansion is explicit and bounded by stable row ids.
 */
export function createFrameworkHandlerRows(
  graph: ProjectGraph,
  options: CreateFrameworkHandlerRowsOptions = {}
): FrameworkHandlerRowsResult {
  const expandedRowIds = new Set(options.expandedRowIds ?? []);
  const records = createFrameworkHandlerRecords(graph);
  const frameworkGroups = createFrameworkGroups(records);
  const rows = createRowsForGroups(graph, frameworkGroups, expandedRowIds);
  const totalRowCount = rows.length;
  const visibleRows = applyRowLimit(rows, options.limit);

  if (visibleRows.length < totalRowCount) {
    const omittedCount = totalRowCount - visibleRows.length;
    visibleRows[0] = {
      ...visibleRows[0],
      detail: appendDetail(visibleRows[0]?.detail ?? "", omittedCount + " rows omitted by limit")
    };
  }

  return {
    rows: visibleRows,
    visibleRowCount: visibleRows.length,
    totalRowCount
  };
}

/** Creates normalized records from semantic matches and graph nodes. */
function createFrameworkHandlerRecords(graph: ProjectGraph): FrameworkHandlerRecord[] {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const unitsById = new Map((graph.metadata.frameworkUnits ?? []).map((unit) => [unit.id, unit]));
  const rawMatches = readFrameworkSemanticMatches(createFunctionFrameworkSemantics(graph));
  const recordsByKey = new Map<string, FrameworkHandlerRecord>();

  for (const match of rawMatches) {
    const unit = unitsById.get(match.frameworkUnitId);
    const node = nodesById.get(match.functionId);
    const record = createFrameworkHandlerRecord(match, node, unit);
    const key = getRecordKey(record);
    const existing = recordsByKey.get(key);

    if (existing) {
      recordsByKey.set(key, mergeFrameworkHandlerRecords(existing, record));
    } else {
      recordsByKey.set(key, record);
    }
  }

  return [...recordsByKey.values()].sort(compareFrameworkHandlerRecords);
}

/** Builds one row-ready handler record with graph fallbacks for labels and ranges. */
function createFrameworkHandlerRecord(
  match: RawFrameworkSemanticMatch,
  node: SymbolNode | undefined,
  unit: FrameworkUnit | undefined
): FrameworkHandlerRecord {
  const frameworkUnitKind = match.unitKind ?? unit?.kind ?? "unknown";
  const role = normalizeRole(match.role, frameworkUnitKind);
  const tags = normalizeTags(match.tags);
  const confidence = normalizeConfidence(match.confidence);
  const filePath = node?.filePath ?? unit?.filePath ?? "";

  return {
    functionId: match.functionId,
    symbolId: node?.id ?? match.functionId,
    label: getFunctionLabel(node, match.functionId),
    filePath,
    range: node?.range ?? unit?.range,
    functionKind: normalizeFunctionKind(node?.kind),
    framework: match.framework ?? unit?.framework ?? "Unknown",
    frameworkUnitId: match.frameworkUnitId,
    frameworkUnitKind,
    frameworkUnitLabel: getFrameworkUnitLabel(unit, match.frameworkUnitId),
    role,
    tags,
    evidence: match.evidence,
    confidence,
  };
}

/** Groups records by framework and unit kind for compact, non-flat expansion. */
function createFrameworkGroups(records: FrameworkHandlerRecord[]): FrameworkRecordGroup[] {
  const recordsByFramework = new Map<string, FrameworkHandlerRecord[]>();

  for (const record of records) {
    const frameworkRecords = recordsByFramework.get(record.framework) ?? [];
    frameworkRecords.push(record);
    recordsByFramework.set(record.framework, frameworkRecords);
  }

  return [...recordsByFramework.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([framework, frameworkRecords]) => ({
      framework,
      records: frameworkRecords,
      unitKindGroups: createUnitKindGroups(frameworkRecords)
    }));
}

/** Groups records within one framework by framework unit kind. */
function createUnitKindGroups(records: FrameworkHandlerRecord[]): UnitKindRecordGroup[] {
  const recordsByUnitKind = new Map<string, FrameworkHandlerRecord[]>();

  for (const record of records) {
    const unitKindRecords = recordsByUnitKind.get(record.frameworkUnitKind) ?? [];
    unitKindRecords.push(record);
    recordsByUnitKind.set(record.frameworkUnitKind, unitKindRecords);
  }

  return [...recordsByUnitKind.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([unitKind, unitKindRecords]) => ({
      unitKind,
      records: [...unitKindRecords].sort(compareFrameworkHandlerRecords)
    }));
}

/** Creates protocol rows for the currently expanded framework handler branches. */
function createRowsForGroups(
  graph: ProjectGraph,
  frameworkGroups: FrameworkRecordGroup[],
  expandedRowIds: Set<string>
): FunctionExplorerRow[] {
  const rows: FunctionExplorerRow[] = [];
  const handlerCount = frameworkGroups.reduce((count, group) => count + group.records.length, 0);
  const hasChildren = handlerCount > 0;
  const sectionExpanded = hasChildren && expandedRowIds.has(FRAMEWORK_HANDLER_ROWS_ROOT_ID);

  rows.push({
    id: FRAMEWORK_HANDLER_ROWS_ROOT_ID,
    sectionId: "frameworkHandlers",
    kind: "section",
    label: "Framework Handlers",
    depth: 0,
    hasChildren,
    expanded: sectionExpanded,
    detail: createSectionDetail(frameworkGroups)
  });

  if (!sectionExpanded) {
    return rows;
  }

  for (const frameworkGroup of frameworkGroups) {
    appendFrameworkGroupRows(graph, frameworkGroup, expandedRowIds, rows);
  }

  return rows;
}

/** Appends one framework bucket and, when expanded, its unit-kind buckets. */
function appendFrameworkGroupRows(
  graph: ProjectGraph,
  frameworkGroup: FrameworkRecordGroup,
  expandedRowIds: Set<string>,
  rows: FunctionExplorerRow[]
): void {
  const rowId = getFrameworkRowId(frameworkGroup.framework);
  const expanded = expandedRowIds.has(rowId);

  rows.push({
    id: rowId,
    sectionId: "frameworkHandlers",
    kind: "bucket",
    label: frameworkGroup.framework,
    depth: 1,
    parentId: FRAMEWORK_HANDLER_ROWS_ROOT_ID,
    hasChildren: frameworkGroup.unitKindGroups.length > 0,
    expanded,
    detail: createHandlerUnitDetail(frameworkGroup.records)
  });

  if (!expanded) {
    return;
  }

  for (const unitKindGroup of frameworkGroup.unitKindGroups) {
    appendUnitKindGroupRows(graph, rowId, unitKindGroup, expandedRowIds, rows);
  }
}

/** Appends one unit-kind bucket and, when expanded, its function rows. */
function appendUnitKindGroupRows(
  graph: ProjectGraph,
  parentRowId: string,
  unitKindGroup: UnitKindRecordGroup,
  expandedRowIds: Set<string>,
  rows: FunctionExplorerRow[]
): void {
  const rowId = getUnitKindRowId(parentRowId, unitKindGroup.unitKind);
  const expanded = expandedRowIds.has(rowId);

  rows.push({
    id: rowId,
    sectionId: "frameworkHandlers",
    kind: "bucket",
    label: getUnitKindLabel(unitKindGroup.unitKind),
    depth: 2,
    parentId: parentRowId,
    hasChildren: unitKindGroup.records.length > 0,
    expanded,
    detail: createHandlerUnitDetail(unitKindGroup.records),
    metadata: {
      frameworkUnitKind: unitKindGroup.unitKind
    }
  });

  if (!expanded) {
    return;
  }

  for (const record of unitKindGroup.records) {
    rows.push(createFunctionRow(graph, rowId, record));
  }
}

/** Creates one framework-dispatched function protocol row. */
function createFunctionRow(
  graph: ProjectGraph,
  parentRowId: string,
  record: FrameworkHandlerRecord
): FunctionExplorerRow {
  return {
    id: getFunctionRowId(parentRowId, record),
    sectionId: "frameworkHandlers",
    kind: "function",
    label: record.label,
    depth: 3,
    parentId: parentRowId,
    hasChildren: false,
    expanded: false,
    functionId: record.functionId,
    symbolId: record.symbolId,
    detail: createFunctionDetail(graph, record),
    filePath: record.filePath,
    range: record.range,
    functionKind: record.functionKind,
    role: record.role,
    tags: record.tags,
    confidence: record.confidence,
    metadata: {
      framework: record.framework,
      frameworkUnitId: record.frameworkUnitId,
      frameworkUnitKind: record.frameworkUnitKind,
      frameworkUnitLabel: record.frameworkUnitLabel,
      evidence: record.evidence
    }
  };
}

/** Reads matches from the expected semantics API while tolerating result wrappers. */
function readFrameworkSemanticMatches(value: unknown): RawFrameworkSemanticMatch[] {
  const candidateValues = getSemanticMatchCandidates(value);
  const matches: RawFrameworkSemanticMatch[] = [];

  for (const candidate of candidateValues) {
    const nestedCandidates = Array.isArray(candidate) ? candidate : [candidate];

    for (const nestedCandidate of nestedCandidates) {
      const match = readFrameworkSemanticMatch(nestedCandidate);

      if (match) {
        matches.push(match);
      }
    }
  }

  return matches;
}

function getSemanticMatchCandidates(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (!isRecord(value)) {
    return [];
  }

  for (const propertyName of ["semantics", "records", "matches", "handlers", "functions", "functionRecords"]) {
    const propertyValue = value[propertyName];

    if (Array.isArray(propertyValue)) {
      return propertyValue;
    }
  }

  const byFunctionId = value.semanticsByFunctionId ?? value.byFunctionId;

  if (byFunctionId instanceof Map) {
    return [...byFunctionId.values()];
  }

  if (isRecord(byFunctionId)) {
    return Object.values(byFunctionId);
  }

  return [];
}

function readFrameworkSemanticMatch(value: unknown): RawFrameworkSemanticMatch | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const functionId = getString(value.functionId);
  const frameworkUnitId = getString(value.frameworkUnitId);

  if (!functionId || !frameworkUnitId) {
    return undefined;
  }

  return {
    functionId,
    frameworkUnitId,
    framework: getString(value.framework),
    unitKind: getString(value.unitKind),
    role: getString(value.role),
    tags: getStringArray(value.tags),
    evidence: normalizeEvidence(value.evidence),
    confidence: getString(value.confidence)
  };
}

function mergeFrameworkHandlerRecords(
  left: FrameworkHandlerRecord,
  right: FrameworkHandlerRecord
): FrameworkHandlerRecord {
  return {
    ...left,
    role: left.role === "unknown" ? right.role : left.role,
    tags: mergeTags(left.tags, right.tags),
    evidence: mergeEvidence(left.evidence, right.evidence),
    confidence: choosePreferredConfidence(left.confidence, right.confidence)
  };
}

function getRecordKey(record: FrameworkHandlerRecord): string {
  return [
    record.framework,
    record.frameworkUnitKind,
    record.frameworkUnitId,
    record.functionId
  ].join("\u0000");
}

function compareFrameworkHandlerRecords(left: FrameworkHandlerRecord, right: FrameworkHandlerRecord): number {
  return left.framework.localeCompare(right.framework) ||
    left.frameworkUnitKind.localeCompare(right.frameworkUnitKind) ||
    left.filePath.localeCompare(right.filePath) ||
    left.label.localeCompare(right.label) ||
    left.functionId.localeCompare(right.functionId) ||
    left.frameworkUnitId.localeCompare(right.frameworkUnitId);
}

function applyRowLimit(rows: FunctionExplorerRow[], limit: number | undefined): FunctionExplorerRow[] {
  if (limit === undefined || !Number.isFinite(limit)) {
    return rows;
  }

  return rows.slice(0, Math.max(1, Math.floor(limit)));
}

function createSectionDetail(frameworkGroups: FrameworkRecordGroup[]): string {
  const records = frameworkGroups.flatMap((group) => group.records);
  const frameworkCount = frameworkGroups.length;

  return createHandlerUnitDetail(records) + " / " + frameworkCount + " " + pluralize("framework", frameworkCount);
}

function createHandlerUnitDetail(records: FrameworkHandlerRecord[]): string {
  const handlerCount = records.length;
  const unitCount = countUnique(records.map((record) => record.frameworkUnitId));

  return handlerCount + " " + pluralize("handler", handlerCount) +
    " / " +
    unitCount +
    " framework " +
    pluralize("unit", unitCount);
}

function createFunctionDetail(graph: ProjectGraph, record: FrameworkHandlerRecord): string {
  return [
    record.role,
    getRelativePath(graph, record.filePath),
    record.frameworkUnitLabel,
    record.confidence
  ].filter((part) => part.length > 0).join(" / ");
}

function appendDetail(detail: string, addition: string): string {
  return detail ? detail + " / " + addition : addition;
}

function getFrameworkRowId(framework: string): string {
  return FRAMEWORK_HANDLER_ROWS_ROOT_ID + ":framework:" + encodeRowPart(framework);
}

function getUnitKindRowId(parentRowId: string, unitKind: string): string {
  return parentRowId + ":unit-kind:" + encodeRowPart(unitKind);
}

function getFunctionRowId(parentRowId: string, record: FrameworkHandlerRecord): string {
  return parentRowId +
    ":function:" +
    encodeRowPart(record.frameworkUnitId) +
    ":" +
    encodeRowPart(record.functionId);
}

function encodeRowPart(value: string): string {
  const normalized = value.trim() || "unknown";

  return encodeURIComponent(normalized);
}

function getFunctionLabel(node: SymbolNode | undefined, functionId: string): string {
  return node?.qualifiedName || node?.name || functionId;
}

function getFrameworkUnitLabel(unit: FrameworkUnit | undefined, frameworkUnitId: string): string {
  return unit?.qualifiedName || unit?.name || frameworkUnitId;
}

function getUnitKindLabel(unitKind: string): string {
  const normalized = unitKind.trim() || "unknown";

  return normalized.slice(0, 1).toUpperCase() + normalized.slice(1);
}

function normalizeFunctionKind(kind: SymbolKind | undefined): FunctionExplorerFunctionKind {
  if (kind === "function" || kind === "method" || kind === "constructor" || kind === "external") {
    return kind;
  }

  return "handler";
}

function normalizeRole(role: string | undefined, unitKind: string): FunctionExplorerRole {
  if (isFunctionExplorerRole(role)) {
    return role;
  }

  switch (unitKind) {
    case "operation":
      return "resolver";
    case "route":
      return "routeHandler";
    case "controller":
      return "controller";
    case "service":
      return "service";
    case "repository":
      return "repository";
    case "model":
      return "modelOperation";
    case "serializer":
      return "serializer";
    case "schema":
      return "schema";
    case "component":
      return "component";
    case "command":
      return "cliCommand";
    case "middleware":
    case "provider":
      return "adapter";
    default:
      return "unknown";
  }
}

function normalizeTags(tags: string[]): FunctionExplorerTag[] {
  const normalizedTags = tags.filter(isFunctionExplorerTag);

  if (!normalizedTags.includes("frameworkDispatch")) {
    normalizedTags.push("frameworkDispatch");
  }

  return mergeTags([], normalizedTags);
}

function mergeTags(left: FunctionExplorerTag[], right: FunctionExplorerTag[]): FunctionExplorerTag[] {
  return [...new Set([...left, ...right])].sort((leftTag, rightTag) => leftTag.localeCompare(rightTag));
}

function normalizeConfidence(confidence: string | undefined): EdgeConfidence {
  return isEdgeConfidence(confidence) ? confidence : DEFAULT_CONFIDENCE;
}

function choosePreferredConfidence(left: EdgeConfidence, right: EdgeConfidence): EdgeConfidence {
  return CONFIDENCE_ORDER.indexOf(left) <= CONFIDENCE_ORDER.indexOf(right) ? left : right;
}

function normalizeEvidence(value: unknown): FunctionExplorerJsonValue[] {
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
  const evidence: FunctionExplorerJsonValue[] = [];

  for (const item of values) {
    const normalized = toJsonProtocolValue(item);

    if (normalized !== undefined) {
      evidence.push(normalized);
    }
  }

  return evidence;
}

function mergeEvidence(
  left: FunctionExplorerJsonValue[],
  right: FunctionExplorerJsonValue[]
): FunctionExplorerJsonValue[] {
  const merged: FunctionExplorerJsonValue[] = [];
  const seenKeys = new Set<string>();

  for (const item of [...left, ...right]) {
    const key = JSON.stringify(item);

    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      merged.push(item);
    }
  }

  return merged;
}

function toJsonProtocolValue(value: unknown): FunctionExplorerJsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  try {
    const serialized = JSON.stringify(value);

    if (!serialized) {
      return String(value);
    }

    return JSON.parse(serialized) as FunctionExplorerJsonValue;
  } catch {
    return String(value);
  }
}

function isFunctionExplorerRole(value: string | undefined): value is FunctionExplorerRole {
  return value !== undefined && VALID_ROLES.has(value as FunctionExplorerRole);
}

function isFunctionExplorerTag(value: string): value is FunctionExplorerTag {
  return VALID_TAGS.has(value as FunctionExplorerTag);
}

function isEdgeConfidence(value: string | undefined): value is EdgeConfidence {
  return value === "exact" || value === "resolved" || value === "inferred" || value === "unresolved";
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function countUnique(values: string[]): number {
  return new Set(values).size;
}

function pluralize(word: string, count: number): string {
  return count === 1 ? word : word + "s";
}

function getRelativePath(graph: ProjectGraph, filePath: string): string {
  if (!filePath) {
    return "";
  }

  const workspaceRoot = graph.workspaceRoot.replace(/\\/g, "/");
  const normalized = filePath.replace(/\\/g, "/");

  if (normalized.startsWith(workspaceRoot + "/")) {
    return normalized.slice(workspaceRoot.length + 1);
  }

  return normalized.split("/").slice(-3).join("/");
}
