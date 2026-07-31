/**
 * Browser-only Function Logic inspector drawer.
 *
 * The drawer owns one exclusive reading mode: selected-block inspection or
 * Function Guide. Graph and Guide modules supply their own content, while this
 * module keeps disclosure, focus, and session persistence consistent.
 */

/** Returns CSP-safe helpers for one graph-adjacent inspector drawer. */
export function getFunctionLogicInspectorBrowserSource(): string {
  return /* js */ `
    const MAX_FUNCTION_LOGIC_INSPECTOR_SESSIONS = 16;
    const functionLogicInspectorStateBySession = new Map();
    let functionLogicInspectorSequence = 0;

    /** Bounds browser-only drawer state without recursive eviction. */
    function readFunctionLogicInspectorState(sessionKey) {
      const existing = functionLogicInspectorStateBySession.get(sessionKey);
      if (existing) return existing;
      const wideQuery = typeof window.matchMedia === "function"
        ? window.matchMedia("(min-width: 1040px)") : undefined;
      const created = { open: wideQuery ? wideQuery.matches : true, mode: "inspect", scrollTop: 0 };
      functionLogicInspectorStateBySession.set(sessionKey, created);
      while (functionLogicInspectorStateBySession.size > MAX_FUNCTION_LOGIC_INSPECTOR_SESSIONS) {
        const oldest = functionLogicInspectorStateBySession.keys().next().value;
        if (oldest === undefined) break;
        functionLogicInspectorStateBySession.delete(oldest);
      }
      return created;
    }

    /** Builds a right-side drawer whose mode survives graph relayouts. */
    function createFunctionLogicInspector(sessionKey) {
      const state = readFunctionLogicInspectorState(sessionKey);
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
      let currentSelectionLabel = projectAnalyzerText("selected-block");

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
      toggle.textContent = projectAnalyzerText("inspector");
      toggle.setAttribute("aria-controls", inspectorId);

      inspectContent.append(selectionPanel);
      scroll.append(inspectContent);
      headingGroup.append(eyebrow, heading, description, selectedLabel);
      header.append(headingGroup, close);
      drawer.append(header, scroll);
      workspace.append(drawer);

      /** Synchronizes header language with the sole visible reading surface. */
      function renderModeHeader() {
        const guideMode = state.mode === "guide";
        eyebrow.textContent = projectAnalyzerText(guideMode ? "guide-eyebrow" : "inspector-eyebrow");
        heading.textContent = projectAnalyzerText(guideMode ? "understand-function" : "selected-block");
        description.textContent = guideMode
          ? projectAnalyzerText("guide-description") : projectAnalyzerText("inspect-description");
        selectedLabel.hidden = guideMode;
        selectedLabel.textContent = currentSelectionLabel;
      }

      /** Applies disclosure, visibility, and assistive-technology mode state. */
      function setDrawer(nextOpen, nextMode, focusDrawer) {
        state.open = Boolean(nextOpen);
        state.mode = nextMode === "guide" && guide ? "guide" : "inspect";
        workspace.className = "logic-graph-workspace" + (state.open ? " inspector-open" : "");
        drawer.dataset.inspectorMode = state.mode;
        drawer.setAttribute("aria-hidden", state.open ? "false" : "true");
        drawer.inert = !state.open;
        inspectContent.hidden = !state.open || state.mode !== "inspect";
        if (guide) guide.setActive(state.open && state.mode === "guide");
        toggle.setAttribute("aria-expanded", state.open && state.mode === "inspect" ? "true" : "false");
        if (guide?.toggle) guide.toggle.setAttribute("aria-expanded", state.open && state.mode === "guide" ? "true" : "false");
        renderModeHeader();
        updateToggleTitle();
        if (state.open) scroll.scrollTop = state.scrollTop || 0;
        if (focusDrawer && state.open) close.focus();
        if (focusDrawer && !state.open) {
          (state.mode === "guide" && guide?.toggle ? guide.toggle : toggle).focus();
        }
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
      scroll.addEventListener("scroll", () => { state.scrollTop = scroll.scrollTop; });
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
        /** Places the graph in the first track and the drawer in the second. */
        attachViewport(viewport) { workspace.replaceChildren(viewport, drawer); },
        /** Registers the Guide as the alternate exclusive drawer mode. */
        registerGuide(nextGuide) {
          guide = nextGuide;
          if (!guide) return;
          scroll.append(guide.section);
          guide.toggle.addEventListener("click", () => openGuide(true));
          setDrawer(state.open, state.mode, false);
        },
        /** Opens inspect mode after a direct node action without stealing focus. */
        open() { setDrawer(true, "inspect", false); },
        openInspect() { setDrawer(true, "inspect", false); },
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
          toggle.textContent = projectAnalyzerText("inspector");
          // This is deliberately a presentation-only pass: preserve the active
          // drawer mode, scroll offset, and Guide instance while rewriting chrome.
          renderModeHeader();
          updateToggleTitle();
          guide?.refreshLanguage?.();
        },
        /** Lets CSS disclose only the tools relevant to the reader question. */
        setLens(lens) { drawer.dataset.logicLens = lens; },
        /** Keeps invariant Scenario controls above variable-height block evidence. */
        prependSections(...sections) {
          const available = sections.filter(Boolean);
          if (available.length > 0) inspectContent.replaceChildren(...available, ...inspectContent.children);
        },
        /** Adds graph-level tools below selected-block inspection only. */
        appendSections(...sections) {
          for (const section of sections) if (section) inspectContent.append(section);
        }
      };
    }
  `;
}
