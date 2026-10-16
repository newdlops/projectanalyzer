/** Lazy adapter from the actual workspace GraphStore to one source-capture action. */
import type { GraphStore } from "../../graph/graphStore";
import { createContentHash } from "../../shared/hash";
import type { ProjectGraph, SymbolNode } from "../../shared/types";
import { SourceCaptureError, type NarrativeSourceGraph } from "../../shared/narrativeSources";
import { createSourceGraphValidation } from "./graphValidation";

/** An existing indexed store avoids building a second full graph index per action. */
export type WorkspaceSourceGraphInput = {
  graph: ProjectGraph;
  store: Pick<GraphStore, "getNode" | "getOutgoingEdges">;
  getCurrentGraph(): ProjectGraph | undefined;
};

/** Retain only selected graph records and text-free file identities for final checks. */
export function createWorkspaceSourceGraph(input: WorkspaceSourceGraphInput): NarrativeSourceGraph {
  let owner: WorkspaceSourceGraphInput | undefined = input;
  const header = JSON.stringify([input.graph.workspaceRoot, input.graph.version, input.graph.generatedAt]);
  const diagnosticsHash = createContentHash(JSON.stringify(input.graph.diagnostics));
  const nodes = new Map<string, string | undefined>(), outgoing = new Map<string, Map<string, string>>();
  const fileBindings = new Map<string, string | undefined>(), usedFiles = new Set<string>();
  const files = new Map<string, SymbolNode[]>();
  for (const node of input.graph.nodes) if (node.kind === "file") {
    const group = files.get(node.filePath) ?? []; group.push(node); files.set(node.filePath, group);
  }
  const binding = (rows: readonly SymbolNode[]) => JSON.stringify(rows.map((node) => ({ id: node.id,
    filePath: node.filePath, contentHash: node.metadata?.contentHash, sizeBytes: node.metadata?.sizeBytes })).sort((a, b) => a.id.localeCompare(b.id)));
  for (const [path, group] of files) fileBindings.set(path, binding(group));
  const active = () => {
    if (!owner) throw new SourceCaptureError("disposed", "Source graph authority was disposed");
    const current = owner.getCurrentGraph();
    if (current !== owner.graph || JSON.stringify([current.workspaceRoot, current.version, current.generatedAt]) !== header) {
      throw new SourceCaptureError("source-changed", "Workspace graph snapshot changed");
    }
    return owner;
  };
  return {
    snapshotId: createContentHash(header),
    getNode(id) {
      const current = active(), value = current.store.getNode(id), encoded = value === undefined ? undefined : JSON.stringify(value);
      if (nodes.has(id) && nodes.get(id) !== encoded) throw new SourceCaptureError("source-changed", "Selected graph declaration changed");
      nodes.set(id, encoded);
      if (!value) return undefined;
      const result = structuredClone(value);
      if (current.graph.diagnostics.some((diagnostic) => diagnostic.filePath === value.filePath && diagnostic.severity === "error"
        || diagnostic.code === "analysis.rustWorkspaceFailed" || diagnostic.code === "analysis.rustFileFailed")) {
        result.metadata = { ...result.metadata, sourceCaptureAnalysisLimited: true };
      }
      return result;
    },
    getOutgoingEdges(id, maximumEdges) {
      const rows = active().store.getOutgoingEdges(id);
      if (!Number.isSafeInteger(maximumEdges) || maximumEdges < 0 || rows.length > maximumEdges) throw new SourceCaptureError("context-too-large", "Graph dependencies exceed capture budget");
      const encoded = new Map(rows.map((edge) => [edge.id, JSON.stringify(edge)]));
      if (encoded.size !== rows.length) throw new SourceCaptureError("source-changed", "Duplicate source edge identity");
      const previous = outgoing.get(id);
      if (previous && (previous.size !== encoded.size || [...encoded].some(([key, value]) => previous.get(key) !== value))) {
        throw new SourceCaptureError("source-changed", "Selected graph dependencies changed");
      }
      outgoing.set(id, encoded); return structuredClone(rows);
    },
    getFileContentHash(filePath) {
      active(); usedFiles.add(filePath);
      const hashes = files.get(filePath)?.map((node) => node.metadata?.contentHash);
      return hashes?.length && hashes.every((hash) => typeof hash === "string" && /^[0-9a-f]{64}$/u.test(hash) && hash === hashes[0])
        ? hashes[0] as string : undefined;
    },
    assertCurrent() {
      const current = active().graph, seenNodes = new Set<string>(), seenEdges = new Set<string>();
      if (createContentHash(JSON.stringify(current.diagnostics)) !== diagnosticsHash) throw new SourceCaptureError("source-changed", "Graph analysis diagnostics changed");
      const currentFiles = new Map<string, SymbolNode[]>();
      for (const node of current.nodes) {
        if (nodes.has(node.id)) {
          if (seenNodes.has(node.id) || nodes.get(node.id) !== JSON.stringify(node)) throw new SourceCaptureError("source-changed", "Selected graph declaration changed");
          seenNodes.add(node.id);
        }
        if (node.kind === "file" && usedFiles.has(node.filePath)) {
          const group = currentFiles.get(node.filePath) ?? []; group.push(node); currentFiles.set(node.filePath, group);
        }
      }
      if ([...nodes].some(([id, value]) => value !== undefined && !seenNodes.has(id))) throw new SourceCaptureError("source-changed", "Selected graph declaration disappeared");
      let expectedEdges = 0;
      for (const rows of outgoing.values()) expectedEdges += rows.size;
      for (const edge of current.edges) if (outgoing.has(edge.sourceId)) {
        if (seenEdges.has(edge.id) || outgoing.get(edge.sourceId)!.get(edge.id) !== JSON.stringify(edge)) throw new SourceCaptureError("source-changed", "Selected graph dependency changed");
        seenEdges.add(edge.id);
      }
      if (seenEdges.size !== expectedEdges) throw new SourceCaptureError("source-changed", "Selected graph dependency disappeared");
      for (const path of usedFiles) if (fileBindings.get(path) !== (currentFiles.has(path) ? binding(currentFiles.get(path)!) : undefined)) {
        throw new SourceCaptureError("source-changed", "Analyzed file identity changed");
      }
    },
    createValidation() {
      this.assertCurrent(); const current = active();
      return createSourceGraphValidation({ reference: new WeakRef(current.graph), getCurrentGraph: current.getCurrentGraph,
        nodeIds: nodes.keys(), filePaths: usedFiles, outgoingOwners: outgoing.keys() });
    },
    dispose() { owner = undefined; nodes.clear(); outgoing.clear(); files.clear(); fileBindings.clear(); usedFiles.clear(); }
  };
}
