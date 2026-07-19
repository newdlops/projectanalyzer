/**
 * Pure graph merge for languages that the Rust engine currently treats as
 * file-only. It adds only selected-language fallback nodes and their own edges.
 */

import type { ProjectGraph } from "../../shared/types";

/** Merges one fallback graph without replacing primary-engine evidence. */
export function mergeSupplementalLanguageGraph(
  base: ProjectGraph,
  supplemental: ProjectGraph,
  languages: ReadonlySet<string>
): ProjectGraph {
  const supplementalNodes = supplemental.nodes.filter((node) =>
    languages.has(node.language)
  );
  if (supplementalNodes.length === 0) {
    return base;
  }
  const allowedNodeIds = new Set(supplementalNodes.map((node) => node.id));
  const nodesById = new Map(base.nodes.map((node) => [node.id, node]));
  for (const node of supplementalNodes) {
    if (!nodesById.has(node.id)) {
      nodesById.set(node.id, node);
    }
  }
  const edgesById = new Map(base.edges.map((edge) => [edge.id, edge]));
  for (const edge of supplemental.edges) {
    if (allowedNodeIds.has(edge.sourceId) && allowedNodeIds.has(edge.targetId)
      && !edgesById.has(edge.id)) {
      edgesById.set(edge.id, edge);
    }
  }
  const nodes = [...nodesById.values()];
  const edges = [...edgesById.values()];
  const diagnosticKeys = new Set(base.diagnostics.map((diagnostic) =>
    `${diagnostic.code}\0${diagnostic.filePath ?? ""}\0${diagnostic.message}`
  ));
  const diagnostics = [...base.diagnostics];
  for (const diagnostic of supplemental.diagnostics) {
    const relevant = diagnostic.filePath
      ? supplementalNodes.some((node) => node.filePath === diagnostic.filePath)
      : false;
    const key = `${diagnostic.code}\0${diagnostic.filePath ?? ""}\0${diagnostic.message}`;
    if (relevant && !diagnosticKeys.has(key)) {
      diagnosticKeys.add(key);
      diagnostics.push(diagnostic);
    }
  }
  return {
    ...base,
    nodes,
    edges,
    diagnostics,
    metadata: {
      ...base.metadata,
      languages: [...new Set([
        ...base.metadata.languages,
        ...supplementalNodes.map((node) => node.language)
      ])].sort(),
      symbolCount: nodes.length,
      edgeCount: edges.length
    }
  };
}
