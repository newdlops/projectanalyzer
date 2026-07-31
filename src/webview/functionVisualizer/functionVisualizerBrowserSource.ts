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
      enteringAttachedFunctionIds: new Set(),
      nextAttachedFunctionId: 0,
      activeLogicGraphSurface: undefined,
      activeLogicViewportController: undefined,
      activeLogicValueFlowRendering: undefined,
      uiLanguage: "en",
      loading: false,
      error: undefined,
      selectedLogicBlockId: undefined,
      logicGraphScale: 1,
      logicGraphViewportTransform: undefined,
      presentation: { breadcrumbs: [], gaps: [], empty: undefined }
    };

    const elements = {
      topbar: document.getElementById("function-navigation"),
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

      if (message.type === "ui/language") {
        const language = message.payload?.language === "ko" ? "ko" : "en";
        state.uiLanguage = language;
        applyProjectAnalyzerLanguage(language);
        relocalizeFunctionVisualizerPresentation();
        return;
      }

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
      state.enteringAttachedFunctionIds.clear();
      state.nextAttachedFunctionId = 0;
      state.activeLogicGraphSurface = undefined;
      state.loading = true;
      state.error = undefined;
      state.selectedLogicBlockId = undefined;
      state.logicGraphScale = 1;
      state.logicGraphViewportTransform = undefined;
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
      state.logicGraphViewportTransform = undefined;
      render();
    }

    /** Keeps the current function visible when a deeper static analysis fails. */
    function acceptFunctionFailure(payload) {
      if (!payload || !isCurrentGraph(payload.graphVersion)
        || (!state.pendingTarget && !state.pendingExpansionId)) return;
      if (state.pendingExpansionId) {
        acceptAttachedFunctionFailure(payload);
        return;
      }
      state.pendingTarget = undefined;
      state.loading = false;
      state.error = payload;
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
    function acceptAttachedFunctionFailure(failure) {
      const expansionId = state.pendingExpansionId;
      const expansion = state.attachedFunctions.find((candidate) =>
        candidate.id === expansionId
      );
      if (expansion) {
        expansion.status = "failed";
        expansion.error = failure;
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
        label: target.qualifiedName || target.name || projectAnalyzerText("called-function")
      };
      state.loading = true;
      state.error = undefined;
      setVisualizerStatus(projectAnalyzerText("building-function", { label: state.pendingTarget.label }), true);
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
      state.logicGraphViewportTransform = undefined;
      render();
    }

    /** Renders the active function and its evidence-backed analysis gaps. */
    function render() {
      renderNavigation();
      const entry = state.history[state.historyIndex];
      const rootScopeId = entry
        ? createRootScopeId(entry.target.sourceToken)
        : undefined;
      const graphViewportSnapshot = captureLogicGraphViewport(rootScopeId);
      disposeActiveFunctionLogicViewport();
      state.activeLogicGraphSurface = undefined;
      clearElement(elements.flowSteps);
      clearElement(elements.flowGaps);
      clearElement(elements.origins);
      state.presentation = { breadcrumbs: [], gaps: [], empty: undefined };

      if (!entry) {
        elements.title.textContent = state.pendingTarget?.label || projectAnalyzerText("function-title");
        elements.subtitle.textContent = projectAnalyzerText("building-control-flow");
        elements.summary.textContent = "";
        elements.semantics.textContent = projectAnalyzerText("static-not-runtime");
        elements.flowGapsSection.hidden = true;
        elements.originsSection.hidden = true;
        state.presentation.empty = createEmptyState(formatFunctionStatus(state.error) || projectAnalyzerText("reading-function"));
        elements.flowSteps.append(state.presentation.empty);
        setVisualizerStatus(formatFunctionStatus(state.error) || projectAnalyzerText("analyzing-function-logic"), true);
        return;
      }

      const detail = entry.detail;
      document.title = projectAnalyzerText("function-flow-title", { title: detail.title });
      elements.title.textContent = detail.title;
      elements.subtitle.textContent = formatFunctionSubtitle(detail);
      elements.summary.textContent = createFunctionLogicSummaryText(detail.logic);
      elements.semantics.textContent = projectAnalyzerText("function-semantics");
      const pendingExpansion = state.attachedFunctions.find((candidate) =>
        candidate.id === state.pendingExpansionId
      );
      const activeStatus = formatFunctionStatus(state.error)
        || (pendingExpansion
          ? projectAnalyzerText("attaching-function", { label: expansionTargetLabel(pendingExpansion) })
          : state.loading && state.pendingTarget
            ? projectAnalyzerText("building-function", { label: state.pendingTarget.label })
            : "");
      setVisualizerStatus(activeStatus, Boolean(activeStatus));
      renderOrigins(detail.origins || []);
      const attachedScene = createAttachedFunctionGraphScene(
        detail.logic,
        rootScopeId,
        detail.title,
        state.attachedFunctions
      );
      renderFunctionLogic(
        attachedScene.logic,
        createAttachedGraphContext(attachedScene, rootScopeId, graphViewportSnapshot)
      );
      renderGaps(detail.gaps || []);
    }

    /** Patches retained Function Visualizer chrome and graph copy without rebuilding state. */
    function relocalizeFunctionVisualizerPresentation() {
      const entry = state.history[state.historyIndex];
      if (!entry) {
        elements.title.textContent = state.pendingTarget?.label || projectAnalyzerText("function-title");
        elements.subtitle.textContent = projectAnalyzerText("building-control-flow");
        elements.semantics.textContent = projectAnalyzerText("static-not-runtime");
        state.presentation.empty && (state.presentation.empty.textContent = formatFunctionStatus(state.error) || projectAnalyzerText("reading-function"));
        relocalizeNavigation();
        setVisualizerStatus(formatFunctionStatus(state.error) || projectAnalyzerText("analyzing-function-logic"), true);
        return;
      }
      const detail = entry.detail;
      document.title = projectAnalyzerText("function-flow-title", { title: detail.title });
      elements.subtitle.textContent = formatFunctionSubtitle(detail);
      elements.summary.textContent = createFunctionLogicSummaryText(detail.logic);
      elements.semantics.textContent = projectAnalyzerText("function-semantics");
      relocalizeNavigation();
      for (const record of state.presentation.gaps) {
        record.label.textContent = record.gap.presentation ? projectAnalyzerText("logic-gap-" + record.gap.presentation) : record.gap.label;
        record.detail.textContent = record.gap.detailPresentation ? projectAnalyzerText(record.gap.detailPresentation.key, record.gap.detailPresentation.params) : record.gap.detail;
      }
      const pendingExpansion = state.attachedFunctions.find((candidate) => candidate.id === state.pendingExpansionId);
      const localizedStatus = formatFunctionStatus(state.error) || (pendingExpansion
        ? projectAnalyzerText("attaching-function", { label: expansionTargetLabel(pendingExpansion) })
        : state.loading && state.pendingTarget
          ? projectAnalyzerText("building-function", { label: state.pendingTarget.label }) : "");
      setVisualizerStatus(localizedStatus, Boolean(localizedStatus));
      state.activeLogicGraphRendering?.updateLanguage(state.uiLanguage);
    }

    /** Keeps source locations literal while localizing their owned wrapper. */
    function formatFunctionSubtitle(detail) {
      if (detail.subtitlePresentation === "functionLogic") {
        return detail.subtitle
          ? projectAnalyzerText("function-logic-title") + " · " + detail.subtitle
          : projectAnalyzerText("function-logic-title");
      }
      return detail.subtitle;
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
      // A single root breadcrumb repeats the title and costs a full sticky row.
      // Navigation chrome appears only after a real parent/child trail exists.
      elements.topbar.hidden = state.history.length <= 1;
      elements.back.disabled = state.historyIndex <= 0;
      for (let index = 0; index < state.history.length; index += 1) {
        const entry = state.history[index];
        const button = document.createElement("button");
        button.type = "button";
        button.className = "breadcrumb-button" + (index === state.historyIndex ? " active" : "");
        button.textContent = entry.detail.title || entry.target.label;
        button.title = projectAnalyzerText("back-to-function", { title: entry.detail.title || entry.target.label });
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
        state.presentation.breadcrumbs.push({ button, entry });
      }
    }

    /** Updates retained navigation labels without rebuilding its history controls. */
    function relocalizeNavigation() {
      for (const record of state.presentation.breadcrumbs) {
        record.button.title = projectAnalyzerText("back-to-function", { title: record.entry.detail.title || record.entry.target.label });
      }
    }

    /** Reserves vertical status space only for active work or an actionable error. */
    function setVisualizerStatus(message, visible) {
      elements.status.textContent = message || "";
      elements.status.hidden = !visible;
    }
    /** Resolves retained Host failure descriptors on each locale change. */
    function formatFunctionStatus(status) {
      if (status?.presentationKey) return projectAnalyzerText("code-flow-failure-" + status.presentationKey);
      if (status?.localKey) return projectAnalyzerText(status.localKey);
      return status?.message || "";
    }

    /** Renders analyzer limitations as visible static-analysis boundaries. */
    function renderGaps(gaps) {
      elements.flowGapsSection.hidden = gaps.length === 0;
      for (const gap of gaps) {
        const card = document.createElement("article");
        const label = document.createElement("strong");
        const detail = document.createElement("p");
        card.className = "gap-card";
        label.textContent = gap.presentation ? projectAnalyzerText("logic-gap-" + gap.presentation) : gap.label;
        detail.textContent = gap.detailPresentation
          ? projectAnalyzerText(gap.detailPresentation.key, gap.detailPresentation.params)
          : gap.detail;
        card.append(label, detail);
        elements.flowGaps.append(card);
        state.presentation.gaps.push({ gap, label, detail });
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
    function createAttachedGraphContext(scene, rootScopeId, graphViewportSnapshot) {
      const graphKind = () => scene.logic.blocks.some((block) =>
        block.valueChanges && block.valueChanges.length > 0
      ) || (scene.logic.valueBindings || []).length > 0
        ? projectAnalyzerText("control-value-flow") : projectAnalyzerText("control-paths");
      const isEnteringBlock = (blockId) => {
        const identity = scene.blockIdentityById.get(blockId);
        return Boolean(
          identity && state.enteringAttachedFunctionIds.has(identity.scopeId)
        );
      };
      return {
        selectedBlockId: state.selectedLogicBlockId,
        graphTitle: () => scene.attachedFunctionCount > 0
          ? projectAnalyzerText("functions-in-one-graph", { count: scene.attachedFunctionCount + 1, graph: graphKind() })
          : graphKind(),
        onSelectionChanged: (blockId) => {
          state.selectedLogicBlockId = blockId;
        },
        readViewportTransform: () => state.logicGraphViewportTransform,
        writeViewportTransform: (transform) => {
          state.logicGraphViewportTransform = transform;
          state.logicGraphScale = transform.scale;
        },
        isBlockEntering: isEnteringBlock,
        isEdgeEntering: (edge) =>
          isEnteringBlock(edge.sourceId) || isEnteringBlock(edge.targetId),
        onGraphRendered: (graphRendering) => {
          const surface = {
            rootScopeId,
            viewport: graphRendering.viewport,
            viewportController: graphRendering.viewportController,
            nodeLayoutsByBlockId: graphRendering.nodeLayoutsByBlockId
          };
          restoreLogicGraphViewport(graphViewportSnapshot, surface);
          state.activeLogicGraphSurface = surface;
          finishAttachedFunctionEntryAnimations();
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

    /** Captures one selected callsite's screen position before rebuilding the graph. */
    function captureLogicGraphViewport(rootScopeId) {
      const surface = state.activeLogicGraphSurface;
      if (!rootScopeId || !surface || surface.rootScopeId !== rootScopeId) return undefined;
      const transform = surface.viewportController.getTransform();
      if (!transform) return undefined;
      const blockId = state.selectedLogicBlockId;
      const nodeLayout = blockId
        ? surface.nodeLayoutsByBlockId.get(blockId)
        : undefined;
      return {
        blockId: nodeLayout ? blockId : undefined,
        relativeX: nodeLayout ? transform.x + nodeLayout.x * transform.scale : undefined,
        relativeY: nodeLayout ? transform.y + nodeLayout.y * transform.scale : undefined,
        transform
      };
    }

    /** Restores free-pan state or compensates for movement around the selected callsite. */
    function restoreLogicGraphViewport(snapshot, surface) {
      if (!snapshot || !surface) return;
      const nodeLayout = snapshot.blockId
        ? surface.nodeLayoutsByBlockId.get(snapshot.blockId)
        : undefined;
      const current = surface.viewportController.getTransform() || snapshot.transform;
      if (!current) return;
      surface.viewportController.setTransform({
        scale: current.scale,
        x: nodeLayout && Number.isFinite(snapshot.relativeX)
          ? snapshot.relativeX - nodeLayout.x * current.scale
          : snapshot.transform.x,
        y: nodeLayout && Number.isFinite(snapshot.relativeY)
          ? snapshot.relativeY - nodeLayout.y * current.scale
          : snapshot.transform.y
      }, false);
    }

    /** Stops marking terminal child scopes after their entry frame has been mounted once. */
    function finishAttachedFunctionEntryAnimations() {
      for (const expansionId of state.enteringAttachedFunctionIds) {
        const expansion = state.attachedFunctions.find((candidate) =>
          candidate.id === expansionId
        );
        if (!expansion || (expansion.status !== "queued" && expansion.status !== "loading")) {
          state.enteringAttachedFunctionIds.delete(expansionId);
        }
      }
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
        const expansionId = "attached-function:" + state.nextAttachedFunctionId;
        const status = ancestorTokens.includes(target.sourceToken)
          ? "cycle"
          : childDepth > MAX_ATTACHED_FUNCTION_DEPTH
            ? "limited"
            : "queued";
        state.attachedFunctions.push({
          id: expansionId,
          parentScopeId,
          anchorBlockId: block.id,
          target,
          depth: childDepth,
          status
        });
        state.enteringAttachedFunctionIds.add(expansionId);
        availableSlots -= 1;
        addedCount += 1;
      }
      if (addedCount < targets.length) {
        state.error = { localKey: "attached-limit" };
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
      for (const removedId of removedIds) {
        state.enteringAttachedFunctionIds.delete(removedId);
      }
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
      return expansion.target.qualifiedName || expansion.target.name || projectAnalyzerText("called-function");
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
