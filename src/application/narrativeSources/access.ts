/** Share read-only graph indexes while keeping each action's source ownership disposable. */
import { InMemoryGraphStore } from "../../graph/graphStore";
import type { ProjectGraph } from "../../shared/types";
import { SourceCaptureError, type NarrativeSourceAccess, type NarrativeSourceReader, type SourceCaptureLimits } from "../../shared/narrativeSources";
import { captureNarrativeSources } from "./capture";
import { createWorkspaceSourceGraph } from "./graphAuthority";

/** No I/O or index allocation occurs before an explicit capture request. */
export function createNarrativeSourceAccess(reader: NarrativeSourceReader, resourceLimits: SourceCaptureLimits): NarrativeSourceAccess {
  const limits = Object.freeze({ ...resourceLimits });
  // Weak keys release old graphs with their UI snapshots; source strings are never cached here.
  const stores = new WeakMap<ProjectGraph, InMemoryGraphStore>();
  const access: NarrativeSourceAccess = {
    maxDepth: limits.maxDepth,
    capture({ graph, getCurrentGraph, rootIds, signal }) {
      if (rootIds.length > limits.maxGraphNodes) throw new SourceCaptureError("context-too-large", "Required source roots exceed graph budget");
      let store = stores.get(graph);
      if (!store) { store = new InMemoryGraphStore(graph); stores.set(graph, store); }
      return captureNarrativeSources({ graph: createWorkspaceSourceGraph({ graph, store, getCurrentGraph }),
        reader, rootIds, limits, signal });
    },
    async readFileText(filePath, signal) { return (await reader.read(filePath, limits.maxFileBytes, signal))?.text; }
  };
  return Object.freeze(access);
}

/** Include all immediate callers and lexical parents; helper expansion remains capture-owned. */
export function getNarrativeSourceRoots(graph: ProjectGraph, declarationId: string, maximumParentDepth: number): string[] {
  if (!Number.isSafeInteger(maximumParentDepth) || maximumParentDepth < 0) throw new RangeError("Source parent depth required");
  const roots = new Set([declarationId]);
  for (const edge of graph.edges) if (edge.targetId === declarationId && edge.kind === "calls") roots.add(edge.sourceId);
  const queue = [...roots].map(id => ({ id, depth: 0 })), visited = new Set<string>();
  for (let index = 0; index < queue.length; index++) {
    const { id, depth } = queue[index]; if (visited.has(id)) continue; visited.add(id);
    const parentId = graph.nodes.find(node => node.id === id)?.parentId;
    if (parentId && graph.nodes.find(node => node.id === parentId)?.kind !== "file" && !visited.has(parentId)) {
      if (depth >= maximumParentDepth) throw new SourceCaptureError("context-too-large", "Complete lexical parent chain exceeds depth budget");
      roots.add(parentId); queue.push({ id: parentId, depth: depth + 1 });
    }
  }
  return [...roots];
}
