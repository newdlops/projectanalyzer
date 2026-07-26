/**
 * Browser presentation helpers for the compact Function Logic graph header
 * and graph-local adjacency indexes. They depend only on browser globals
 * supplied by the renderer composition layer.
 */

/** Returns CSP-safe header and index helper declarations. */
export function getFunctionLogicGraphHeaderBrowserSource(): string {
  return /* js */ `
    /** Creates the graph header with lens-local legend and viewport controls. */
    function createLogicGraphHeader(
      viewportController,
      inspectorToggle,
      lensToolbar,
      lensLegend,
      graphTitle,
      extraControl
    ) {
      const header = document.createElement("div");
      const title = document.createElement("strong");
      const controls = document.createElement("div");
      const viewportControls = createFunctionLogicViewportControls(viewportController);
      header.className = "logic-graph-header";
      title.textContent = graphTitle || "Control paths";
      controls.className = "logic-graph-controls";
      controls.append(lensToolbar, viewportControls);
      // append(undefined) creates visible text in browsers, so Tutor's
      // optional control must be added only when the host supplied one.
      if (extraControl) controls.append(extraControl);
      controls.append(inspectorToggle);
      header.append(title, controls, lensLegend);
      return header;
    }

    /** Indexes outgoing edges for selection, navigation, and Inspector detail. */
    function createOutgoingLogicEdgeIndex(edges) {
      const result = new Map();
      for (const edge of edges) {
        const values = result.get(edge.sourceId) || [];
        values.push(edge);
        result.set(edge.sourceId, values);
      }
      return result;
    }

    /** Indexes edges touching each node without rescanning the graph per selection. */
    function createConnectedLogicEdgeIndex(edges) {
      const result = new Map();
      for (const edge of edges) {
        for (const blockId of [edge.sourceId, edge.targetId]) {
          const values = result.get(blockId) || [];
          values.push(edge.id);
          result.set(blockId, values);
        }
      }
      return result;
    }

    /** Creates SVG elements without interpolating analyzer text into markup. */
    function createLogicSvgElement(name) {
      return document.createElementNS(LOGIC_SVG_NAMESPACE, name);
    }
  `;
}
