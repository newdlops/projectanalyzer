/** Source outline adapter: local filtering and explicit graph/evidence navigation. */
import { getFunctionReadingModelBrowserSource } from "./functionReadingModel";

/** Returns browser declarations; adapters own selection, camera, and Inspector state. */
export function getFunctionReadingBrowserSource(): string {
  return /* js */ `
    ${getFunctionReadingModelBrowserSource()}
    const functionReadingSessions = new Map();
    let functionReadingSequence = 0;

    /** Mounts one outline beside the existing canvas without cloning graph nodes. */
    function createFunctionReadingSurface(logic, sessionKey, viewport, controller, viewportController, inspector) {
      const model = createFunctionReadingOutline(logic);
      const wide = typeof window.matchMedia !== "function" || window.matchMedia("(min-width: 1040px)").matches;
      const local = functionReadingSessions.get(sessionKey) || { open: wide, filter: "all" };
      functionReadingSessions.set(sessionKey, local);
      while (functionReadingSessions.size > 16) functionReadingSessions.delete(functionReadingSessions.keys().next().value);
      const id = "function-reading-" + (++functionReadingSequence);
      const surface = document.createElement("div");
      const outline = document.createElement("aside");
      const header = document.createElement("header");
      const heading = document.createElement("h2");
      const description = document.createElement("p");
      const filters = document.createElement("div");
      const list = document.createElement("ol");
      const empty = document.createElement("p");
      const footer = document.createElement("div");
      const progress = document.createElement("span");
      const previous = document.createElement("button");
      const next = document.createElement("button");
      const toggle = document.createElement("button");
      const rowsById = new Map();
      const filterButtons = new Map();
      let selectedId = controller.getState().selectedBlockId;
      let filteredRows = model.rows;
      let disposed = false;
      let revealFrame;
      surface.className = "logic-reading-surface";
      outline.className = "logic-reading-outline";
      outline.id = id;
      outline.setAttribute("aria-labelledby", id + "-heading");
      header.className = "logic-reading-header";
      heading.id = id + "-heading";
      description.className = "logic-reading-description";
      filters.className = "logic-reading-filters";
      filters.setAttribute("role", "group");
      list.className = "logic-reading-list";
      empty.className = "logic-reading-empty";
      empty.setAttribute("role", "status");
      footer.className = "logic-reading-footer";
      progress.className = "logic-reading-progress";
      progress.setAttribute("role", "status");
      for (const button of [toggle, previous, next]) button.type = "button";
      toggle.className = "logic-reading-toggle";
      toggle.setAttribute("aria-controls", id);
      previous.className = "logic-reading-previous";
      next.className = "logic-reading-next";
      toggle.addEventListener("click", () => { local.open = !local.open; refreshDisclosure(); });
      previous.addEventListener("click", () => move(-1));
      next.addEventListener("click", () => move(1));
      for (const filter of ["all", "decisions", "calls", "exits"]) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "logic-reading-filter";
        button.dataset.readingFilter = filter;
        button.addEventListener("click", () => { local.filter = filter; refreshFilter(); });
        filterButtons.set(filter, button);
        filters.append(button);
      }
      for (const row of model.rows) {
        const item = document.createElement("li");
        const button = document.createElement("button");
        const ordinal = document.createElement("span");
        const content = document.createElement("span");
        const meta = document.createElement("span");
        const label = document.createElement("code");
        item.value = row.ordinal;
        button.type = "button";
        button.className = "logic-reading-step";
        button.dataset.blockId = row.block.id;
        button.style.setProperty("--reading-depth", String(Math.min(3, Math.max(0, row.block.depth || 0))));
        ordinal.className = "logic-reading-ordinal";
        ordinal.textContent = String(row.ordinal).padStart(2, "0");
        ordinal.setAttribute("aria-hidden", "true");
        content.className = "logic-reading-step-content";
        label.setAttribute("translate", "no");
        meta.className = "logic-reading-step-meta";
        content.append(meta, label);
        button.append(ordinal, content);
        button.addEventListener("click", () => activate(row.block.id));
        button.addEventListener("keydown", (event) => {
          const index = filteredRows.findIndex((candidate) => candidate.block.id === row.block.id);
          let target;
          if (event.key === "ArrowDown") target = filteredRows[Math.min(filteredRows.length - 1, index + 1)];
          else if (event.key === "ArrowUp") target = filteredRows[Math.max(0, index - 1)];
          else if (event.key === "Home") target = filteredRows[0];
          else if (event.key === "End") target = filteredRows[filteredRows.length - 1];
          if (!target) return;
          event.preventDefault();
          activate(target.block.id);
          rowsById.get(target.block.id)?.button.focus();
        });
        item.append(button);
        list.append(item);
        rowsById.set(row.block.id, { item, button, meta, label });
      }
      header.append(heading, description, filters);
      footer.append(progress, previous, next);
      outline.append(header, list, empty, footer);
      surface.append(outline, viewport);

      /** Explicit reading navigation selects evidence and reveals only the requested node. */
      function activate(blockId) {
        controller.activateBlock(blockId, false);
        inspector.openInspect("code");
        // Wait for the drawer's new grid width before measuring the visible graph.
        if (revealFrame !== undefined) cancelAnimationFrame(revealFrame);
        revealFrame = requestAnimationFrame(() => {
          if (!disposed) viewportController.revealBlocks([blockId], { announce: false });
        });
      }

      /** Previous/Next follow the filtered source list, including alternative branches. */
      function move(delta) {
        const index = filteredRows.findIndex((row) => row.block.id === selectedId);
        const target = filteredRows[index < 0 ? 0 : index + delta];
        if (target) activate(target.block.id);
      }

      function refreshDisclosure() {
        outline.hidden = !local.open;
        surface.classList.toggle("outline-closed", !local.open);
        toggle.setAttribute("aria-expanded", String(local.open));
        toggle.textContent = projectAnalyzerText("reading-outline");
        toggle.title = projectAnalyzerText(local.open ? "reading-hide" : "reading-show");
      }

      /** Updates retained rows so locale/filter changes never replace keyboard focus. */
      function refreshFilter() {
        filteredRows = model.rows.filter((row) => row.categories.includes(local.filter));
        const visible = new Set(filteredRows.map((row) => row.block.id));
        for (const [blockId, row] of rowsById) row.item.hidden = !visible.has(blockId);
        for (const [filter, button] of filterButtons) {
          button.setAttribute("aria-pressed", String(local.filter === filter));
          button.textContent = projectAnalyzerText("reading-filter-" + filter) + " " + model.counts[filter];
        }
        empty.hidden = filteredRows.length > 0;
        empty.textContent = projectAnalyzerText("reading-no-match");
        updateSelection(controller.getState(), false);
      }

      /** Synchronizes only list state; ordinary graph selection never changes the camera. */
      function updateSelection(readerState, scrollSelected = true) {
        const changed = selectedId !== readerState.selectedBlockId;
        selectedId = readerState.selectedBlockId;
        const index = filteredRows.findIndex((row) => row.block.id === selectedId);
        const tabbableId = index >= 0 ? selectedId : filteredRows[0]?.block.id;
        for (const [blockId, row] of rowsById) {
          row.button.setAttribute("aria-current", blockId === selectedId ? "step" : "false");
          row.button.tabIndex = blockId === tabbableId ? 0 : -1;
        }
        previous.disabled = index <= 0;
        next.disabled = filteredRows.length === 0 || index === filteredRows.length - 1;
        progress.textContent = projectAnalyzerText(index >= 0 ? "reading-position" : "reading-shown", { current: index + 1, count: filteredRows.length });
        if (model.omittedCount) progress.textContent += projectAnalyzerText("reading-omitted", { count: model.omittedCount });
        if (scrollSelected && changed && local.open && index >= 0) {
          const item = rowsById.get(selectedId).item;
          if (item.offsetTop < list.scrollTop) list.scrollTop = item.offsetTop;
          else if (item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight;
        }
      }

      function refreshLanguage() {
        heading.textContent = projectAnalyzerText("reading-title");
        description.textContent = projectAnalyzerText("reading-description");
        list.setAttribute("aria-label", projectAnalyzerText("reading-static-order"));
        filters.setAttribute("aria-label", projectAnalyzerText("reading-filter-label"));
        previous.textContent = projectAnalyzerText("reading-previous");
        next.textContent = projectAnalyzerText("reading-next");
        previous.title = projectAnalyzerText("reading-previous-title");
        next.title = projectAnalyzerText("reading-next-title");
        for (const row of model.rows) {
          const rendered = rowsById.get(row.block.id);
          const block = row.block;
          const label = ["entry", "exit"].includes(block.kind) ? formatLogicBlockLabel(block) : block.label;
          const location = block.sourceLocation?.match(/:(\\d+)$/)?.[1];
          const branch = block.branchPresentation?.key ? projectAnalyzerText(block.branchPresentation.key, block.branchPresentation.params) : block.branchLabel;
          rendered.label.textContent = label;
          rendered.meta.textContent = [formatLogicKind(block.kind), branch, location ? "L" + location : "", projectAnalyzerText("logic-confidence-" + (block.confidence || "unknown"))].filter(Boolean).join(" · ");
          if (block.functionLabel) rendered.meta.textContent = block.functionLabel + " · " + rendered.meta.textContent;
          rendered.button.title = [label, block.sourceLocation].filter(Boolean).join(" · ");
          rendered.button.setAttribute("aria-label", projectAnalyzerText("reading-step", { ordinal: row.ordinal, kind: formatLogicKind(block.kind), label }));
        }
        refreshDisclosure();
        refreshFilter();
      }
      const unsubscribe = controller.subscribe(updateSelection);
      refreshLanguage();
      return { element: surface, toggle, refreshLanguage, dispose() { disposed = true; unsubscribe(); if (revealFrame !== undefined) cancelAnimationFrame(revealFrame); } };
    }
  `;
}
