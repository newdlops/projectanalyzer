/**
 * Pure server-side query for the complete Function Index callable set.
 *
 * The query applies bounded search, deterministic relevance/path ordering, and
 * snapshot-bound opaque pagination without rebuilding graph-wide call indexes.
 */

import type { FunctionIndexNode } from "../../graph/functionIndex";
import {
  createFunctionArchitecturePayload,
  formatFunctionArchitectureSummary
} from "../functionArchitecture";
import type { FunctionArchitectureIndex } from "../../insights/architecturalLayers";
import type { FunctionArchitecturePayload } from "../../protocol/functionArchitecture";
import type {
  FunctionExplorerSearchRow,
  FunctionExplorerSearchPayload,
  FunctionExplorerSearchRequest
} from "../../protocol/functionExplorer";
import type { SourceNodeToken } from "../../protocol/sourceNavigation";
import { createContentHash } from "../../shared/hash";
import { createPortableProjectPathNormalizer } from "../../shared/portableProjectPath";

/** Hard protocol budget for one callable search page. */
export const FUNCTION_SEARCH_MAX_PAGE_SIZE = 100;

/** Inputs retained by the Extension Host while the Webview receives only rows. */
export type FunctionSearchQueryInput = {
  workspaceRoot: string;
  nodes: readonly FunctionIndexNode[];
  architectureIndex?: FunctionArchitectureIndex;
  request: FunctionExplorerSearchRequest;
  /** Host-owned token factory; raw graph identities are never serialized. */
  createSourceToken?(nodeId: string): SourceNodeToken | undefined;
};

/** Internal ranked match with its workspace-relative display location. */
type FunctionSearchMatch = {
  node: FunctionIndexNode;
  locationPath: string;
  matchScore: number;
  relevanceScore: number;
  architecture?: FunctionArchitecturePayload;
};

/** Cursor fields are intentionally private so clients treat the token as opaque. */
type FunctionSearchCursorState = {
  version: 1;
  offset: number;
  proof: string;
};

const CURSOR_PREFIX = "function-search:";
const CURSOR_VERSION = 1;
const CURSOR_PROOF_LENGTH = 24;
const SEARCH_LABEL_CHARACTER_LIMIT = 160;
const SEARCH_LOCATION_CHARACTER_LIMIT = 200;

/**
 * Searches one cached Function Index core and returns a bounded protocol page.
 * Empty queries enumerate the filtered universe in the same deterministic
 * relevance/path order used for textual matches.
 */
export function searchFunctionIndex(
  input: FunctionSearchQueryInput
): FunctionExplorerSearchPayload {
  const normalizedQuery = normalizeText(input.request.query);
  const includeExternal = input.request.filters?.includeExternal !== false;
  const includeUnresolved = input.request.filters?.includeUnresolved !== false;
  const pathNormalizer = createPortableProjectPathNormalizer(input.workspaceRoot);
  const matches: FunctionSearchMatch[] = [];

  for (const node of input.nodes) {
    if (!shouldIncludeNode(node, includeExternal, includeUnresolved)) {
      continue;
    }

    const normalizedLocation = pathNormalizer.normalize(node.filePath).displayPath;
    const locationPath = createSafeLocationPath(normalizedLocation, node.filePath);
    const matchScore = getMatchScore(node, locationPath, normalizedQuery);
    if (matchScore === undefined) {
      continue;
    }

    const assessment = input.architectureIndex?.assessmentsByFunctionId.get(node.id);
    const architecture = assessment ? createFunctionArchitecturePayload(assessment) : undefined;
    matches.push({
      node,
      locationPath,
      matchScore,
      relevanceScore: getRelevanceScore(node, architecture),
      architecture
    });
  }

  matches.sort(compareFunctionSearchMatches);

  const totalMatchCount = matches.length;
  const pageSize = normalizePageSize(input.request.limit);
  const cursorSignature = createCursorSignature(
    input.request.graphVersion,
    normalizedQuery,
    includeExternal,
    includeUnresolved
  );
  const startOffset = resolveCursorOffset(
    input.request.cursor,
    cursorSignature,
    totalMatchCount
  );
  const endOffset = Math.min(totalMatchCount, startOffset + pageSize);
  const page = matches.slice(startOffset, endOffset);
  const payload: FunctionExplorerSearchPayload = {
    graphVersion: input.request.graphVersion,
    requestId: input.request.requestId,
    query: input.request.query,
    rows: page.map((match) => createSearchRow(match, input.createSourceToken)),
    totalMatchCount
  };

  if (pageSize > 0 && endOffset < totalMatchCount) {
    payload.nextCursor = createCursor(endOffset, cursorSignature);
  }

  return payload;
}

