/**
 * Browser-injected request state machine for heavyweight sidebar disclosures.
 * It keeps graph-version correlation and one-request-per-snapshot rules out of
 * the main DOM/event script while sharing its `state` and `postRequest` API.
 */

/** Returns lazy disclosure helpers injected into the sidebar browser script. */
export function getLazyDetailsBrowserSource(): string {
  return /* js */ `
    /** Clears detail payloads that are valid only for one immutable graph version. */
    function resetGraphScopedDetails() {
      state.functionIndex = undefined;
      state.functionIndexLoading = false;
      state.functionIndexRequestVersion = undefined;
      resetFunctionSearchState();
      state.projectOverview = undefined;
      state.projectOverviewLoading = false;
      state.projectOverviewRequestVersion = undefined;
      state.readingGuide = undefined;
      state.scopeGuide = undefined;
      state.scopeGuideLoading = false;
      state.selectedScopeId = undefined;
      state.structureGraph = undefined;
      state.structureLoading = false;
      state.structureRequestVersion = undefined;
      state.selectedTreeId = undefined;
      state.selectedFunctionId = undefined;
      state.functionIndexRevision += 1;
      state.treeRevision += 1;
      state.treeRowsCache.clear();
    }

    /** Rejects late detail responses from an older immutable graph. */
    function isCurrentGraphVersion(graphVersion) {
      return Boolean(state.graph && state.graph.version === graphVersion);
    }

    /** Starts each heavy detail request at most once for the current graph. */
    function requestAccordionData(sectionId) {
      if (sectionId === "calls") {
        requestFunctionIndex();
      } else if (sectionId === "structure") {
        requestProjectStructure();
      } else if (sectionId === "analysis") {
        requestProjectOverview();
      }
    }

    /** Restarts open disclosure requests after the active graph token changes. */
    function requestExpandedAccordionData() {
      for (const sectionId of ["calls", "structure", "analysis"]) {
        if (state.expandedAccordionSections.has(sectionId)) {
          requestAccordionData(sectionId);
        }
      }
    }

    /** Requests the host-projected Function Index once per graph version. */
    function requestFunctionIndex() {
      const graphVersion = state.graph?.version;

      if (
        !graphVersion
        || state.functionIndex?.graphVersion === graphVersion
        || state.functionIndexRequestVersion === graphVersion
      ) {
        return;
      }

      state.functionIndexLoading = true;
      state.functionIndexRequestVersion = graphVersion;
      postRequest("function/index", {
        graphVersion,
        options: {
          expandedRowIds: Array.from(state.expandedTreeIds),
          selectedFunctionId: state.selectedFunctionId
        }
      }, "Loading function index");
    }

    /** Requests the file/framework projection once per immutable graph version. */
    function requestProjectStructure() {
      const graphVersion = state.graph?.version;

      if (
        !graphVersion
        || state.structureGraph?.version === graphVersion
        || state.structureRequestVersion === graphVersion
      ) {
        return;
      }

      state.structureLoading = true;
      state.structureRequestVersion = graphVersion;
      postRequest("graph/loadStructure", { graphVersion }, "Loading project structure");
    }

    /** Requests the evidence overview once per immutable graph version. */
    function requestProjectOverview() {
      const graphVersion = state.graph?.version;

      if (
        !graphVersion
        || state.projectOverview?.graphVersion === graphVersion
        || state.projectOverviewRequestVersion === graphVersion
      ) {
        return;
      }

      state.projectOverviewLoading = true;
      state.projectOverviewRequestVersion = graphVersion;
      postRequest("project/loadOverview", { graphVersion }, "Loading analysis details");
    }
  `;
}
