/** Browser fragment for progressive graph value-object and status helpers. */
export function getExplorerProgressiveHelpersBrowserSource(): string {
  return /* js */ `
    /** Creates the inert graph-node shape used for progressive placeholders. */
    function createVirtualNode(id, name, kind, filePath) {
      return {
        id,
        kind,
        name,
        qualifiedName: name,
        filePath,
        range: emptyRange(),
        selectionRange: emptyRange(),
        language: "virtual"
      };
    }
    /** Creates an exact local edge between progressive graph nodes. */
    function createProgressiveEdge(sourceId, targetId, kind) {
      return {
        id: "edge::progressive::" + sourceId + "::" + targetId,
        kind,
        sourceId,
        targetId,
        filePath: "",
        range: emptyRange(),
        confidence: "exact"
      };
    }
    /** Adds a node under its stable graph identity. */
    function addNode(nodesById, node) {
      nodesById.set(node.id, node);
    }
    /** Adds an edge under its stable graph identity. */
    function addEdge(edgesById, edge) {
      edgesById.set(edge.id, edge);
    }
    function isVirtualNodeId(nodeId) {
      return nodeId.startsWith("virtual::");
    }
    function emptyRange() {
      return { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 0 };
    }
    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value));
    }
    /** Summarizes loaded and omitted graph data for retained panel status. */
    function summarizeGraph(graph) {
      const projection = graph?.metadata?.visualProjection;
      return {
        edges: graph?.edges?.length ?? 0,
        files: graph?.metadata?.fileCount ?? 0,
        nodes: graph?.nodes?.length ?? 0,
        omittedEdges: projection?.omittedEdgeCount ?? 0,
        omittedNodes: projection?.omittedNodeCount ?? 0
      };
    }
    /** Makes Host-side payload bounds visible instead of looking like missing analysis. */
    function formatProjectionStatus(graph) {
      const projection = graph?.metadata?.visualProjection;
      if (!projection || projection.omittedNodeCount <= 0) {
        return ["graph-projection-loaded"];
      }
      return ["graph-projection-bounded", {
        loaded: graph.nodes.length,
        total: projection.sourceNodeCount
      }];
    }
    /** Sends bounded diagnostic metadata through the Host telemetry boundary. */
    function logWebview(level, message, fields) {
      vscode.postMessage({
        type: "telemetry/log",
        payload: { fields, level, message, source: "graphPanel" }
      });
    }
  `;
}
