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
      const showGroup = document.createElement("div");
      const viewGroup = document.createElement("div");
      const readGroup = document.createElement("div");
      const viewportControls = createFunctionLogicViewportControls(viewportController);
      header.className = "logic-graph-header";
      const resolveTitle = () => typeof graphTitle === "function" ? graphTitle() : (graphTitle || projectAnalyzerText("control-paths-title"));
      title.textContent = resolveTitle();
      controls.className = "logic-graph-controls";
      showGroup.className = "logic-graph-control-group logic-graph-show-group";
      viewGroup.className = "logic-graph-control-group logic-graph-view-group";
      readGroup.className = "logic-graph-control-group logic-graph-read-group";
      showGroup.append(createLogicGraphControlLabel(projectAnalyzerText("show")), lensToolbar);
      viewGroup.append(createLogicGraphControlLabel(projectAnalyzerText("view")), viewportControls);
      readGroup.append(createLogicGraphControlLabel(projectAnalyzerText("read")));
      // append(undefined) creates visible text in browsers, so Tutor's
      // optional control must be added only when the host supplied one.
      if (extraControl) readGroup.append(extraControl);
      readGroup.append(inspectorToggle);
      controls.append(showGroup, viewGroup, readGroup);
      header.append(title, controls, lensLegend);
      // Keep stable header nodes: a language update must not replace controls
      // because callers retain focus and viewport state across the update.
      header.refreshLanguage = () => {
        title.textContent = resolveTitle();
        showGroup.firstChild.textContent = projectAnalyzerText("show");
        viewGroup.firstChild.textContent = projectAnalyzerText("view");
        readGroup.firstChild.textContent = projectAnalyzerText("read");
      };
      return header;
    }

    /** Labels compact control clusters without turning actions into a new lens. */
    function createLogicGraphControlLabel(text) {
      const label = document.createElement("span");
      label.className = "logic-graph-control-label";
      label.textContent = text;
      return label;
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
