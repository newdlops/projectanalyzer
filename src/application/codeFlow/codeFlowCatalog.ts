/**
 * Bounded CodeFlow entrypoint catalog projection and deterministic search.
 * Function inventory search remains a separate host-indexed protocol route.
 */

import type { SemanticFlow, SemanticFlowIndex } from "../../insights/semanticFlow";
import type {
  CodeFlowCatalogItem,
  CodeFlowCatalogPayload,
  CodeFlowCatalogRequest
} from "../../protocol/codeFlow";
import type { EdgeConfidence, ProjectGraph } from "../../shared/types";
import { createSourceDisplayFormatter } from "../sourcePresentation";
import { createCodeFlowIdentity } from "./codeFlowIdentity";

/** Initial entrypoint choices stay compact in the narrow Activity Bar surface. */
export const CODE_FLOW_CATALOG_DEFAULT_LIMIT = 24;

/** Text narrowing can return more rows without turning into a graph inventory. */
export const CODE_FLOW_CATALOG_MAX_LIMIT = 50;

const DISPLAY_TEXT_LIMIT = 180;
const CONFIDENCE_RANK: Record<EdgeConfidence, number> = {
  exact: 0,
  resolved: 1,
  inferred: 2,
  unresolved: 3
};

/** Builds one correlated, bounded entrypoint catalog. */
export function createCodeFlowCatalogPayload(
  graph: ProjectGraph,
  index: SemanticFlowIndex,
  deliveryVersion: string,
  request: CodeFlowCatalogRequest
): CodeFlowCatalogPayload {
  const sourceDisplay = createSourceDisplayFormatter(graph.workspaceRoot);
  const normalizedQuery = normalizeSearchText(request.query);
  const matches = index.flows
    .map((flow) => createCodeFlowCatalogItem(
      flow,
      deliveryVersion,
      sourceDisplay.path(flow.rootPath)
    ))
    .filter((item) => matchesCatalogQuery(item, normalizedQuery))
    .sort(compareCodeFlowCatalogItems);
  const limit = normalizeCatalogLimit(request.limit);
  const items = matches.slice(0, limit);

  return {
    graphVersion: deliveryVersion,
    requestId: request.requestId,
    query: request.query,
    items,
    totalMatchCount: matches.length,
    omittedMatchCount: Math.max(0, matches.length - items.length),
    summary: {
      entrypointCount: index.summary.entrypointCount,
      routeCount: index.summary.routeCount,
      operationCount: index.summary.operationCount,
      mappedCount: index.summary.mappedHandlerCount,
      gapCount: index.coverageGaps.length
    }
  };
}

/** Creates one bounded catalog record without serializing a framework identity. */
export function createCodeFlowCatalogItem(
  flow: SemanticFlow,
  deliveryVersion: string,
  scopeLabel: string | undefined
): CodeFlowCatalogItem {
  const mapped = flow.steps.some((step) =>
    step.kind === "handler" && step.resolution === "concrete" && step.functionId !== undefined
  );
  const kindLabel = flow.entrypointKind === "httpRoute" ? "HTTP" : "GraphQL";
  const mappingLabel = mapped ? "handler mapped" : "handler unknown";

  return {
    id: createCodeFlowIdentity(deliveryVersion, flow.id),
    kind: flow.entrypointKind,
    name: safeText(flow.name, "Unnamed entrypoint"),
    framework: safeText(flow.framework, "Unknown framework"),
    scopeLabel: scopeLabel && scopeLabel !== "." ? scopeLabel : undefined,
    detail: `${kindLabel} · ${mappingLabel}`,
    confidence: flow.confidence,
    mapped,
    gapCount: flow.coverageGaps.length
  };
}

/** Mapped and stronger flows appear before gaps, then sort deterministically. */
export function compareCodeFlowCatalogItems(
  left: CodeFlowCatalogItem,
  right: CodeFlowCatalogItem
): number {
  return Number(right.mapped) - Number(left.mapped)
    || compareOptionalConfidence(left.confidence, right.confidence)
    || compareText(left.framework, right.framework)
    || compareText(left.name, right.name)
    || compareText(left.id, right.id);
}

/** Matches entrypoint name, framework, scope, and kind labels. */
function matchesCatalogQuery(item: CodeFlowCatalogItem, query: string): boolean {
  if (!query) {
    return true;
  }
  return [
    item.name,
    item.framework,
    item.scopeLabel ?? "",
    item.kind === "httpRoute" ? "http route" : "graphql operation"
  ].some((value) => normalizeSearchText(value).includes(query));
}

/** Normalizes a catalog limit against protocol budgets. */
function normalizeCatalogLimit(limit: number): number {
  if (!Number.isFinite(limit)) {
    return 0;
  }
  return Math.min(CODE_FLOW_CATALOG_MAX_LIMIT, Math.max(0, Math.floor(limit)));
}

/** Missing confidence remains weaker than every explicit evidence grade. */
function compareOptionalConfidence(
  left: EdgeConfidence | undefined,
  right: EdgeConfidence | undefined
): number {
  return (left ? CONFIDENCE_RANK[left] : 4) - (right ? CONFIDENCE_RANK[right] : 4);
}

/** Lowercases and normalizes path separators for entrypoint narrowing. */
function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase().replace(/\\/gu, "/");
}

/** Locale-independent stable text ordering. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Bounds analyzer-owned labels before they reach a compact visual surface. */
function safeText(value: string | undefined, fallback: string): string {
  const normalized = value?.trim() || fallback;
  return normalized.length <= DISPLAY_TEXT_LIMIT
    ? normalized
    : `${normalized.slice(0, DISPLAY_TEXT_LIMIT - 1)}…`;
}

