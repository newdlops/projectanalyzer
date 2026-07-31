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
      section.setAttribute("aria-label", projectAnalyzerText("scenario-trace-region"));
      header.className = "logic-scenario-trace-header";
      title.textContent = projectAnalyzerText("scenario-calculation");
      hint.textContent = projectAnalyzerText("scenario-calculation-hint");
      selection.className = "logic-scenario-trace-selection";
      rows.className = "logic-scenario-trace-rows";
      rows.setAttribute("aria-live", "polite");
      omitted.className = "logic-scenario-trace-omitted";
      omitted.hidden = true;
      header.append(title, hint);
      section.append(header, selection, rows, omitted);

      /** Recalculates the selected branch after input, selection, or choice changes. */
      function refresh() {
        const binding = readFunctionLogicScenarioEditableBindings(
          logic.valueBindings || []
        ).find((candidate) =>
          candidate.id === selectedBindingId
        );
        rows.replaceChildren();
        omitted.hidden = true;
        omitted.textContent = "";
        if (!binding) {
          selection.textContent = projectAnalyzerText("choose-variable");
          return;
        }
        const progression = readFunctionLogicScenarioPlaybackFrames(
          logic, binding, nodeButtonsById, controlEdgeElementsById
        );
        const calculation = progression.calculation;
        const orderedRecords = progression.orderedRecords;
        const allSteps = progression.frames;
        const visibleSteps = allSteps.slice(0, MAX_LOGIC_SCENARIO_TRACE_STEPS);
        const rawInput = readFunctionLogicValuePreview(binding.id);
        const inputState = calculation.inputStateByBindingId.get(binding.id);
        const latestState = readLatestFunctionLogicScenarioBindingState(
          binding.id,
          orderedRecords,
          inputState
        );
        const inputText = rawInput
          ? projectAnalyzerText("scenario-trace-input", { value: formatFunctionLogicScenarioState(inputState) })
          : binding.kind === "parameter" || binding.manual
            ? projectAnalyzerText("scenario-trace-input-unset")
            : projectAnalyzerText("scenario-trace-source");
        selection.textContent = projectAnalyzerText("scenario-trace-selection", {
          kind: formatFunctionLogicBindingKind(binding.kind, binding.valueRole), name: binding.name, input: inputText,
          current: projectAnalyzerText("scenario-trace-current", { value: formatFunctionLogicScenarioState(latestState) }),
          steps: projectAnalyzerText("scenario-trace-steps", { count: allSteps.length, plural: allSteps.length === 1 ? "" : "s" })
        });
        for (let index = 0; index < visibleSteps.length; index += 1) {
          rows.append(createFunctionLogicScenarioStep(visibleSteps[index], index));
        }
        if (visibleSteps.length === 0) {
          const empty = document.createElement("p");
          empty.className = "logic-scenario-trace-empty";
          empty.textContent = projectAnalyzerText("no-reachable");
          rows.append(empty);
        }
        const omittedCount = Math.max(0, allSteps.length - visibleSteps.length);
        if (omittedCount > 0 || calculation.truncated) {
          omitted.hidden = false;
          omitted.textContent = (omittedCount > 0
            ? projectAnalyzerText("scenario-trace-omitted", { count: omittedCount })
            : "")
            + (calculation.truncated
              ? projectAnalyzerText("cycle-safety-bound")
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
        },
        /** Supplies the shared bounded frames to graph playback without DOM state changes. */
        readFrames(bindingId) {
          const binding = readFunctionLogicScenarioEditableBindings(logic.valueBindings || [])
            .find((candidate) => candidate.id === bindingId);
          return binding
            ? readFunctionLogicScenarioPlaybackFrames(
                logic, binding, nodeButtonsById, controlEdgeElementsById
              ).frames
            : [];
        }
      };
    }

    /**
     * Produces the one source-backed, bounded frame sequence shared by the
     * Scenario list and playback. No graph relation is created by this helper.
     */
    function readFunctionLogicScenarioPlaybackFrames(logic, binding, nodeButtonsById, edgeElementsById) {
      const calculation = calculateFunctionLogicScenario(logic, nodeButtonsById, edgeElementsById);
      const orderedRecords = collectFunctionLogicScenarioBlockRecords(logic, calculation);
      return {
        calculation,
        orderedRecords,
        frames: collectFunctionLogicScenarioPlaybackFrames(binding, orderedRecords, calculation)
          .slice(0, MAX_LOGIC_SCENARIO_TRACE_STEPS)
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

    /**
     * Combines explicit START state, calculated changes, and lexical use frames.
     * A source-backed transition owns its block so collapsed access annotations
     * cannot duplicate the same write/readwrite mutation in playback.
     */
    function collectFunctionLogicScenarioPlaybackFrames(binding, orderedRecords, calculation) {
      const steps = [];
      const inputState = calculation.inputStateByBindingId.get(binding.id)
        || createFunctionLogicScenarioUnset(createFunctionLogicScenarioReason("scenario-reason-value-unknown"), [binding.id]);
      const definitionRecord = orderedRecords.find((entry) => entry.block.id === binding.definitionBlockId);
      const definitionState = definitionRecord?.record.after.get(binding.id)
        || inputState;
      steps.push({
        type: "start",
        block: definitionRecord?.block,
        binding,
        value: formatFunctionLogicScenarioState(definitionState),
        // Playback carries this selected binding state, not a calculation's result text.
        carriedValue: formatFunctionLogicScenarioState(definitionState),
        stateKind: definitionState.kind,
        status: definitionState.kind === "unknown" || definitionState.kind === "unset"
          ? formatFunctionLogicScenarioReason(definitionState) : "",
        confidence: binding.confidence || "unknown"
      });
      for (const entry of orderedRecords) {
        const accesses = (entry.block.valueAccesses || []).map((access, index) => ({
          access,
          index
        })).filter((candidate) => candidate.access.bindingId === binding.id)
          .sort(compareFunctionLogicScenarioAccesses)
          .map((candidate) => candidate.access);
        const relevantTransitions = entry.record.transitions.filter((transition) =>
          transition.targetBindingId === binding.id
            || transition.dependencyBindingIds.includes(binding.id)
        );
        const hasSourceBackedTransition = relevantTransitions.length > 0;
        for (const access of accesses) {
          if (access.access === "define" && entry.block.id === binding.definitionBlockId) continue;
          if (hasSourceBackedTransition) continue;
          const before = entry.record.before.get(binding.id)
            || createFunctionLogicScenarioUnset(createFunctionLogicScenarioReason("scenario-reason-value-unknown"), [binding.id]);
          const after = entry.record.after.get(binding.id) || before;
          const state = access.access === "define" || access.access === "write" ? after : before;
          const unknownState = after.kind === "unknown" ? after
            : before.kind === "unknown" ? before : undefined;
          const value = access.access === "readwrite"
            ? formatFunctionLogicScenarioState(before) + " → "
              + formatFunctionLogicScenarioState(after)
            : formatFunctionLogicScenarioState(state);
          steps.push({
            type: access.access === "write" || access.access === "readwrite" ? "unknown" : "access",
            access,
            block: entry.block,
            value,
            carriedValue: formatFunctionLogicScenarioState(
              access.access === "define" || access.access === "write" ? after : before
            ),
            stateKind: unknownState ? "unknown" : state.kind,
            status: unknownState ? formatFunctionLogicScenarioReason(unknownState) : ""
          });
        }
        for (const transition of relevantTransitions) {
          const initialized = transition.before.kind === "unset"
            || transition.kind === "override";
          // The initial definition/override is represented by the single START
          // frame above; emitting it again would make it look like a mutation.
          if (transition.targetBindingId === binding.id && initialized) continue;
          steps.push({
            type: transition.targetBindingId === binding.id
              ? (transition.after.kind === "unknown" ? "unknown" : "change")
              : "consume",
            transition,
            block: entry.block,
            value: initialized
              ? formatFunctionLogicScenarioState(transition.after)
              : formatFunctionLogicScenarioState(transition.before) + " → "
                + formatFunctionLogicScenarioState(transition.after),
            carriedValue: formatFunctionLogicScenarioState(
              transition.targetBindingId === binding.id
                ? transition.after
                : (entry.record.before.get(binding.id) || inputState)
            ),
            stateKind: transition.after.kind,
            status: transition.after.kind === "unknown" ? formatFunctionLogicScenarioReason(transition.after) : "",
            confidence: transition.confidence || "unknown"
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
      let state = fallback || createFunctionLogicScenarioUnset(createFunctionLogicScenarioReason("scenario-reason-value-unknown"), [bindingId]);
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
      const isTransition = Boolean(step.transition);
      const semanticClass = step.type === "start"
        ? "override"
        : step.type === "change"
          ? "calculation"
          : step.type === "consume"
            ? "consume"
            : (step.access?.usage || step.access?.access || "unknown");
      const roleText = step.type === "start"
        ? projectAnalyzerText("scenario-start", { name: step.binding?.name || step.transition?.targetName || projectAnalyzerText("value") })
        : isTransition
          ? formatFunctionLogicScenarioCalculationRole(step.transition)
        : formatFunctionLogicScenarioRole(step.access);
      const sourceText = step.type === "start"
        ? (step.block ? formatLogicBlockLabel(step.block) : projectAnalyzerText("defined"))
        : isTransition
        ? formatFunctionLogicScenarioCalculation(step.transition)
        : formatLogicBlockLabel(step.block);

      row.className = "logic-scenario-step " + semanticClass
        + (step.stateKind === "unknown" || step.stateKind === "unset" ? " unknown" : "");
      row.setAttribute("aria-label", projectAnalyzerText("scenario-step-aria", { index: index + 1, role: roleText, source: sourceText, value: step.value, status: step.status ? ". " + step.status : "" }));
      sequence.className = "logic-scenario-step-sequence";
      sequence.textContent = String(index + 1);
      role.className = "logic-scenario-step-role";
      role.textContent = roleText;
      role.title = step.type === "start"
        ? projectAnalyzerText("scenario-initial-state")
        : isTransition
        ? projectAnalyzerText("scenario-safe-calculation")
        : step.access?.usage === "sink"
          ? projectAnalyzerText("scenario-sink")
          : step.access?.usage === "consume"
            ? projectAnalyzerText("scenario-consume")
            : projectAnalyzerText("scenario-change");
      source.className = "logic-scenario-step-source";
      source.textContent = sourceText;
      valueLabel.className = "logic-scenario-step-value-label";
      valueLabel.textContent = projectAnalyzerText(isTransition ? "result" : "value");
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
      if (transition.kind === "override") return projectAnalyzerText("input-override"); if (transition.after.kind === "unknown") return projectAnalyzerText("scenario-unknown"); return projectAnalyzerText(transition.before.kind === "unset" ? "calculated" : "updated");
    }

    /** Produces explicit progression roles while preserving read/write detail. */
    function formatFunctionLogicScenarioRole(access) {
      if (access.access === "define") return projectAnalyzerText("defined"); if (access.access === "write") return projectAnalyzerText("updated");
      if (access.usage === "sink") {
        return access.access === "readwrite" ? projectAnalyzerText("sink") + " · " + projectAnalyzerText("update") : projectAnalyzerText("sink");
      }
      if (access.usage === "consume") {
        return access.access === "readwrite" ? projectAnalyzerText("consume") + " · " + projectAnalyzerText("update") : projectAnalyzerText("consume");
      }
      return formatFunctionLogicValueAccess(access.access);
    }
  `;
}