/** Applies only the completeness filters supported by this vertical slice. */
function shouldIncludeNode(
  node: FunctionIndexNode,
  includeExternal: boolean,
  includeUnresolved: boolean
): boolean {
  return !(
    (node.kind === "external" && !includeExternal)
    || (node.kind === "unresolved" && !includeUnresolved)
  );
}

/** Ranks exact and prefix symbol matches before broader path matches. */
function getMatchScore(
  node: FunctionIndexNode,
  locationPath: string,
  normalizedQuery: string
): number | undefined {
  if (normalizedQuery.length === 0) {
    return 0;
  }

  const nameScore = scoreTextMatch(normalizeText(node.name), normalizedQuery, 600, 500, 400);
  const qualifiedScore = scoreTextMatch(
    normalizeText(node.qualifiedName),
    normalizedQuery,
    550,
    450,
    350
  );
  const pathScore = scorePathMatch(
    normalizePath(node.filePath),
    normalizePath(locationPath),
    normalizePath(normalizedQuery)
  );
  const score = Math.max(nameScore, qualifiedScore, pathScore);

  return score >= 0 ? score : undefined;
}

/** Returns a fixed score for exact, prefix, substring, or absent text matches. */
function scoreTextMatch(
  value: string,
  query: string,
  exactScore: number,
  prefixScore: number,
  containsScore: number
): number {
  if (value === query) {
    return exactScore;
  }
  if (value.startsWith(query)) {
    return prefixScore;
  }
  return value.includes(query) ? containsScore : -1;
}

/** Matches both analyzer paths and workspace-relative display paths. */
function scorePathMatch(
  filePath: string,
  locationPath: string,
  query: string
): number {
  if (filePath === query || locationPath === query) {
    return 325;
  }
  if (filePath.endsWith(`/${query}`) || locationPath.endsWith(`/${query}`)) {
    return 300;
  }
  return filePath.includes(query) || locationPath.includes(query) ? 250 : -1;
}

/** Uses existing direct metrics only as a tie-breaker after textual relevance. */
function getRelevanceScore(
  node: FunctionIndexNode,
  architecture: FunctionArchitecturePayload | undefined
): number {
  const roleScore = node.role === "entrypoint" ? 100 : node.role === "utility" ? 25 : 0;
  const placeholderScore = node.kind === "unresolved" ? 40 : node.kind === "external" ? 20 : 0;
  const architectureScore = architecture?.businessLogic === "domainRuleCandidate"
    ? 300
    : architecture?.businessLogic === "applicationWorkflowCandidate" ? 240 : 0;

  return roleScore
    + architectureScore
    + placeholderScore
    + node.metrics.directCallerCount * 4
    + node.metrics.directCalleeCount * 3
    + node.metrics.unresolvedCallCount * 2
    + node.metrics.externalCallCount;
}

/** Provides locale-independent total ordering for stable cursor pagination. */
function compareFunctionSearchMatches(
  left: FunctionSearchMatch,
  right: FunctionSearchMatch
): number {
  return right.matchScore - left.matchScore
    || right.relevanceScore - left.relevanceScore
    || compareText(normalizePath(left.locationPath), normalizePath(right.locationPath))
    || Number(left.node.range?.startLine ?? 0) - Number(right.node.range?.startLine ?? 0)
    || compareText(normalizeText(left.node.qualifiedName), normalizeText(right.node.qualifiedName))
    || compareText(left.node.qualifiedName, right.node.qualifiedName)
    || compareText(left.node.id, right.node.id);
}

