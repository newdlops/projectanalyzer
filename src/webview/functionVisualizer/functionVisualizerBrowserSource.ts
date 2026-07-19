/**
 * Browser program for the dedicated Function Visualizer tab. It owns a bounded
 * navigation trail and reuses the shared source-backed control-flow renderer.
 */

import { getFunctionLogicBrowserSource } from "../codeFlow/functionLogicBrowserSource";

/** Returns CSP-compatible JavaScript for one Function Visualizer panel. */
export function getFunctionVisualizerBrowserSource(): string {
  return /* js */ `
    const vscode = acquireVsCodeApi();

    const state = {
      graph: undefined,
      root: undefined,
      history: [],
      historyIndex: -1,
      pendingTarget: undefined,
      loading: false,
      error: undefined,
      selectedLogicBlockId: undefined,
      logicGraphScale: 1
    };

    const elements = {
      back: document.getElementById("function-back"),
      breadcrumbs: document.getElementById("function-breadcrumbs"),
      title: document.getElementById("function-title"),
      subtitle: document.getElementById("function-subtitle"),
      summary: document.getElementById("function-summary"),
      semantics: document.getElementById("function-semantics"),
      status: document.getElementById("status"),
      originsSection: document.getElementById("function-origins-section"),
      origins: document.getElementById("function-origins"),
      flowSteps: document.getElementById("flow-steps"),
      flowGapsSection: document.getElementById("flow-gaps-section"),
      flowGaps: document.getElementById("flow-gaps")
    };

    elements.back.addEventListener("click", () => navigateToHistory(state.historyIndex - 1));

    window.addEventListener("message", (event) => {
      const message = event.data;
      if (!message || typeof message.type !== "string") return;

      if (message.type === "functionVisualizer/sessionLoaded") {
        beginSession(message.payload);
        return;
      }
      if (message.type === "codeFlow/detailLoaded") {
        acceptFunctionDetail(message.payload);
        return;
      }
      if (message.type === "codeFlow/detailFailed") {
        acceptFunctionFailure(message.payload);
      }
    });

    vscode.postMessage({ type: "ui/ready", payload: {} });
    render();

    /** Resets browser history for one explicit editor or sidebar root request. */
    function beginSession(payload) {
      if (!payload || !payload.graphVersion || !payload.root) return;
      state.graph = { version: payload.graphVersion };
      state.root = payload.root;
      state.history = [];
      state.historyIndex = -1;
      state.pendingTarget = payload.root;
      state.loading = true;
      state.error = undefined;
      state.selectedLogicBlockId = undefined;
      state.logicGraphScale = 1;
      render();
    }

    /** Adds one correlated function result to the active, cycle-safe trail. */
    function acceptFunctionDetail(detail) {
      if (!detail || detail.kind !== "functionLogic" || !detail.logic
        || !isCurrentGraph(detail.graphVersion) || !state.pendingTarget) {
        return;
      }
      const target = state.pendingTarget;
      const existingIndex = state.history.findIndex((entry) =>
        entry.target.sourceToken === target.sourceToken
      );
      if (existingIndex >= 0) {
        state.history[existingIndex] = { target, detail };
        state.historyIndex = existingIndex;
      } else {
        state.history = state.history.slice(0, state.historyIndex + 1);
        state.history.push({ target, detail });
        state.historyIndex = state.history.length - 1;
      }
      state.pendingTarget = undefined;
      state.loading = false;
      state.error = undefined;
      state.selectedLogicBlockId = undefined;
      state.logicGraphScale = 1;
      render();
    }

    /** Keeps the current function visible when a deeper static analysis fails. */
    function acceptFunctionFailure(payload) {
      if (!payload || !isCurrentGraph(payload.graphVersion) || !state.pendingTarget) return;
      state.pendingTarget = undefined;
      state.loading = false;
      state.error = payload.message || "This function flow is unavailable.";
      render();
    }

    /** Opens a direct callee, or reuses an existing breadcrumb on call cycles. */
    function drillIntoFunction(target) {
      if (!state.graph || state.loading || !target || !target.sourceToken) return;
      const existingIndex = state.history.findIndex((entry) =>
        entry.target.sourceToken === target.sourceToken
      );
      if (existingIndex >= 0) {
        navigateToHistory(existingIndex);
        return;
      }

      state.pendingTarget = {
        sourceToken: target.sourceToken,
        label: target.qualifiedName || target.name || "Called function"
      };
      state.loading = true;
      state.error = undefined;
      elements.status.textContent = "Building " + state.pendingTarget.label + "…";
      renderNavigation();
      vscode.postMessage({
        type: "codeFlow/selectSource",
        payload: {
          graphVersion: state.graph.version,
          sourceToken: target.sourceToken
        }
      });
    }

    /** Moves through already-built function details without another Host request. */
    function navigateToHistory(index) {
      if (index < 0 || index >= state.history.length) return;
      state.historyIndex = index;
      state.pendingTarget = undefined;
      state.loading = false;
      state.error = undefined;
      state.selectedLogicBlockId = undefined;
      state.logicGraphScale = 1;
      render();
    }

    /** Renders the active function and its evidence-backed analysis gaps. */
    function render() {
      renderNavigation();
      clearElement(elements.flowSteps);
      clearElement(elements.flowGaps);
      clearElement(elements.origins);
      const entry = state.history[state.historyIndex];

      if (!entry) {
        elements.title.textContent = state.pendingTarget?.label || "Function Visualizer";
        elements.subtitle.textContent = "Building a source-backed control-flow graph";
        elements.summary.textContent = "";
        elements.semantics.textContent = "Possible static paths, not observed runtime execution.";
        elements.flowGapsSection.hidden = true;
        elements.originsSection.hidden = true;
        elements.flowSteps.append(createEmptyState(
          state.error || "Reading the function body and matching direct calls…"
        ));
        elements.status.textContent = state.error || "Analyzing function logic";
        return;
      }

      const detail = entry.detail;
      document.title = "Function Flow · " + detail.title;
      elements.title.textContent = detail.title;
      elements.subtitle.textContent = detail.subtitle;
      elements.summary.textContent = createFunctionLogicSummaryText(detail.logic);
      elements.semantics.textContent = "Blocks come from source syntax. Arrows show possible transfers; child links use statically resolved calls.";
      elements.status.textContent = state.error
        || (state.loading && state.pendingTarget
          ? "Building " + state.pendingTarget.label + "…"
          : "Select a block to explain it, or open a called function to go deeper.");
      renderOrigins(detail.origins || []);
      renderFunctionLogic(detail.logic);
      renderGaps(detail.gaps || []);
    }

    /** Shows known upstream boundaries as context without changing this root. */
    function renderOrigins(origins) {
      elements.originsSection.hidden = origins.length === 0;
      for (const origin of origins) {
        const chip = document.createElement("span");
        chip.className = "origin-chip";
        chip.textContent = origin.name + " · " + origin.framework;
        elements.origins.append(chip);
      }
    }

    /** Rebuilds bounded breadcrumbs and the single-step back action. */
    function renderNavigation() {
      clearElement(elements.breadcrumbs);
      elements.back.disabled = state.historyIndex <= 0;
      for (let index = 0; index < state.history.length; index += 1) {
        const entry = state.history[index];
        const button = document.createElement("button");
        button.type = "button";
        button.className = "breadcrumb-button" + (index === state.historyIndex ? " active" : "");
        button.textContent = entry.detail.title || entry.target.label;
        button.title = "Go back to function · " + (entry.detail.title || entry.target.label);
        button.disabled = index === state.historyIndex;
        button.addEventListener("click", () => navigateToHistory(index));
        if (index > 0) {
          const separator = document.createElement("span");
          separator.className = "breadcrumb-separator";
          separator.textContent = "→";
          separator.setAttribute("aria-hidden", "true");
          elements.breadcrumbs.append(separator);
        }
        elements.breadcrumbs.append(button);
      }
    }

    /** Renders analyzer limitations as visible static-analysis boundaries. */
    function renderGaps(gaps) {
      elements.flowGapsSection.hidden = gaps.length === 0;
      for (const gap of gaps) {
        const card = document.createElement("article");
        const label = document.createElement("strong");
        const detail = document.createElement("p");
        card.className = "gap-card";
        label.textContent = gap.label;
        detail.textContent = gap.detail;
        card.append(label, detail);
        elements.flowGaps.append(card);
      }
    }

    /** Creates one calm initial/loading state inside the visualization surface. */
    function createEmptyState(message) {
      const empty = document.createElement("div");
      empty.className = "visualizer-empty";
      empty.textContent = message;
      return empty;
    }

    ${getFunctionLogicBrowserSource()}

    /** Creates a theme-aware text badge used by the shared graph renderer. */
    function createBadge(label, className) {
      const badge = document.createElement("span");
      badge.className = "flow-badge " + className;
      badge.textContent = label;
      return badge;
    }

    /** Removes attached child nodes without interpolating Host text into HTML. */
    function clearElement(element) {
      while (element.firstChild) element.removeChild(element.firstChild);
    }

    /** Rejects responses belonging to a replaced panel visualization session. */
    function isCurrentGraph(graphVersion) {
      return Boolean(state.graph && state.graph.version === graphVersion);
    }

    /** Small grammar helper for visible counters. */
    function plural(count) {
      return count === 1 ? "" : "s";
    }
  `;
}
