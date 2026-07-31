/**
 * Browser program for the flow-first Activity Bar. It keeps one current user
 * question, rejects stale/cross-query responses, and renders only bounded Host
 * projections rather than interpreting the complete Project Graph.
 */

import { getFunctionLogicBrowserSource } from "./functionLogicBrowserSource";
import { getCodeFlowPresentationBrowserSource } from "./codeFlowPresentationBrowserSource";

/** Returns CSP-compatible browser JavaScript for the Code Flow Reader. */
export function getCodeFlowBrowserSource(): string {
  return /* js */ `
    const vscode = acquireVsCodeApi();
    const CATALOG_LIMIT = 24;
    const FUNCTION_PAGE_LIMIT = 30;
    const SEARCH_DEBOUNCE_MS = 180;

    const state = {
      graph: undefined,
      analysisState: "idle",
      startMode: "entrypoints",
      query: "",
      catalog: undefined,
      catalogLoading: false,
      catalogRequestSequence: 0,
      catalogPendingRequestId: 0,
      functionRows: [],
      functionTotal: 0,
      functionNextCursor: undefined,
      functionLoading: false,
      functionError: undefined,
      functionRequestSequence: 0,
      functionPendingRequestId: undefined,
      functionPendingCursor: undefined,
      detail: undefined,
      detailLoading: false,
      detailError: undefined,
      selectedLogicBlockId: undefined,
      logicGraphScale: 1,
      logicGraphViewportTransform: undefined,
      activeLogicViewportController: undefined,
      activeLogicValueFlowRendering: undefined,
      uiLanguage: "en",
      moduleFlowOpening: false,
      retainedStatus: undefined,
      statusPresentation: undefined,
      searchTimer: undefined
    };

    const elements = {
      analyzeWorkspace: document.getElementById("analyze-workspace"),
      analyzeCurrent: document.getElementById("analyze-current"),
      showWorkspace: document.getElementById("show-workspace"),
      exportJson: document.getElementById("export-json"),
      clearCache: document.getElementById("clear-cache"),
      openModuleFlow: document.getElementById("open-module-flow"),
      moduleFlowActionLabel: document.getElementById("module-flow-action-label"),
      moduleFlowActionHint: document.getElementById("module-flow-action-hint"),
      status: document.getElementById("status"),
      flowStart: document.getElementById("flow-start"),
      catalogSummary: document.getElementById("catalog-summary"),
      modeEntrypoints: document.getElementById("mode-entrypoints"),
      modeFunctions: document.getElementById("mode-functions"),
      searchForm: document.getElementById("flow-search-form"),
      searchInput: document.getElementById("flow-search-input"),
      searchMeta: document.getElementById("flow-search-meta"),
      results: document.getElementById("flow-results"),
      searchMore: document.getElementById("flow-search-more"),
      flowReader: document.getElementById("flow-reader"),
      flowBack: document.getElementById("flow-back"),
      flowTitle: document.getElementById("flow-title"),
      flowKicker: document.getElementById("flow-reader-kicker"),
      flowSubtitle: document.getElementById("flow-subtitle"),
      flowSummary: document.getElementById("flow-summary"),
      flowSemantics: document.getElementById("flow-semantics-note"),
      flowOriginsSection: document.getElementById("flow-origins-section"),
      flowOrigins: document.getElementById("flow-origins"),
      flowSteps: document.getElementById("flow-steps"),
      flowGapsSection: document.getElementById("flow-gaps-section"),
      flowGaps: document.getElementById("flow-gaps")
    };

    elements.analyzeWorkspace.addEventListener("click", () => {
      if (state.analysisState === "running") {
        postRequest("analysis/cancel", {}, "cancel-requested");
      } else {
        postRequest("analysis/run", { scope: "workspace" }, "analyzing-workspace");
      }
    });
    elements.analyzeCurrent.addEventListener("click", () =>
      postRequest("analysis/run", { scope: "currentFile" }, "analyzing-current")
    );
    elements.showWorkspace.addEventListener("click", () =>
      postRequest("graph/showWorkspaceScope", {}, "restoring-workspace")
    );
    elements.exportJson.addEventListener("click", () =>
      postRequest("export/run", { format: "json" }, "export-requested")
    );
    elements.clearCache.addEventListener("click", () =>
      postRequest("cache/clear", {}, "clearing-cache")
    );
    elements.openModuleFlow.addEventListener("click", () => {
      if (state.moduleFlowOpening || state.analysisState === "running") {
        return;
      }
      state.moduleFlowOpening = true;
      setCodeFlowStatus("preparing-module");
      renderActions();
      vscode.postMessage({ type: "moduleFlow/open", payload: {} });
    });
    elements.modeEntrypoints.addEventListener("click", () => setStartMode("entrypoints"));
    elements.modeFunctions.addEventListener("click", () => setStartMode("functions"));
    elements.searchForm.addEventListener("submit", (event) => {
      event.preventDefault();
      state.query = elements.searchInput.value.slice(0, 512);
      if (state.searchTimer !== undefined) {
        clearTimeout(state.searchTimer);
        state.searchTimer = undefined;
      }
      requestCurrentSearch(false);
    });
    elements.searchInput.addEventListener("input", () => {
      state.query = elements.searchInput.value.slice(0, 512);
      if (state.searchTimer !== undefined) {
        clearTimeout(state.searchTimer);
      }
      state.searchTimer = setTimeout(() => {
        state.searchTimer = undefined;
        requestCurrentSearch(false);
      }, SEARCH_DEBOUNCE_MS);
    });
    elements.searchMore.addEventListener("click", () => requestFunctionSearch(true));
    elements.flowBack.addEventListener("click", () => {
      state.detail = undefined;
      state.detailLoading = false;
      state.detailError = undefined;
      render();
      elements.searchInput.focus();
    });

    window.addEventListener("message", (event) => {
      const message = event.data;

      if (message.type === "ui/language") {
        state.uiLanguage = message.payload?.language === "ko" ? "ko" : "en";
        applyProjectAnalyzerLanguage(state.uiLanguage);
        state.activeLogicGraphRendering?.updateLanguage(state.uiLanguage);
        // Reformat retained owned UI from the existing model only; this path
        // neither posts a request nor reconstructs the Function Logic graph.
        renderLocalizedState();
        return;
      }

      if (message.type === "ui/ready") {
        setCodeFlowStatus("connected");
        return;
      }

      if (message.type === "graph/loaded" || message.type === "graph/updated") {
        const changed = state.graph?.version !== message.payload.version;
        state.graph = message.payload;
        if (changed) {
          resetGraphState();
          state.catalogLoading = true;
          state.catalogPendingRequestId = 0;
        }
        setCodeFlowStatus("ready-trace");
        render();
        return;
      }

      if (message.type === "codeFlow/catalogLoaded") {
        if (
          !isCurrentGraph(message.payload.graphVersion)
          || message.payload.requestId !== state.catalogPendingRequestId
        ) {
          return;
        }
        state.catalog = message.payload;
        state.catalogLoading = false;
        renderStart();
        return;
      }

      if (message.type === "function/searchLoaded") {
        if (!acceptFunctionSearch(message.payload)) {
          return;
        }
        const appending = state.functionPendingCursor !== undefined;
        state.functionRows = appending
          ? state.functionRows.concat(message.payload.rows)
          : message.payload.rows;
        state.functionTotal = message.payload.totalMatchCount;
        state.functionNextCursor = message.payload.nextCursor;
        state.functionLoading = false;
        state.functionError = undefined;
        state.functionPendingCursor = undefined;
        renderStart();
        return;
      }

      if (message.type === "function/searchFailed") {
        if (!acceptFunctionSearch(message.payload)) {
          return;
        }
        state.functionLoading = false;
        state.functionError = message.payload;
        state.functionPendingCursor = undefined;
        renderStart();
        return;
      }

      if (message.type === "codeFlow/detailLoaded") {
        if (!isCurrentGraph(message.payload.graphVersion)) {
          return;
        }
        if (state.detail?.id !== message.payload.id) {
          state.selectedLogicBlockId = undefined;
          state.logicGraphScale = 1;
          state.logicGraphViewportTransform = undefined;
        }
        state.detail = message.payload;
        state.detailLoading = false;
        state.detailError = undefined;
        setCodeFlowStatus("flow-ready");
        render();
        return;
      }

      if (message.type === "codeFlow/detailFailed") {
        if (!isCurrentGraph(message.payload.graphVersion) && message.payload.code !== "staleGraph") {
          return;
        }
        state.detailLoading = false;
        state.detailError = { kind: "codeFlow", payload: message.payload };
        elements.status.textContent = formatRetainedFailure(state.detailError);
        render();
        return;
      }

      if (message.type === "moduleFlow/openCompleted") {
        state.moduleFlowOpening = false;
        state.retainedStatus = { kind: "moduleLaunch", payload: message.payload };
        elements.status.textContent = formatRetainedFailure(state.retainedStatus);
        renderActions();
        return;
      }

      if (message.type === "graph/cleared") {
        state.graph = undefined;
        state.analysisState = "idle";
        resetGraphState();
        setCodeFlowStatus("cache-cleared");
        render();
        return;
      }

      if (message.type === "analysis/status") {
        state.analysisState = message.payload.state;
        state.statusPresentation = undefined;
        state.retainedStatus = undefined;
        elements.status.textContent = message.payload.message;
        renderActions();
        return;
      }

      if (message.type === "error") {
        state.analysisState = "failed";
        state.catalogLoading = false;
        state.functionLoading = false;
        state.detailLoading = false;
        state.moduleFlowOpening = false;
        state.detailError = { kind: "error", payload: message.payload };
        elements.status.textContent = formatRetainedFailure(state.detailError);
        render();
      }
    });

    render();
    postRequest("ui/ready", {}, "connecting-status");

    /** Resets every browser reference bound to a previous immutable graph. */
    function resetGraphState() {
      state.catalog = undefined;
      state.catalogLoading = false;
      state.catalogRequestSequence = 0;
      state.catalogPendingRequestId = 0;
      state.functionRows = [];
      state.functionTotal = 0;
      state.functionNextCursor = undefined;
      state.functionLoading = false;
      state.functionError = undefined;
      state.functionPendingRequestId = undefined;
      state.functionPendingCursor = undefined;
      state.detail = undefined;
      state.detailLoading = false;
      state.detailError = undefined;
      state.selectedLogicBlockId = undefined;
      state.logicGraphScale = 1;
      state.logicGraphViewportTransform = undefined;
    }

    /** Changes the question type while keeping entrypoint and function search separate. */
    function setStartMode(mode) {
      if (state.startMode === mode) {
        return;
      }
      state.startMode = mode;
      state.query = "";
      elements.searchInput.value = "";
      configureSearchInput();
      renderStart();
      requestCurrentSearch(false);
    }

    /** Sends the active start query through its dedicated protocol route. */
    function requestCurrentSearch(append) {
      if (!state.graph) {
        return;
      }
      if (state.startMode === "functions") {
        requestFunctionSearch(append);
      } else {
        requestCatalogSearch();
      }
    }

    /** Correlates every entrypoint query so late keystroke responses are ignored. */
    function requestCatalogSearch() {
      const requestId = ++state.catalogRequestSequence;
      state.catalogPendingRequestId = requestId;
      state.catalogLoading = true;
      vscode.postMessage({
        type: "codeFlow/catalog",
        payload: {
          graphVersion: state.graph.version,
          requestId,
          query: state.query,
          limit: CATALOG_LIMIT
        }
      });
      renderStart();
    }

    /** Searches the complete concrete callable index with cursor-backed pages. */
    function requestFunctionSearch(append) {
      if (!state.graph || state.functionLoading) {
        return;
      }
      const cursor = append ? state.functionNextCursor : undefined;
      if (append && !cursor) {
        return;
      }
      const requestId = ++state.functionRequestSequence;
      state.functionPendingRequestId = requestId;
      state.functionPendingCursor = cursor;
      state.functionLoading = true;
      if (!append) {
        state.functionRows = [];
        state.functionTotal = 0;
        state.functionNextCursor = undefined;
      }
      vscode.postMessage({
        type: "function/search",
        payload: {
          graphVersion: state.graph.version,
          requestId,
          query: state.query,
          limit: FUNCTION_PAGE_LIMIT,
          cursor,
          filters: { includeExternal: false, includeUnresolved: false }
        }
      });
      renderStart();
    }

    /** Rejects cross-query and stale-graph function pages. */
    function acceptFunctionSearch(payload) {
      return isCurrentGraph(payload.graphVersion)
        && payload.requestId === state.functionPendingRequestId
        && payload.query === state.query;
    }

    /** Opens one entrypoint catalog result in the Flow Reader. */
    function selectEntrypoint(item) {
      if (!state.graph) {
        return;
      }
      beginDetailLoad();
      vscode.postMessage({
        type: "codeFlow/select",
        payload: { graphVersion: state.graph.version, flowId: item.id }
      });
    }

    /** Builds function context from a snapshot-local search result token. */
    function selectFunction(row) {
      if (!state.graph || !row.sourceToken) {
        return;
      }
      setCodeFlowStatus("opening-visualizer");
      vscode.postMessage({
        type: "codeFlow/selectSource",
        payload: { graphVersion: state.graph.version, sourceToken: row.sourceToken }
      });
    }

    /** Routes shared renderer drill actions to the dedicated editor tab. */
    function drillIntoFunction(target) {
      selectFunction(target);
    }

    /** Moves from the launcher to an explicit loading state. */
    function beginDetailLoad() {
      state.detail = undefined;
      state.detailLoading = true;
      state.detailError = undefined;
      setCodeFlowStatus("building-flow");
      render();
    }

    /** Renders the complete shell from current question state. */
    function render() {
      configureSearchInput();
      renderStart();
      renderDetail();
      renderActions();
      refreshRetainedStatus();
    }

    /** Updates the pressed starting-point control and its query affordances. */
    function configureSearchInput() {
      const entrypoints = state.startMode === "entrypoints";
      elements.modeEntrypoints.classList.toggle("active", entrypoints);
      elements.modeFunctions.classList.toggle("active", !entrypoints);
      elements.modeEntrypoints.setAttribute("aria-pressed", entrypoints ? "true" : "false");
      elements.modeFunctions.setAttribute("aria-pressed", entrypoints ? "false" : "true");
      elements.searchInput.placeholder = entrypoints
        ? projectAnalyzerText("entrypoint-placeholder")
        : projectAnalyzerText("function-placeholder");
      elements.searchInput.setAttribute(
        "aria-label",
        entrypoints ? projectAnalyzerText("search-entrypoints") : projectAnalyzerText("search-functions")
      );
    }

    /** Renders only bounded catalog or function search results. */
    function renderStart() {
      const showingReader = Boolean(state.detail || state.detailLoading || state.detailError);
      elements.flowStart.hidden = showingReader;
      if (showingReader) {
        return;
      }

      clearElement(elements.results);
      elements.catalogSummary.textContent = createCatalogSummaryText();

      if (!state.graph) {
        elements.searchMeta.textContent = projectAnalyzerText("analyze-first");
        appendEmptyResult(projectAnalyzerText("no-analyzed-code"));
        elements.searchMore.hidden = true;
        return;
      }

      if (state.startMode === "entrypoints") {
        renderCatalogResults();
      } else {
        renderFunctionResults();
      }
    }

    /** Renders framework entrypoint results and mapping confidence. */
    function renderCatalogResults() {
      if (state.catalogLoading && !state.catalog) {
        elements.searchMeta.textContent = projectAnalyzerText("finding-entrypoints");
        appendEmptyResult(projectAnalyzerText("building-entrypoint-catalog"));
        elements.searchMore.hidden = true;
        return;
      }
      const catalog = state.catalog;
      if (!catalog || catalog.items.length === 0) {
        elements.searchMeta.textContent = state.query
          ? projectAnalyzerText("no-entrypoint-match")
          : projectAnalyzerText("no-entrypoints");
        appendEmptyResult(projectAnalyzerText("try-function-search"));
        elements.searchMore.hidden = true;
        return;
      }

      elements.searchMeta.textContent = catalog.totalMatchCount === catalog.items.length
        ? projectAnalyzerText("code-flow-entrypoint-count", { count: catalog.totalMatchCount })
        : projectAnalyzerText("showing-entrypoints", { shown: catalog.items.length, total: catalog.totalMatchCount });
      for (const item of catalog.items) {
        elements.results.append(createCatalogResult(item));
      }
      elements.searchMore.hidden = true;
    }

    /** Renders concrete function results from the complete Host-side index. */
    function renderFunctionResults() {
      if (state.functionLoading && state.functionRows.length === 0) {
        elements.searchMeta.textContent = projectAnalyzerText("searching-functions");
        appendEmptyResult(projectAnalyzerText("reading-function-index"));
        elements.searchMore.hidden = true;
        return;
      }
      if (state.functionError) {
        elements.searchMeta.textContent = formatFunctionSearchFailure(state.functionError);
        appendEmptyResult(formatFunctionSearchFailure(state.functionError));
        elements.searchMore.hidden = true;
        return;
      }
      if (state.functionRows.length === 0) {
        elements.searchMeta.textContent = state.query
          ? projectAnalyzerText("no-function-match")
          : projectAnalyzerText("browse-functions");
        appendEmptyResult(projectAnalyzerText("type-function-search"));
        elements.searchMore.hidden = true;
        return;
      }

      elements.searchMeta.textContent = projectAnalyzerText("showing-functions", { shown: state.functionRows.length, total: state.functionTotal });
      for (const row of state.functionRows) {
        elements.results.append(createFunctionResult(row));
      }
      elements.searchMore.hidden = !state.functionNextCursor;
      elements.searchMore.disabled = state.functionLoading;
      elements.searchMore.textContent = state.functionLoading ? projectAnalyzerText("loading") : projectAnalyzerText("load-more-functions");
    }

    /** Creates one keyboard-accessible entrypoint card. */
    function createCatalogResult(item) {
      const button = createResultButton();
      const top = document.createElement("span");
      const name = document.createElement("strong");
      const badges = document.createElement("span");
      const detail = document.createElement("span");
      top.className = "result-card-top";
      name.className = "result-name";
      badges.className = "result-badges";
      detail.className = "result-detail";
      name.textContent = formatCodeFlowPresentation(item.namePresentation, item.name);
      badges.append(
        createBadge(item.kind === "httpRoute" ? "HTTP" : "GraphQL", "kind"),
        createBadge(formatCodeFlowConfidence(item.confidence), "confidence " + (item.confidence || "unknown"))
      );
      detail.textContent = formatCodeFlowPresentation(item.frameworkPresentation, item.framework) + " · " + projectAnalyzerText(item.kind === "httpRoute" ? "http" : "graphql")
        + " · " + projectAnalyzerText(item.mapped ? "handler-mapped" : "handler-unknown")
        + (item.scopeLabel ? " · " + item.scopeLabel : "")
        + (item.gapCount ? " · " + projectAnalyzerText("gap-count", { count: item.gapCount }) : "");
      button.title = projectAnalyzerText("trace", { label: formatCodeFlowPresentation(item.namePresentation, item.name) });
      top.append(name, badges);
      button.append(top, detail);
      button.addEventListener("click", () => selectEntrypoint(item));
      return button;
    }

    /** Creates one concrete function result with source-safe detail. */
    function createFunctionResult(row) {
      const button = createResultButton();
      const top = document.createElement("span");
      const name = document.createElement("strong");
      const badges = document.createElement("span");
      const detail = document.createElement("span");
      top.className = "result-card-top";
      name.className = "result-name";
      badges.className = "result-badges";
      detail.className = "result-detail";
      name.textContent = formatFunctionSearchLabel(row);
      badges.append(
        createBadge(formatFunctionKind(row.functionKind || "function"), "kind"),
        createBadge(formatConfidence(row.confidence || "unknown"), "confidence " + (row.confidence || "unknown"))
      );
      detail.textContent = row.detail || projectAnalyzerText("concrete-source-function");
      button.title = projectAnalyzerText("trace", { label: formatFunctionSearchLabel(row) });
      top.append(name, badges);
      button.append(top, detail);
      button.disabled = !row.sourceToken;
      button.addEventListener("click", () => selectFunction(row));
      return button;
    }

    /** Shared result-card skeleton. */
    function createResultButton() {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "result-card";
      return button;
    }

    /** Renders the selected flow, its origins, evidence, and explicit gaps. */
    function renderDetail() {
      disposeActiveFunctionLogicViewport();
      const active = Boolean(state.detail || state.detailLoading || state.detailError);
      elements.flowReader.hidden = !active;
      if (!active) {
        clearElement(elements.flowOrigins);
        clearElement(elements.flowSteps);
        clearElement(elements.flowGaps);
        elements.flowOriginsSection.hidden = true;
        elements.flowGapsSection.hidden = true;
        return;
      }

      clearElement(elements.flowOrigins);
      clearElement(elements.flowSteps);
      clearElement(elements.flowGaps);

      if (state.detailLoading) {
        elements.flowTitle.textContent = projectAnalyzerText("building-readable-flow");
        elements.flowSubtitle.textContent = projectAnalyzerText("applying-guards");
        elements.flowSummary.textContent = "";
        elements.flowOriginsSection.hidden = true;
        elements.flowGapsSection.hidden = true;
        elements.flowSteps.append(createLoadingStep());
        return;
      }

      if (state.detailError) {
        elements.flowTitle.textContent = projectAnalyzerText("flow-unavailable");
        elements.flowSubtitle.textContent = formatRetainedFailure(state.detailError);
        elements.flowSummary.textContent = projectAnalyzerText("choose-another");
        elements.flowOriginsSection.hidden = true;
        elements.flowGapsSection.hidden = true;
        return;
      }

      const detail = state.detail;
      renderDetailChrome(detail);

      elements.flowOriginsSection.hidden = detail.origins.length === 0;
      for (const origin of detail.origins) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "origin-chip";
        button.textContent = formatCodeFlowPresentation(origin.namePresentation, origin.name);
        button.title = projectAnalyzerText("open-entrypoint-flow", { framework: origin.framework });
        button.addEventListener("click", () => selectEntrypoint(origin));
        elements.flowOrigins.append(button);
      }

      if (detail.kind === "functionLogic" && detail.logic) {
        renderFunctionLogic(detail.logic);
      } else {
        for (const step of detail.steps) {
          elements.flowSteps.append(createFlowStep(step, detail.focusStepId));
        }
      }

      elements.flowGapsSection.hidden = detail.gaps.length === 0;
      for (const gap of detail.gaps) {
        const card = document.createElement("article");
        const label = document.createElement("strong");
        const text = document.createElement("p");
        card.className = "gap-card";
        label.textContent = formatCodeFlowPresentation(gap.labelPresentation, formatCodeFlowGap(gap));
        text.textContent = gap.codeFlowDetailPresentation
          ? projectAnalyzerText(gap.codeFlowDetailPresentation.key, gap.codeFlowDetailPresentation.params)
          : gap.detailPresentation
          ? projectAnalyzerText(gap.detailPresentation.key, gap.detailPresentation.params)
          : gap.detail;
        card.append(label, text);
        elements.flowGaps.append(card);
      }
    }

    ${getCodeFlowPresentationBrowserSource()}

    ${getFunctionLogicBrowserSource()}

    /** Adds one non-actionable result state. */
    function appendEmptyResult(message) {
      const empty = document.createElement("div");
      empty.className = "flow-empty";
      empty.textContent = message;
      elements.results.append(empty);
    }

    /** Produces a lightweight loading skeleton without animation dependence. */
    function createLoadingStep() {
      const loading = document.createElement("div");
      loading.className = "flow-empty";
      loading.textContent = projectAnalyzerText("following-static");
      return loading;
    }

    /** Keeps primary and maintenance actions aligned with analysis lifecycle. */
    function renderActions() {
      const running = state.analysisState === "running";
      const hasGraph = Boolean(state.graph);
      elements.analyzeWorkspace.textContent = running ? projectAnalyzerText("cancel-analysis") : projectAnalyzerText("analyze-workspace");
      elements.analyzeCurrent.disabled = running;
      elements.showWorkspace.disabled = running;
      elements.exportJson.disabled = !hasGraph || running;
      elements.clearCache.disabled = running;
      elements.openModuleFlow.disabled = running || state.moduleFlowOpening;
      elements.openModuleFlow.setAttribute(
        "aria-busy",
        state.moduleFlowOpening ? "true" : "false"
      );
      elements.moduleFlowActionLabel.textContent = state.moduleFlowOpening
        ? projectAnalyzerText("opening-module-flow")
        : projectAnalyzerText("open-module-flow");
      elements.moduleFlowActionHint.textContent = running
        ? projectAnalyzerText("module-flow-unavailable")
        : state.moduleFlowOpening
          ? projectAnalyzerText("building-project-graph")
          : projectAnalyzerText("module-flow-opens");
      elements.searchInput.disabled = !hasGraph || running;
    }

    /** Initial catalog coverage stays contextual rather than becoming a dashboard. */
    function createCatalogSummaryText() {
      const summary = state.catalog?.summary;
      if (!summary) {
        return "";
      }
      return projectAnalyzerText("mapped-count", { mapped: summary.mappedCount, total: summary.entrypointCount });
    }

    /** Formats only visible flow counters. */
    function createDetailSummaryText(summary) {
      const parts = [projectAnalyzerText("code-flow-visible-steps", { count: summary.stepCount })];
      if (summary.decisionStepCount) parts.push(projectAnalyzerText("code-flow-decision-candidates", { count: summary.decisionStepCount }));
      if (summary.effectStepCount) parts.push(projectAnalyzerText("code-flow-effect-boundaries", { count: summary.effectStepCount }));
      if (summary.unknownStepCount) parts.push(projectAnalyzerText("code-flow-unknown-steps", { count: summary.unknownStepCount }));
      return parts.join(" · ");
    }

    /** Removes child nodes without interpolating Host text into HTML. */
    function clearElement(element) {
      while (element.firstChild) {
        element.removeChild(element.firstChild);
      }
    }

    /** Tests one response against the current Webview-only snapshot identity. */
    function isCurrentGraph(graphVersion) {
      return Boolean(state.graph && state.graph.version === graphVersion);
    }

    /** Posts one typed request and retains its owned transient status for locale refresh. */
    function postRequest(type, payload, statusKey, statusParams) {
      setCodeFlowStatus(statusKey, statusParams);
      vscode.postMessage({ type, payload });
    }

  `;
}