/** Projects one match without assigning source identity to placeholders. */
function createSearchRow(
  match: FunctionSearchMatch,
  createSourceToken: FunctionSearchQueryInput["createSourceToken"]
): FunctionExplorerSearchRow {
  const node = match.node;
  const concrete = node.kind === "function" || node.kind === "method" || node.kind === "constructor";
  const row: FunctionExplorerSearchRow = {
    id: `function-search:${createContentHash(`${node.kind}\0${node.id}`).slice(0, 24)}`,
    sectionId: "allFunctions",
    kind: concrete ? "function" : "call",
    label: createSafeSearchLabel(node),
    depth: 0,
    hasChildren: false,
    expanded: false,
    detail: concrete
      ? createConcreteDetail(match)
      : createPlaceholderDetail(node),
    functionKind: node.kind,
    role: node.role,
    tags: [...node.tags],
    metrics: { ...node.metrics },
    architecture: match.architecture,
    confidence: node.confidence
  };

  if (concrete) {
    row.sourceToken = createSourceToken?.(node.id);
    if (node.range) {
      row.range = { ...node.range };
    }
  }

  return row;
}

/** Selects a bounded symbol label without falling back to path-bearing IDs. */
function createSafeSearchLabel(node: FunctionIndexNode): string {
  for (const candidate of [node.qualifiedName, node.name]) {
    const value = candidate.trim();
    if (value && !containsHostIdentity(value, node)) {
      return boundDisplayText(value, SEARCH_LABEL_CHARACTER_LIMIT, false);
    }
  }

  if (node.kind === "external") {
    return "External callable";
  }
  if (node.kind === "unresolved") {
    return "Unresolved call";
  }
  return "Anonymous callable";
}

