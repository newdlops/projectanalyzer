/**
 * Browser-injected controller for host-backed function search.
 *
 * Search stays inactive until the user submits it. Results are bounded pages
 * from the Extension Host, correlated to the current graph snapshot, and
 * rendered through the existing virtual tree without receiving the full index.
 */

/** Returns the self-contained search controller injected into the sidebar. */
export function getFunctionSearchBrowserSource(): string {
  return /* js */ `
    /** Maximum search rows requested in one bounded host projection. */
    const FUNCTION_SEARCH_PAGE_SIZE = 50;

    /** Mirrors the Host validator so rejected text cannot strand loading UI. */
    const FUNCTION_SEARCH_QUERY_LIMIT = 512;

    /** Binds explicit submit, clear, pagination, and keyboard affordances. */
    function bindFunctionSearchControls() {
      elements.functionSearchSubmit.addEventListener("click", () => requestFunctionSearch());
      elements.functionSearchClear.addEventListener("click", clearFunctionSearch);
      elements.functionSearchMore.addEventListener("click", () => {
        const cursor = state.functionSearch?.nextCursor;
        if (cursor) {
          requestFunctionSearch(cursor);
        }
      });
      elements.functionSearchInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          requestFunctionSearch();
        } else if (event.key === "Escape" && state.functionSearchActive) {
          event.preventDefault();
          clearFunctionSearch();
        }
      });
    }

    /** Clears search data that belongs to the previous graph snapshot. */
    function resetFunctionSearchState() {
      state.functionSearch = undefined;
      state.functionSearchActive = false;
      state.functionSearchLoading = false;
      state.functionSearchPendingCursor = undefined;
      state.functionSearchPendingRequestId = undefined;
      state.functionSearchQuery = "";
      state.functionSearchError = undefined;
      state.functionSearchFailure = undefined;
      state.functionSearchLocalError = undefined;
      state.functionSearchRevision += 1;
      if (elements.functionSearchInput) {
        elements.functionSearchInput.value = "";
      }
    }

    /** Requests either the first result page or the current query's next page. */
    function requestFunctionSearch(cursor) {
      const graphVersion = state.graph?.version;
      if (!graphVersion || state.functionSearchLoading) {
        return;
      }

      // Pagination is bound to the submitted query even if the user edits the
      // input before choosing Load more.
      const query = cursor
        ? state.functionSearchQuery
        : elements.functionSearchInput.value.trim();
      if (cursor && cursor !== state.functionSearch?.nextCursor) {
        return;
      }
      if (query.length > FUNCTION_SEARCH_QUERY_LIMIT) {
        state.functionSearch = undefined;
        state.functionSearchActive = true;
        state.functionSearchLoading = false;
        state.functionSearchPendingCursor = undefined;
        state.functionSearchPendingRequestId = undefined;
        state.functionSearchQuery = query;
        state.functionSearchError = undefined;
        state.functionSearchFailure = undefined;
        state.functionSearchLocalError = {
          key: "search-query-limit",
          params: { count: FUNCTION_SEARCH_QUERY_LIMIT }
        };
        state.functionSearchRevision += 1;
        state.treeRowsCache.clear();
        renderFunctionCallTree();
        return;
      }

      const requestId = state.functionSearchRequestSequence + 1;
      state.functionSearchRequestSequence = requestId;

      state.functionSearchActive = true;
      state.functionSearchLoading = true;
      state.functionSearchPendingCursor = cursor;
      state.functionSearchPendingRequestId = requestId;
      state.functionSearchQuery = query;
      state.functionSearchError = undefined;
      state.functionSearchFailure = undefined;
      state.functionSearchLocalError = undefined;
      if (!cursor) {
        state.functionSearch = undefined;
      }
      state.functionSearchRevision += 1;
      state.treeRowsCache.clear();
      renderFunctionCallTree();
      postRequest("function/search", {
        graphVersion,
        requestId,
        query,
        limit: FUNCTION_SEARCH_PAGE_SIZE,
        ...(cursor ? { cursor } : {}),
        filters: {
          includeExternal: false,
          includeUnresolved: false
        }
      }, projectAnalyzerText(query ? "searching-functions-status" : "loading-all-functions"));
    }

    /** Accepts only the active query and appends a cursor page without duplicates. */
    function acceptFunctionSearchPayload(payload) {
      if (
        !state.functionSearchActive
        || !isCurrentGraphVersion(payload.graphVersion)
        || payload.requestId !== state.functionSearchPendingRequestId
        || payload.query !== state.functionSearchQuery
      ) {
        return false;
      }

      const shouldAppend = Boolean(
        state.functionSearchPendingCursor
        && state.functionSearch?.query === payload.query
      );
      const rows = shouldAppend
        ? mergeFunctionSearchRows(state.functionSearch.rows, payload.rows)
        : payload.rows;

      state.functionSearch = { ...payload, rows };
      state.functionSearchLoading = false;
      state.functionSearchPendingCursor = undefined;
      state.functionSearchPendingRequestId = undefined;
      state.functionSearchError = undefined;
      state.functionSearchFailure = undefined;
      state.functionSearchLocalError = undefined;
      state.functionSearchRevision += 1;
      state.treeRowsCache.clear();
      if (shouldAppend && !payload.nextCursor) {
        elements.functionSearchInput.focus();
      }
      return true;
    }

    /** Ends only the matching in-flight request and leaves search retryable. */
    function acceptFunctionSearchFailurePayload(payload) {
      if (
        !state.functionSearchActive
        || !isCurrentGraphVersion(payload.graphVersion)
        || payload.requestId !== state.functionSearchPendingRequestId
        || payload.query !== state.functionSearchQuery
      ) {
        return false;
      }

      state.functionSearchLoading = false;
      state.functionSearchPendingCursor = undefined;
      state.functionSearchPendingRequestId = undefined;
      state.functionSearchError = payload.message;
      state.functionSearchFailure = payload;
      state.functionSearchLocalError = undefined;
      state.functionSearchRevision += 1;
      state.treeRowsCache.clear();
      elements.functionSearchInput.focus();
      return true;
    }

    /** Routes both search response variants through request correlation. */
    function acceptFunctionSearchMessage(message) {
      return message.type === "function/searchLoaded"
        ? acceptFunctionSearchPayload(message.payload)
        : acceptFunctionSearchFailurePayload(message.payload);
    }

    /** Preserves page order while rejecting duplicate stable row identities. */
    function mergeFunctionSearchRows(existingRows, nextRows) {
      const rowsById = new Map();
      for (const row of existingRows.concat(nextRows)) {
        if (!rowsById.has(row.id)) {
          rowsById.set(row.id, row);
        }
      }
      return Array.from(rowsById.values());
    }

    /** Leaves search mode and restores the semantic flow tree. */
    function clearFunctionSearch() {
      resetFunctionSearchState();
      state.treeRowsCache.clear();
      renderFunctionCallTree();
      elements.functionSearchInput.focus();
    }

    /** Re-formats retained search copy after a language switch without posting a request. */
    function refreshFunctionSearchLanguage() {
      renderFunctionSearchControls();
      if (state.functionSearchActive) {
        state.functionSearchRevision += 1;
        state.treeRowsCache.clear();
        renderFunctionCallTree();
      }
    }

    /** Updates controls without recreating them during virtual-tree renders. */
    function renderFunctionSearchControls() {
      const hasGraph = Boolean(state.graph);
      elements.functionSearch.setAttribute(
        "aria-busy",
        state.functionSearchLoading ? "true" : "false"
      );
      elements.functionSearchInput.disabled = !hasGraph;
      elements.functionSearchSubmit.disabled = !hasGraph || state.functionSearchLoading;
      elements.functionSearchClear.hidden = !state.functionSearchActive;
      elements.functionSearchMore.hidden = !Boolean(
        state.functionSearchActive
        && (state.functionSearch?.nextCursor || state.functionSearchPendingCursor)
      );
      elements.functionSearchMore.disabled = state.functionSearchLoading;

      if (!state.functionSearchActive) {
        elements.functionSearchStatus.textContent = projectAnalyzerText("search-help");
        return;
      }
      if (state.functionSearchFailure || state.functionSearchLocalError || state.functionSearchError) {
        elements.functionSearchStatus.textContent = formatFunctionSearchFailure(
          state.functionSearchFailure,
          state.functionSearchError,
          state.functionSearchLocalError
        );
        return;
      }
      if (state.functionSearchLoading && !state.functionSearch) {
        elements.functionSearchStatus.textContent = projectAnalyzerText("searching");
        return;
      }

      const loadedCount = state.functionSearch?.rows.length ?? 0;
      const totalCount = state.functionSearch?.totalMatchCount ?? loadedCount;
      elements.functionSearchStatus.textContent = projectAnalyzerText("function-search-matching-count", {
        loaded: loadedCount,
        total: totalCount
      });
    }

    /** Converts protocol search rows into source-opening virtual tree rows. */
    function createFunctionSearchRows() {
      return (state.functionSearch?.rows ?? []).map((row) => {
        const nodeId = row.sourceToken;
        const isConcrete = Boolean(
          nodeId
          && !["external", "unresolved"].includes(row.functionKind)
          && !["external", "unresolved"].includes(row.role)
        );

        return {
          id: "function-search-result:" + row.id,
          label: formatFunctionSearchLabel(row),
          name: formatFunctionSearchLabel(row),
          detail: formatFunctionSearchDetail(row),
          kind: isConcrete ? "semantic" : (row.functionKind || row.kind),
          nodeId: isConcrete ? nodeId : undefined,
          functionKind: row.functionKind,
          depth: 0,
          hasChildren: false,
          expanded: false,
          openSourceOnClick: isConcrete
        };
      });
    }

    /** Formats owned callable metadata from semantic protocol fields only. */
    function formatFunctionSearchDetail(row) {
      const parts = [];
      if (row.detail) parts.push(row.detail); // source path/location literal
      const architecture = row.architecture;
      if (architecture) {
        const layerKey = "architecture-" + architecture.layer;
        let summary = projectAnalyzerText(layerKey);
        if (architecture.businessLogic === "domainRuleCandidate") summary += " · " + projectAnalyzerText("domain-rule-candidate");
        if (architecture.businessLogic === "applicationWorkflowCandidate") summary += " · " + projectAnalyzerText("workflow-candidate");
        parts.push(summary + " · " + projectAnalyzerText("purity-unverified"));
      } else {
        parts.push(projectAnalyzerText("unclassified") + " · " + projectAnalyzerText("purity-unverified"));
      }
      const metrics = row.metrics || {};
      parts.push(projectAnalyzerText("caller-count", { count: metrics.directCallerCount || 0 }));
      parts.push(projectAnalyzerText("callee-count", { count: metrics.directCalleeCount || 0 }));
      return parts.join(" · ");
    }

    /** Prefers semantic fallback labels while preserving literal source labels. */
    function formatFunctionSearchLabel(row) {
      return row.labelPresentation
        ? projectAnalyzerText(row.labelPresentation.key, row.labelPresentation.params)
        : row.label;
    }

    /** Formats a retained Host failure without issuing another search request. */
    function formatFunctionSearchFailure(failure, fallback, localFailure) {
      if (failure?.reason === "graphUnavailable") return projectAnalyzerText("function-search-failure-graph-unavailable");
      if (failure?.reason === "projectionFailed") return projectAnalyzerText("function-search-failure-projection-failed");
      if (localFailure?.key) return projectAnalyzerText(localFailure.key, localFailure.params);
      return fallback || projectAnalyzerText("function-search-failed");
    }
  `;
}
