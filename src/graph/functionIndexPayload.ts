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
import { createFrameworkHandlerRows } from "./functionFrameworkRows";
import type { FunctionIndex, FunctionIndexTreeRow } from "./functionIndex";

/** Options for projecting a host Function Index into an initial Webview payload. */
export type FunctionIndexPayloadOptions = {
  initialRowLimit?: number;
  expandedRowIds?: Iterable<string>;
  semanticFlowRows?: readonly FunctionExplorerRow[];
  changeImpactRows?: readonly FunctionExplorerRow[];
  selectedFunctionId?: string;
};

/** Converts a host Function Index into the protocol payload consumed by sidebar. */
export function createFunctionExplorerPayload(
  graph: ProjectGraph,
  index: FunctionIndex,
  options: FunctionIndexPayloadOptions = {}
): FunctionExplorerPayload {
  const initialRowLimit = Math.max(1, options.initialRowLimit ?? 500);
  const expandedRowIds = Array.from(options.expandedRowIds ?? []);
  const indexRows = index.flowsRows.map((row) => toExplorerRow(row));
  const semanticFlowRows = options.semanticFlowRows
    ? [...options.semanticFlowRows]
    : createFrameworkHandlerRows(graph, { expandedRowIds }).rows;
  const changeImpactRows = [...(options.changeImpactRows ?? [])];
  const allRows = changeImpactRows.concat(insertSemanticFlowRows(indexRows, semanticFlowRows));
  const sectionDescriptors = getSectionDescriptors(changeImpactRows.length > 0);
  const rows = selectBoundedSectionRows(allRows, sectionDescriptors, initialRowLimit);
  const visibleSourceRowCount = rows.filter((row) => row.kind !== "more").length;

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
      hiddenByCollapsedBranchCount: Math.max(0, allRows.length - visibleSourceRowCount),
      hiddenByActiveFilterCount: 0
    },
    sections: createSectionSummaries(allRows, rows, sectionDescriptors),
    rows,
    options: {
      requestedSections: sectionDescriptors.map((section) => section.id),
      initialRowLimit,
      expandedRowIds,
      filters: {
        includeExternal: true,
        includeUnresolved: true,
        includeInferred: true
      },
      sortBy: "relevance",
      selectedFunctionId: options.selectedFunctionId
    }
  };
}

/**
 * Keeps a prefix of every non-empty section before distributing remaining row
 * budget. This preserves parent-before-child order without allowing one large
 * expanded GraphQL bucket to hide all later top-level sections.
 */
function selectBoundedSectionRows(
  allRows: FunctionExplorerRow[],
  sectionDescriptors: Array<{ id: FunctionExplorerSectionId; title: string }>,
  limit: number
): FunctionExplorerRow[] {
  if (allRows.length <= limit) {
    return allRows;
  }

  const rowsBySection = new Map<FunctionExplorerSectionId, FunctionExplorerRow[]>();
  for (const descriptor of sectionDescriptors) {
    rowsBySection.set(descriptor.id, []);
  }
  for (const row of allRows) {
    rowsBySection.get(row.sectionId)?.push(row);
  }

  const nonEmptySections = sectionDescriptors.filter((descriptor) =>
    (rowsBySection.get(descriptor.id)?.length ?? 0) > 0
  );
  const retainedCounts = new Map<FunctionExplorerSectionId, number>();
  let remaining = limit;

  // Reserve each section's first row, which is its stable top-level header.
  for (const descriptor of nonEmptySections) {
    if (remaining === 0) {
      break;
    }
    retainedCounts.set(descriptor.id, 1);
    remaining -= 1;
  }

  // Keep one explicit omission row for each large section when budget allows.
  // This is intentionally not a fake cursor: the provider does not implement
  // server-side paging yet.
  const markerSectionIds = new Set<FunctionExplorerSectionId>();
  for (const descriptor of nonEmptySections) {
    if (remaining === 0) {
      break;
    }
    if ((rowsBySection.get(descriptor.id)?.length ?? 0) > 1) {
      markerSectionIds.add(descriptor.id);
      remaining -= 1;
    }
  }

  // Round-robin prefix growth gives every section bounded detail while keeping
  // hierarchical parents ahead of their children within the section.
  while (remaining > 0) {
    let added = false;

    for (const descriptor of nonEmptySections) {
      if (remaining === 0) {
        break;
      }
      const sectionRows = rowsBySection.get(descriptor.id) ?? [];
      const retainedCount = retainedCounts.get(descriptor.id) ?? 0;

      if (retainedCount >= sectionRows.length) {
        continue;
      }

      retainedCounts.set(descriptor.id, retainedCount + 1);
      remaining -= 1;
      added = true;
    }

    if (!added) {
      break;
    }
  }

  return nonEmptySections.flatMap((descriptor) => {
    const sectionRows = rowsBySection.get(descriptor.id) ?? [];
    const retainedCount = retainedCounts.get(descriptor.id) ?? 0;
    const retainedRows = sectionRows.slice(0, retainedCount);
    const hiddenRowCount = sectionRows.length - retainedRows.length;

    if (hiddenRowCount === 0 || !markerSectionIds.has(descriptor.id)) {
      return retainedRows;
    }

    return retainedRows.concat(createOmittedSectionRow(descriptor.id, hiddenRowCount));
  });
}

