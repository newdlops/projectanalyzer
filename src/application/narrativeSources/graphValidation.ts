/** Compact graph fingerprints for cached source authority; original graph objects are held weakly. */
import type { ProjectGraph } from "../../shared/types";
import { createContentHash } from "../../shared/hash";
import { SourceCaptureError, type NarrativeSourceGraphValidation } from "../../shared/narrativeSources";

/** One rolling digest uses constant temporary space even with many incoming edges. */
function signature(graph: ProjectGraph, nodes: ReadonlySet<string>, files: ReadonlySet<string>, outgoing: ReadonlySet<string>): string {
  let value = createContentHash(JSON.stringify([graph.workspaceRoot, graph.version, graph.generatedAt, graph.diagnostics]));
  for (const node of graph.nodes) if (nodes.has(node.id) || node.kind === "file" && files.has(node.filePath)) value = createContentHash(value + JSON.stringify(node));
  // Incoming edges detect newly discovered callers, including a previously absent edge.
  for (const edge of graph.edges) if (outgoing.has(edge.sourceId) || nodes.has(edge.targetId)) value = createContentHash(value + JSON.stringify(edge));
  return value;
}

/** Clone only identity sets and a digest; no capture payload, serialized nodes or file text survives here. */
export function createSourceGraphValidation(input: { reference: WeakRef<ProjectGraph>; getCurrentGraph(): ProjectGraph | undefined;
  nodeIds: Iterable<string>; filePaths: Iterable<string>; outgoingOwners: Iterable<string> }): NarrativeSourceGraphValidation {
  const reference = input.reference, nodes = new Set(input.nodeIds), files = new Set(input.filePaths), outgoing = new Set(input.outgoingOwners);
  let getGraph: (() => ProjectGraph | undefined) | undefined = input.getCurrentGraph;
  const initial = reference.deref(); if (!initial) throw new SourceCaptureError("source-changed", "Source graph expired");
  const expected = signature(initial, nodes, files, outgoing);
  return {
    assertCurrent() {
      if (!getGraph) throw new SourceCaptureError("disposed", "Cached graph validation was disposed");
      const graph = getGraph();
      if (!graph || graph !== reference.deref() || signature(graph, nodes, files, outgoing) !== expected) throw new SourceCaptureError("source-changed", "Cached source graph changed");
    },
    dispose() { getGraph = undefined; nodes.clear(); files.clear(); outgoing.clear(); }
  };
}
