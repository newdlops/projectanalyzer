/**
 * Browser-only Scenario progression renderer. It combines selected-binding
 * accesses with safe, source-backed calculations produced by the adjacent
 * evaluator and keeps unsupported runtime behavior explicitly unknown.
 */

/** Returns CSP-safe helpers for the bounded calculated Scenario trace. */
export function getFunctionLogicScenarioTraceBrowserSource(): string {
  return /* js */ `
    const MAX_LOGIC_SCENARIO_TRACE_STEPS = 80;

    /** Builds one live calculated progression view beside the Scenario editor. */
    function createFunctionLogicScenarioTrace(
      logic,
      nodeButtonsById,
      controlEdgeElementsById
    ) {
      const section = document.createElement("section");
      const header = document.createElement("div");
      const title = document.createElement("strong");
      const hint = document.createElement("span");
      const selection = document.createElement("div");
      const rows = document.createElement("div");
      const omitted = document.createElement("p");
      let selectedBindingId = "";

      section.className = "logic-scenario-trace";
      section.setAttribute("aria-label", "Calculated Scenario value progression");
      header.className = "logic-scenario-trace-header";
      title.textContent = "Scenario calculation";
      hint.textContent = "Parses JSON/scalar inputs and safely calculates source-backed assignments, "
        + "boolean expressions, and nested ternaries. Calls and dynamic runtime behavior stay unknown.";
      selection.className = "logic-scenario-trace-selection";
      rows.className = "logic-scenario-trace-rows";
      rows.setAttribute("aria-live", "polite");
      omitted.className = "logic-scenario-trace-omitted";
      omitted.hidden = true;
      header.append(title, hint);
      section.append(header, selection, rows, omitted);

      /** Recalculates the selected branch after input, selection, or choice changes. */
      function refresh() {
        const binding = (logic.valueBindings || []).find((candidate) =>
          candidate.id === selectedBindingId
        );
        rows.replaceChildren();
        omitted.hidden = true;
        omitted.textContent = "";
        if (!binding) {
          selection.textContent = "Choose a variable above to calculate its value flow.";
          return;
        }
        const calculation = calculateFunctionLogicScenario(
          logic,
          nodeButtonsById,
          controlEdgeElementsById
        );
        const orderedRecords = collectFunctionLogicScenarioBlockRecords(logic, calculation);
        const allSteps = collectFunctionLogicScenarioSteps(
          binding,
          orderedRecords
        );
        const visibleSteps = allSteps.slice(0, MAX_LOGIC_SCENARIO_TRACE_STEPS);
        const rawInput = readFunctionLogicValuePreview(binding.id);
        const inputState = calculation.inputStateByBindingId.get(binding.id);
        const latestState = readLatestFunctionLogicScenarioBindingState(
          binding.id,
          orderedRecords,
          inputState
        );
        const inputText = rawInput
          ? "input " + formatFunctionLogicScenarioState(inputState)
          : binding.kind === "parameter" ? "input <not set>" : "source-derived";
        selection.textContent = formatFunctionLogicBindingKind(binding.kind, binding.valueRole)
          + " " + binding.name + " · " + inputText
          + " · current " + formatFunctionLogicScenarioState(latestState)
          + " · " + allSteps.length + " step" + (allSteps.length === 1 ? "" : "s");
        for (let index = 0; index < visibleSteps.length; index += 1) {
          rows.append(createFunctionLogicScenarioStep(visibleSteps[index], index));
        }
        if (visibleSteps.length === 0) {
          const empty = document.createElement("p");
          empty.className = "logic-scenario-trace-empty";
          empty.textContent = "No reachable access or derived calculation is available on the selected branch.";
          rows.append(empty);
        }
        const omittedCount = Math.max(0, allSteps.length - visibleSteps.length);
        if (omittedCount > 0 || calculation.truncated) {
          omitted.hidden = false;
          omitted.textContent = (omittedCount > 0
            ? "+" + omittedCount + " calculation steps omitted. "
            : "")
            + (calculation.truncated
              ? "Cycle propagation stopped at the safety bound."
              : "");
        }
      }

      return {
        element: section,
        refresh,
        /** Shares the same binding lens as graph chips and Scenario labels. */
        setSelectedBinding(bindingId) {
          selectedBindingId = bindingId || "";
          refresh();
        }
      };
    }

    /** Collects final fixed-point block records in deterministic graph order. */
    function collectFunctionLogicScenarioBlockRecords(logic, calculation) {
      const layoutByBlockId = new Map(
        (logic.layout?.nodes || []).map((layout) => [layout.blockId, layout])
      );
      return logic.blocks.map((block, index) => ({
        block,
        index,
        layout: layoutByBlockId.get(block.id),
        record: calculation.recordsByBlockId.get(block.id)
      })).filter((entry) => Boolean(entry.record))
        .sort(compareFunctionLogicScenarioBlocks);
    }

    /** Combines direct accesses with transitively derived calculations. */
    function collectFunctionLogicScenarioSteps(binding, orderedRecords) {
      const steps = [];
      for (const entry of orderedRecords) {
        const accesses = (entry.block.valueAccesses || []).map((access, index) => ({
          access,
          index
        })).filter((candidate) => candidate.access.bindingId === binding.id)
          .sort(compareFunctionLogicScenarioAccesses)
          .map((candidate) => candidate.access);
        for (const access of accesses) {
          const before = entry.record.before.get(binding.id)
            || createFunctionLogicScenarioUnset("value is not available", [binding.id]);
          const after = entry.record.after.get(binding.id) || before;
          const state = access.access === "define" || access.access === "write" ? after : before;
          const value = access.access === "readwrite"
            ? formatFunctionLogicScenarioState(before) + " → "
              + formatFunctionLogicScenarioState(after)
            : formatFunctionLogicScenarioState(state);
          steps.push({
            type: "access",
            access,
            block: entry.block,
            value,
            stateKind: before.kind === "unknown" || after.kind === "unknown"
              ? "unknown" : state.kind,
            status: state.kind === "unknown" ? state.reason : ""
          });
        }
        for (const transition of entry.record.transitions) {
          if (transition.targetBindingId !== binding.id
            && !transition.dependencyBindingIds.includes(binding.id)) {
            continue;
          }
          const initialized = transition.before.kind === "unset"
            || transition.kind === "override";
          steps.push({
            type: "calculation",
            transition,
            block: entry.block,
            value: initialized
              ? formatFunctionLogicScenarioState(transition.after)
              : formatFunctionLogicScenarioState(transition.before) + " → "
                + formatFunctionLogicScenarioState(transition.after),
            stateKind: transition.after.kind,
            status: transition.after.kind === "unknown" ? transition.after.reason : ""
          });
        }
      }
      return steps;
    }

    /** Reads precede a pure write inside one collapsed block; other order stays stable. */
    function compareFunctionLogicScenarioAccesses(left, right) {
      const priority = (entry) => entry.access.access === "define"
        ? 0
        : entry.access.access === "write" ? 2 : 1;
      return priority(left) - priority(right) || left.index - right.index;
    }

    /** Stable rank/lane ordering mirrors the graph while the CFG owns values. */
    function compareFunctionLogicScenarioBlocks(left, right) {
      const leftLayout = left.layout || {};
      const rightLayout = right.layout || {};
      return (Number(leftLayout.rank) || 0) - (Number(rightLayout.rank) || 0)
        || (Number(leftLayout.y) || 0) - (Number(rightLayout.y) || 0)
        || (Number(leftLayout.lane) || 0) - (Number(rightLayout.lane) || 0)
        || (Number(leftLayout.x) || 0) - (Number(rightLayout.x) || 0)
        || left.index - right.index;
    }

    /** Finds the latest reachable state for the selected binding. */
    function readLatestFunctionLogicScenarioBindingState(
      bindingId,
      orderedRecords,
      fallback
    ) {
      let state = fallback || createFunctionLogicScenarioUnset("value is not available", [bindingId]);
      for (const entry of orderedRecords) {
        state = entry.record.after.get(bindingId) || state;
      }
      return state;
    }

    /** Creates one calculated or consume/sink progression row. */
    function createFunctionLogicScenarioStep(step, index) {
      const row = document.createElement("div");
      const sequence = document.createElement("span");
      const role = document.createElement("strong");
      const source = document.createElement("span");
      const valueLabel = document.createElement("span");
      const value = document.createElement("code");
      const status = document.createElement("span");
      const semanticClass = step.type === "calculation"
        ? (step.transition.kind === "override" ? "override" : "calculation")
        : (step.access.usage || step.access.access);
      const roleText = step.type === "calculation"
        ? formatFunctionLogicScenarioCalculationRole(step.transition)
        : formatFunctionLogicScenarioRole(step.access);
      const sourceText = step.type === "calculation"
        ? formatFunctionLogicScenarioCalculation(step.transition)
        : step.block.label;

      row.className = "logic-scenario-step " + semanticClass
        + (step.stateKind === "unknown" || step.stateKind === "unset" ? " unknown" : "");
      row.setAttribute("aria-label", (index + 1) + ". " + roleText + " at "
        + sourceText + ". Value " + step.value
        + (step.status ? ". " + step.status : ""));
      sequence.className = "logic-scenario-step-sequence";
      sequence.textContent = String(index + 1);
      role.className = "logic-scenario-step-role";
      role.textContent = roleText;
      role.title = step.type === "calculation"
        ? "Safe source-backed Scenario calculation"
        : step.access.usage === "sink"
          ? "Value leaves the tracked lexical flow here"
          : step.access.usage === "consume"
            ? "Value participates in an internal computation here"
            : "Binding state changes here";
      source.className = "logic-scenario-step-source";
      source.textContent = sourceText;
      valueLabel.className = "logic-scenario-step-value-label";
      valueLabel.textContent = step.type === "calculation" ? "Result" : "Value";
      value.className = "logic-scenario-step-value";
      value.textContent = step.value;
      status.className = "logic-scenario-step-status";
      status.textContent = step.status || "";
      status.hidden = !status.textContent;
      row.append(sequence, role, source, valueLabel, value, status);
      return row;
    }

    /** Formats an assignment without hiding the evaluated right-hand side. */
    function formatFunctionLogicScenarioCalculation(transition) {
      const expression = transition.expression ? " " + transition.expression : "";
      return transition.targetName + " " + transition.operator + expression;
    }

    /** Separates user overrides, successful calculations, and unknown results. */
    function formatFunctionLogicScenarioCalculationRole(transition) {
      if (transition.kind === "override") return "INPUT OVERRIDE";
      if (transition.after.kind === "unknown") return "UNKNOWN";
      return transition.before.kind === "unset" ? "CALCULATED" : "UPDATED";
    }

    /** Produces explicit progression roles while preserving read/write detail. */
    function formatFunctionLogicScenarioRole(access) {
      if (access.access === "define") return "DEFINED";
      if (access.access === "write") return "UPDATED";
      if (access.usage === "sink") {
        return access.access === "readwrite" ? "SINK · UPDATE" : "SINK";
      }
      if (access.usage === "consume") {
        return access.access === "readwrite" ? "CONSUME · UPDATE" : "CONSUME";
      }
      return formatFunctionLogicValueAccess(access.access);
    }
  `;
}
