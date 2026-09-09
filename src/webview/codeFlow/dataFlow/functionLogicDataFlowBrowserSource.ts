/**
 * Browser-only Function Logic value-flow selector, access rows, and SVG
 * overlay. One binding is shown at a time so definition-to-use arrows remain
 * readable beside the independently rendered control-flow edges.
 */

import { getFunctionLogicValueFlowRoutingBrowserSource } from "./functionLogicValueFlowRouting";
import { getFunctionLogicValueFlowPlaybackBrowserSource } from "./functionLogicValueFlowPlaybackBrowserSource";
import { getFunctionLogicScenarioPlaybackFrameBrowserSource } from "../scenarioEvaluation";
import { getFunctionLogicScenarioInputsBrowserSource } from "./functionLogicScenarioInputsBrowserSource";

/** Returns CSP-safe value-flow browser helpers. */
export function getFunctionLogicDataFlowBrowserSource(): string {
  return /* js */ `
    ${getFunctionLogicValueFlowRoutingBrowserSource()}
    ${getFunctionLogicValueFlowPlaybackBrowserSource()}
    ${getFunctionLogicScenarioPlaybackFrameBrowserSource()}
    ${getFunctionLogicScenarioInputsBrowserSource()}

    const MAX_LOGIC_VALUE_ACCESS_ROWS = 8;
    const MAX_LOGIC_VALUE_FLOW_HOPS = 1500;
    let functionLogicValueFlowSessionKey = "";
    let functionLogicSelectedValueBindingId = "";

    /**
     * Keeps an explicit reader binding while the same root graph is relaid out.
     * A new graph deliberately starts unselected so value overlays stay
     * reader-directed rather than becoming default control-flow decoration.
     */
    function readFunctionLogicValueFlowSelection(sessionKey, bindings, flows) {
      const bindingIds = new Set(bindings.map((binding) => binding.id));
      if (functionLogicValueFlowSessionKey !== sessionKey) {
        functionLogicValueFlowSessionKey = sessionKey;
        functionLogicSelectedValueBindingId = "";
      } else if (!bindingIds.has(functionLogicSelectedValueBindingId)) {
        functionLogicSelectedValueBindingId = "";
      }
      return functionLogicSelectedValueBindingId;
    }

    /** Builds the selector and hidden-per-binding curved hops behind graph nodes. */
    function createFunctionLogicValueFlowRendering(
      logic,
      nodeLayoutsByBlockId,
      nodeButtonsById,
      controlEdgeElementsById,
      sessionKey,
      onBindingSelected,
      viewportController,
      onApplyScenarioPath,
      onRestoreScenarioPath,
      scenarioIdentity
    ) {
      const bindings = logic.valueBindings || [];
      const flows = logic.valueFlows || [];
      const flowHops = createFunctionLogicValueFlowHops(
        flows,
        logic.edges || [],
        logic.blocks.length,
        MAX_LOGIC_VALUE_FLOW_HOPS
      );
      prepareFunctionLogicValuePreviewSession(sessionKey, bindings);
      const editableBindings = readFunctionLogicScenarioEditableBindings(bindings);
      const bindingById = new Map(bindings.map((binding) => [binding.id, binding]));
      const blockById = new Map(logic.blocks.map((block) => [block.id, block]));
      const svg = createLogicSvgElement("svg");
      const foreground = createLogicSvgElement("svg");
      const toolbar = document.createElement("section");
      const header = document.createElement("div");
      const title = document.createElement("strong");
      const hint = document.createElement("span");
      const buttons = document.createElement("div");
      const legend = document.createElement("div");
      const paths = [];
      const playbackPathByKey = new Map();
      const scenarioControlPathByKey = new Map();
      const travelerSamplesByPath = new Map();
      const playbackHighlightedElements = new Set();
      let activePlaybackPath;
      let activeTransitionRecord;
      const buttonByBindingId = new Map();
      const traveler = createLogicSvgElement("g");
      const travelerBody = createLogicSvgElement("rect");
      const travelerLabel = createLogicSvgElement("text");
      const calculationPlaque = document.createElement("div");
      let cancelTravelerMotion = () => {};
      let lastArrivedFrame;
      const completedPathKeys = new Set();
      // Each selected binding starts on the same side and alternates locally,
      // producing a predictable stepping-stone rhythm independent of siblings.
      const hopIndexByBindingId = new Map();
      for (const edge of logic.edges || []) {
        const path = controlEdgeElementsById.get(edge.id)?.path;
        const key = edge.sourceId + "→" + edge.targetId;
        if (path && !scenarioControlPathByKey.has(key)) scenarioControlPathByKey.set(key, { flow: { sourceBlockId: edge.sourceId, targetBlockId: edge.targetId, confidence: edge.confidence }, path });
      }
      let selectedBindingId = readFunctionLogicValueFlowSelection(
        sessionKey,
        editableBindings,
        flows
      );
      let playbackRouteId = selectedBindingId;
      let scenarioTraceRendering;
      let playback;
      let scenarioFrames = [];
      // Only the current explicit Scenario action may project shared playback
      // phase into a row; ordinary binding playback deliberately has no row state.
      let activeScenarioSeedId = "";
      let activeScenarioPathIndex = 0;
      const scenarioWorkspaceSession = acquireFunctionLogicScenarioWorkspace(sessionKey, logic.tutor);
      const inputSuggestions = createScenarioInputSuggestions(logic.tutor, scenarioWorkspaceSession);
      const valuePreviewRendering = createFunctionLogicValuePreviewEditor(
        bindings,
        logic.blocks,
        sessionKey,
        (bindingId) => selectBinding(bindingId, false),
        () => {
          scenarioTraceRendering?.refresh();
          playback?.reset();
          scenarioWorkspace?.markModified();
        }
      );
      // Keep Tutor data browser-local until an explicit Guide action fills it.
      valuePreviewRendering.setRecommendedInputs(logic.tutor, inputSuggestions);
      scenarioTraceRendering = createFunctionLogicScenarioTrace(
        logic,
        nodeButtonsById,
        controlEdgeElementsById,
        scenarioIdentity
      );
      const scenarioWorkspace = createFunctionLogicScenarioWorkspace(scenarioWorkspaceSession, {
        tutor: logic.tutor,
        inputSuggestions,
        onPreview(path) {
          for (const node of nodeButtonsById.values()) node.classList.remove("scenario-workspace-preview");
          for (const elements of controlEdgeElementsById.values()) elements.path?.classList.remove("scenario-workspace-preview");
          for (const blockId of path?.blockIds || []) nodeButtonsById.get(scenarioIdentity?.resolveScenarioBlockId?.(blockId) || blockId)?.classList.add("scenario-workspace-preview");
          for (const edgeId of path?.edgeIds || []) controlEdgeElementsById.get(scenarioIdentity?.resolveScenarioEdgeId?.(edgeId) || edgeId)?.path?.classList.add("scenario-workspace-preview");
        },
        onApplyInputs(seed) {
          activeScenarioSeedId = ""; activeScenarioPathIndex = 0; playbackRouteId = selectedBindingId;
          valuePreviewRendering.loadKnownInputsByBindingId(readFunctionLogicScenarioSeedInputs(seed, logic.tutor, bindingById, scenarioIdentity));
          scenarioTraceRendering?.refresh(); playback?.reset();
        },
        onApplyPlay(seed, path, pathIndex) {
          this.onApplyInputs?.(seed);
          scenarioWorkspaceSession.setSnapshot(onApplyScenarioPath?.(path));
          scenarioFrames = readFunctionLogicScenarioStoryFrames(path, logic.tutor, bindingById, blockById, scenarioIdentity);
          activeScenarioSeedId = seed.id;
          activeScenarioPathIndex = Math.max(0, Number(pathIndex) || 0);
          playbackRouteId = "__scenario_workspace__";
          // Scenario playback owns an explicit temporary frame source; no value-chip selection is required.
          playback?.sync("__scenario_workspace__");
          playback?.playFromStart();
        },
        onRestore(snapshot) {
          onRestoreScenarioPath?.(snapshot);
        }
      });

      /** Updates the shared value-flow lens from either selector surface. */
      function selectBinding(bindingId, toggleSelected) {
        selectedBindingId = toggleSelected && selectedBindingId === bindingId
          ? ""
          : bindingId;
        functionLogicValueFlowSessionKey = sessionKey;
        functionLogicSelectedValueBindingId = selectedBindingId;
        activeScenarioSeedId = ""; activeScenarioPathIndex = 0; playbackRouteId = selectedBindingId;
        if (onBindingSelected) onBindingSelected(selectedBindingId);
        playback?.sync(selectedBindingId);
        refresh();
      }

      svg.setAttribute("class", "logic-data-flow-layer");
      svg.setAttribute("width", String(logic.layout.width));
      svg.setAttribute("height", String(logic.layout.height));
      svg.setAttribute("viewBox", "0 0 " + logic.layout.width + " " + logic.layout.height);
      svg.setAttribute("aria-hidden", "true");
      foreground.setAttribute("class", "logic-data-flow-foreground");
      foreground.setAttribute("width", String(logic.layout.width));
      foreground.setAttribute("height", String(logic.layout.height));
      foreground.setAttribute("viewBox", "0 0 " + logic.layout.width + " " + logic.layout.height);
      foreground.setAttribute("aria-hidden", "true");
      svg.append(createFunctionLogicValueFlowArrowMarker());
      for (let index = 0; index < flowHops.length; index += 1) {
        const flow = flowHops[index];
        const source = nodeLayoutsByBlockId.get(flow.sourceBlockId);
        const target = nodeLayoutsByBlockId.get(flow.targetBlockId);
        if (!source || !target || !bindingById.has(flow.bindingId)) continue;
        const bindingHopIndex = hopIndexByBindingId.get(flow.bindingId) || 0;
        hopIndexByBindingId.set(flow.bindingId, bindingHopIndex + 1);
        const path = createLogicSvgElement("path");
        path.setAttribute(
          "class",
          "logic-data-flow-edge logic-data-flow-hop"
            + (flow.targetUsage ? " " + flow.targetUsage : "")
            + (flow.confidence === "inferred" ? " inferred" : "")
        );
        path.setAttribute("d", createFunctionLogicValueFlowHopPath(
          source,
          target,
          bindingHopIndex
        ));
        path.setAttribute("data-value-hop", flow.sourceBlockId + "→" + flow.targetBlockId);
        path.setAttribute("data-value-hop-index", String(bindingHopIndex));
        path.setAttribute(
          "marker-end",
          flow.targetUsage === "sink"
            ? "url(#logic-data-flow-sink-arrow)"
            : "url(#logic-data-flow-arrow)"
        );
        svg.append(path);
        paths.push({ flow, path });
        playbackPathByKey.set(flow.bindingId + "::" + flow.sourceBlockId + "→" + flow.targetBlockId, { flow, path });
      }
      traveler.setAttribute("class", "logic-data-flow-traveler");
      traveler.setAttribute("aria-hidden", "true");
      travelerBody.setAttribute("class", "logic-data-flow-traveler-body");
      travelerLabel.setAttribute("class", "logic-data-flow-traveler-label");
      travelerLabel.setAttribute("text-anchor", "middle");
      travelerLabel.setAttribute("dominant-baseline", "middle");
      traveler.hidden = true;
      traveler.append(travelerBody, travelerLabel);
      foreground.append(traveler);
      calculationPlaque.className = "logic-value-flow-calculation-plaque";
      calculationPlaque.hidden = true;

      toolbar.className = "logic-data-flow-toolbar";
      toolbar.setAttribute("aria-label", projectAnalyzerText("values-function"));
      header.className = "logic-data-flow-header";
      title.textContent = projectAnalyzerText("values-function");
      hint.textContent = projectAnalyzerText("values-hint");
      buttons.className = "logic-data-flow-bindings";
      legend.className = "logic-data-flow-legend";
      legend.append(
        createBadge(projectAnalyzerText("legend-curved-hops"), "flow-badge logic-legend value-hop"),
        createBadge(projectAnalyzerText("value-consume"), "flow-badge logic-legend value-consume"),
        createBadge(projectAnalyzerText("value-sink"), "flow-badge logic-legend value-sink")
      );
      header.append(title, hint);
      for (const binding of bindings) {
        const button = document.createElement("button");
        const accessCount = logic.blocks.reduce((count, block) =>
          count + (block.valueAccesses || []).filter((access) =>
            access.bindingId === binding.id && access.access !== "define"
          ).length, 0);
        button.type = "button";
        button.className = "logic-data-binding " + binding.kind
          + (binding.valueRole ? " " + binding.valueRole : "")
          + (binding.confidence === "inferred" ? " inferred" : "");
        button.textContent = formatFunctionLogicBindingKind(binding.kind, binding.valueRole)
          + " " + binding.name + " · "
          + projectAnalyzerText(accessCount === 1 ? "access-count" : "accesses-count", { count: accessCount });
        button.title = projectAnalyzerText("trace-binding", {
          kind: formatFunctionLogicBindingKind(binding.kind, binding.valueRole), name: binding.name
        });
        button.setAttribute("aria-pressed", binding.id === selectedBindingId ? "true" : "false");
        button.addEventListener("click", () => selectBinding(binding.id, true));
        buttons.append(button);
        buttonByBindingId.set(binding.id, button);
      }
      toolbar.append(header, legend, buttons);
      playback = createFunctionLogicValueFlowPlayback({
        language: state.uiLanguage,
        readFrames(bindingId) {
          if (bindingId === "__scenario_workspace__") return scenarioFrames;
          return scenarioTraceRendering?.readFrames(bindingId) || [];
        },
        onActiveFrame(frame, activeIndex, _frameCount, animated) {
          const playbackState = animated || {};
          const previous = playbackState.previous || lastArrivedFrame;
          for (const node of playbackHighlightedElements) {
            node.classList.remove(
              "data-flow-playback-source",
              "data-flow-playback-target",
              "data-flow-playback-current",
              "data-flow-playback-change",
              "data-flow-playback-departure"
            );
          }
          playbackHighlightedElements.clear();
          const record = findFunctionLogicPlaybackPath(playbackPathByKey, scenarioControlPathByKey, playbackRouteId, previous, frame);
          activePlaybackPath?.classList.remove("playback-active");
          activeTransitionRecord = undefined;
          activePlaybackPath = record?.path;
          if (record) record.path.classList.add("playback-active");
          cancelTravelerMotion();
          if (frame?.block?.id && playbackState.phase !== "transition") {
            const current = nodeButtonsById.get(frame.block.id);
            current?.classList.add("data-flow-playback-current");
            if (current) playbackHighlightedElements.add(current);
            if (["change", "unknown", "decision", "effect", "result"].includes(frame.type)) {
              current?.classList.add("data-flow-playback-change");
            }
          }
          if (record) {
            nodeButtonsById.get(record.flow.sourceBlockId)
              ?.classList.add("data-flow-playback-source");
            nodeButtonsById.get(record.flow.targetBlockId)
              ?.classList.add("data-flow-playback-target");
            const sourceNode = nodeButtonsById.get(record.flow.sourceBlockId);
            const targetNode = nodeButtonsById.get(record.flow.targetBlockId);
            if (sourceNode) playbackHighlightedElements.add(sourceNode);
            if (targetNode) playbackHighlightedElements.add(targetNode);
            if (playbackState.phase !== "transition") {
              completedPathKeys.add(record.flow.sourceBlockId + "→" + record.flow.targetBlockId);
              cancelTravelerMotion = placeFunctionLogicValueFlowTraveler(
                traveler, travelerBody, travelerLabel,
                nodeLayoutsByBlockId.get(frame.block.id), frame
              );
            }
          } else if (frame?.block?.id) {
            cancelTravelerMotion = placeFunctionLogicValueFlowTraveler(
              traveler, travelerBody, travelerLabel,
              nodeLayoutsByBlockId.get(frame.block.id),
              frame
            );
          }
          if (playbackState.phase !== "transition") {
            lastArrivedFrame = frame;
            renderFunctionLogicValueFlowCalculationPlaque(calculationPlaque, nodeLayoutsByBlockId, frame);
            const layout = frame?.block?.id ? nodeLayoutsByBlockId.get(frame.block.id) : undefined;
            if (layout) viewportController?.followWorldPoint?.({ x: layout.x + layout.width / 2, y: layout.y + layout.height / 2 });
            viewportController?.settleAutoFollow?.();
          }
        },
        onTransitionStart(frame, previous) {
          const record = findFunctionLogicPlaybackPath(playbackPathByKey, scenarioControlPathByKey, playbackRouteId, previous, frame);
          // Activate before sampling: selected scenario paths are intentionally
          // hidden until this state makes their SVG geometry measurable.
          activeTransitionRecord = record;
          if (!activeTransitionRecord) return { durationMs: 0 };
          activePlaybackPath?.classList.remove("playback-active");
          activePlaybackPath = activeTransitionRecord.path;
          activePlaybackPath.classList.add("playback-active");
          const source = nodeButtonsById.get(activeTransitionRecord.flow.sourceBlockId);
          source?.classList.add("data-flow-playback-source", "data-flow-playback-departure");
          if (source) playbackHighlightedElements.add(source);
          if (!isFunctionLogicPlaybackPathVisible(activeTransitionRecord.path)) { activeTransitionRecord = undefined; return { durationMs: 0 }; }
          cacheFunctionLogicValueFlowTravelerPath(activeTransitionRecord.path, travelerSamplesByPath);
          const cached = travelerSamplesByPath.get(activeTransitionRecord.path);
          if (!cached?.points?.length) { activeTransitionRecord = undefined; return { durationMs: 0 }; }
          return { durationMs: Math.max(1400, Math.min(2800, 1400 + cached.points.length * 2)) };
        },
        onTransition(frame, previous, _activeIndex, _frameCount, progress, playbackState) {
          const record = activeTransitionRecord;
          if (!record) return;
          renderFunctionLogicValueFlowTravelerProgress(
            traveler, travelerBody, travelerLabel, record.path, previous, progress,
            playbackState.direction, travelerSamplesByPath, viewportController
          );
        },
        onTransitionError() {
          // Playback owns semantic progression; graph motion is best-effort and
          // may lose its SVG path during a concurrent Webview presentation update.
          activeTransitionRecord = undefined;
          cancelTravelerMotion();
          viewportController?.settleAutoFollow?.();
        },
        onCancel() {
          cancelTravelerMotion();
          viewportController?.settleAutoFollow?.();
        },
        onPassStart() {
          viewportController?.beginAutoFollow?.();
        },
        onPlaybackState(bindingId, phase) {
          if (bindingId === "__scenario_workspace__" && activeScenarioSeedId) {
            scenarioWorkspaceSession.setPlaybackState(activeScenarioSeedId, activeScenarioPathIndex, phase);
            return;
          }
          scenarioWorkspaceSession.clearPlaybackState();
        }
      });

      /** Synchronizes selected binding, branch reachability, and node emphasis. */
      function refresh() {
        valuePreviewRendering.setSelectedBinding(selectedBindingId);
        scenarioTraceRendering.setSelectedBinding(selectedBindingId);
        for (const [bindingId, button] of buttonByBindingId) {
          const selected = bindingId === selectedBindingId;
          button.classList.toggle("selected", selected);
          button.setAttribute("aria-pressed", selected ? "true" : "false");
        }
        for (const [blockId, node] of nodeButtonsById) {
          const block = blockById.get(blockId);
          const selectedAccesses = selectedBindingId
            ? (block?.valueAccesses || []).filter((access) =>
                access.bindingId === selectedBindingId
              )
            : [];
          const related = selectedAccesses.length > 0;
          node.classList.toggle("data-flow-related", related);
          node.classList.toggle(
            "data-flow-definition",
            related && bindingById.get(selectedBindingId)?.definitionBlockId === blockId
          );
          node.classList.toggle(
            "data-flow-consume",
            selectedAccesses.some((access) => access.usage === "consume")
          );
          node.classList.toggle(
            "data-flow-sink",
            selectedAccesses.some((access) => access.usage === "sink")
          );
        }
        for (const record of paths) {
          const selected = record.flow.bindingId === selectedBindingId;
          const sourceDimmed = nodeButtonsById.get(record.flow.sourceBlockId)
            ?.classList.contains("choice-dimmed");
          const targetDimmed = nodeButtonsById.get(record.flow.targetBlockId)
            ?.classList.contains("choice-dimmed");
          record.path.classList.toggle("selected", selected);
          record.path.classList.toggle(
            "choice-dimmed",
            selected && Boolean(sourceDimmed || targetDimmed)
          );
        }
        completedPathKeys.clear();
        activePlaybackPath?.classList.remove("playback-active");
        activePlaybackPath = undefined;
        activeTransitionRecord = undefined;
        lastArrivedFrame = undefined;
        playback?.sync(selectedBindingId);
      }

      return {
        svg: flowHops.length > 0 ? svg : undefined,
        foreground: flowHops.length > 0 ? foreground : undefined,
        calculationPlaque,
        toolbar: bindings.length > 0 ? toolbar : undefined,
        playback: bindings.length > 0 ? playback.element : undefined,
        valuePreviewEditor: valuePreviewRendering.element,
        scenarioWorkspace: scenarioWorkspace.element,
        scenarioWorkspaceSession,
        scenarioTrace: scenarioTraceRendering.element,
        refresh,
        /** Leaving Values pauses its work; returning never starts or resumes automatically. */
        setVisible(visible) {
          if (visible) return;
          playback?.pause();
          scenarioWorkspace.deactivate();
        },
        /** Delegates an explicit Guide handoff to the editor surface. */
        focusKnownInputs(names, message) {
          valuePreviewRendering.focusKnownInputs(names, message);
        },
        /** Applies Guide-provided values to tracked editor rows without graph work. */
        loadKnownInputs(valuesByName) {
          valuePreviewRendering.loadKnownInputs(valuesByName);
        },
        resetPlayback() {
          playback.reset();
          refresh();
        },
        dispose() {
          scenarioWorkspace.dispose();
          playback?.dispose();
          cancelTravelerMotion();
          viewportController?.cancelAutoFollow?.();
        },
        updateLanguage(language) {
          playback?.setLanguage(language);
          toolbar.setAttribute("aria-label", projectAnalyzerText("values-function"));
          title.textContent = projectAnalyzerText("values-function");
          hint.textContent = projectAnalyzerText("values-hint");
          const legendKeys = ["legend-curved-hops", "value-consume", "value-sink"];
          for (let index = 0; index < legend.children.length; index += 1) {
            legend.children[index].textContent = projectAnalyzerText(legendKeys[index]);
          }
          for (const binding of bindings) {
            const button = buttonByBindingId.get(binding.id);
            if (!button) continue;
            const accessCount = logic.blocks.reduce((count, block) => count + (block.valueAccesses || []).filter((access) => access.bindingId === binding.id && access.access !== "define").length, 0);
            button.textContent = formatFunctionLogicBindingKind(binding.kind, binding.valueRole) + " " + binding.name + " · " + projectAnalyzerText(accessCount === 1 ? "access-count" : "accesses-count", { count: accessCount });
            button.title = projectAnalyzerText("trace-binding", {
              kind: formatFunctionLogicBindingKind(binding.kind, binding.valueRole), name: binding.name
            });
          }
          valuePreviewRendering.refreshLanguage?.();
          scenarioTraceRendering?.refresh?.();
          // Reformat the settled fact only; do not advance playback, focus, or camera.
          if (lastArrivedFrame) renderFunctionLogicValueFlowCalculationPlaque(calculationPlaque, nodeLayoutsByBlockId, lastArrivedFrame);
          // The shared Workspace retains its session, selected row, and result
          // map; refresh only its localized labels and ARIA surface.
          scenarioWorkspace.refresh?.();
        }
      };
    }


    /** Converts one path into an ordered source story without inventing runtime values. */
    function readFunctionLogicScenarioStoryFrames(path, tutor, bindingsById, blocksById, identity) {
      if (path?.scenario) return readFunctionLogicSymbolicScenarioStoryFrames(path, tutor, bindingsById, blocksById, identity);
      const parameterBindingIds = new Set((tutor?.program?.bindings || []).filter((binding) => binding.parameterId).map((binding) => binding.bindingId));
      const frames = [];
      for (const bindingId of parameterBindingIds) {
        const visibleBindingId = identity?.resolveScenarioBindingId?.(bindingId) || bindingId;
        const binding = bindingsById.get(visibleBindingId); if (!binding) continue;
        const block = blocksById.get(binding.definitionBlockId); if (block) frames.push({ type: "start", bindingId: visibleBindingId, binding, block, carriedValue: readFunctionLogicValuePreview(visibleBindingId) || projectAnalyzerText("scenario-state-unknown"), confidence: binding.confidence || "unknown" });
      }
      const appendTransition = (transition, occurrence) => {
        const bindingId = identity?.resolveScenarioBindingId?.(transition.valueRef?.rootBindingId || transition.targetBindingId) || transition.valueRef?.rootBindingId || transition.targetBindingId;
        const block = blocksById.get(identity?.resolveScenarioBlockId?.(transition.blockId) || transition.blockId);
        if (!bindingId || !bindingsById.has(bindingId) || !block) {
          // Unsupported identity/geometry remains a discrete, explicitly unknown beat.
          frames.push({ type: "unknown", bindingId: bindingId || "", block, transition, occurrence, confidence: transition.certainty || "unknown" });
          return;
        }
        const binding = bindingsById.get(bindingId);
        const fieldTarget = transition.valueRef?.path?.length
          ? (binding?.name || projectAnalyzerText("value")) + transition.valueRef.path.map(formatFunctionLogicCanonicalFieldSegment).join("")
          : undefined;
        const normalizedTransition = { ...transition, targetName: fieldTarget || binding?.name || transition.target || projectAnalyzerText("value"), operator: transition.operator || block?.label || "", expression: transition.expression || "", confidence: transition.certainty || "unknown" };
        frames.push({ type: "change", bindingId, binding, block, occurrence, carriedValue: formatFunctionLogicScenarioState(normalizedTransition.after), transition: normalizedTransition, confidence: normalizedTransition.confidence });
      };
      const occurrences = readFunctionLogicScenarioPlaybackOccurrences(path);
      if (occurrences.length > 0) {
        const programBlocks = new Map((tutor?.program?.blocks || []).map((block) => [block.blockId, block]));
        const programEdges = new Map((tutor?.program?.edges || []).map((edge) => [edge.edgeId, edge]));
        for (const occurrence of occurrences) {
          const block = blocksById.get(identity?.resolveScenarioBlockId?.(occurrence.blockId) || occurrence.blockId);
          const programBlock = programBlocks.get(occurrence.blockId);
          if (block && programBlock?.decision && occurrence.selectedEdgeId) {
            const edgeKind = programEdges.get(occurrence.selectedEdgeId)?.kind;
            const outcome = edgeKind === "true" || edgeKind === "false"
              ? projectAnalyzerText("scenario-outcome-" + edgeKind)
              : projectAnalyzerText("scenario-outcome-case");
            frames.push({ type: "decision", block, occurrence, storyText: projectAnalyzerText("scenario-story-decision", { condition: block.label, outcome }), carriedValue: outcome, confidence: "exact" });
          }
          for (const transition of occurrence.transitions || []) appendTransition(transition, occurrence);
        }
      } else for (const transition of path?.transitions || []) {
        appendTransition(transition, undefined);
      }
      return frames;
    }

    /** Narrates calculations, choices, writes, and effects in reachable source order. */
    function readFunctionLogicSymbolicScenarioStoryFrames(path, tutor, bindingsById, blocksById, identity) {
      const frames = [];
      const visibleBlockId = (blockId) => identity?.resolveScenarioBlockId?.(blockId) || blockId;
      const visibleBindingId = (bindingId) => identity?.resolveScenarioBindingId?.(bindingId) || bindingId;
      const orderedBlocks = (path.blockIds || []).map((blockId) => blocksById.get(visibleBlockId(blockId))).filter(Boolean);
      const entry = orderedBlocks.find((block) => block.kind === "entry") || orderedBlocks[0];
      const inputs = [];
      for (const binding of tutor?.program?.bindings || []) {
        if (!binding.parameterId) continue;
        const id = visibleBindingId(binding.bindingId); const visible = bindingsById.get(id); if (!visible) continue;
        inputs.push(visible.name + " = " + (readFunctionLogicValuePreview(id) || projectAnalyzerText("scenario-state-unknown")));
      }
      if (entry) frames.push({ type: "scene", block: entry, storyText: projectAnalyzerText("scenario-story-start", { inputs: inputs.join(" · ") || projectAnalyzerText("unknown") }), carriedValue: functionTutorScenarioTitle(path, path.scenario.ordinal), confidence: path.certainty || "inferred" });
      const decisionByBlock = new Map((path.scenario.decisions || []).map((decision) => [visibleBlockId(decision.blockId), decision]));
      const effectByBlock = new Map((path.scenario.effects || []).map((effect) => [visibleBlockId(effect.blockId), effect]));
      const transitionsByBlock = new Map();
      for (const transition of path.transitions || []) {
        const blockId = visibleBlockId(transition.blockId); const values = transitionsByBlock.get(blockId) || []; values.push(transition); transitionsByBlock.set(blockId, values);
      }
      const bindingsByName = new Map();
      for (const binding of bindingsById.values()) {
        const values = bindingsByName.get(binding.name) || []; values.push(binding); bindingsByName.set(binding.name, values);
      }
      for (const block of orderedBlocks) {
        if (block === entry || block.kind === "exit") continue;
        let emitted = false;
        const blockTransitions = transitionsByBlock.get(block.id) || [];
        for (const transition of blockTransitions) {
          const bindingId = visibleBindingId(transition.valueRef?.rootBindingId || transition.targetBindingId); const binding = bindingsById.get(bindingId);
          const fieldTarget = transition.valueRef?.path?.length ? (binding?.name || projectAnalyzerText("value")) + transition.valueRef.path.map(formatFunctionLogicCanonicalFieldSegment).join("") : undefined;
          const normalized = { ...transition, targetName: fieldTarget || binding?.name || transition.target || projectAnalyzerText("value"), operator: transition.operator || block.label || "", expression: transition.expression || "", confidence: transition.certainty || "unknown" };
          frames.push({ type: "change", bindingId, binding, block, carriedValue: formatFunctionLogicScenarioState(normalized.after), transition: normalized, confidence: normalized.confidence }); emitted = true;
        }
        for (const change of blockTransitions.length ? [] : block.valueChanges || []) {
          const rootName = change.valueRef?.rootBindingId ? undefined : String(change.target || "").split(".")[0].split("[")[0];
          const candidateBindings = rootName ? bindingsByName.get(rootName) || [] : [];
          const bindingId = change.valueRef?.rootBindingId || (candidateBindings.length === 1 ? candidateBindings[0].id : "");
          const binding = bindingId ? bindingsById.get(bindingId) : undefined;
          const expression = change.value || projectAnalyzerText("scenario-state-unknown");
          frames.push({ type: "change", bindingId, binding, block, carriedValue: expression, storyText: projectAnalyzerText("scenario-story-change", { target: change.target, operator: change.operator, value: expression }), confidence: change.confidence || "unknown" }); emitted = true;
        }
        const decision = decisionByBlock.get(block.id);
        if (decision) { const outcome = projectAnalyzerText("scenario-outcome-" + decision.outcome); frames.push({ type: "decision", block, storyText: projectAnalyzerText("scenario-story-decision", { condition: decision.label, outcome: outcome }), carriedValue: outcome, confidence: block.confidence || "inferred" }); emitted = true; }
        const effect = effectByBlock.get(block.id);
        if (effect) { frames.push({ type: "effect", block, storyText: projectAnalyzerText("scenario-story-effect", { effect: effect.label }), carriedValue: effect.label, confidence: block.confidence || "inferred" }); emitted = true; }
        if (!emitted && (block.kind === "loop" || block.kind === "operation")) frames.push({ type: "calculation", block, storyText: projectAnalyzerText("scenario-story-calculation", { calculation: block.label }), carriedValue: block.label, confidence: block.confidence || "inferred" });
        if (frames.length >= 31) break;
      }
      const terminal = [...orderedBlocks].reverse().find((block) => ["return", "throw", "exit"].includes(block.kind));
      if (terminal && frames.length < 32) frames.push({ type: "result", block: terminal, storyText: projectAnalyzerText("scenario-story-result", { result: functionTutorScenarioEffectText(path) }), carriedValue: functionTutorScenarioEffectText(path), confidence: path.certainty || "inferred" });
      return frames;
    }

    /** Returns the one exact existing lexical hop for two adjacent Scenario frames. */
    function findFunctionLogicPlaybackPath(pathByKey, controlPathByKey, bindingId, previous, frame) {
      if (!previous?.block?.id || !frame?.block?.id || previous.block.id === frame.block.id) return undefined;
      // Scenario beats may carry the owner inside either field metadata or a
      // binding object. Normalize before the opaque hop key is constructed.
      const ownerFor = (candidate) => candidate?.transition?.valueRef?.rootBindingId
        || candidate?.bindingId || candidate?.binding?.id;
      const previousOwner = ownerFor(previous);
      const frameOwner = ownerFor(frame);
      const storyBindingId = previousOwner && previousOwner === frameOwner
        ? frameOwner
        : bindingId;
      const candidate = pathByKey.get(storyBindingId + "::" + previous.block.id + "→" + frame.block.id)
        || (bindingId === "__scenario_workspace__" ? controlPathByKey.get(previous.block.id + "→" + frame.block.id) : undefined);
      return candidate && candidate.flow.confidence === "exact"
        && !candidate.path.classList.contains("choice-dimmed") ? candidate : undefined;
    }

    /** Formats decoded canonical keys without changing their opaque identity. */
    function formatFunctionLogicCanonicalFieldSegment(key) {
      if (/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(key)) return "." + key;
      if (/^(?:0|[1-9][0-9]*)$/u.test(key)) return "[" + key + "]";
      return "[" + JSON.stringify(key) + "]";
    }

    /** Anchors a stopped token alongside its current block without altering graph geometry. */
    function placeFunctionLogicValueFlowTraveler(traveler, body, label, layout, frame) {
      if (!layout || !frame) {
        traveler.hidden = true;
        return () => {};
      }
      setFunctionLogicValueFlowTravelerLabel(body, label, frame);
      traveler.hidden = false;
      traveler.setAttribute("transform", "translate(" + (layout.x + layout.width / 2) + " "
        + (layout.y + 10) + ")");
      return () => {};
    }

    /** Caches bounded path geometry before rAF so frame work remains numeric only. */
    function cacheFunctionLogicValueFlowTravelerPath(path, cache) {
      if (cache.has(path) || typeof path.getTotalLength !== "function" || typeof path.getPointAtLength !== "function") return;
      const length = path.getTotalLength();
      if (!Number.isFinite(length) || length <= 0) return;
      const points = [];
      for (let index = 0; index < 48; index += 1) points.push(path.getPointAtLength(length * index / 47));
      cache.set(path, { points, length, lastSlot: -1 });
    }

    /** Uses cached transition geometry; rAF never queries SVG geometry. */
    function renderFunctionLogicValueFlowTravelerProgress(traveler, body, label, path, frame, progress, direction, cache, viewportController) {
      let entry = cache.get(path);
      if (!entry) return;
      const slot = Math.max(0, Math.min(47, Math.round((direction < 0 ? 1 - progress : progress) * 47)));
      if (entry.lastSlot === slot) return;
      entry.lastSlot = slot;
      const point = entry.points[slot];
      if (!point) return;
      setFunctionLogicValueFlowTravelerLabel(body, label, frame);
      traveler.hidden = false;
      traveler.setAttribute("transform", "translate(" + point.x + " " + point.y + ")");
      viewportController?.followWorldPoint?.(point);
    }

    /** Shows only source-backed transition facts beside the affected node. */
    function renderFunctionLogicValueFlowCalculationPlaque(plaque, layouts, frame) {
      const transition = frame?.transition;
      const layout = frame?.block?.id ? layouts.get(frame.block.id) : undefined;
      if (!layout) { plaque.hidden = true; return; }
      if (frame?.storyText && !transition) {
        plaque.textContent = frame.storyText + " · " + projectAnalyzerText("logic-confidence-" + (frame.confidence || "unknown"));
        plaque.style.setProperty("left", (layout.x + layout.width / 2) + "px");
        plaque.style.setProperty("top", Math.max(0, layout.y - 8) + "px");
        plaque.hidden = false;
        return;
      }
      if (!transition) { plaque.hidden = true; return; }
      const before = formatFunctionLogicScenarioState(transition.before);
      const after = formatFunctionLogicScenarioState(transition.after);
      const operation = transition.operator
        ? transition.targetName + " " + formatFunctionLogicValueFlowOperation(transition.operator) + (transition.expression ? " " + transition.expression : "")
        : projectAnalyzerText("scenario-unknown");
      const reason = transition.after?.kind === "unknown" ? " · " + formatFunctionLogicScenarioReason(transition.after) : "";
      plaque.textContent = before + " → " + operation + " → " + after + " · " + projectAnalyzerText("logic-confidence-" + (transition.confidence || "unknown")) + reason;
      plaque.style.setProperty("left", (layout.x + layout.width / 2) + "px");
      plaque.style.setProperty("top", Math.max(0, layout.y - 8) + "px");
      plaque.hidden = false;
    }

    /** Localizes protocol operation enums while preserving source operators and expressions. */
    function formatFunctionLogicValueFlowOperation(operation) {
      const enumOperations = new Set(["define", "initialize", "assign", "update", "delete", "iterate", "mutate", "read", "write", "readwrite", "readWrite", "consume", "sink", "unknown"]);
      return enumOperations.has(operation) ? projectAnalyzerText("logic-value-operation-" + operation) : operation;
    }

    /** Falls back to discrete arrival when the exact path cannot currently be seen. */
    function isFunctionLogicPlaybackPathVisible(path) {
      if (document.hidden || path.isConnected === false) return false;
      if (typeof path.getBoundingClientRect !== "function") return true;
      const box = path.getBoundingClientRect();
      return !box || box.width > 0 || box.height > 0;
    }

    /** Keeps the traveler identity source-verifiable; full mutations live in the wrapping status/plaque. */
    function setFunctionLogicValueFlowTravelerLabel(body, label, frame) {
      const tokenText = frame.binding?.name
        ? frame.binding.name
        : frame.storyText || frame.carriedValue || projectAnalyzerText("value-token-fallback");
      if (label) label.textContent = tokenText;
      if (body) {
        const width = Math.max(42, tokenText.length * 5.6 + 12);
        body.setAttribute("x", String(-width / 2));
        body.setAttribute("y", "-15");
        body.setAttribute("width", String(width));
        body.setAttribute("height", "30");
        body.setAttribute("rx", "4");
      }
    }

    /** Creates a distinct arrowhead for the optional value-flow overlay. */
    function createFunctionLogicValueFlowArrowMarker() {
      const defs = createLogicSvgElement("defs");
      for (const descriptor of [{
        id: "logic-data-flow-arrow",
        className: "logic-data-flow-arrow-head"
      }, {
        id: "logic-data-flow-sink-arrow",
        className: "logic-data-flow-arrow-head sink"
      }]) {
        const marker = createLogicSvgElement("marker");
        const arrow = createLogicSvgElement("path");
        marker.setAttribute("id", descriptor.id);
        marker.setAttribute("viewBox", "0 0 10 10");
        marker.setAttribute("refX", "9");
        marker.setAttribute("refY", "5");
        marker.setAttribute("markerWidth", "7");
        marker.setAttribute("markerHeight", "7");
        marker.setAttribute("orient", "auto-start-reverse");
        arrow.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
        arrow.setAttribute("class", descriptor.className);
        marker.append(arrow);
        defs.append(marker);
      }
      return defs;
    }

    /** Renders compact value-use rows shared by graph nodes and detail panels. */
    function createFunctionLogicValueAccessList(accesses, className) {
      const list = document.createElement("span");
      list.className = className;
      for (const access of accesses.slice(0, MAX_LOGIC_VALUE_ACCESS_ROWS)) {
        const row = document.createElement("span");
        const role = document.createElement("span");
        const name = document.createElement("code");
        row.className = "logic-value-access " + access.bindingKind
          + (access.usage ? " " + access.usage : "")
          + (access.valueRole ? " " + access.valueRole : "")
          + (access.confidence === "inferred" ? " inferred" : "");
        row.title = access.confidence === "inferred"
          ? projectAnalyzerText("inferred-binding-detail")
          : access.usage === "sink"
            ? projectAnalyzerText("value-flow-sink-detail")
            : access.usage === "consume"
              ? projectAnalyzerText("value-flow-consume-detail")
              : projectAnalyzerText("value-flow-access-detail");
        role.className = "logic-value-access-role";
        role.textContent = formatFunctionLogicBindingKind(access.bindingKind, access.valueRole)
          + " · " + formatFunctionLogicValueUsage(access);
        name.textContent = access.name;
        row.append(role, name, createFunctionLogicValuePreviewLabel(access.bindingId));
        list.append(row);
        row.refreshLanguage = () => {
          row.title = access.confidence === "inferred" ? projectAnalyzerText("inferred-binding-detail") : access.usage === "sink" ? projectAnalyzerText("value-flow-sink-detail") : access.usage === "consume" ? projectAnalyzerText("value-flow-consume-detail") : projectAnalyzerText("value-flow-access-detail");
          role.textContent = formatFunctionLogicBindingKind(access.bindingKind, access.valueRole) + " · " + formatFunctionLogicValueUsage(access);
        };
      }
      if (accesses.length > MAX_LOGIC_VALUE_ACCESS_ROWS) {
        const omitted = document.createElement("span");
        omitted.className = "logic-value-access omitted";
        omitted.textContent = projectAnalyzerText("more-bindings", { count: accesses.length - MAX_LOGIC_VALUE_ACCESS_ROWS });
        list.append(omitted);
        omitted.refreshLanguage = () => { omitted.textContent = projectAnalyzerText("more-bindings", { count: accesses.length - MAX_LOGIC_VALUE_ACCESS_ROWS }); };
      }
      list.refreshLanguage = () => {
        for (const row of list.children) row.refreshLanguage?.();
      };
      return list;
    }

    /** Produces concise non-color binding kind labels. */
    function formatFunctionLogicBindingKind(kind, valueRole) {
      if (valueRole === "component") return projectAnalyzerText("component"); if (kind === "manual") return projectAnalyzerText("custom"); if (kind === "parameter") return projectAnalyzerText("parameter"); if (kind === "constant") return projectAnalyzerText("constant"); return projectAnalyzerText("local");
    }

    /** Produces concise non-color access labels. */
    function formatFunctionLogicValueAccess(access) {
      if (access === "readwrite") return projectAnalyzerText("read-write"); if (access === "define") return projectAnalyzerText("define"); return projectAnalyzerText(access === "write" ? "write" : "read");
    }

    /** Keeps consume/sink semantics explicit while retaining update behavior. */
    function formatFunctionLogicValueUsage(access) {
      const usage = access.usage === "sink" ? projectAnalyzerText("sink") : access.usage === "consume" ? projectAnalyzerText("consume") : "";
      if (!usage) return formatFunctionLogicValueAccess(access.access);
      return access.access === "readwrite" ? usage + " / " + projectAnalyzerText("write") : usage;
    }
  `;
}
