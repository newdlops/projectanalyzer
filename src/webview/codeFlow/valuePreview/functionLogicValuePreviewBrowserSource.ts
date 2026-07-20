/**
 * Browser-only Function Logic Scenario variable editor. Analyzer bindings and
 * user-added fallback variables share one Debug Variables-like surface and feed
 * the safe evaluator without Host messages, persistence, or source execution.
 */

/** Returns CSP-safe helpers for session-scoped Scenario variable inputs. */
export function getFunctionLogicValuePreviewBrowserSource(): string {
  return /* js */ `
    const MAX_LOGIC_VALUE_PREVIEW_LENGTH = 240;
    const MAX_LOGIC_VALUE_PREVIEW_ROWS = 120;
    const MAX_LOGIC_MANUAL_SCENARIO_ROWS = 32;
    const MAX_LOGIC_MANUAL_SCENARIO_NAME_LENGTH = 80;
    const FUNCTION_LOGIC_MANUAL_SCENARIO_PREFIX = "scenario-manual:";
    let functionLogicValuePreviewSessionKey = "";
    const functionLogicValuePreviewByBindingId = new Map();
    const functionLogicManualScenarioValueByName = new Map();
    const functionLogicValuePreviewElementsByBindingId = new Map();

    /** Resets every editable value only when the root graph session changes. */
    function readFunctionLogicValuePreviewSession(sessionKey) {
      if (functionLogicValuePreviewSessionKey === sessionKey) return;
      functionLogicValuePreviewSessionKey = sessionKey;
      functionLogicValuePreviewByBindingId.clear();
      functionLogicManualScenarioValueByName.clear();
      functionLogicValuePreviewElementsByBindingId.clear();
    }

    /**
     * Prepares one session and promotes a manual name when a later relayout
     * introduces exactly one analyzer-backed binding with the same name.
     */
    function prepareFunctionLogicValuePreviewSession(sessionKey, bindings) {
      readFunctionLogicValuePreviewSession(sessionKey);
      const bindingsByName = new Map();
      for (const binding of bindings || []) {
        const values = bindingsByName.get(binding.name) || [];
        values.push(binding);
        bindingsByName.set(binding.name, values);
      }
      for (const [name, rawValue] of functionLogicManualScenarioValueByName) {
        const matches = bindingsByName.get(name) || [];
        if (matches.length !== 1) continue;
        if (rawValue && !functionLogicValuePreviewByBindingId.has(matches[0].id)) {
          functionLogicValuePreviewByBindingId.set(matches[0].id, rawValue);
        }
        functionLogicManualScenarioValueByName.delete(name);
      }
    }

    /** Returns analyzer bindings plus bounded user-added fallback identities. */
    function readFunctionLogicScenarioEditableBindings(bindings) {
      const result = [...(bindings || [])];
      const trackedNames = new Set(result.map((binding) => binding.name));
      for (const name of functionLogicManualScenarioValueByName.keys()) {
        if (trackedNames.has(name)) continue;
        result.push({
          id: createFunctionLogicManualScenarioBindingId(name),
          name,
          kind: "manual",
          definitionBlockId: "",
          confidence: "inferred",
          manual: true
        });
      }
      return result;
    }

    /** Builds a collision-safe browser-local identity for one manual variable. */
    function createFunctionLogicManualScenarioBindingId(name) {
      return FUNCTION_LOGIC_MANUAL_SCENARIO_PREFIX + name;
    }

    /** Reads the validated name encoded by one browser-local manual identity. */
    function readFunctionLogicManualScenarioBindingName(bindingId) {
      return String(bindingId || "").startsWith(FUNCTION_LOGIC_MANUAL_SCENARIO_PREFIX)
        ? String(bindingId).slice(FUNCTION_LOGIC_MANUAL_SCENARIO_PREFIX.length)
        : "";
    }

    /** Accepts one lexical base name without interpreting member/call syntax. */
    function normalizeFunctionLogicManualScenarioName(rawName) {
      const name = String(rawName || "").trim().slice(
        0,
        MAX_LOGIC_MANUAL_SCENARIO_NAME_LENGTH
      );
      return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(name) ? name : "";
    }

    /** Builds the always-visible Name/Value table used by the Inspector. */
    function createFunctionLogicValuePreviewEditor(
      bindings,
      blocks,
      sessionKey,
      onBindingSelect,
      onValueChanged
    ) {
      prepareFunctionLogicValuePreviewSession(sessionKey, bindings);
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
      const trackedRows = document.createElement("div");
      const manualRows = document.createElement("div");
      const addPanel = document.createElement("div");
      const addName = document.createElement("input");
      const addValue = document.createElement("input");
      const add = document.createElement("button");
      const addStatus = document.createElement("span");
      const blockById = new Map(blocks.map((block) => [block.id, block]));
      const labelRecordsByBindingId = new Map();
      const inputsByBindingId = new Map();
      let selectedBindingId = "";

      section.className = "logic-value-preview-editor";
      section.setAttribute("aria-label", "Editable Scenario variables");
      header.className = "logic-value-preview-header";
      heading.className = "logic-value-preview-heading";
      title.textContent = "Scenario values";
      hint.textContent = "Edit tracked values like Debug Variables. If analysis missed a name, "
        + "add it below; JSON/scalars feed safe calculation. Source calls are never executed.";
      clearAll.type = "button";
      clearAll.className = "logic-value-preview-clear-all";
      clearAll.textContent = "Clear values";
      clearAll.title = "Clear all Scenario input values";
      columns.className = "logic-value-preview-columns";
      nameColumn.textContent = "Name";
      valueColumn.textContent = "Scenario input";
      rows.className = "logic-value-preview-rows";
      trackedRows.className = "logic-value-preview-tracked-rows";
      manualRows.className = "logic-value-preview-manual-rows";
      addPanel.className = "logic-value-preview-add";
      addName.type = "text";
      addName.className = "logic-value-preview-input logic-value-preview-variable-name";
      addName.maxLength = MAX_LOGIC_MANUAL_SCENARIO_NAME_LENGTH;
      addName.placeholder = "variable name";
      addName.spellcheck = false;
      addName.title = "Scenario variable name";
      addName.setAttribute("aria-label", addName.title);
      addValue.type = "text";
      addValue.className = "logic-value-preview-input logic-value-preview-variable-value";
      addValue.maxLength = MAX_LOGIC_VALUE_PREVIEW_LENGTH;
      addValue.placeholder = "JSON / scalar value";
      addValue.spellcheck = false;
      addValue.title = "Initial Scenario value";
      addValue.setAttribute("aria-label", addValue.title);
      add.type = "button";
      add.className = "logic-value-preview-add-button";
      add.textContent = "Add variable";
      add.title = "Add Scenario variable";
      addStatus.className = "logic-value-preview-add-status";
      addStatus.setAttribute("aria-live", "polite");

      /** Creates one tracked or manual editable row with a shared selection lens. */
      function appendValueRow(parent, binding, rawValue, options) {
        const row = document.createElement("div");
        const identity = document.createElement("button");
        const kind = document.createElement("span");
        const name = document.createElement("code");
        const definition = blockById.get(binding.definitionBlockId);
        const scope = document.createElement("span");
        const editor = document.createElement("div");
        const input = document.createElement("input");
        const action = document.createElement("button");
        const bindingRole = binding.manual ? "custom" : (binding.valueRole || binding.kind);
        const inputLabel = "Scenario input for " + bindingRole + " " + binding.name;

        row.className = "logic-value-preview-row"
          + (binding.confidence === "inferred" ? " inferred" : "")
          + (binding.manual ? " manual" : "");
        identity.className = "logic-value-preview-identity";
        identity.type = "button";
        identity.title = "Highlight " + bindingRole + " " + binding.name
          + (binding.manual ? " calculation" : " value flow");
        identity.setAttribute("aria-label", identity.title);
        identity.setAttribute("aria-pressed", "false");
        kind.className = "logic-value-preview-kind " + binding.kind
          + (binding.valueRole ? " " + binding.valueRole : "");
        kind.textContent = formatFunctionLogicBindingKind(binding.kind, binding.valueRole);
        name.textContent = binding.name;
        scope.className = "logic-value-preview-scope";
        scope.textContent = definition?.functionLabel || (binding.manual ? "user-added" : "");
        scope.hidden = !scope.textContent;
        editor.className = "logic-value-preview-input-cell";
        input.type = "text";
        input.className = "logic-value-preview-input";
        input.value = rawValue || "";
        input.maxLength = MAX_LOGIC_VALUE_PREVIEW_LENGTH;
        input.placeholder = "JSON / scalar";
        input.spellcheck = false;
        input.title = inputLabel;
        input.setAttribute("aria-label", inputLabel);
        action.type = "button";
        action.className = "logic-value-preview-clear";
        action.textContent = "×";
        action.title = options.actionTitle;
        action.setAttribute("aria-label", action.title);

        input.addEventListener("input", () => options.write(input.value));
        identity.addEventListener("click", () => onBindingSelect(binding.id));
        action.addEventListener("click", () => options.act(input));
        identity.append(kind, name, scope);
        editor.append(input, action);
        row.append(identity, editor);
        parent.append(row);
        inputsByBindingId.set(binding.id, input);
        labelRecordsByBindingId.set(binding.id, { row, identity });
      }

      for (const binding of bindings.slice(0, MAX_LOGIC_VALUE_PREVIEW_ROWS)) {
        appendValueRow(
          trackedRows,
          binding,
          functionLogicValuePreviewByBindingId.get(binding.id) || "",
          {
            actionTitle: "Clear scenario input for " + binding.name,
            write(value) {
              writeFunctionLogicValuePreview(binding.id, value);
              if (onValueChanged) onValueChanged(binding.id);
            },
            act(input) {
              input.value = "";
              writeFunctionLogicValuePreview(binding.id, "");
              if (onValueChanged) onValueChanged(binding.id);
              input.focus();
            }
          }
        );
      }

      /** Rebuilds only user-added rows after an add/remove operation. */
      function renderManualRows() {
        manualRows.replaceChildren();
        for (const bindingId of [...labelRecordsByBindingId.keys()]) {
          if (!readFunctionLogicManualScenarioBindingName(bindingId)) continue;
          labelRecordsByBindingId.delete(bindingId);
          inputsByBindingId.delete(bindingId);
        }
        const manualBindings = readFunctionLogicScenarioEditableBindings(bindings)
          .filter((binding) => binding.manual);
        for (const binding of manualBindings) {
          appendValueRow(
            manualRows,
            binding,
            functionLogicManualScenarioValueByName.get(binding.name) || "",
            {
              actionTitle: "Remove Scenario variable " + binding.name,
              write(value) {
                functionLogicManualScenarioValueByName.set(
                  binding.name,
                  String(value || "").slice(0, MAX_LOGIC_VALUE_PREVIEW_LENGTH)
                );
                if (onValueChanged) onValueChanged(binding.id);
              },
              act() {
                functionLogicManualScenarioValueByName.delete(binding.name);
                const removedSelection = selectedBindingId === binding.id;
                renderManualRows();
                if (removedSelection) onBindingSelect(bindings[0]?.id || "");
                if (onValueChanged) onValueChanged(binding.id);
                addName.focus();
              }
            }
          );
        }
        if (bindings.length === 0 && manualBindings.length === 0) {
          const empty = document.createElement("p");
          empty.className = "logic-value-preview-empty";
          empty.textContent = "No tracked bindings were reported. Add a variable name below; "
            + "the Inspector will keep this editor available.";
          manualRows.append(empty);
        }
        applySelectedBinding();
      }

      /** Adds one fallback input or redirects a matching tracked binding. */
      function addManualVariable() {
        const name = normalizeFunctionLogicManualScenarioName(addName.value);
        addStatus.classList.remove("error");
        if (!name) {
          addStatus.textContent = "Use a variable name such as count, ready, or $item.";
          addStatus.classList.add("error");
          return;
        }
        const trackedMatches = bindings.filter((binding) => binding.name === name);
        if (trackedMatches.length === 1) {
          const binding = trackedMatches[0];
          const value = String(addValue.value || "").slice(0, MAX_LOGIC_VALUE_PREVIEW_LENGTH);
          const input = inputsByBindingId.get(binding.id);
          if (input) input.value = value;
          writeFunctionLogicValuePreview(binding.id, value);
          addStatus.textContent = name + " is already tracked; its value was updated above.";
          onBindingSelect(binding.id);
          if (onValueChanged) onValueChanged(binding.id);
        } else if (trackedMatches.length > 1) {
          addStatus.textContent = name + " exists in multiple scopes; edit a tracked row above.";
          addStatus.classList.add("error");
          return;
        } else if (!functionLogicManualScenarioValueByName.has(name)
          && functionLogicManualScenarioValueByName.size >= MAX_LOGIC_MANUAL_SCENARIO_ROWS) {
          addStatus.textContent = "At most " + MAX_LOGIC_MANUAL_SCENARIO_ROWS
            + " user-added variables are kept per graph.";
          addStatus.classList.add("error");
          return;
        } else {
          const value = String(addValue.value || "").slice(0, MAX_LOGIC_VALUE_PREVIEW_LENGTH);
          functionLogicManualScenarioValueByName.set(name, value);
          const bindingId = createFunctionLogicManualScenarioBindingId(name);
          renderManualRows();
          addStatus.textContent = "Added " + name + ".";
          onBindingSelect(bindingId);
          if (onValueChanged) onValueChanged(bindingId);
        }
        addName.value = "";
        addValue.value = "";
      }

      add.addEventListener("click", addManualVariable);
      addName.addEventListener("input", () => {
        addStatus.textContent = "";
        addStatus.classList.remove("error");
      });
      addValue.addEventListener("input", () => {
        addStatus.textContent = "";
      });
      for (const input of [addName, addValue]) {
        input.addEventListener("keydown", (event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          addManualVariable();
        });
      }
      clearAll.addEventListener("click", () => {
        functionLogicValuePreviewByBindingId.clear();
        for (const name of functionLogicManualScenarioValueByName.keys()) {
          functionLogicManualScenarioValueByName.set(name, "");
        }
        for (const bindingId of functionLogicValuePreviewElementsByBindingId.keys()) {
          refreshFunctionLogicValuePreviewElements(bindingId);
        }
        for (const input of inputsByBindingId.values()) input.value = "";
        if (onValueChanged) onValueChanged("");
      });

      /** Synchronizes every row with the shared graph/scenario selection. */
      function applySelectedBinding() {
        for (const [candidateId, record] of labelRecordsByBindingId) {
          const selected = candidateId === selectedBindingId;
          record.row.classList.toggle("selected", selected);
          record.identity.classList.toggle("selected", selected);
          record.identity.setAttribute("aria-pressed", selected ? "true" : "false");
        }
      }

      if (bindings.length > MAX_LOGIC_VALUE_PREVIEW_ROWS) {
        const omitted = document.createElement("p");
        omitted.className = "logic-value-preview-omitted";
        omitted.textContent = "+" + (bindings.length - MAX_LOGIC_VALUE_PREVIEW_ROWS)
          + " tracked bindings omitted from the editor";
        trackedRows.append(omitted);
      }
      heading.append(title, hint);
      header.append(heading, clearAll);
      columns.append(nameColumn, valueColumn);
      addPanel.append(addName, addValue, add, addStatus);
      rows.append(trackedRows, manualRows);
      section.append(header, columns, rows, addPanel);
      renderManualRows();
      return {
        element: section,
        /** Keeps the Scenario row synchronized with the shared value-flow lens. */
        setSelectedBinding(bindingId) {
          selectedBindingId = bindingId || "";
          applySelectedBinding();
        }
      };
    }

    /** Stores one bounded analyzer-backed input without sending it to the Host. */
    function writeFunctionLogicValuePreview(bindingId, nextValue) {
      const manualName = readFunctionLogicManualScenarioBindingName(bindingId);
      const value = String(nextValue || "").slice(0, MAX_LOGIC_VALUE_PREVIEW_LENGTH);
      if (manualName) {
        functionLogicManualScenarioValueByName.set(manualName, value);
      } else if (value) {
        functionLogicValuePreviewByBindingId.set(bindingId, value);
      } else {
        functionLogicValuePreviewByBindingId.delete(bindingId);
      }
      refreshFunctionLogicValuePreviewElements(bindingId);
    }

    /** Reads a tracked or manual session input for the safe evaluator. */
    function readFunctionLogicValuePreview(bindingId) {
      const manualName = readFunctionLogicManualScenarioBindingName(bindingId);
      return manualName
        ? (functionLogicManualScenarioValueByName.get(manualName) || "")
        : (functionLogicValuePreviewByBindingId.get(bindingId) || "");
    }

    /** Creates one live graph/detail suffix for a tracked binding preview. */
    function createFunctionLogicValuePreviewLabel(bindingId) {
      const label = document.createElement("span");
      const labels = functionLogicValuePreviewElementsByBindingId.get(bindingId) || new Set();
      const value = readFunctionLogicValuePreview(bindingId);
      label.className = "logic-value-access-preview";
      label.textContent = value ? "= " + value : "";
      label.hidden = !value;
      labels.add(label);
      functionLogicValuePreviewElementsByBindingId.set(bindingId, labels);
      return label;
    }

    /** Synchronizes attached labels and prunes detached real-DOM elements. */
    function refreshFunctionLogicValuePreviewElements(bindingId) {
      const value = readFunctionLogicValuePreview(bindingId);
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