/** Makes truncation visible without claiming that the placeholder is pageable. */
function createOmittedSectionRow(
  sectionId: FunctionExplorerSectionId,
  hiddenRowCount: number
): FunctionExplorerRow {
  return {
    id: `function-rows:omitted:${sectionId}`,
    sectionId,
    kind: "more",
    label: `${hiddenRowCount} more rows not loaded`,
    detail: "Server-side paging is not available yet",
    depth: 1,
    hasChildren: false,
    expanded: false,
    metadata: { hiddenRowCount }
  };
}

/** Builds per-section row counts for the Function Explorer accordion. */
function createSectionSummaries(
  allRows: FunctionExplorerRow[],
  visibleRows: FunctionExplorerRow[],
  sectionDescriptors: Array<{ id: FunctionExplorerSectionId; title: string }>
): FunctionExplorerSectionSummary[] {
  const visibleCounts = new Map<FunctionExplorerSectionId, number>();

  for (const row of visibleRows) {
    if (row.kind === "more") {
      continue;
    }
    visibleCounts.set(row.sectionId, (visibleCounts.get(row.sectionId) ?? 0) + 1);
  }

  return sectionDescriptors.map((section) => {
    const totalRowCount = allRows.filter((row) => row.sectionId === section.id).length;
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

/** Places request flows before generic callable roots while preserving later sections. */
function insertSemanticFlowRows(
  indexRows: FunctionExplorerRow[],
  semanticFlowRows: FunctionExplorerRow[]
): FunctionExplorerRow[] {
  const insertionIndex = indexRows.findIndex((row) => row.sectionId === "entrypoints");

  if (insertionIndex < 0) {
    return semanticFlowRows.concat(indexRows);
  }

  return indexRows.slice(0, insertionIndex).concat(semanticFlowRows, indexRows.slice(insertionIndex));
}

/** Maps stable legacy row ids to protocol section ids. */
function getSectionIdForRow(rowId: string): FunctionExplorerSectionId {
  if (rowId.startsWith("function-flows:framework-handlers")) {
    return "frameworkHandlers";
  }

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
function getSectionDescriptors(
  includeSelected: boolean
): Array<{ id: FunctionExplorerSectionId; title: string }> {
  const descriptors: Array<{ id: FunctionExplorerSectionId; title: string }> = [
    { id: "frameworkHandlers", title: "Request Flows" },
    { id: "entrypoints", title: "Other Entrypoints" },
    { id: "hotspots", title: "Hotspots" },
    { id: "unresolvedExternal", title: "Unresolved / External" },
    { id: "allFunctions", title: "All Functions" }
  ];

  return includeSelected
    ? [{ id: "selected", title: "Change Impact" }, ...descriptors]
    : descriptors;
}
