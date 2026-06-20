/**
 * Helpers for graph-level metadata that is derived from normalized nodes.
 */

import type { LanguageSummary, ProjectGraph, SymbolNode } from "../shared/types";

/** Builds a file-count language summary from graph file nodes. */
export function createLanguageSummaryFromNodes(nodes: readonly SymbolNode[]): LanguageSummary[] {
  const counts = new Map<string, number>();

  for (const node of nodes) {
    if (node.kind !== "file" || !node.language) {
      continue;
    }

    counts.set(node.language, (counts.get(node.language) ?? 0) + 1);
  }

  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);

  return [...counts.entries()]
    .map(([language, fileCount]) => ({
      language,
      fileCount,
      percentage: total === 0 ? 0 : Math.round((fileCount / total) * 1000) / 10
    }))
    .sort((left, right) => right.fileCount - left.fileCount || left.language.localeCompare(right.language));
}

/** Normalizes optional metadata arrays for old analyzer payloads. */
export function normalizeProjectGraphMetadata(graph: ProjectGraph): ProjectGraph {
  return {
    ...graph,
    metadata: {
      ...graph.metadata,
      languageSummary: graph.metadata.languageSummary ?? createLanguageSummaryFromNodes(graph.nodes),
      frameworks: graph.metadata.frameworks ?? []
    }
  };
}
