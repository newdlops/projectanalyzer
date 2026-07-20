/**
 * Browser-only Function Logic value-preview annotations. The editor accepts
 * debugger-like scenario inputs that feed the separate safe evaluator without
 * mutating source, persisting values, or executing calls.
 */

/** Returns CSP-safe helpers for session-scoped value preview annotations. */
export function getFunctionLogicValuePreviewBrowserSource(): string {
  return /* js */ `
    const MAX_LOGIC_VALUE_PREVIEW_LENGTH = 240;
    const MAX_LOGIC_VALUE_PREVIEW_ROWS = 120;
    let functionLogicValuePreviewSessionKey = "";
    const functionLogicValuePreviewByBindingId = new Map();
    const functionLogicValuePreviewElementsByBindingId = new Map();

    /** Resets annotations only when the root function-graph session changes. */
    function readFunctionLogicValuePreviewSession(sessionKey) {
      if (functionLogicValuePreviewSessionKey === sessionKey) return;
      functionLogicValuePreviewSessionKey = sessionKey;
      functionLogicValuePreviewByBindingId.clear();
      functionLogicValuePreviewElementsByBindingId.clear();
    }

    /** Builds a bounded Name/Scenario input table similar to Debug Variables. */
    function createFunctionLogicValuePreviewEditor(
      bindings,
      blocks,
      sessionKey,
      onBindingSelect,
      onValueChanged
    ) {
      readFunctionLogicValuePreviewSession(sessionKey);
      const section = document.createElement("section");
      const header = document.createElement("div");
      const heading = document.createElement("div");
      const title = document.createElement("strong");
      const hint = document.createElement("span");
      const clearAll = document.createElement("button");
      const columns = document.createElement("div");
      const nameColumn = document.createElement("span");
      const valueColumn = document.createElement("span");
      const rows = document.createElement("div");
      const inputs = [];
      const blockById = new Map(blocks.map((block) => [block.id, block]));
      const labelRecordsByBindingId = new Map();

      section.className = "logic-value-preview-editor";
      section.setAttribute("aria-label", "Scenario value previews");
      header.className = "logic-value-preview-header";
      heading.className = "logic-value-preview-heading";
      title.textContent = "Scenario values";
      hint.textContent = "Enter JSON or a scalar value, then click a name to follow its calculated "
        + "definition → consume → sink flow. Source calls are never executed.";
      clearAll.type = "button";
      clearAll.className = "logic-value-preview-clear-all";
      clearAll.textContent = "Clear all";
      clearAll.title = "Clear all Scenario inputs";
      columns.className = "logic-value-preview-columns";
      nameColumn.textContent = "Name";
      valueColumn.textContent = "Scenario input";
      rows.className = "logic-value-preview-rows";

      for (const binding of bindings.slice(0, MAX_LOGIC_VALUE_PREVIEW_ROWS)) {
        const row = document.createElement("div");
        const identity = document.createElement("button");
        const kind = document.createElement("span");
        const name = document.createElement("code");
        const definition = blockById.get(binding.definitionBlockId);
        const scope = document.createElement("span");
        const editor = document.createElement("div");
        const input = document.createElement("input");
        const clear = document.createElement("button");
        const bindingRole = binding.valueRole || binding.kind;
        const inputLabel = "Scenario input for " + bindingRole + " " + binding.name;

        row.className = "logic-value-preview-row"
          + (binding.confidence === "inferred" ? " inferred" : "");
        identity.className = "logic-value-preview-identity";
        identity.type = "button";
        identity.title = "Highlight " + bindingRole + " " + binding.name + " value flow";
        identity.setAttribute("aria-label", identity.title);
        identity.setAttribute("aria-pressed", "false");
        kind.className = "logic-value-preview-kind " + binding.kind
          + (binding.valueRole ? " " + binding.valueRole : "");
        kind.textContent = formatFunctionLogicBindingKind(binding.kind, binding.valueRole);
        name.textContent = binding.name;
        scope.className = "logic-value-preview-scope";
        scope.textContent = definition?.functionLabel || "";
        scope.hidden = !scope.textContent;
        editor.className = "logic-value-preview-input-cell";
        input.type = "text";
        input.className = "logic-value-preview-input";
        input.value = functionLogicValuePreviewByBindingId.get(binding.id) || "";
        input.maxLength = MAX_LOGIC_VALUE_PREVIEW_LENGTH;
        input.placeholder = "JSON / scalar";
        input.spellcheck = false;
        input.title = inputLabel;
        input.setAttribute("aria-label", inputLabel);
        clear.type = "button";
        clear.className = "logic-value-preview-clear";
        clear.textContent = "×";
        clear.title = "Clear scenario input for " + binding.name;
        clear.setAttribute("aria-label", clear.title);

        input.addEventListener("input", () => {
          writeFunctionLogicValuePreview(binding.id, input.value);
          if (onValueChanged) onValueChanged(binding.id);
        });
        identity.addEventListener("click", () => onBindingSelect(binding.id));
        clear.addEventListener("click", () => {
          input.value = "";
          writeFunctionLogicValuePreview(binding.id, "");
          if (onValueChanged) onValueChanged(binding.id);
          input.focus();
        });
        identity.append(kind, name, scope);
        editor.append(input, clear);
        row.append(identity, editor);
        rows.append(row);
        inputs.push(input);
        labelRecordsByBindingId.set(binding.id, { row, identity });
      }

      if (bindings.length > MAX_LOGIC_VALUE_PREVIEW_ROWS) {
        const omitted = document.createElement("p");
        omitted.className = "logic-value-preview-omitted";
        omitted.textContent = "+" + (bindings.length - MAX_LOGIC_VALUE_PREVIEW_ROWS)
          + " bindings omitted from the editor";
        rows.append(omitted);
      }

      clearAll.addEventListener("click", () => {
        functionLogicValuePreviewByBindingId.clear();
        for (const bindingId of functionLogicValuePreviewElementsByBindingId.keys()) {
          refreshFunctionLogicValuePreviewElements(bindingId);
        }
        for (const input of inputs) input.value = "";
        if (onValueChanged) onValueChanged("");
      });
      heading.append(title, hint);
      header.append(heading, clearAll);
      columns.append(nameColumn, valueColumn);
      section.append(header, columns, rows);
      return {
        element: section,
        /** Keeps the scenario label synchronized with the shared value-flow lens. */
        setSelectedBinding(bindingId) {
          for (const [candidateId, record] of labelRecordsByBindingId) {
            const selected = candidateId === bindingId;
            record.row.classList.toggle("selected", selected);
            record.identity.classList.toggle("selected", selected);
            record.identity.setAttribute("aria-pressed", selected ? "true" : "false");
          }
        }
      };
    }

    /** Stores bounded input text for local parsing without sending it to the Host. */
    function writeFunctionLogicValuePreview(bindingId, nextValue) {
      const value = String(nextValue || "").slice(0, MAX_LOGIC_VALUE_PREVIEW_LENGTH);
      if (value) functionLogicValuePreviewByBindingId.set(bindingId, value);
      else functionLogicValuePreviewByBindingId.delete(bindingId);
      refreshFunctionLogicValuePreviewElements(bindingId);
    }

    /** Reads one session-scoped scenario input for the safe evaluator. */
    function readFunctionLogicValuePreview(bindingId) {
      return functionLogicValuePreviewByBindingId.get(bindingId) || "";
    }

    /** Creates one live graph/detail suffix for a binding preview. */
    function createFunctionLogicValuePreviewLabel(bindingId) {
      const label = document.createElement("span");
      const labels = functionLogicValuePreviewElementsByBindingId.get(bindingId) || new Set();
      const value = functionLogicValuePreviewByBindingId.get(bindingId) || "";
      label.className = "logic-value-access-preview";
      label.textContent = value ? "= " + value : "";
      label.hidden = !value;
      labels.add(label);
      functionLogicValuePreviewElementsByBindingId.set(bindingId, labels);
      return label;
    }

    /** Synchronizes attached labels and prunes detached real-DOM elements. */
    function refreshFunctionLogicValuePreviewElements(bindingId) {
      const value = functionLogicValuePreviewByBindingId.get(bindingId) || "";
      const labels = functionLogicValuePreviewElementsByBindingId.get(bindingId);
      if (!labels) return;
      for (const label of labels) {
        if ("isConnected" in label && !label.isConnected) {
          labels.delete(label);
          continue;
        }
        label.textContent = value ? "= " + value : "";
        label.hidden = !value;
      }
      if (labels.size === 0) functionLogicValuePreviewElementsByBindingId.delete(bindingId);
    }
  `;
}
