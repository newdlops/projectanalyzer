/**
 * Browser-only Function Logic inspector drawer.
 *
 * The drawer owns one exclusive reading mode: selected-block inspection or
 * Function Guide. Graph and Guide modules supply their own content, while this
 * module keeps disclosure, focus, and session persistence consistent.
 */

import { getFunctionLogicInspectorTabsBrowserSource } from "./functionLogicInspectorTabsBrowserSource";

/** Returns CSP-safe helpers for one graph-adjacent inspector drawer. */
export function getFunctionLogicInspectorBrowserSource(): string {
  return /* js */ `
    ${getFunctionLogicInspectorTabsBrowserSource()}
    const MAX_FUNCTION_LOGIC_INSPECTOR_SESSIONS = 16;
    const functionLogicInspectorStateBySession = new Map();
    let functionLogicInspectorSequence = 0;

    /** Bounds browser-only drawer state without recursive eviction. */
    function readFunctionLogicInspectorState(sessionKey) {
      const existing = functionLogicInspectorStateBySession.get(sessionKey);
      if (existing) return existing;
      const wideQuery = typeof window.matchMedia === "function"
        ? window.matchMedia("(min-width: 1040px)") : undefined;
      const created = { open: wideQuery ? wideQuery.matches : true, mode: "inspect", tab: "code", scrollTop: 0, scrollByTab: {}, defaultGuidePending: true };
      functionLogicInspectorStateBySession.set(sessionKey, created);
      while (functionLogicInspectorStateBySession.size > MAX_FUNCTION_LOGIC_INSPECTOR_SESSIONS) {
        const oldest = functionLogicInspectorStateBySession.keys().next().value;
        if (oldest === undefined) break;
        functionLogicInspectorStateBySession.delete(oldest);
      }
      return created;
    }

    /** Builds a right-side drawer whose mode survives graph relayouts. */
    function createFunctionLogicInspector(sessionKey, hasNarratives = false) {
      const state = readFunctionLogicInspectorState(sessionKey);
      // Construction precedes Guide registration. Save the desired mode before
      // the temporary guideless shell falls back to Inspect during a relayout.
      const retainedGuideMode = state.mode === "guide";
      functionLogicInspectorSequence += 1;
      const inspectorId = "logic-inspector-" + functionLogicInspectorSequence;
      const workspace = document.createElement("div");
      const drawer = document.createElement("aside");
      const header = document.createElement("header");
      const headingGroup = document.createElement("div");
      const eyebrow = document.createElement("span");
      const heading = document.createElement("strong");
      const description = document.createElement("span");
      const selectedLabel = document.createElement("span");
      const close = document.createElement("button");
      const scroll = document.createElement("div");
      const inspectContent = document.createElement("div");
      const selectionPanel = document.createElement("section");
      const toggle = document.createElement("button");
      let guide;
      let onValuesVisibilityChanged;
      let drawerInitialized = false;
      let currentSelectionLabel = projectAnalyzerText("selected-block");
      const tabs = createFunctionLogicInspectorTabs(inspectorId, state, (previous) => {
        if (state.mode === "inspect") state.scrollByTab[previous] = scroll.scrollTop;
      }, (_previous, next) => {
        if (state.mode === "inspect") {
          scroll.scrollTop = state.scrollByTab[next] || 0;
          state.scrollTop = scroll.scrollTop;
        }
        renderModeHeader();
        notifyValuesVisibility();
      });

      workspace.className = "logic-graph-workspace";
      drawer.id = inspectorId;
      drawer.className = "logic-inspector-drawer";
      drawer.setAttribute("aria-label", projectAnalyzerText("reading-panel"));
      header.className = "logic-inspector-header";
      headingGroup.className = "logic-inspector-heading";
      selectedLabel.className = "logic-inspector-selected-label";
      description.className = "logic-inspector-mode-description";
      close.type = "button";
      close.className = "logic-inspector-close";
      close.textContent = "×";
      close.title = projectAnalyzerText("close-reading-panel");
      close.setAttribute("aria-label", close.title);
      scroll.className = "logic-inspector-scroll";
      inspectContent.className = "logic-inspector-inspect-content";
      selectionPanel.className = "logic-selection logic-inspector-selection";
      selectionPanel.setAttribute("aria-live", "polite");
      toggle.type = "button";
      toggle.className = "logic-inspector-toggle";
      toggle.textContent = projectAnalyzerText("reading-details");
      toggle.setAttribute("aria-controls", inspectorId);

      tabs.panels.get("code").append(selectionPanel);
      inspectContent.append(...tabs.panels.values());
      scroll.append(inspectContent);
      headingGroup.append(eyebrow, heading, description, selectedLabel);
      header.append(headingGroup, close);
      drawer.append(header, tabs.bar, scroll);
      workspace.append(drawer);

      /** Synchronizes header language with the sole visible reading surface. */
      function renderModeHeader() {
        const guideMode = state.mode === "guide";
        eyebrow.textContent = projectAnalyzerText(guideMode ? "guide-eyebrow" : "inspector-eyebrow");
        heading.textContent = projectAnalyzerText(guideMode ? "understand-function" : "reading-tab-" + state.tab);
        description.textContent = guideMode
          ? projectAnalyzerText(hasNarratives ? "narrative-guide-description" : "guide-description") : projectAnalyzerText("reading-tab-" + state.tab + "-hint");
        selectedLabel.hidden = guideMode || state.tab !== "code";
        selectedLabel.textContent = currentSelectionLabel;
      }

      /** Applies disclosure, visibility, and assistive-technology mode state. */
      function setDrawer(nextOpen, nextMode, focusDrawer) {
        const previousSurface = state.mode === "guide" ? "guide" : state.tab;
        if (drawerInitialized && state.open) state.scrollByTab[previousSurface] = scroll.scrollTop;
        state.open = Boolean(nextOpen);
        state.mode = nextMode === "guide" && guide ? "guide" : "inspect";
        workspace.className = "logic-graph-workspace" + (state.open ? " inspector-open" : "");
        drawer.dataset.inspectorMode = state.mode;
        drawer.setAttribute("aria-hidden", state.open ? "false" : "true");
        drawer.inert = !state.open;
        inspectContent.hidden = !state.open || state.mode !== "inspect";
        tabs.bar.hidden = !state.open || state.mode !== "inspect";
        if (guide) guide.setActive(state.open && state.mode === "guide");
        toggle.setAttribute("aria-expanded", state.open && state.mode === "inspect" ? "true" : "false");
        if (guide?.toggle) guide.toggle.setAttribute("aria-expanded", state.open && state.mode === "guide" ? "true" : "false");
        notifyValuesVisibility();
        renderModeHeader();
        updateToggleTitle();
        const nextSurface = state.mode === "guide" ? "guide" : state.tab;
        if (state.open) scroll.scrollTop = state.scrollByTab[nextSurface] ?? (drawerInitialized ? 0 : state.scrollTop || 0);
        drawerInitialized = true;
        if (focusDrawer && state.open) close.focus();
        if (focusDrawer && !state.open) {
          (state.mode === "guide" && guide?.toggle ? guide.toggle : toggle).focus();
        }
      }

      /** Hidden value controls must not leave scenario calculation or motion running. */
      function notifyValuesVisibility() {
        onValuesVisibilityChanged?.(state.open && state.mode === "inspect" && state.tab === "values");
      }

      /** Keeps the Inspector toggle purpose specific to the current selection. */
      function updateToggleTitle() {
        toggle.title = projectAnalyzerText("toggle-inspector", { action: projectAnalyzerText(state.open && state.mode === "inspect" ? "close" : "open"), label: currentSelectionLabel });
      }

      function openInspect(focusDrawer) {
        const closes = state.open && state.mode === "inspect";
        setDrawer(!closes, "inspect", focusDrawer);
      }
      function openGuide(focusDrawer) {
        const closes = state.open && state.mode === "guide";
        setDrawer(!closes, "guide", focusDrawer);
      }

      toggle.addEventListener("click", () => openInspect(true));
      close.addEventListener("click", () => setDrawer(false, state.mode, true));
      scroll.addEventListener("scroll", () => {
        state.scrollTop = scroll.scrollTop;
        if (state.open) state.scrollByTab[state.mode === "guide" ? "guide" : state.tab] = scroll.scrollTop;
      });
      workspace.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || !state.open) return;
        event.preventDefault();
        setDrawer(false, state.mode, true);
      });
      setDrawer(state.open, state.mode, false);

      return {
        workspace,
        drawer,
        selectionPanel,
        toggle,
        onValuesVisibilityChange(listener) { onValuesVisibilityChanged = listener; notifyValuesVisibility(); },
        /** Places the graph in the first track and the drawer in the second. */
        attachViewport(viewport) { workspace.replaceChildren(viewport, drawer); },
        /** Registers the Guide as the alternate exclusive drawer mode. */
        registerGuide(nextGuide) {
          guide = nextGuide;
          if (!guide) return;
          scroll.append(guide.section);
          guide.toggle.addEventListener("click", () => openGuide(true));
          // Only the first registration chooses the reading surface. Retained
          // sessions preserve explicit tabs/closed state when the graph relayouts.
          const nextMode = state.defaultGuidePending || retainedGuideMode ? "guide" : state.mode;
          if (state.defaultGuidePending) { state.defaultGuidePending = false; state.open = true; }
          // Keep the temporary shell's actual surface until setDrawer captures
          // its scroll. Prematurely choosing Guide would overwrite its offset.
          setDrawer(state.open, nextMode, false);
        },
        /** Opens inspect mode after a direct node action without stealing focus. */
        open() { tabs.select("code", false); setDrawer(true, "inspect", false); },
        openInspect(tab = "code") { tabs.select(tab, false); setDrawer(true, "inspect", false); },
        openGuide() { setDrawer(true, "guide", false); },
        /** Updates drawer and toggle context when graph selection changes. */
        setSelection(block) {
          currentSelectionLabel = block ? formatLogicBlockLabel(block) : projectAnalyzerText("selected-block");
          selectedLabel.textContent = currentSelectionLabel;
          updateToggleTitle();
        },
        /** Reapplies retained drawer chrome without changing open mode or scroll. */
        refreshLanguage() {
          drawer.setAttribute("aria-label", projectAnalyzerText("reading-panel"));
          close.title = projectAnalyzerText("close-reading-panel");
          close.setAttribute("aria-label", close.title);
          toggle.textContent = projectAnalyzerText("reading-details");
          // This is deliberately a presentation-only pass: preserve the active
          // drawer mode, scroll offset, and Guide instance while rewriting chrome.
          renderModeHeader();
          updateToggleTitle();
          tabs.refreshLanguage();
          guide?.refreshLanguage?.();
        },
        /** Keeps all panels mounted so input values, playback, and Guide handoff survive tabs. */
        appendSectionsTo(tab, ...sections) {
          const panel = tabs.panels.get(tab);
          for (const section of sections) if (section) panel?.append(section);
        }
      };
    }
  `;
}
