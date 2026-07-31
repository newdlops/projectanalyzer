/**
 * Browser-only Function Logic value-flow selector, access rows, and SVG
 * overlay. One binding is shown at a time so definition-to-use arrows remain
 * readable beside the independently rendered control-flow edges.
 */

import { getFunctionLogicValueFlowRoutingBrowserSource } from "./functionLogicValueFlowRouting";
import { getFunctionLogicValueFlowPlaybackBrowserSource } from "./functionLogicValueFlowPlaybackBrowserSource";

/** Returns CSP-safe value-flow browser helpers. */
export function getFunctionLogicDataFlowBrowserSource(): string {
  return /* js */ `
    ${getFunctionLogicValueFlowRoutingBrowserSource()}
    ${getFunctionLogicValueFlowPlaybackBrowserSource()}

    const MAX_LOGIC_VALUE_ACCESS_ROWS = 8;
    const MAX_LOGIC_VALUE_FLOW_HOPS = 1500;
    let functionLogicValueFlowSessionKey = "";
    let functionLogicSelectedValueBindingId = "";

    /**
     * Keeps an explicit reader binding while the same root graph is relaid out.
     * A new graph deliberately starts unselected: a value overlay is a Values
     * question, not default control-flow decoration.
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
      onBindingSelected
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
      const toolbar = document.createElement("section");
      const header = document.createElement("div");
      const title = document.createElement("strong");
      const hint = document.createElement("span");
      const buttons = document.createElement("div");
      const legend = document.createElement("div");
      const paths = [];
      const playbackPathByKey = new Map();
      const travelerSamplesByPath = new Map();
      const playbackHighlightedElements = new Set();
      let activePlaybackPath;
      const buttonByBindingId = new Map();
      const traveler = createLogicSvgElement("g");
      const travelerBody = createLogicSvgElement("rect");
      const travelerLabel = createLogicSvgElement("text");
      let cancelTravelerMotion = () => {};
      let lastArrivedFrame;
      const completedPathKeys = new Set();
      // Each selected binding starts on the same side and alternates locally,
      // producing a predictable stepping-stone rhythm independent of siblings.
      const hopIndexByBindingId = new Map();
      let selectedBindingId = readFunctionLogicValueFlowSelection(
        sessionKey,
        editableBindings,
        flows
      );
      let scenarioTraceRendering;
      let playback;
      const valuePreviewRendering = createFunctionLogicValuePreviewEditor(
        bindings,
        logic.blocks,
        sessionKey,
        (bindingId) => selectBinding(bindingId, false),
        () => {
          scenarioTraceRendering?.refresh();
          playback?.reset();
        }
      );
      scenarioTraceRendering = createFunctionLogicScenarioTrace(
        logic,
        nodeButtonsById,
        controlEdgeElementsById
      );

      /** Updates the shared value-flow lens from either selector surface. */
      function selectBinding(bindingId, toggleSelected) {
        selectedBindingId = toggleSelected && selectedBindingId === bindingId
          ? ""
          : bindingId;
        functionLogicValueFlowSessionKey = sessionKey;
        functionLogicSelectedValueBindingId = selectedBindingId;
        if (onBindingSelected) onBindingSelected(selectedBindingId);
        playback?.sync(selectedBindingId);
        refresh();
      }

      svg.setAttribute("class", "logic-data-flow-layer");
      svg.setAttribute("width", String(logic.layout.width));
      svg.setAttribute("height", String(logic.layout.height));
      svg.setAttribute("viewBox", "0 0 " + logic.layout.width + " " + logic.layout.height);
      svg.setAttribute("aria-hidden", "true");
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
      svg.append(traveler);

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
              "data-flow-playback-change"
            );
          }
          playbackHighlightedElements.clear();
          const record = findFunctionLogicPlaybackPath(playbackPathByKey, selectedBindingId, previous, frame);
          activePlaybackPath?.classList.remove("playback-active");
          activePlaybackPath = record?.path;
          if (record) record.path.classList.add("playback-active");
          cancelTravelerMotion();
          if (frame?.block?.id && playbackState.phase !== "transition") {
            const current = nodeButtonsById.get(frame.block.id);
            current?.classList.add("data-flow-playback-current");
            if (current) playbackHighlightedElements.add(current);
            if (frame.type === "change" || frame.type === "unknown") {
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
          }
        },
        onTransition(frame, previous, _activeIndex, _frameCount, progress, playbackState) {
          const record = findFunctionLogicPlaybackPath(playbackPathByKey, selectedBindingId, previous, frame);
          if (!record || !isFunctionLogicPlaybackPathVisible(record.path)) {
            return;
          }
          renderFunctionLogicValueFlowTravelerProgress(
            traveler, travelerBody, travelerLabel, record.path, frame, progress,
            playbackState.direction, travelerSamplesByPath
          );
        },
        onCancel() {
          cancelTravelerMotion();
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
        lastArrivedFrame = undefined;
        playback?.sync(selectedBindingId);
      }

      return {
        svg: flowHops.length > 0 ? svg : undefined,
        toolbar: bindings.length > 0 ? toolbar : undefined,
        playback: bindings.length > 0 ? playback.element : undefined,
        valuePreviewEditor: valuePreviewRendering.element,
        scenarioTrace: scenarioTraceRendering.element,
        refresh,
        /** Delegates an explicit Guide → Values handoff to the editor surface. */
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
          playback?.dispose();
          cancelTravelerMotion();
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
        }
      };
    }

    /** Returns the one exact existing lexical hop for two adjacent Scenario frames. */
    function findFunctionLogicPlaybackPath(pathByKey, bindingId, previous, frame) {
      if (!previous?.block?.id || !frame?.block?.id || previous.block.id === frame.block.id) return undefined;
      const candidate = pathByKey.get(bindingId + "::" + previous.block.id + "→" + frame.block.id);
      return candidate && !candidate.path.classList.contains("choice-dimmed") ? candidate : undefined;
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

    /** Lazily samples exactly 32 points once per immutable SVG path; frames only choose a cached slot. */
    function renderFunctionLogicValueFlowTravelerProgress(traveler, body, label, path, frame, progress, direction, cache) {
      let entry = cache.get(path);
      if (!entry) {
        if (typeof path.getTotalLength !== "function" || typeof path.getPointAtLength !== "function") return;
        const length = path.getTotalLength();
        if (!Number.isFinite(length) || length <= 0) return;
        const points = [];
        for (let index = 0; index < 32; index += 1) points.push(path.getPointAtLength(length * index / 31));
        entry = { points, lastSlot: -1 };
        cache.set(path, entry);
      }
      const slot = Math.max(0, Math.min(31, Math.round((direction < 0 ? 1 - progress : progress) * 31)));
      if (entry.lastSlot === slot) return;
      entry.lastSlot = slot;
      const point = entry.points[slot];
      if (!point) return;
      setFunctionLogicValueFlowTravelerLabel(body, label, frame);
      traveler.hidden = false;
      traveler.setAttribute("transform", "translate(" + point.x + " " + point.y + ")");
    }

    /** Falls back to discrete arrival when the exact path cannot currently be seen. */
    function isFunctionLogicPlaybackPathVisible(path) {
      if (document.hidden || path.isConnected === false) return false;
      if (typeof path.getBoundingClientRect !== "function") return true;
      const box = path.getBoundingClientRect();
      return !box || box.width > 0 || box.height > 0;
    }

    /** Keeps the graph token compact while the playback status preserves the full value. */
    function setFunctionLogicValueFlowTravelerLabel(body, label, frame) {
      const tokenText = (frame.binding?.name || projectAnalyzerText("value-token-fallback"))
        + " = " + (frame.carriedValue || projectAnalyzerText("value-token-unknown"));
      const compact = tokenText.length > 26 ? tokenText.slice(0, 25) + "…" : tokenText;
      if (label) label.textContent = compact;
      if (body) {
        const width = Math.max(42, compact.length * 5.6 + 12);
        body.setAttribute("x", String(-width / 2));
        body.setAttribute("y", "-9");
        body.setAttribute("width", String(width));
        body.setAttribute("height", "18");
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
