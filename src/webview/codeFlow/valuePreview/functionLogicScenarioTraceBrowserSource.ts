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
      controlEdgeElementsById,
      scenarioIdentity
    ) {
      const symbolicOnly = logic.tutor?.program?.evaluationMode === "symbolic-only";
      const section = document.createElement("section");
      const header = document.createElement("div");
      const title = document.createElement("h3");
      const hint = document.createElement("span");
      const selection = document.createElement("div");
      const rows = document.createElement("ol");
      const omitted = document.createElement("p");
      let selectedBindingId = "";
      const readProgression = createFunctionLogicScenarioProgressionReader(
        logic, nodeButtonsById, controlEdgeElementsById, scenarioIdentity
      );
      let renderedProgression;
      let renderedLanguage;

      section.className = "logic-scenario-trace";
      // Source-path playback remains in the Workspace; this view requires calculated binding values.
      section.hidden = symbolicOnly;
      section.setAttribute("aria-label", projectAnalyzerText("scenario-trace-region"));
      header.className = "logic-scenario-trace-header";
      title.textContent = projectAnalyzerText("scenario-calculation");
      hint.textContent = projectAnalyzerText("scenario-calculation-hint");
      selection.className = "logic-scenario-trace-selection";
      rows.className = "logic-scenario-trace-rows";
      rows.setAttribute("role", "list");
      rows.setAttribute("aria-live", "polite");
      omitted.className = "logic-scenario-trace-omitted";
      omitted.hidden = true;
      header.append(title, hint);
      section.append(header, selection, rows, omitted);

      /** Recalculates the selected branch after input, selection, or choice changes. */
      function refresh() {
        if (symbolicOnly) return;
        // Locale refresh retains the selected binding and rows; only owned
        // landmark/header copy is rewritten before the existing progression.
        section.setAttribute("aria-label", projectAnalyzerText("scenario-trace-region"));
        title.textContent = projectAnalyzerText("scenario-calculation");
        hint.textContent = projectAnalyzerText("scenario-calculation-hint");
        const binding = readFunctionLogicScenarioEditableBindings(
          logic.valueBindings || []
        ).find((candidate) =>
          candidate.id === selectedBindingId
        );
        const progression = binding ? readProgression(binding.id) : undefined;
        const language = document.documentElement.lang;
        if (progression === renderedProgression && language === renderedLanguage) return;
        renderedProgression = progression; renderedLanguage = language;
        rows.replaceChildren();
        omitted.hidden = true;
        omitted.textContent = "";
        if (!binding) {
          selection.textContent = projectAnalyzerText("choose-variable");
          return;
        }
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
          const empty = document.createElement("li");
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
          return readProgression(bindingId)?.frames || [];
        }
      };
    }

    /**
     * Shares one calculation between trace and playback reads. The graph/IR and
     * opaque resolvers are fixed for this renderer's lifetime; editable inputs
     * and branch exclusions own invalidation. Retain only one binding's frames
     * so visiting many variables cannot grow a second graph-sized cache.
     */
    function createFunctionLogicScenarioProgressionReader(logic, nodes, edges, scenarioIdentity) {
      let inputKey;
      let calculation;
      let orderedRecords;
      let frameBindingId;
      let frameLanguage;
      let progression;
      return (bindingId) => {
        if (logic.tutor?.program?.evaluationMode === "symbolic-only") return undefined;
        const bindings = readFunctionLogicScenarioEditableBindings(logic.valueBindings || []);
        const binding = bindings.find((candidate) => candidate.id === bindingId);
        if (!binding) return undefined;
        // A small semantic signature avoids coupling input writers, Guide
        // handoffs, and branch controls to an extra mutable revision counter.
        const nextInputKey = JSON.stringify([
          bindings.map((candidate) => [candidate.id, readFunctionLogicValuePreview(candidate.id)]),
          logic.blocks.map((block) => Boolean(nodes.get(block.id)?.classList.contains("choice-dimmed"))),
          (logic.edges || []).map((edge) => Boolean(edges?.get(edge.id)?.path?.classList.contains("choice-dimmed")))
        ]);
        if (nextInputKey !== inputKey) {
          const raw = calculateFunctionLogicScenario(logic, nodes, edges, scenarioIdentity);
          calculation = projectFunctionLogicScenarioCalculation(logic, raw, scenarioIdentity);
          orderedRecords = collectFunctionLogicScenarioBlockRecords(logic, calculation);
          inputKey = nextInputKey; progression = undefined;
        }
        const language = document.documentElement.lang;
        if (!progression || frameBindingId !== bindingId || frameLanguage !== language) {
          frameBindingId = bindingId; frameLanguage = language;
          progression = { calculation, orderedRecords,
            frames: collectFunctionLogicScenarioPlaybackFrames(binding, orderedRecords, calculation)
              .slice(0, MAX_LOGIC_SCENARIO_TRACE_STEPS) };
        }
        return progression;
      };
    }

    /**
     * Produces the one source-backed, bounded frame sequence shared by the
     * Scenario list and playback. No graph relation is created by this helper.
     */
    function readFunctionLogicScenarioPlaybackFrames(logic, binding, nodeButtonsById, edgeElementsById, scenarioIdentity) {
      const rawCalculation = calculateFunctionLogicScenario(logic, nodeButtonsById, edgeElementsById, scenarioIdentity);
      const calculation = projectFunctionLogicScenarioCalculation(logic, rawCalculation, scenarioIdentity);
      const orderedRecords = collectFunctionLogicScenarioBlockRecords(logic, calculation);
      return {
        calculation,
        orderedRecords,
        frames: collectFunctionLogicScenarioPlaybackFrames(binding, orderedRecords, calculation)
          .slice(0, MAX_LOGIC_SCENARIO_TRACE_STEPS)
      };
    }

    /**
     * Projects only exact root-program identities into the visible graph.
     * Evaluation remains keyed by opaque raw IDs; this boundary refuses absent
     * or aliased resolver results rather than guessing a visible target.
     */
    function projectFunctionLogicScenarioCalculation(logic, calculation, scenarioIdentity) {
      const visibleBindings = new Map((logic.valueBindings || []).map((binding) => [binding.id, binding]));
      const visibleBlocks = new Map((logic.blocks || []).map((block) => [block.id, block]));
      const root = (logic.tutor?.programBundle?.programs || []).find((program) => program.id === logic.tutor?.programBundle?.rootProgramId);
      // Legacy snapshots already execute against visible graph identities.
      // Preserve that direct contract rather than projecting an absent bundle.
      if (!root) return calculation;
      // Parameters seed raw execution, while locals must still cross this
      // boundary to render their root-program transitions and trace frames.
      const rawBindingIds = (root.bindings || []).map((binding) => binding.bindingId);
      const rawBlockIds = root ? (root.blocks || []).map((block) => block.blockId) : [...visibleBlocks.keys()];
      const bindingMap = createFunctionLogicScenarioVisibleTraceIdentityMap(rawBindingIds, visibleBindings, scenarioIdentity?.resolveScenarioBindingId);
      const blockMap = createFunctionLogicScenarioVisibleTraceIdentityMap(rawBlockIds, visibleBlocks, scenarioIdentity?.resolveScenarioBlockId);
      const inputStateByBindingId = new Map();
      for (const [rawId, state] of calculation.inputStateByBindingId || []) {
        const visibleId = bindingMap.get(rawId); if (visibleId) inputStateByBindingId.set(visibleId, state);
      }
      const recordsByBlockId = new Map();
      const projectRecord = (rawBlockId, record) => {
        const visibleBlockId = blockMap.get(rawBlockId); if (!visibleBlockId) return undefined;
        const before = projectFunctionLogicScenarioTraceEnvironment(record.before, bindingMap);
        const after = projectFunctionLogicScenarioTraceEnvironment(record.after, bindingMap);
        const transitions = (record.transitions || []).flatMap((transition) => {
          const targetBindingId = bindingMap.get(transition.targetBindingId);
          if (!targetBindingId) return [];
          const rootBindingId = transition.valueRef?.rootBindingId ? bindingMap.get(transition.valueRef.rootBindingId) : undefined;
          const segments = transition.valueRef?.segments?.map((segment) => segment.kind === "binding"
            ? (bindingMap.get(segment.bindingId) ? { kind: "binding", bindingId: bindingMap.get(segment.bindingId) } : undefined)
            : segment).filter(Boolean);
          const visibleOwner = rootBindingId ? visibleBindings.get(rootBindingId) : undefined;
          const resolvedPath = transition.valueRef?.path || [];
          const targetName = visibleOwner && resolvedPath.length
            ? visibleOwner.name + resolvedPath.map(formatFunctionLogicScenarioCanonicalFieldSegment).join("")
            : transition.targetName;
          return [{ ...transition, blockId: visibleBlockId, targetBindingId, targetName,
            ...(transition.valueRef && rootBindingId ? { valueRef: { ...transition.valueRef, rootBindingId, ...(segments ? { segments } : {}) } } : {}),
            dependencyBindingIds: (transition.dependencyBindingIds || []).map((id) => bindingMap.get(id)).filter(Boolean) }];
        });
        return { ...record, blockId: visibleBlockId, before, after, transitions };
      };
      for (const [rawBlockId, record] of calculation.recordsByBlockId || []) {
        const projected = projectRecord(rawBlockId, record); if (projected) recordsByBlockId.set(projected.blockId, projected);
      }
      const scenarioPaths = calculation.scenarioPaths?.map((path) => ({ ...path, occurrences: (path.occurrences || []).flatMap((record) => {
        if (!record.before || !record.after) return [];
        const projected = projectRecord(record.blockId, record); return projected ? [projected] : [];
      }) }));
      return { ...calculation, inputStateByBindingId, recordsByBlockId, ...(scenarioPaths ? { scenarioPaths } : {}) };
    }

    function projectFunctionLogicScenarioTraceEnvironment(environment, identityMap) {
      const projected = new Map();
      for (const [rawId, state] of environment || []) { const visibleId = identityMap.get(rawId); if (visibleId) projected.set(visibleId, state); }
      return projected;
    }

    /** Uses array-index notation only for canonical non-negative integer segments. */
    function formatFunctionLogicScenarioCanonicalFieldSegment(key) {
      if (/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(key)) return "." + key;
      if (/^(?:0|[1-9][0-9]*)$/u.test(key)) return "[" + key + "]";
      return "[" + JSON.stringify(key) + "]";
    }

    function createFunctionLogicScenarioVisibleTraceIdentityMap(rawIds, visibleById, resolve) {
      const candidates = new Map();
      for (const rawId of rawIds || []) { const visibleId = resolve ? resolve(rawId) : (visibleById.has(rawId) ? rawId : undefined); if (visibleId && visibleById.has(visibleId)) { const entries = candidates.get(visibleId) || []; entries.push(rawId); candidates.set(visibleId, entries); } }
      const mapped = new Map(); for (const [visibleId, rawIdsForVisible] of candidates) if (rawIdsForVisible.length === 1) mapped.set(rawIdsForVisible[0], visibleId);
      return mapped;
    }

    /** Preserves executed occurrences; legacy CFG snapshots retain graph order. */
    function collectFunctionLogicScenarioBlockRecords(logic, calculation) {
      const occurrences = calculation.scenarioPaths?.[0]?.occurrences;
      if (occurrences?.some((item) => item.before && item.after)) {
        const blocks = new Map(logic.blocks.map((block) => [block.id, block]));
        return occurrences.flatMap((record, index) => blocks.has(record.blockId) && record.before && record.after
          ? [{ block: blocks.get(record.blockId), index, record }] : []);
      }
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
          const initialized = !transition.before || transition.before.kind === "unset"
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
      const row = document.createElement("li");
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
      source.translate = false;
      source.textContent = sourceText;
      valueLabel.className = "logic-scenario-step-value-label";
      valueLabel.textContent = projectAnalyzerText(isTransition ? "result" : "value");
      value.className = "logic-scenario-step-value";
      value.translate = false;
      value.textContent = step.value;
      status.className = "logic-scenario-step-status";
      status.textContent = step.status || "";
      status.hidden = !status.textContent;
      row.append(sequence, role, source, valueLabel, value, status);
      return row;
    }

    /** Formats an assignment without hiding the evaluated right-hand side. */
    function formatFunctionLogicScenarioCalculation(transition) {
      if (transition.sourceLabel) return transition.sourceLabel;
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
