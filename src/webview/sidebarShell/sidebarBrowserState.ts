/**
 * Browser-injected state and DOM registry for the sidebar shell. Feature
 * renderers share this small public surface instead of extending the already
 * large explorer script with their own document lookups.
 */

/** Returns the sidebar state object and stable element registry declarations. */
export function getSidebarBrowserStateSource(): string {
  return /* js */ `
    const state = {
      activeSurface: "guide",
      graph: undefined,
      structureGraph: undefined,
      analysisState: "idle",
      expandedAccordionSections: new Set(),
      expandedTreeIds: new Set(["root", "function-flows:framework-handlers"]),
      graphRevision: 0,
      functionIndex: undefined,
      functionIndexLoading: false,
      functionIndexRequestVersion: undefined,
      functionIndexRevision: 0,
      functionSearch: undefined,
      functionSearchActive: false,
      functionSearchLoading: false,
      functionSearchPendingCursor: undefined,
      functionSearchPendingRequestId: undefined,
      functionSearchQuery: "",
      functionSearchError: undefined,
      functionSearchRequestSequence: 0,
      functionSearchRevision: 0,
      guidedTour: undefined,
      guidedTourCurrentStopIndex: 0,
      guidedTourOpenedStopIds: new Set(),
      guidedTourPendingOpen: undefined,
      guidedTourOpenError: undefined,
      guidedTourOpenRequestSequence: 0,
      guidedTourFocusCurrentStop: false,
      projectOverview: undefined,
      projectOverviewLoading: false,
      projectOverviewRequestVersion: undefined,
      readingGuide: undefined,
      scopeGuide: undefined,
      scopeGuideLoading: false,
      selectedScopeId: undefined,
      structureLoading: false,
      structureMode: "frameworks",
      structureRequestVersion: undefined,
      treeRevision: 0,
      treeRowsCache: new Map(),
      selectedTreeId: undefined,
      selectedFunctionId: undefined
    };

    const elements = {
      analyzeWorkspace: document.getElementById("analyze-workspace"),
      analyzeCurrent: document.getElementById("analyze-current"),
      showWorkspace: document.getElementById("show-workspace"),
      exportJson: document.getElementById("export-json"),
      clearCache: document.getElementById("clear-cache"),
      status: document.getElementById("status"),
      guideTab: document.getElementById("surface-guide-tab"),
      exploreTab: document.getElementById("surface-explore-tab"),
      guidedTourSurface: document.getElementById("guided-tour-surface"),
      exploreSurface: document.getElementById("explore-surface"),
      guidedTourContent: document.getElementById("guided-tour-content"),
      guideSummary: document.getElementById("guide-summary"),
      guideScopes: document.getElementById("guide-scopes"),
      guideScopeDetail: document.getElementById("guide-scope-detail"),
      projectBrief: document.getElementById("project-brief"),
      analysisSignals: document.getElementById("analysis-signals"),
      callAccordion: document.getElementById("accordion-calls"),
      structureAccordion: document.getElementById("accordion-structure"),
      analysisAccordion: document.getElementById("accordion-analysis"),
      callPanel: document.getElementById("call-panel"),
      structurePanel: document.getElementById("structure-panel"),
      analysisPanel: document.getElementById("analysis-panel"),
      callSection: document.getElementById("call-section"),
      structureSection: document.getElementById("structure-section"),
      analysisSection: document.getElementById("analysis-section"),
      structureFrameworks: document.getElementById("structure-frameworks"),
      structureFiles: document.getElementById("structure-files"),
      frameworkTree: document.getElementById("framework-tree"),
      callTree: document.getElementById("call-tree"),
      functionSearch: document.getElementById("function-search"),
      functionSearchInput: document.getElementById("function-search-input"),
      functionSearchSubmit: document.getElementById("function-search-submit"),
      functionSearchClear: document.getElementById("function-search-clear"),
      functionSearchStatus: document.getElementById("function-search-status"),
      functionSearchMore: document.getElementById("function-search-more"),
      explorerTree: document.getElementById("explorer-tree")
    };
  `;
}
