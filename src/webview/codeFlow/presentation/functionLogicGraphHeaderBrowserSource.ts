/**
 * Browser presentation helpers for the compact Function Logic graph header
 * signature/summary and graph-local adjacency indexes. They depend only on browser globals
 * supplied by the renderer composition layer.
 */

/** Returns CSP-safe header and index helper declarations. */
export function getFunctionLogicGraphHeaderBrowserSource(): string {
  return /* js */ `
    /** Creates the graph header with an integrated legend and viewport controls. */
    function createLogicGraphHeader(
      viewportController,
      inspectorToggle,
      integratedLegend,
      graphTitle,
      extraControl,
      outlineToggle,
      understanding
    ) {
      const header = document.createElement("div");
      const title = document.createElement("strong");
      const controls = document.createElement("div");
      const viewGroup = document.createElement("div");
      const readGroup = document.createElement("div");
      const viewportControls = createFunctionLogicViewportControls(viewportController, true);
      const tools = document.createElement("details");
      const toolsSummary = document.createElement("summary");
      const toolsBody = document.createElement("div");
      header.className = "logic-graph-header";
      const resolveTitle = () => typeof graphTitle === "function" ? graphTitle() : (graphTitle || projectAnalyzerText("control-paths-title"));
      title.textContent = resolveTitle();
      controls.className = "logic-graph-controls";
      viewGroup.className = "logic-graph-control-group logic-graph-view-group";
      readGroup.className = "logic-graph-control-group logic-graph-read-group";
      viewGroup.append(createLogicGraphControlLabel(projectAnalyzerText("view")), viewportControls);
      readGroup.append(createLogicGraphControlLabel(projectAnalyzerText("read")));
      if (outlineToggle) readGroup.append(outlineToggle);
      readGroup.append(inspectorToggle);
      tools.className = "logic-graph-tools"; toolsBody.className = "logic-graph-tools-body";
      toolsSummary.textContent = projectAnalyzerText("reading-tools");
      tools.append(toolsSummary, toolsBody);
      toolsBody.append(viewGroup, readGroup);
      if (integratedLegend) toolsBody.append(integratedLegend);
      if (understanding) toolsBody.append(understanding);
      // Keep the original Fit action outside advanced tools without duplicating listeners or camera state.
      if (extraControl) controls.append(extraControl);
      controls.append(viewportControls.primaryFit);
      header.append(title, controls, tools);
      // Keep stable header nodes: a language update must not replace controls
      // because callers retain focus and viewport state across the update.
      header.refreshLanguage = () => {
        title.textContent = resolveTitle();
        viewGroup.firstChild.textContent = projectAnalyzerText("view");
        readGroup.firstChild.textContent = projectAnalyzerText("read");
        toolsSummary.textContent = projectAnalyzerText("reading-tools");
        integratedLegend?.refreshLanguage?.();
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
    /** Creates the compact current-function header above the graph. */
    function createLogicSignature(signatureText) {
      const signature = document.createElement("div");
      const signatureLabel = document.createElement("span");
      const signatureCode = document.createElement("code");
      signature.className = "logic-signature";
      signatureLabel.textContent = projectAnalyzerText("function-signature");
      signatureCode.textContent = signatureText;
      signature.append(signatureLabel, signatureCode);
      signature.refreshLanguage = () => { signatureLabel.textContent = projectAnalyzerText("function-signature"); };
      return signature;
    }

    /** Summarizes internal logic rather than call-graph size. */
    function createFunctionLogicSummaryText(logic) {
      const summary = logic.summary;
      const parts = [projectAnalyzerText("logic-block-count", { count: summary.blockCount })];
      if (summary.branchCount) parts.push(projectAnalyzerText("summary-branches", { count: summary.branchCount }));
      if (summary.loopCount) parts.push(projectAnalyzerText("summary-loops", { count: summary.loopCount }));
      const renderCount = logic.blocks.filter((block) => block.kind === "render").length;
      const eventCount = logic.blocks.filter((block) => block.kind === "event").length;
      if (renderCount) parts.push(projectAnalyzerText("summary-jsx-steps", { count: renderCount }));
      if (eventCount) parts.push(projectAnalyzerText("summary-event-bindings", { count: eventCount }));
      if (summary.effectCount) parts.push(projectAnalyzerText("summary-effects", { count: summary.effectCount }));
      if (summary.valueChangeCount) parts.push(
        projectAnalyzerText("summary-value-changes", { count: summary.valueChangeCount })
      );
      else if (summary.mutationCount) parts.push(
        projectAnalyzerText("summary-mutations", { count: summary.mutationCount })
      );
      const bindingCount = (logic.valueBindings || []).length;
      if (bindingCount) parts.push(
        projectAnalyzerText("tracked-binding-count", { count: bindingCount })
      );
      return parts.join(" · ");
    }
  `;
}
