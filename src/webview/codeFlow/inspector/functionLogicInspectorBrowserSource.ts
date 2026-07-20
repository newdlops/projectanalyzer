/**
 * Browser-only Function Logic inspector drawer. It owns drawer state,
 * accessibility, and a separate layout column while leaving graph selection
 * content and analysis semantics in their feature modules.
 */

/** Returns CSP-safe helpers for one graph-adjacent inspector drawer. */
export function getFunctionLogicInspectorBrowserSource(): string {
  return /* js */ `
    let functionLogicInspectorSessionKey = "";
    let functionLogicInspectorOpen = false;
    let functionLogicInspectorSequence = 0;

    /** Builds one right-side drawer whose open state survives graph relayouts. */
    function createFunctionLogicInspector(sessionKey) {
      if (functionLogicInspectorSessionKey !== sessionKey) {
        functionLogicInspectorSessionKey = sessionKey;
        // Scenario Variables are part of every graph's stable Inspector
        // contract. A user's later close choice survives same-root relayouts.
        functionLogicInspectorOpen = true;
      }
      functionLogicInspectorSequence += 1;
      const inspectorId = "logic-inspector-" + functionLogicInspectorSequence;
      const workspace = document.createElement("div");
      const drawer = document.createElement("aside");
      const header = document.createElement("header");
      const headingGroup = document.createElement("div");
      const eyebrow = document.createElement("span");
      const heading = document.createElement("strong");
      const selectedLabel = document.createElement("span");
      const close = document.createElement("button");
      const scroll = document.createElement("div");
      const selectionPanel = document.createElement("section");
      const toggle = document.createElement("button");
      let currentSelectionLabel = "selected block";

      workspace.className = "logic-graph-workspace";
      drawer.id = inspectorId;
      drawer.className = "logic-inspector-drawer";
      drawer.setAttribute("aria-label", "Function block inspector");
      header.className = "logic-inspector-header";
      headingGroup.className = "logic-inspector-heading";
      eyebrow.textContent = "FUNCTION INSPECTOR";
      heading.textContent = "Selected block";
      selectedLabel.className = "logic-inspector-selected-label";
      selectedLabel.textContent = currentSelectionLabel;
      close.type = "button";
      close.className = "logic-inspector-close";
      close.textContent = "×";
      close.title = "Close function inspector";
      close.setAttribute("aria-label", "Close function inspector");
      scroll.className = "logic-inspector-scroll";
      selectionPanel.className = "logic-selection logic-inspector-selection";
      selectionPanel.setAttribute("aria-live", "polite");
      toggle.type = "button";
      toggle.className = "logic-inspector-toggle";
      toggle.textContent = "Inspector";
      toggle.setAttribute("aria-controls", inspectorId);

      headingGroup.append(eyebrow, heading, selectedLabel);
      header.append(headingGroup, close);
      scroll.append(selectionPanel);
      drawer.append(header, scroll);
      workspace.append(drawer);

      /** Applies visual, focus, and assistive-technology drawer state. */
      function setOpen(nextOpen, focusDrawer) {
        functionLogicInspectorOpen = Boolean(nextOpen);
        workspace.className = "logic-graph-workspace"
          + (functionLogicInspectorOpen ? " inspector-open" : "");
        drawer.setAttribute("aria-hidden", functionLogicInspectorOpen ? "false" : "true");
        drawer.inert = !functionLogicInspectorOpen;
        toggle.setAttribute("aria-expanded", functionLogicInspectorOpen ? "true" : "false");
        updateToggleTitle();
        if (focusDrawer && functionLogicInspectorOpen) close.focus();
        if (focusDrawer && !functionLogicInspectorOpen) toggle.focus();
      }

      /** Keeps the toggle purpose specific to the current graph selection. */
      function updateToggleTitle() {
        toggle.title = (functionLogicInspectorOpen ? "Close" : "Open")
          + " function inspector · " + currentSelectionLabel;
      }

      toggle.addEventListener("click", () => setOpen(!functionLogicInspectorOpen, true));
      close.addEventListener("click", () => setOpen(false, true));
      workspace.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || !functionLogicInspectorOpen) return;
        event.preventDefault();
        setOpen(false, true);
      });
      setOpen(functionLogicInspectorOpen, false);

      return {
        workspace,
        drawer,
        selectionPanel,
        toggle,
        /** Places the graph in the first track and the drawer in the second. */
        attachViewport(viewport) {
          workspace.replaceChildren(viewport, drawer);
        },
        /** Opens after a direct node action without stealing graph focus. */
        open() {
          setOpen(true, false);
        },
        /** Updates drawer and toggle context when graph selection changes. */
        setSelection(block) {
          currentSelectionLabel = block?.label || "selected block";
          selectedLabel.textContent = currentSelectionLabel;
          updateToggleTitle();
        },
        /** Keeps invariant Scenario controls above variable-height block evidence. */
        prependSections(...sections) {
          const available = sections.filter(Boolean);
          if (available.length > 0) {
            scroll.replaceChildren(...available, ...scroll.children);
          }
        },
        /** Adds graph-level tools below the selected-block inspector. */
        appendSections(...sections) {
          for (const section of sections) {
            if (section) scroll.append(section);
          }
        }
      };
    }
  `;
}
