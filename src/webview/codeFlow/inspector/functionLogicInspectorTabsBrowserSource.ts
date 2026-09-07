/** Keyboard-accessible Inspector tabs that retain mounted input and reading state. */
export function getFunctionLogicInspectorTabsBrowserSource(): string {
  return /* js */ `
    /** Builds stable panels; changing tabs never rebuilds inputs or evaluates a scenario. */
    function createFunctionLogicInspectorTabs(id, state, beforeChange, onChange) {
      const keys = ["code", "values", "info"];
      const bar = document.createElement("div");
      const panels = new Map();
      const buttons = new Map();
      bar.className = "logic-inspector-tabs";
      bar.setAttribute("role", "tablist");
      for (const key of keys) {
        const button = document.createElement("button");
        const panel = document.createElement("div");
        button.type = "button";
        button.className = "logic-inspector-tab";
        button.id = id + "-tab-" + key;
        button.setAttribute("role", "tab");
        button.setAttribute("aria-controls", id + "-panel-" + key);
        button.dataset.inspectorTab = key;
        panel.id = id + "-panel-" + key;
        panel.className = "logic-inspector-tab-panel";
        panel.setAttribute("role", "tabpanel");
        panel.setAttribute("aria-labelledby", button.id);
        button.addEventListener("click", () => select(key, false));
        button.addEventListener("keydown", (event) => {
          const index = keys.indexOf(key);
          let next;
          if (event.key === "ArrowRight") next = keys[(index + 1) % keys.length];
          else if (event.key === "ArrowLeft") next = keys[(index + keys.length - 1) % keys.length];
          else if (event.key === "Home") next = keys[0];
          else if (event.key === "End") next = keys[keys.length - 1];
          else return;
          event.preventDefault();
          select(next, true);
        });
        buttons.set(key, button);
        panels.set(key, panel);
        bar.append(button);
      }
      function render() {
        for (const key of keys) {
          const active = state.tab === key;
          buttons.get(key).setAttribute("aria-selected", String(active));
          buttons.get(key).tabIndex = active ? 0 : -1;
          panels.get(key).hidden = !active;
        }
      }
      function select(key, focus) {
        if (!keys.includes(key)) return;
        const previous = state.tab;
        // Save the old scroll before hidden panels can clamp the scroll container.
        if (previous !== key) beforeChange(previous, key);
        state.tab = key;
        render();
        if (previous !== key) onChange(previous, key);
        if (focus) buttons.get(key).focus();
      }
      function refreshLanguage() {
        bar.setAttribute("aria-label", projectAnalyzerText("reading-inspector-tabs"));
        for (const key of keys) buttons.get(key).textContent = projectAnalyzerText("reading-tab-" + key);
      }
      if (!keys.includes(state.tab)) state.tab = "code";
      render();
      refreshLanguage();
      return { bar, panels, select, refreshLanguage };
    }
  `;
}