/** Detects exact analyzer IDs and embedded absolute portable path forms. */
function containsHostIdentity(value: string, node: FunctionIndexNode): boolean {
  const normalized = normalizePath(value);
  const identities = [node.id, node.symbolId, node.filePath]
    .map(normalizePath)
    .filter((identity) => identity.length > 0);
  if (identities.some((identity) => normalized.includes(identity))) {
    return true;
  }

  return /(?:^|[:=(\s])\/(?:[^/\s:]+\/)+[^/\s:]*/u.test(normalized)
    || /(?:^|[:=(\s])[a-z]:\/(?:[^/\s:]+\/)*[^/\s:]*/u.test(normalized)
    || /(?:^|[:=(\s])\/\/[a-z0-9._-]+\/[a-z0-9._-]+/iu.test(normalized);
}

/** Formats a one-based workspace-relative source location plus direct metrics. */
function createConcreteDetail(match: FunctionSearchMatch): string {
  const lineSuffix = match.node.range ? `:${match.node.range.startLine + 1}` : "";
  const metrics = match.node.metrics;
  return `${match.locationPath}${lineSuffix} · ${formatFunctionArchitectureSummary(match.architecture)} · `
    + `${metrics.directCallerCount} callers · ${metrics.directCalleeCount} callees`;
}

/** Describes placeholders without presenting their callsite as target source. */
function createPlaceholderDetail(node: FunctionIndexNode): string {
  const label = node.kind === "external" ? "external callable" : "unresolved callable";
  return `${label} · ${node.metrics.directCallerCount} callers`;
}

/** Keeps host absolute paths out of Webview payloads for out-of-root sources. */
function createSafeLocationPath(displayPath: string, originalPath: string): string {
  let safePath = displayPath;
  if (!isAbsolutePortablePath(displayPath)) {
    return boundDisplayText(safePath, SEARCH_LOCATION_CHARACTER_LIMIT, true);
  }

  const segments = normalizePath(originalPath).split("/").filter(Boolean);
  safePath = segments.at(-1) || "source";
  return boundDisplayText(safePath, SEARCH_LOCATION_CHARACTER_LIMIT, true);
}

/** Bounds untrusted analyzer display text, optionally preserving its filename tail. */
function boundDisplayText(value: string, limit: number, preserveTail: boolean): string {
  if (value.length <= limit) {
    return value;
  }
  const visibleLength = limit - 1;
  return preserveTail
    ? `…${value.slice(-visibleLength)}`
    : `${value.slice(0, visibleLength)}…`;
}

/** Detects POSIX, drive, and UNC absolute display forms lexically. */
function isAbsolutePortablePath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:\//u.test(value);
}

/** Clamps finite request limits without allowing a page above the hard budget. */
function normalizePageSize(limit: number): number {
  if (!Number.isFinite(limit)) {
    return 0;
  }
  return Math.min(FUNCTION_SEARCH_MAX_PAGE_SIZE, Math.max(0, Math.floor(limit)));
}

/** Binds every cursor to one immutable browser snapshot and query/filter set. */
function createCursorSignature(
  graphVersion: string,
  normalizedQuery: string,
  includeExternal: boolean,
  includeUnresolved: boolean
): string {
  return createContentHash(JSON.stringify([
    CURSOR_VERSION,
    graphVersion,
    normalizedQuery,
    includeExternal,
    includeUnresolved,
    "architecture-relevance-path"
  ]));
}

/** Creates a compact token whose offset cannot be changed without detection. */
function createCursor(offset: number, signature: string): string {
  const state: FunctionSearchCursorState = {
    version: CURSOR_VERSION,
    offset,
    proof: createCursorProof(offset, signature)
  };
  return CURSOR_PREFIX + Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
}

/** Returns the cursor offset, or an empty terminal page for an invalid token. */
function resolveCursorOffset(
  cursor: string | undefined,
  signature: string,
  totalMatchCount: number
): number {
  if (!cursor) {
    return 0;
  }

  const state = parseCursor(cursor);
  if (
    !state
    || state.offset > totalMatchCount
    || state.proof !== createCursorProof(state.offset, signature)
  ) {
    return totalMatchCount;
  }

  return state.offset;
}

/** Decodes only the fixed internal cursor schema and rejects oversized input. */
function parseCursor(cursor: string): FunctionSearchCursorState | undefined {
  if (!cursor.startsWith(CURSOR_PREFIX) || cursor.length > 512) {
    return undefined;
  }

  const encoded = cursor.slice(CURSOR_PREFIX.length);
  if (!/^[A-Za-z0-9_-]+$/u.test(encoded)) {
    return undefined;
  }

  try {
    const value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as unknown;
    if (!isRecord(value)) {
      return undefined;
    }
    if (
      value.version !== CURSOR_VERSION
      || !Number.isSafeInteger(value.offset)
      || Number(value.offset) <= 0
      || typeof value.proof !== "string"
      || !new RegExp(`^[0-9a-f]{${CURSOR_PROOF_LENGTH}}$`, "u").test(value.proof)
    ) {
      return undefined;
    }

    return {
      version: CURSOR_VERSION,
      offset: Number(value.offset),
      proof: value.proof
    };
  } catch {
    return undefined;
  }
}

/** Signs an offset with its snapshot-bound request signature. */
function createCursorProof(offset: number, signature: string): string {
  return createContentHash(`${signature}\0${offset}`).slice(0, CURSOR_PROOF_LENGTH);
}

/** Normalizes user and analyzer text without locale-dependent casing. */
function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

/** Makes Windows and POSIX path searches comparable on every host OS. */
function normalizePath(value: string): string {
  return normalizeText(value).replace(/\\/gu, "/");
}

/** Locale-independent lexical comparison used by the pagination order. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Narrows decoded cursor values without trusting JSON object prototypes. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
