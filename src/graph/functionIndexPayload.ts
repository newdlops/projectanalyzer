/**
 * Function Index protocol adapter. The graph module keeps rich Maps for host
 * queries, while Webview messages require plain JSON-compatible payloads.
 */

import type {
  FunctionExplorerPayload,
  FunctionExplorerRow,
  FunctionExplorerRowKind,
  FunctionExplorerSectionId,
  FunctionExplorerSectionSummary
} from "../protocol/functionExplorer";
import type { ProjectGraph } from "../shared/types";
import type { FunctionIndex, FunctionIndexTreeRow } from "./functionIndex";

/** Options for projecting a host Function Index into an initial Webview payload. */
export type FunctionIndexPayloadOptions = {
  initialRowLimit?: number;
};

/** Converts a host Function Index into the protocol payload consumed by sidebar. */
export function createFunctionExplorerPayload(
  graph: ProjectGraph,
  index: FunctionIndex,
  options: FunctionIndexPayloadOptions = {}
): FunctionExplorerPayload {
  const initialRowLimit = Math.max(1, options.initialRowLimit ?? 500);
  const rows = index.flowsRows.slice(0, initialRowLimit).map((row) => toExplorerRow(row));

  return {
    graphVersion: graph.version,
    workspaceRoot: graph.workspaceRoot,
    summary: {
      graphVersion: index.summary.graphVersion,
      generatedAt: graph.generatedAt,
      analyzedFileCount: graph.metadata.fileCount,
      skippedFileCount: index.summary.excludedFileCount,
      parserFailureCount: index.summary.parserFailureCount,
      excludedFileCount: index.summary.excludedFileCount,
      callableNodeCount: index.summary.callableNodeCount,
      callEdgeCount: index.summary.callEdgeCount,
      externalCallableCount: index.summary.externalCallableCount,
      unresolvedCallableCount: index.summary.unresolvedCallableCount,
      externalCallEdgeCount: index.summary.externalCallEdgeCount,
      unresolvedCallEdgeCount: index.summary.unresolvedCallEdgeCount,
      inferredCallEdgeCount: index.summary.inferredCallEdgeCount,
      visibleByDefaultViewCount: index.summary.visibleByDefaultViewCount,
      hiddenByDefaultViewCount: index.summary.hiddenByDefaultViewCount,
      hiddenByCollapsedBranchCount: Math.max(0, index.flowsRows.length - rows.length),
      hiddenByActiveFilterCount: 0
    },
    sections: createSectionSummaries(index.flowsRows, rows),
    rows,
    options: {
      requestedSections: ["entrypoints", "hotspots", "unresolvedExternal", "allFunctions"],
      initialRowLimit,
      filters: {
        includeExternal: true,
        includeUnresolved: true,
        includeInferred: true
      },
      sortBy: "relevance"
    },
    nextCursor: index.flowsRows.length > rows.length ? "function-rows:" + String(rows.length) : undefined
  };
}

/** Builds per-section row counts for the Function Explorer accordion. */
function createSectionSummaries(
  allRows: FunctionIndexTreeRow[],
  visibleRows: FunctionExplorerRow[]
): FunctionExplorerSectionSummary[] {
  const visibleCounts = new Map<FunctionExplorerSectionId, number>();

  for (const row of visibleRows) {
    visibleCounts.set(row.sectionId, (visibleCounts.get(row.sectionId) ?? 0) + 1);
  }

  return getSectionDescriptors().map((section) => {
    const totalRowCount = allRows.filter((row) => getSectionIdForRow(row.id) === section.id).length;
    const visibleRowCount = visibleCounts.get(section.id) ?? 0;

    return {
      id: section.id,
      title: section.title,
      totalRowCount,
      visibleRowCount,
      hiddenRowCount: Math.max(0, totalRowCount - visibleRowCount),
      hasMore: totalRowCount > visibleRowCount
    };
  });
}

/** Converts one host row into the JSON protocol row shape. */
function toExplorerRow(row: FunctionIndexTreeRow): FunctionExplorerRow {
  const sectionId = getSectionIdForRow(row.id);

  return {
    id: row.id,
    sectionId,
    kind: getProtocolRowKind(row, sectionId),
    label: row.label,
    depth: row.depth,
    hasChildren: row.hasChildren,
    expanded: row.expanded,
    functionId: row.nodeId,
    symbolId: row.nodeId,
    detail: row.detail,
    metadata: {
      legacyKind: row.kind,
      name: row.name
    }
  };
}

/** Maps stable legacy row ids to protocol section ids. */
function getSectionIdForRow(rowId: string): FunctionExplorerSectionId {
  if (rowId.startsWith("function-flows:hotspots")) {
    return "hotspots";
  }

  if (rowId.startsWith("function-flows:unresolved-external")) {
    return "unresolvedExternal";
  }

  if (rowId.startsWith("function-flows:all-functions")) {
    return "allFunctions";
  }

  return "entrypoints";
}

/** Maps row depth and legacy kind to a protocol row category. */
function getProtocolRowKind(row: FunctionIndexTreeRow, sectionId: FunctionExplorerSectionId): FunctionExplorerRowKind {
  if (row.depth === 0) {
    return "section";
  }

  if (sectionId === "unresolvedExternal" && row.hasChildren) {
    return "bucket";
  }

  if (row.kind === "external" || row.kind === "unresolved") {
    return "call";
  }

  return row.nodeId ? "function" : "relation";
}

/** Returns fixed section metadata in sidebar order. */
function getSectionDescriptors(): Array<{ id: FunctionExplorerSectionId; title: string }> {
  return [
    { id: "entrypoints", title: "Entrypoints" },
    { id: "hotspots", title: "Hotspots" },
    { id: "unresolvedExternal", title: "Unresolved / External" },
    { id: "allFunctions", title: "All Functions" }
  ];
}
