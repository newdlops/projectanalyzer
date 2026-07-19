/**
 * Browser program for the flow-first Activity Bar. It keeps one current user
 * question, rejects stale/cross-query responses, and renders only bounded Host
 * projections rather than interpreting the complete Project Graph.
 */

import { getFunctionLogicBrowserSource } from "./functionLogicBrowserSource";

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
      searchTimer: undefined
    };

    const elements = {
      analyzeWorkspace: document.getElementById("analyze-workspace"),
      analyzeCurrent: document.getElementById("analyze-current"),
      showWorkspace: document.getElementById("show-workspace"),
      exportJson: document.getElementById("export-json"),
      clearCache: document.getElementById("clear-cache"),
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
        postRequest("analysis/cancel", {}, "Cancel requested");
      } else {
        postRequest("analysis/run", { scope: "workspace" }, "Analyzing workspace");
      }
    });
    elements.analyzeCurrent.addEventListener("click", () =>
      postRequest("analysis/run", { scope: "currentFile" }, "Analyzing current file")
    );
    elements.showWorkspace.addEventListener("click", () =>
      postRequest("graph/showWorkspaceScope", {}, "Restoring workspace analysis")
    );
    elements.exportJson.addEventListener("click", () =>
      postRequest("export/run", { format: "json" }, "Export requested")
    );
    elements.clearCache.addEventListener("click", () =>
      postRequest("cache/clear", {}, "Clearing analysis cache")
    );
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

      if (message.type === "ui/ready") {
        elements.status.textContent = "Connected";
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
        elements.status.textContent = "Ready to trace a flow";
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
        state.functionError = message.payload.message;
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
        }
        state.detail = message.payload;
        state.detailLoading = false;
        state.detailError = undefined;
        elements.status.textContent = "Flow ready · verify each step in source";
        render();
        return;
      }

      if (message.type === "codeFlow/detailFailed") {
        if (!isCurrentGraph(message.payload.graphVersion) && message.payload.code !== "staleGraph") {
          return;
        }
        state.detailLoading = false;
        state.detailError = message.payload.message;
        elements.status.textContent = message.payload.message;
        render();
        return;
      }

      if (message.type === "graph/cleared") {
        state.graph = undefined;
        state.analysisState = "idle";
        resetGraphState();
        elements.status.textContent = "Analysis cache cleared";
        render();
        return;
      }

      if (message.type === "analysis/status") {
        state.analysisState = message.payload.state;
        elements.status.textContent = message.payload.message;
        renderActions();
        return;
      }

      if (message.type === "error") {
        state.analysisState = "failed";
        state.catalogLoading = false;
        state.functionLoading = false;
        state.detailLoading = false;
        state.detailError = message.payload.message;
        elements.status.textContent = message.payload.message;
        render();
      }
    });

    render();
    postRequest("ui/ready", {}, "Connecting");

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
      beginDetailLoad();
      vscode.postMessage({
        type: "codeFlow/selectSource",
        payload: { graphVersion: state.graph.version, sourceToken: row.sourceToken }
      });
    }

    /** Moves from the launcher to an explicit loading state. */
    function beginDetailLoad() {
      state.detail = undefined;
      state.detailLoading = true;
      state.detailError = undefined;
      elements.status.textContent = "Building a bounded flow";
      render();
    }

    /** Renders the complete shell from current question state. */
    function render() {
      configureSearchInput();
      renderStart();
      renderDetail();
      renderActions();
    }

    /** Updates start-mode accessibility and query affordances. */
    function configureSearchInput() {
      const entrypoints = state.startMode === "entrypoints";
      elements.modeEntrypoints.classList.toggle("active", entrypoints);
      elements.modeFunctions.classList.toggle("active", !entrypoints);
      elements.modeEntrypoints.setAttribute("aria-selected", entrypoints ? "true" : "false");
      elements.modeFunctions.setAttribute("aria-selected", entrypoints ? "false" : "true");
      elements.searchInput.placeholder = entrypoints
        ? "Route, operation, or framework"
        : "Function name or source path";
      elements.searchInput.setAttribute(
        "aria-label",
        entrypoints ? "Search entrypoints" : "Search functions"
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
        elements.searchMeta.textContent = "Analyze the workspace to discover flow starting points.";
        appendEmptyResult("No analyzed code yet");
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
        elements.searchMeta.textContent = "Finding supported entrypoints…";
        appendEmptyResult("Building entrypoint catalog");
        elements.searchMore.hidden = true;
        return;
      }
      const catalog = state.catalog;
      if (!catalog || catalog.items.length === 0) {
        elements.searchMeta.textContent = state.query
          ? "No entrypoints match this question."
          : "No supported HTTP or GraphQL entrypoints were found.";
        appendEmptyResult("Try a function search instead");
        elements.searchMore.hidden = true;
        return;
      }

      elements.searchMeta.textContent = catalog.totalMatchCount === catalog.items.length
        ? catalog.totalMatchCount + " entrypoint" + plural(catalog.totalMatchCount)
        : "Showing " + catalog.items.length + " of " + catalog.totalMatchCount + " entrypoints";
      for (const item of catalog.items) {
        elements.results.append(createCatalogResult(item));
      }
      elements.searchMore.hidden = true;
    }

    /** Renders concrete function results from the complete Host-side index. */
    function renderFunctionResults() {
      if (state.functionLoading && state.functionRows.length === 0) {
        elements.searchMeta.textContent = "Searching concrete functions…";
        appendEmptyResult("Reading the function index");
        elements.searchMore.hidden = true;
        return;
      }
      if (state.functionError) {
        elements.searchMeta.textContent = state.functionError;
        appendEmptyResult("Function search could not complete");
        elements.searchMore.hidden = true;
        return;
      }
      if (state.functionRows.length === 0) {
        elements.searchMeta.textContent = state.query
          ? "No concrete functions match this search."
          : "Browse or search all analyzed functions.";
        appendEmptyResult("Type a function name or source path");
        elements.searchMore.hidden = true;
        return;
      }

      elements.searchMeta.textContent = "Showing " + state.functionRows.length + " of " + state.functionTotal + " functions";
      for (const row of state.functionRows) {
        elements.results.append(createFunctionResult(row));
      }
      elements.searchMore.hidden = !state.functionNextCursor;
      elements.searchMore.disabled = state.functionLoading;
      elements.searchMore.textContent = state.functionLoading ? "Loading…" : "Load more functions";
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
      name.textContent = item.name;
      badges.append(
        createBadge(item.kind === "httpRoute" ? "HTTP" : "GraphQL", "kind"),
        createBadge(item.confidence || "unknown", "confidence " + (item.confidence || "unknown"))
      );
      detail.textContent = item.framework + " · " + item.detail
        + (item.scopeLabel ? " · " + item.scopeLabel : "")
        + (item.gapCount ? " · " + item.gapCount + " gap" + plural(item.gapCount) : "");
      button.title = "Trace " + item.name;
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
      name.textContent = row.label;
      badges.append(
        createBadge(row.functionKind || "function", "kind"),
        createBadge(row.confidence || "unknown", "confidence " + (row.confidence || "unknown"))
      );
      detail.textContent = row.detail || "Concrete source function";
      button.title = "Trace " + row.label;
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
      button.setAttribute("role", "option");
      return button;
    }

    /** Renders the selected flow, its origins, evidence, and explicit gaps. */
    function renderDetail() {
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
        elements.flowTitle.textContent = "Building a readable flow…";
        elements.flowSubtitle.textContent = "Applying depth, step, and cycle guards";
        elements.flowSummary.textContent = "";
        elements.flowOriginsSection.hidden = true;
        elements.flowGapsSection.hidden = true;
        elements.flowSteps.append(createLoadingStep());
        return;
      }

      if (state.detailError) {
        elements.flowTitle.textContent = "Flow unavailable";
        elements.flowSubtitle.textContent = state.detailError;
        elements.flowSummary.textContent = "Choose another starting point or analyze again.";
        elements.flowOriginsSection.hidden = true;
        elements.flowGapsSection.hidden = true;
        return;
      }

      const detail = state.detail;
      elements.flowSteps.setAttribute("role", detail.kind === "functionLogic" ? "group" : "tree");
      elements.flowSteps.setAttribute(
        "aria-label",
        detail.kind === "functionLogic" ? "Function control-flow graph" : "Code flow steps"
      );
      elements.flowTitle.textContent = detail.title;
      elements.flowKicker.textContent = detail.kind === "functionLogic"
        ? "FUNCTION LOGIC · POSSIBLE CONTROL PATHS"
        : "STATIC FLOW · POSSIBLE CALL PATH";
      elements.flowSubtitle.textContent = detail.subtitle;
      elements.flowSummary.textContent = detail.kind === "functionLogic" && detail.logic
        ? createFunctionLogicSummaryText(detail.logic)
        : createDetailSummaryText(detail.summary);
      elements.flowSemantics.textContent = detail.kind === "functionLogic"
        ? "Blocks and transfers come from current source syntax. They show possible paths, not values or observed runtime order."
        : "Arrows mean statically discoverable call relationships, not observed runtime order.";

      elements.flowOriginsSection.hidden = detail.origins.length === 0;
      for (const origin of detail.origins) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "origin-chip";
        button.textContent = origin.name;
        button.title = origin.framework + " · open full entrypoint flow";
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
        label.textContent = gap.label;
        text.textContent = gap.detail;
        card.append(label, text);
        elements.flowGaps.append(card);
      }
    }

    /** Creates one source-connected visual step in the vertical flow ribbon. */
    function createFlowStep(step, focusStepId) {
      const card = document.createElement("article");
      const header = document.createElement("div");
      const stage = createBadge(step.stage, "stage " + step.stage);
      const name = document.createElement("strong");
      const confidence = createBadge(
        step.confidence || "n/a",
        "confidence " + (step.confidence || "unknown")
      );
      const detail = document.createElement("div");
      const evidence = document.createElement("div");

      card.className = "flow-step stage-" + step.stage
        + (step.id === focusStepId ? " focus-step" : "");
      card.style.setProperty("--flow-depth", String(Math.min(4, Math.max(0, step.depth))));
      card.setAttribute("role", "treeitem");
      card.setAttribute("aria-level", String(step.depth + 1));
      card.tabIndex = 0;
      header.className = "flow-step-header";
      name.className = "flow-step-name";
      detail.className = "flow-step-detail";
      evidence.className = "flow-step-evidence";
      name.textContent = step.label;
      detail.textContent = step.detail;
      evidence.textContent = step.evidenceLabel;
      header.append(stage, name, confidence);
      card.append(header, detail, evidence);

      if (step.sourceToken) {
        const actions = document.createElement("div");
        const inspect = document.createElement("button");
        const source = document.createElement("button");
        actions.className = "flow-step-actions";
        inspect.type = "button";
        inspect.className = "logic-button";
        inspect.textContent = "Inspect logic";
        inspect.title = "Inspect logic · " + step.label;
        inspect.addEventListener("click", () => selectFunction({ sourceToken: step.sourceToken }));
        source.type = "button";
        source.className = "source-button";
        source.textContent = "Open source";
        source.title = step.sourceLocation || step.label;
        source.addEventListener("click", () => openSource(step.sourceToken));
        actions.append(inspect, source);
        card.append(actions);
        card.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            selectFunction({ sourceToken: step.sourceToken });
          }
        });
      }
      return card;
    }

    /** Opens a concrete source definition without recording comprehension. */
    function openSource(sourceToken) {
      vscode.postMessage({ type: "node/openSource", payload: { nodeId: sourceToken } });
      elements.status.textContent = "Source opened for verification";
    }

    ${getFunctionLogicBrowserSource()}

    /** Creates a theme-aware text badge. */
    function createBadge(label, className) {
      const badge = document.createElement("span");
      badge.className = "flow-badge " + className;
      badge.textContent = label;
      return badge;
    }

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
      loading.textContent = "Following static calls and preserving unknowns…";
      return loading;
    }

    /** Keeps primary and maintenance actions aligned with analysis lifecycle. */
    function renderActions() {
      const running = state.analysisState === "running";
      const hasGraph = Boolean(state.graph);
      elements.analyzeWorkspace.textContent = running ? "Cancel Analysis" : "Analyze Workspace";
      elements.analyzeCurrent.disabled = running;
      elements.showWorkspace.disabled = running;
      elements.exportJson.disabled = !hasGraph || running;
      elements.clearCache.disabled = running;
      elements.searchInput.disabled = !hasGraph || running;
    }

    /** Initial catalog coverage stays contextual rather than becoming a dashboard. */
    function createCatalogSummaryText() {
      const summary = state.catalog?.summary;
      if (!summary) {
        return "";
      }
      return summary.mappedCount + "/" + summary.entrypointCount + " mapped";
    }

    /** Formats only visible flow counters. */
    function createDetailSummaryText(summary) {
      const parts = [summary.stepCount + " visible step" + plural(summary.stepCount)];
      if (summary.decisionStepCount) parts.push(summary.decisionStepCount + " decision candidate" + plural(summary.decisionStepCount));
      if (summary.effectStepCount) parts.push(summary.effectStepCount + " effect boundary" + plural(summary.effectStepCount));
      if (summary.unknownStepCount) parts.push(summary.unknownStepCount + " unknown" + plural(summary.unknownStepCount));
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

    /** Posts one already-typed request and updates the compact status line. */
    function postRequest(type, payload, statusText) {
      elements.status.textContent = statusText;
      vscode.postMessage({ type, payload });
    }

    /** Small grammar helper for visible counters. */
    function plural(count) {
      return count === 1 ? "" : "s";
    }
  `;
}
