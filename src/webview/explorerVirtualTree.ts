/**
 * Browser-injected virtual tree renderer for sidebar explorer lists. It keeps
 * the tree API row-based while limiting live DOM nodes to the visible viewport.
 */

/** Returns browser-injected source for virtualized tree rendering. */
export function getVirtualTreeBrowserSource(): string {
  return /* js */ `
    const VIRTUAL_TREE_ROW_HEIGHT = 22;
    const VIRTUAL_TREE_OVERSCAN = 10;

    function renderVirtualTree(parent, rows, emptyMessage) {
      const state = getVirtualTreeState(parent);
      state.rows = rows;
      state.emptyMessage = emptyMessage;
      state.renderedRange = "";

      parent.classList.add("virtual-tree");

      if (rows.length === 0) {
        resetVirtualTree(parent);
        parent.classList.remove("virtual-tree");
        appendEmptyTree(parent, emptyMessage);
        return;
      }

      if (!state.spacer) {
        parent.replaceChildren();
        state.spacer = document.createElement("div");
        state.spacer.className = "virtual-tree-spacer";
        parent.append(state.spacer);
      }

      state.spacer.style.height = String(rows.length * VIRTUAL_TREE_ROW_HEIGHT) + "px";
      renderVirtualTreeWindow(state);
    }

    function clearVirtualTree(parent) {
      if (!parent) {
        return;
      }

      const state = parent.__projectAnalyzerVirtualTree;
      if (state?.scrollHandler) {
        parent.removeEventListener("scroll", state.scrollHandler);
      }
      parent.__projectAnalyzerVirtualTree = undefined;
      parent.classList.remove("virtual-tree");
      parent.replaceChildren();
    }

    function getVirtualTreeState(parent) {
      if (parent.__projectAnalyzerVirtualTree) {
        return parent.__projectAnalyzerVirtualTree;
      }

      const state = {
        emptyMessage: "",
        parent,
        renderedRange: "",
        rows: [],
        spacer: undefined,
        scrollHandler: undefined
      };

      state.scrollHandler = () => {
        window.requestAnimationFrame(() => renderVirtualTreeWindow(state));
      };
      parent.addEventListener("scroll", state.scrollHandler, { passive: true });
      parent.__projectAnalyzerVirtualTree = state;
      return state;
    }

    function renderVirtualTreeWindow(state) {
      const parent = state.parent;
      const spacer = state.spacer;
      const viewportHeight = Math.max(parent.clientHeight || 0, VIRTUAL_TREE_ROW_HEIGHT);
      const firstVisible = Math.floor(parent.scrollTop / VIRTUAL_TREE_ROW_HEIGHT);
      const visibleCount = Math.ceil(viewportHeight / VIRTUAL_TREE_ROW_HEIGHT);
      const start = Math.max(0, firstVisible - VIRTUAL_TREE_OVERSCAN);
      const end = Math.min(state.rows.length, firstVisible + visibleCount + VIRTUAL_TREE_OVERSCAN);
      const rangeKey = String(start) + ":" + String(end) + ":" + String(state.rows.length);

      if (!spacer || state.renderedRange === rangeKey) {
        return;
      }

      state.renderedRange = rangeKey;
      spacer.replaceChildren();

      for (let index = start; index < end; index += 1) {
        const rowElement = createTreeRow(state.rows[index]);
        rowElement.classList.add("virtual-tree-row");
        rowElement.style.transform = "translateY(" + String(index * VIRTUAL_TREE_ROW_HEIGHT) + "px)";
        spacer.append(rowElement);
      }
    }

    function resetVirtualTree(parent) {
      const state = parent.__projectAnalyzerVirtualTree;

      if (state) {
        state.renderedRange = "";
        state.rows = [];
        state.spacer = undefined;
      }

      parent.replaceChildren();
    }
  `;
}
