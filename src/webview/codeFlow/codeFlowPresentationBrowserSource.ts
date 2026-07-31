/**
 * Generated browser helpers for Code Flow presentation and retained localized
 * status. This fragment deliberately relies on the parent script's DOM/state
 * bindings so it adds no browser-global lifecycle of its own.
 */

/** Returns presentation helpers composed into the Code Flow browser program. */
export function getCodeFlowPresentationBrowserSource(): string {
  return /* js */ `
    /** Formats finite analysis gaps while preserving source-derived fallback text. */
    function formatCodeFlowGap(gap) {
      return gap.presentation
        ? projectAnalyzerText("logic-gap-" + gap.presentation)
        : gap.label;
    }
    /** Updates retained UI on a language switch without reinitializing Function Logic. */
    function renderLocalizedState() {
      configureSearchInput();
      renderStart();
      if (state.detail?.kind === "functionLogic") renderDetailChrome(state.detail);
      else renderDetail();
      renderActions(); refreshRetainedStatus();
    }
    /** Renders only reader chrome so Function Logic graph state remains intact. */
    function renderDetailChrome(detail) {
      elements.flowSteps.setAttribute(
        "role", detail.kind === "functionLogic" ? "group" : "tree"
      );
      elements.flowSteps.setAttribute(
        "aria-label",
        detail.kind === "functionLogic"
          ? projectAnalyzerText("function-control-graph")
          : projectAnalyzerText("code-flow-steps")
      );
      elements.flowTitle.textContent = formatCodeFlowPresentation(
        detail.titlePresentation, detail.title
      );
      elements.flowKicker.textContent = detail.kind === "functionLogic"
        ? projectAnalyzerText("function-logic-eyebrow")
        : projectAnalyzerText("static-flow-eyebrow");
      elements.flowSubtitle.textContent = formatCodeFlowSubtitle(detail);
      elements.flowSummary.textContent = detail.kind === "functionLogic" && detail.logic
        ? createFunctionLogicSummaryText(detail.logic)
        : createDetailSummaryText(detail.summary);
      elements.flowSemantics.textContent = detail.kind === "functionLogic"
        ? projectAnalyzerText("control-runtime-note")
        : projectAnalyzerText("call-runtime-note");
    }
    function formatCodeFlowSubtitle(detail) {
      if (detail.subtitlePresentation === "functionLogic") {
        return detail.subtitle
          ? projectAnalyzerText("function-logic-title") + " · " + detail.subtitle
          : projectAnalyzerText("function-logic-title");
      }
      return formatCodeFlowPresentation(detail.subtitlePresentation, detail.subtitle);
    }
    /** Creates one source-connected visual step in the vertical flow ribbon. */
    function createFlowStep(step, focusStepId) {
      const card = document.createElement("article");
      const header = document.createElement("div");
      const name = document.createElement("strong");
      const detail = document.createElement("div");
      const evidence = document.createElement("div");
      const stage = createBadge(formatCodeFlowStage(step.stage), "stage " + step.stage);
      const confidence = createBadge(formatCodeFlowConfidence(step.confidence), "confidence " + (step.confidence || "unknown"));
      const resolution = createBadge(formatCodeFlowResolution(step.resolution), "resolution " + step.resolution);
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
      name.textContent = formatCodeFlowPresentation(step.labelPresentation, step.label);
      detail.textContent = formatCodeFlowPresentation(step.detailPresentation, step.detail);
      evidence.textContent = formatCodeFlowPresentation(
        step.evidencePresentation, step.evidenceLabel
      );
      header.append(stage, name, confidence, resolution);
      card.append(header, detail, evidence);
      if (step.sourceToken) {
        const actions = document.createElement("div");
        const inspect = document.createElement("button");
        const source = document.createElement("button");
        actions.className = "flow-step-actions";
        inspect.type = "button";
        inspect.className = "logic-button";
        inspect.textContent = projectAnalyzerText("inspect-logic");
        inspect.title = projectAnalyzerText("inspect-logic-title", { label: step.label });
        inspect.addEventListener("click", () => selectFunction({ sourceToken: step.sourceToken }));
        source.type = "button";
        source.className = "source-button";
        source.textContent = projectAnalyzerText("open-source");
        source.title = step.sourceLocation || step.label;
        source.addEventListener("click", () => openSource(step.sourceToken));
        actions.append(inspect, source);
        card.append(actions);
        card.addEventListener("keydown", (event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          selectFunction({ sourceToken: step.sourceToken });
        });
      }
      return card;
    }
    /** Requests the Host to open a stable source token. */
    function openSource(sourceToken) {
      vscode.postMessage({ type: "node/openSource", payload: { nodeId: sourceToken } });
      setCodeFlowStatus("source-opened");
    }
    function createBadge(label, className) {
      const badge = document.createElement("span");
      badge.className = "flow-badge " + className;
      badge.textContent = label;
      return badge;
    }
    function formatCodeFlowPresentation(presentation, fallback) {
      return presentation && typeof presentation === "object"
        ? projectAnalyzerText(presentation.key, presentation.params)
        : fallback;
    }
    function formatCodeFlowStage(stage) {
      return projectAnalyzerText("code-flow-stage-" + stage);
    }
    function formatCodeFlowConfidence(confidence) {
      return projectAnalyzerText("code-flow-confidence-" + (confidence || "none"));
    }
    function formatCodeFlowResolution(resolution) {
      return projectAnalyzerText("code-flow-resolution-" + resolution);
    }
    function formatFunctionSearchLabel(row) {
      return row.labelPresentation
        ? projectAnalyzerText(row.labelPresentation.key, row.labelPresentation.params)
        : row.label;
    }
    function formatFunctionSearchFailure(failure) {
      if (failure?.reason === "graphUnavailable") {
        return projectAnalyzerText("function-search-failure-graph-unavailable");
      }
      if (failure?.reason === "projectionFailed") {
        return projectAnalyzerText("function-search-failure-projection-failed");
      }
      return failure?.message || projectAnalyzerText("function-search-failed");
    }
    /** Keeps raw external details literal while formatting owned wrappers. */
    function formatRetainedFailure(failure) {
      if (failure?.kind === "codeFlow" && failure.payload?.presentationKey) {
        return projectAnalyzerText("code-flow-failure-" + failure.payload.presentationKey);
      }
      if (failure?.kind === "moduleLaunch") {
        const payload = failure.payload || {};
        return projectAnalyzerText("module-launch-" + payload.outcome, {
          detail: payload.detail ? ": " + payload.detail : ""
        });
      }
      if (failure?.kind === "error") {
        const payload = failure.payload || {};
        const key = "error-" + payload.code;
        return projectAnalyzerText(key) !== key
          ? projectAnalyzerText(key, { detail: payload.detail ? ": " + payload.detail : "" })
          : payload.message;
      }
      return failure?.message || "";
    }
    /** Stores a localized status descriptor so it survives later language changes. */
    function setCodeFlowStatus(key, params) {
      state.retainedStatus = undefined;
      state.statusPresentation = { key, params };
      elements.status.textContent = projectAnalyzerText(key, params);
    }
    function refreshRetainedStatus() {
      if (state.detailError) {
        elements.status.textContent = formatRetainedFailure(state.detailError);
      } else if (state.retainedStatus) {
        elements.status.textContent = formatRetainedFailure(state.retainedStatus);
      } else if (state.statusPresentation) {
        elements.status.textContent = projectAnalyzerText(
          state.statusPresentation.key, state.statusPresentation.params
        );
      }
    }
    function formatFunctionKind(kind) {
      return projectAnalyzerText(kind === "method" ? "method-kind"
        : kind === "constructor" ? "constructor-kind" : "function-kind");
    }
    function formatConfidence(confidence) {
      return projectAnalyzerText(confidence === "exact" ? "exact-confidence"
        : confidence === "inferred" ? "inferred" : "unknown");
    }
  `;
}
