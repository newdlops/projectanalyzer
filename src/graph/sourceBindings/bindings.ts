/** Joins exact analyzed-input hashes to native or supplemental file graph nodes. */
import type { ProjectGraph } from "../../shared/types";
import type { AnalyzedSourceBinding } from "../../shared/sourceSnapshots";

/**
 * Returns a graph with text-free file bindings. Symbol identities, ranges, edges
 * and confidence are preserved. A conflicting supplemental snapshot is rejected.
 */
export function bindAnalyzedSourceFiles(graph: ProjectGraph, bindings: readonly AnalyzedSourceBinding[]): ProjectGraph {
  const byPath = new Map<string, AnalyzedSourceBinding>();
  for (const binding of bindings) {
    if (byPath.has(binding.filePath) || !/^[0-9a-f]{64}$/u.test(binding.contentHash)
      || !Number.isSafeInteger(binding.sizeBytes) || binding.sizeBytes < 0) {
      throw new Error("Invalid or duplicate analyzed source binding");
    }
    byPath.set(binding.filePath, binding);
  }
  return { ...graph, nodes: graph.nodes.map((node) => {
    const binding = node.kind === "file" ? byPath.get(node.filePath) : undefined;
    if (!binding) return node;
    const previous = node.metadata?.contentHash;
    if (previous !== undefined && previous !== binding.contentHash) {
      throw new Error("Graph file content differs from its analyzed input");
    }
    return { ...node, metadata: { ...node.metadata, contentHash: binding.contentHash,
      sizeBytes: binding.sizeBytes, sourceContentAuthority: "analyzedInput" } };
  }) };
}
