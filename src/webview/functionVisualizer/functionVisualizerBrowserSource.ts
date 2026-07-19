/**
 * Browser program for the dedicated Function Visualizer tab. It owns bounded
 * navigation and lazily attaches child functions to one compound graph canvas.
 */

import { getFunctionLogicBrowserSource } from "../codeFlow/functionLogicBrowserSource";
import { getCompoundFunctionLogicGraphSource } from "./compoundFunctionLogicGraphSource";

/** Returns CSP-compatible JavaScript for one Function Visualizer panel. */
export function getFunctionVisualizerBrowserSource(): string {
  return /* js */ `
    const vscode = acquireVsCodeApi();
    const MAX_ATTACHED_FUNCTION_DEPTH = 6;
    const MAX_ATTACHED_FUNCTIONS = 32;
    const ROOT_FUNCTION_SCOPE_PREFIX = "function-root:";

    const state = {
      graph: undefined,
      root: undefined,
      history: [],
      historyIndex: -1,
      pendingTarget: undefined,
      pendingExpansionId: undefined,
      attachedFunctions: [],
      nextAttachedFunctionId: 0,
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
      state.pendingExpansionId = undefined;
      state.attachedFunctions = [];
      state.nextAttachedFunctionId = 0;
      state.loading = true;
      state.error = undefined;
      state.selectedLogicBlockId = undefined;
      state.logicGraphScale = 1;
      render();
    }

    /** Adds one correlated function result to the active, cycle-safe trail. */
    function acceptFunctionDetail(detail) {
      if (!detail || detail.kind !== "functionLogic" || !detail.logic
        || !isCurrentGraph(detail.graphVersion)
        || (!state.pendingTarget && !state.pendingExpansionId)) {
        return;
      }
      if (state.pendingExpansionId) {
        acceptAttachedFunctionDetail(detail);
        return;
      }
      const target = state.pendingTarget;
      if (!target) return;
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
      if (!payload || !isCurrentGraph(payload.graphVersion)
        || (!state.pendingTarget && !state.pendingExpansionId)) return;
      if (state.pendingExpansionId) {
        acceptAttachedFunctionFailure(payload.message);
        return;
      }
      state.pendingTarget = undefined;
      state.loading = false;
      state.error = payload.message || "This function flow is unavailable.";
      render();
    }

    /** Attaches one correlated child detail to its callsite inside the graph. */
    function acceptAttachedFunctionDetail(detail) {
      const expansionId = state.pendingExpansionId;
      const expansion = state.attachedFunctions.find((candidate) =>
        candidate.id === expansionId
      );
      if (expansion) {
        expansion.status = "loaded";
        expansion.detail = detail;
        expansion.error = undefined;
      }
      state.pendingExpansionId = undefined;
      state.loading = false;
      pumpAttachedFunctionQueue();
      render();
    }

    /** Keeps the parent flow visible and turns a failed child into one graph node. */
    function acceptAttachedFunctionFailure(message) {
      const expansionId = state.pendingExpansionId;
      const expansion = state.attachedFunctions.find((candidate) =>
        candidate.id === expansionId
      );
      if (expansion) {
        expansion.status = "failed";
        expansion.error = message || "This called function flow is unavailable.";
      }
      state.pendingExpansionId = undefined;
      state.loading = false;
      pumpAttachedFunctionQueue();
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
      if (state.pendingTarget) {
        state.pendingTarget = undefined;
        state.loading = false;
      }
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
      elements.semantics.textContent = "Blocks come from source syntax. Click a block with called code to attach that function inside this graph.";
      const pendingExpansion = state.attachedFunctions.find((candidate) =>
        candidate.id === state.pendingExpansionId
      );
      elements.status.textContent = state.error
        || (pendingExpansion
          ? "Attaching " + expansionTargetLabel(pendingExpansion) + "…"
          : state.loading && state.pendingTarget
            ? "Building " + state.pendingTarget.label + "…"
            : "Select a block to explain it; called functions attach to this canvas.");
      renderOrigins(detail.origins || []);
      const rootScopeId = createRootScopeId(entry.target.sourceToken);
      const attachedScene = createAttachedFunctionGraphScene(
        detail.logic,
        rootScopeId,
        detail.title,
        state.attachedFunctions
      );
      renderFunctionLogic(
        attachedScene.logic,
        createAttachedGraphContext(attachedScene)
      );
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

    /** Creates the root scope identity used only inside this browser session. */
    function createRootScopeId(sourceToken) {
      return ROOT_FUNCTION_SCOPE_PREFIX + sourceToken;
    }

    /** Adapts the compound scene to the reusable single-graph renderer. */
    function createAttachedGraphContext(scene) {
      return {
        selectedBlockId: state.selectedLogicBlockId,
        graphTitle: scene.attachedFunctionCount > 0
          ? "Control paths · " + (scene.attachedFunctionCount + 1) + " functions in one graph"
          : "Control paths",
        onSelectionChanged: (blockId) => {
          state.selectedLogicBlockId = blockId;
        },
        readScale: () => state.logicGraphScale,
        writeScale: (scale) => {
          state.logicGraphScale = scale;
        },
        isBlockExpanded: (blockId) => {
          const identity = scene.blockIdentityById.get(blockId);
          return Boolean(identity && state.attachedFunctions.some((candidate) =>
            candidate.parentScopeId === identity.scopeId
            && candidate.anchorBlockId === identity.sourceBlockId
          ));
        },
        isTargetExpanded: (blockId, target) => {
          const identity = scene.blockIdentityById.get(blockId);
          return Boolean(identity && state.attachedFunctions.some((candidate) =>
            candidate.parentScopeId === identity.scopeId
            && candidate.anchorBlockId === identity.sourceBlockId
            && candidate.target.sourceToken === target.sourceToken
          ));
        },
        onExpandableBlockClick: (block) => {
          const identity = scene.blockIdentityById.get(block.id);
          if (!identity) return;
          toggleAttachedFunctionBlock(identity.scopeId, {
            ...block,
            id: identity.sourceBlockId
          });
        },
        onExpandableTargetClick: (block, target) => {
          const identity = scene.blockIdentityById.get(block.id);
          if (!identity) return;
          toggleAttachedFunctionBlock(identity.scopeId, {
            ...block,
            id: identity.sourceBlockId
          }, target);
        }
      };
    }

    /** Toggles every direct function attached to one graph block, or one target. */
    function toggleAttachedFunctionBlock(parentScopeId, block, selectedTarget) {
      if (state.loading && state.pendingTarget) return;
      const rawTargets = selectedTarget ? [selectedTarget] : (block.drillTargets || []);
      const targets = [];
      const seenTokens = new Set();
      for (const target of rawTargets) {
        if (!target || !target.sourceToken || seenTokens.has(target.sourceToken)) continue;
        seenTokens.add(target.sourceToken);
        targets.push(target);
      }
      if (targets.length === 0) return;

      const selectedTokens = new Set(targets.map((target) => target.sourceToken));
      const existing = state.attachedFunctions.filter((candidate) =>
        candidate.parentScopeId === parentScopeId
        && candidate.anchorBlockId === block.id
        && (!selectedTarget || selectedTokens.has(candidate.target.sourceToken))
      );
      state.error = undefined;
      if (existing.length > 0) {
        removeAttachedFunctionBranches(existing.map((candidate) => candidate.id));
        pumpAttachedFunctionQueue();
        render();
        return;
      }

      const ancestorTokens = collectScopeSourceTokens(parentScopeId);
      const childDepth = ancestorTokens.length;
      let availableSlots = MAX_ATTACHED_FUNCTIONS - state.attachedFunctions.length;
      let addedCount = 0;
      for (const target of targets) {
        if (availableSlots <= 0) break;
        state.nextAttachedFunctionId += 1;
        const status = ancestorTokens.includes(target.sourceToken)
          ? "cycle"
          : childDepth > MAX_ATTACHED_FUNCTION_DEPTH
            ? "limited"
            : "queued";
        state.attachedFunctions.push({
          id: "attached-function:" + state.nextAttachedFunctionId,
          parentScopeId,
          anchorBlockId: block.id,
          target,
          depth: childDepth,
          status
        });
        availableSlots -= 1;
        addedCount += 1;
      }
      if (addedCount < targets.length) {
        state.error = "The attached function limit was reached. Collapse a branch before expanding more.";
      }
      pumpAttachedFunctionQueue();
      render();
    }

    /** Removes an expansion and all of its descendants with an explicit queue. */
    function removeAttachedFunctionBranches(rootIds) {
      const removedIds = new Set(rootIds);
      const pendingIds = [...rootIds];
      let cursor = 0;
      while (cursor < pendingIds.length) {
        const parentId = pendingIds[cursor];
        cursor += 1;
        for (const candidate of state.attachedFunctions) {
          if (candidate.parentScopeId !== parentId || removedIds.has(candidate.id)) continue;
          removedIds.add(candidate.id);
          pendingIds.push(candidate.id);
        }
      }
      state.attachedFunctions = state.attachedFunctions.filter((candidate) =>
        !removedIds.has(candidate.id)
      );
    }

    /** Returns ancestor function tokens for depth checks and call-cycle guards. */
    function collectScopeSourceTokens(scopeId) {
      const tokens = [];
      const visitedScopeIds = new Set();
      let currentScopeId = scopeId;
      while (currentScopeId && !visitedScopeIds.has(currentScopeId)) {
        visitedScopeIds.add(currentScopeId);
        if (currentScopeId.startsWith(ROOT_FUNCTION_SCOPE_PREFIX)) {
          tokens.push(currentScopeId.slice(ROOT_FUNCTION_SCOPE_PREFIX.length));
          break;
        }
        const expansion = state.attachedFunctions.find((candidate) =>
          candidate.id === currentScopeId
        );
        if (!expansion) break;
        tokens.push(expansion.target.sourceToken);
        currentScopeId = expansion.parentScopeId;
      }
      return tokens;
    }

    /** Sends at most one child request at a time so generic Host responses correlate safely. */
    function pumpAttachedFunctionQueue() {
      if (!state.graph || state.loading) return;
      const next = state.attachedFunctions.find((candidate) => candidate.status === "queued");
      if (!next) return;
      next.status = "loading";
      state.pendingExpansionId = next.id;
      state.loading = true;
      vscode.postMessage({
        type: "codeFlow/selectSource",
        payload: {
          graphVersion: state.graph.version,
          sourceToken: next.target.sourceToken
        }
      });
    }

    /** Returns the safest available label for one opaque child target. */
    function expansionTargetLabel(expansion) {
      return expansion.target.qualifiedName || expansion.target.name || "Called function";
    }

    ${getCompoundFunctionLogicGraphSource()}

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
