/**
 * Browser rendering fragment for the bounded Function Logic graph. It draws
 * Host-positioned nodes and routed control edges, then keeps full statement
 * evidence in a keyboard-accessible selection panel. Optional graph contexts
 * let the editor tab attach multiple function fragments to one graph canvas.
 */

import { getFunctionLogicCompoundGroupBrowserSource } from "./functionLogicCompoundGroupBrowserSource";

/** Returns browser functions for rendering the function-local control graph. */
export function getFunctionLogicBrowserSource(): string {
  return /* js */ `
    const LOGIC_SVG_NAMESPACE = "http://www.w3.org/2000/svg";

    ${getFunctionLogicCompoundGroupBrowserSource()}

    /** Renders the function signature, graph canvas, legend, and node details. */
    function renderFunctionLogic(logic, graphContext) {
      elements.flowSteps.append(createFunctionUnderstanding(logic));
      const signature = createLogicSignature(logic.signature);
      elements.flowSteps.append(signature);
      const callees = createLogicCalleeExplorer(
        logic.callees || [],
        logic.omittedCalleeCount || 0
      );
      if (callees) elements.flowSteps.append(callees);

      if (logic.blocks.length === 0 || logic.layout.nodes.length === 0) {
        const empty = document.createElement("div");
        empty.className = "flow-empty";
        empty.textContent = "No function-body graph is available for this source.";
        elements.flowSteps.append(empty);
        return;
      }

      const graphRendering = createFunctionLogicGraph(logic, graphContext);
      elements.flowSteps.append(graphRendering.element);
      if (graphContext && graphContext.onGraphRendered) {
        graphContext.onGraphRendered(graphRendering);
      }
    }

    /** Builds one independently selectable and zoomable function graph surface. */
    function createFunctionLogicGraph(logic, graphContext) {
      const blocksById = new Map(logic.blocks.map((block) => [block.id, block]));
      const edgesById = new Map(logic.edges.map((edge) => [edge.id, edge]));
      const outgoingBySourceId = createOutgoingLogicEdgeIndex(logic.edges);
      const connectedEdgeIdsByBlockId = createConnectedLogicEdgeIndex(logic.edges);
      const nodeLayoutsByBlockId = new Map(
        logic.layout.nodes.map((nodeLayout) => [nodeLayout.blockId, nodeLayout])
      );
      const compoundGroups = createLogicCompoundGroups(
        logic.blocks,
        nodeLayoutsByBlockId
      );
      const compoundOwnerIds = new Set(
        compoundGroups.map((group) => group.ownerBlockId)
      );
      const graph = document.createElement("section");
      const viewport = document.createElement("div");
      const stage = document.createElement("div");
      const canvas = document.createElement("div");
      const edgeRendering = createLogicEdgeSvg(logic.layout, edgesById, graphContext);
      const compoundGroupLayer = createLogicCompoundGroupLayer(
        compoundGroups,
        blocksById
      );
      const detailPanel = document.createElement("section");
      const nodeButtonsById = new Map();
      const readScale = graphContext && graphContext.readScale
        ? graphContext.readScale
        : () => state.logicGraphScale;
      const writeScale = graphContext && graphContext.writeScale
        ? graphContext.writeScale
        : (value) => { state.logicGraphScale = value; };
      const applyScale = () => applyLogicGraphScale(
        stage,
        canvas,
        logic.layout,
        readScale()
      );
      const hasRenderFlow = logic.blocks.some((block) =>
        block.kind === "render" || block.kind === "event"
      );
      const hasValueFlow = logic.blocks.some((block) =>
        block.valueChanges && block.valueChanges.length > 0
      );
      const graphHeader = createLogicGraphHeader(
        applyScale,
        readScale,
        writeScale,
        graphContext?.graphTitle || (hasRenderFlow
          ? (hasValueFlow ? "Control, render & value flow" : "Control & JSX render flow")
          : (hasValueFlow ? "Control & value flow" : "Control paths"))
      );

      graph.className = "logic-graph";
      viewport.className = "logic-graph-viewport";
      viewport.setAttribute("role", "region");
      viewport.setAttribute("aria-label", hasRenderFlow
        ? "Function control and JSX render-flow graph"
        : "Function control-flow graph");
      viewport.tabIndex = 0;
      stage.className = "logic-graph-stage";
      canvas.className = "logic-graph-canvas";
      canvas.style.setProperty("width", logic.layout.width + "px");
      canvas.style.setProperty("height", logic.layout.height + "px");
      detailPanel.className = "logic-selection";
      detailPanel.setAttribute("aria-live", "polite");
      canvas.append(compoundGroupLayer, edgeRendering.svg);

      for (const nodeLayout of logic.layout.nodes) {
        const block = blocksById.get(nodeLayout.blockId);
        if (!block) continue;
        const node = createLogicGraphNode(
          block,
          nodeLayout,
          outgoingBySourceId.get(block.id) || [],
          blocksById,
          graphContext,
          compoundOwnerIds.has(block.id)
        );
        node.addEventListener("click", () => {
          selectLogicGraphNode(
            block.id,
            nodeButtonsById,
            blocksById,
            outgoingBySourceId,
            connectedEdgeIdsByBlockId,
            edgeRendering.elementsById,
            detailPanel,
            true,
            graphContext
          );
          if (block.drillTargets && block.drillTargets.length > 0
            && graphContext && graphContext.onExpandableBlockClick) {
            graphContext.onExpandableBlockClick(block);
          }
        });
        nodeButtonsById.set(block.id, node);
        canvas.append(node);
      }

      applyScale();
      stage.append(canvas);
      viewport.append(stage);
      graph.append(graphHeader, viewport, detailPanel);

      const preferredBlock = blocksById.get(
        graphContext ? graphContext.selectedBlockId : state.selectedLogicBlockId
      )
        || logic.blocks.find((block) => ["condition", "loop", "switch"].includes(block.kind))
        || logic.blocks[0];
      selectLogicGraphNode(
        preferredBlock.id,
        nodeButtonsById,
        blocksById,
        outgoingBySourceId,
        connectedEdgeIdsByBlockId,
        edgeRendering.elementsById,
        detailPanel,
        false,
        graphContext
      );
      return {
        element: graph,
        viewport,
        nodeButtonsById,
        nodeLayoutsByBlockId
      };
    }

    /** Creates the compact current-function header above the graph. */
    function createLogicSignature(signatureText) {
      const signature = document.createElement("div");
      const signatureLabel = document.createElement("span");
      const signatureCode = document.createElement("code");
      signature.className = "logic-signature";
      signatureLabel.textContent = "FUNCTION";
      signatureCode.textContent = signatureText;
      signature.append(signatureLabel, signatureCode);
      return signature;
    }

    /** Turns raw counters into a repeatable four-pass function reading frame. */
    function createFunctionUnderstanding(logic) {
      const summary = logic.summary;
      const section = document.createElement("section");
      const header = document.createElement("div");
      const kicker = document.createElement("span");
      const title = document.createElement("strong");
      const cards = document.createElement("div");
      section.className = "logic-understanding";
      header.className = "logic-understanding-header";
      kicker.textContent = "HOW TO READ IT";
      title.textContent = "Understand this function in four passes";
      cards.className = "logic-understanding-cards";
      header.append(kicker, title);
      cards.append(
        createUnderstandingCard("1", "Start", "Read the signature, then find the first source-backed block."),
        createUnderstandingCard("2", "Choose", createDecisionUnderstanding(summary)),
        createUnderstandingCard("3", "Do", createActionUnderstanding(summary, logic.blocks)),
        createUnderstandingCard("4", "Finish", summary.exitCount
          ? summary.exitCount + " explicit finish point" + plural(summary.exitCount)
            + (summary.exitCount === 1 ? " is visible." : " are visible.")
          : "Follow the final transfer to see how control leaves the function.")
      );
      section.append(header, cards);
      return section;
    }

    /** Creates one numbered reading cue backed by function-logic counters. */
    function createUnderstandingCard(number, label, detailText) {
      const card = document.createElement("article");
      const numberBadge = document.createElement("span");
      const content = document.createElement("div");
      const title = document.createElement("strong");
      const detail = document.createElement("p");
      card.className = "logic-understanding-card";
      numberBadge.className = "logic-understanding-number";
      numberBadge.textContent = number;
      title.textContent = label;
      detail.textContent = detailText;
      content.append(title, detail);
      card.append(numberBadge, content);
      return card;
    }

    /** Describes only decision structures visible in the bounded syntax graph. */
    function createDecisionUnderstanding(summary) {
      const parts = [];
      if (summary.branchCount) parts.push(
        summary.branchCount + " branch decision" + plural(summary.branchCount)
      );
      if (summary.loopCount) parts.push(summary.loopCount + " loop" + plural(summary.loopCount));
      return parts.length
        ? parts.join(" and ") + " can change the path."
        : "No branch or loop is visible; read the main path from top to bottom.";
    }

    /** Describes visible work without guessing business purpose or runtime values. */
    function createActionUnderstanding(summary, blocks) {
      const parts = [];
      const renderCount = blocks.filter((block) => block.kind === "render").length;
      const eventCount = blocks.filter((block) => block.kind === "event").length;
      if (renderCount) parts.push(renderCount + " JSX render step" + plural(renderCount));
      if (eventCount) parts.push(eventCount + " event binding" + plural(eventCount));
      if (summary.callCount) parts.push(summary.callCount + " call site" + plural(summary.callCount));
      if (summary.effectCount) parts.push(summary.effectCount + " possible effect" + plural(summary.effectCount));
      if (summary.valueChangeCount) parts.push(
        summary.valueChangeCount + " visible value change" + plural(summary.valueChangeCount)
      );
      else if (summary.mutationCount) parts.push(
        summary.mutationCount + " mutation" + plural(summary.mutationCount)
      );
      return parts.length
        ? "Inspect " + parts.join(", ") + "."
        : "The visible blocks contain no classified render, call, effect, or mutation.";
    }

    /** Lists concrete direct callees so readers can expand only when useful. */
    function createLogicCalleeExplorer(targets, omittedCount) {
      if (targets.length === 0 && omittedCount === 0) return undefined;
      const section = document.createElement("section");
      const header = document.createElement("div");
      const text = document.createElement("div");
      const title = document.createElement("strong");
      const detail = document.createElement("p");
      const list = document.createElement("div");
      const renderTargetCount = targets.filter((target) => target.relation === "render").length;
      section.className = "logic-callees";
      header.className = "logic-callees-header";
      title.textContent = renderTargetCount > 0
        ? "Go deeper into called or rendered code"
        : "Go deeper into called functions";
      detail.textContent = "Open a statically resolved definition, then use the breadcrumb to return.";
      list.className = "logic-callee-list";
      text.append(title, detail);
      header.append(text, createBadge(
        targets.length + " child target" + plural(targets.length),
        "logic-callee-count"
      ));
      for (const target of targets) list.append(createDrillTargetButton(target));
      if (omittedCount > 0) {
        const omitted = document.createElement("small");
        omitted.className = "logic-callee-omitted";
        omitted.textContent = omittedCount + " additional concrete child target" + plural(omittedCount)
          + " omitted by the display limit.";
        list.append(omitted);
      }
      section.append(header, list);
      return section;
    }

    /** Creates one token-only direct-callee navigation or graph-attachment action. */
    function createDrillTargetButton(target, block, graphContext) {
      const button = document.createElement("button");
      const name = document.createElement("strong");
      const meta = document.createElement("span");
      const expandsInline = Boolean(
        block && graphContext && graphContext.onExpandableTargetClick
      );
      const expandedInline = Boolean(
        expandsInline && graphContext.isTargetExpanded
        && graphContext.isTargetExpanded(block.id, target)
      );
      const renderedComponent = target.relation === "render";
      button.type = "button";
      button.className = "logic-callee-button";
      button.classList.toggle("expanded", expandedInline);
      button.title = (expandedInline
        ? (renderedComponent ? "Collapse rendered component · " : "Collapse attached function · ")
        : expandsInline
          ? (renderedComponent ? "Attach rendered component · " : "Attach child function · ")
          : (renderedComponent ? "Open rendered component · " : "Open child function · "))
        + target.qualifiedName;
      name.textContent = target.qualifiedName || target.name;
      meta.textContent = [
        target.sourceLocation,
        target.confidence,
        target.callsiteCount + (renderedComponent ? " render site" : " callsite")
          + plural(target.callsiteCount)
      ].filter(Boolean).join(" · ");
      button.append(name, meta);
      button.addEventListener("click", () => {
        if (expandsInline) {
          graphContext.onExpandableTargetClick(block, target);
          return;
        }
        drillIntoFunction(target);
      });
      return button;
    }

    /** Creates graph semantics and confidence legend without color-only meaning. */
    function createLogicGraphHeader(applyScale, readScale, writeScale, graphTitle) {
      const header = document.createElement("div");
      const title = document.createElement("strong");
      const controls = document.createElement("div");
      const legend = document.createElement("div");
      const zoomOut = createLogicZoomButton(
        "−", "Zoom out function graph", -0.2, applyScale, readScale, writeScale
      );
      const zoomReset = createLogicZoomButton(
        "100%", "Reset function graph zoom", 0, applyScale, readScale, writeScale
      );
      const zoomIn = createLogicZoomButton(
        "+", "Zoom in function graph", 0.2, applyScale, readScale, writeScale
      );
      header.className = "logic-graph-header";
      title.textContent = graphTitle || "Control paths";
      controls.className = "logic-graph-controls";
      legend.className = "logic-graph-legend";
      legend.append(
        createBadge("solid · exact", "logic-legend exact"),
        createBadge("dashed · inferred", "logic-legend inferred"),
        createBadge("Δ value", "logic-legend value-change"),
        createBadge("↶ repeat", "logic-legend repeat")
      );
      controls.append(zoomOut, zoomReset, zoomIn);
      header.append(title, controls, legend);
      return header;
    }

    /** Creates one bounded graph zoom action without changing analyzer data. */
    function createLogicZoomButton(label, title, delta, applyScale, readScale, writeScale) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "logic-zoom-button";
      button.textContent = label;
      button.title = title;
      button.addEventListener("click", () => {
        const nextScale = delta === 0
          ? 1
          : Math.min(1.6, Math.max(0.5, readScale() + delta));
        writeScale(nextScale);
        applyScale();
      });
      return button;
    }

    /** Scales presentation while preserving the canvas's scrollable dimensions. */
    function applyLogicGraphScale(stage, canvas, layout, scale) {
      stage.style.setProperty("width", Math.round(layout.width * scale) + "px");
      stage.style.setProperty("height", Math.round(layout.height * scale) + "px");
      canvas.style.setProperty("transform", "scale(" + scale + ")");
    }

    /** Indexes outgoing edges for node accessibility and the detail panel. */
    function createOutgoingLogicEdgeIndex(edges) {
      const result = new Map();
      for (const edge of edges) {
        const values = result.get(edge.sourceId) || [];
        values.push(edge);
        result.set(edge.sourceId, values);
      }
      return result;
    }

    /** Indexes incoming and outgoing edges for selected-node graph emphasis. */
    function createConnectedLogicEdgeIndex(edges) {
      const result = new Map();
      for (const edge of edges) {
        for (const blockId of [edge.sourceId, edge.targetId]) {
          const values = result.get(blockId) || [];
          values.push(edge.id);
          result.set(blockId, values);
        }
      }
      return result;
    }

    /** Draws every routed edge and label behind the interactive HTML nodes. */
    function createLogicEdgeSvg(layout, edgesById, graphContext) {
      const svg = createLogicSvgElement("svg");
      const elementsById = new Map();
      svg.setAttribute("class", "logic-edge-layer");
      svg.setAttribute("width", String(layout.width));
      svg.setAttribute("height", String(layout.height));
      svg.setAttribute("viewBox", "0 0 " + layout.width + " " + layout.height);
      svg.setAttribute("aria-hidden", "true");
      svg.append(createLogicArrowMarker());

      for (const edgeLayout of layout.edges) {
        const edge = edgesById.get(edgeLayout.edgeId);
        if (!edge || edgeLayout.points.length < 2) continue;
        const path = createLogicSvgElement("path");
        const label = createLogicSvgElement("text");
        const entering = Boolean(
          graphContext && graphContext.isEdgeEntering
          && graphContext.isEdgeEntering(edge)
        );
        path.setAttribute("class", "logic-edge logic-edge-" + edge.kind
          + (edge.relation === "call" ? " logic-edge-call" : "")
          + (edge.relation === "callReturn" ? " logic-edge-call-return" : "")
          + (edge.confidence === "inferred" ? " inferred" : "")
          + (edgeLayout.route === "back" ? " back-edge" : "")
          + (edgeLayout.route === "long" ? " long-edge" : "")
          + (entering ? " logic-edge-entering" : ""));
        path.setAttribute("d", createLogicEdgePath(edgeLayout.points));
        path.setAttribute("marker-end", "url(#logic-graph-arrow)");
        label.setAttribute("class", "logic-edge-label logic-edge-label-" + edge.kind
          + (edge.relation === "call" ? " logic-edge-label-call" : "")
          + (edge.relation === "callReturn" ? " logic-edge-label-call-return" : "")
          + (entering ? " logic-edge-label-entering" : ""));
        label.setAttribute("x", String(edgeLayout.labelX));
        label.setAttribute("y", String(edgeLayout.labelY));
        if (edgeLayout.route !== "forward") label.setAttribute("text-anchor", "end");
        label.textContent = formatLogicEdge(edge);
        svg.append(path, label);
        elementsById.set(edge.id, { path, label });
      }
      return { svg, elementsById };
    }

    /** Creates one reusable arrow marker whose color follows each edge stroke. */
    function createLogicArrowMarker() {
      const defs = createLogicSvgElement("defs");
      const marker = createLogicSvgElement("marker");
      const arrow = createLogicSvgElement("path");
      marker.setAttribute("id", "logic-graph-arrow");
      marker.setAttribute("viewBox", "0 0 10 10");
      marker.setAttribute("refX", "9");
      marker.setAttribute("refY", "5");
      marker.setAttribute("markerWidth", "6");
      marker.setAttribute("markerHeight", "6");
      marker.setAttribute("orient", "auto-start-reverse");
      arrow.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
      arrow.setAttribute("class", "logic-arrow-head");
      marker.append(arrow);
      defs.append(marker);
      return defs;
    }

    /** Converts Host-routed points into an SVG polyline path. */
    function createLogicEdgePath(points) {
      return points.map((point, index) =>
        (index === 0 ? "M " : "L ") + point.x + " " + point.y
      ).join(" ");
    }

    /** Creates one positioned, keyboard-accessible control-flow graph node. */
    function createLogicGraphNode(
      block,
      layout,
      outgoing,
      blocksById,
      graphContext,
      ownsCompoundBody
    ) {
      const node = document.createElement("button");
      const top = document.createElement("span");
      const kind = createBadge(formatLogicKind(block.kind), "logic-kind " + block.kind);
      const branch = document.createElement("span");
      const label = document.createElement("strong");
      const meta = document.createElement("small");
      const valueChangeText = (block.valueChanges || []).map((change) =>
        formatLogicValueChange(change) + " (" + change.confidence + ")"
      ).join(", ");
      const outgoingText = outgoing.map((edge) => {
        const target = blocksById.get(edge.targetId);
        return formatLogicEdge(edge) + (target ? " to " + completeTargetLabel(target) : "");
      }).join(", ");
      const expandable = Boolean(block.drillTargets && block.drillTargets.length > 0);
      const rendersOnly = expandable && block.drillTargets.every((target) =>
        target.relation === "render"
      );
      const expanded = Boolean(
        expandable && graphContext && graphContext.isBlockExpanded
        && graphContext.isBlockExpanded(block.id)
      );
      const visualDepth = normalizeLogicVisualDepth(block.depth);
      const entering = Boolean(
        graphContext && graphContext.isBlockEntering
        && graphContext.isBlockEntering(block.id)
      );

      node.type = "button";
      node.className = "logic-graph-node logic-node-" + block.kind
        + " logic-depth-" + visualDepth
        + (ownsCompoundBody ? " logic-node-body-owner" : "")
        + (entering ? " logic-node-entering" : "");
      node.classList.toggle("expandable", expandable);
      node.classList.toggle("expanded", expanded);
      node.title = expandable && graphContext && graphContext.onExpandableBlockClick
        ? (rendersOnly
            ? (expanded ? "Collapse rendered component · " : "Expand rendered component · ")
            : (expanded ? "Collapse called function · " : "Expand called function · "))
          + block.drillTargets.map((target) => target.qualifiedName || target.name).join(", ")
        : "Select logic · " + block.label;
      node.style.setProperty("left", layout.x + "px");
      node.style.setProperty("top", layout.y + "px");
      node.style.setProperty("width", layout.width + "px");
      node.style.setProperty("height", layout.height + "px");
      if (entering) {
        node.style.setProperty(
          "--logic-enter-delay",
          Math.min(140, Math.max(0, Number(layout.rank) || 0) * 18) + "ms"
        );
      }
      node.setAttribute("aria-label", block.label
        + (valueChangeText ? ". Value changes: " + valueChangeText : "")
        + (outgoingText ? ". Paths: " + outgoingText : "")
        + (expandable && graphContext && graphContext.onExpandableBlockClick
          ? (expanded
              ? (rendersOnly
                  ? ". Activate to collapse rendered components."
                  : ". Activate to collapse called functions.")
              : (rendersOnly
                  ? ". Activate to attach rendered components."
                  : ". Activate to attach called functions."))
          : ""));
      node.setAttribute("aria-pressed", "false");
      if (expandable && graphContext && graphContext.onExpandableBlockClick) {
        node.setAttribute("aria-expanded", expanded ? "true" : "false");
      }
      top.className = "logic-node-top";
      branch.className = "logic-node-branch";
      branch.textContent = block.branchLabel || "";
      label.className = "logic-node-label";
      label.textContent = block.label;
      meta.className = "logic-node-meta";
      meta.textContent = block.sourceLocation || block.detail;
      top.append(kind);
      if (block.functionLabel) {
        top.append(createBadge(block.functionLabel, "logic-node-function"));
      }
      if (block.drillTargets && block.drillTargets.length > 0) {
        top.append(createBadge(
          block.drillTargets.length + " child" + plural(block.drillTargets.length),
          "logic-node-callee"
        ));
      }
      if (branch.textContent) top.append(branch);
      node.append(top, label);
      if (block.valueChanges && block.valueChanges.length > 0) {
        node.append(createLogicValueChangeList(block.valueChanges, "logic-node-value-changes"));
      }
      node.append(meta);
      return node;
    }

    /** Synchronizes graph selection and rebuilds the evidence detail panel. */
    function selectLogicGraphNode(
      blockId,
      nodeButtonsById,
      blocksById,
      outgoingBySourceId,
      connectedEdgeIdsByBlockId,
      edgeElementsById,
      detailPanel,
      moveFocus,
      graphContext
    ) {
      const selected = blocksById.get(blockId);
      if (!selected) return;
      if (graphContext && graphContext.onSelectionChanged) {
        graphContext.onSelectionChanged(blockId);
      } else {
        state.selectedLogicBlockId = blockId;
      }
      for (const [candidateId, button] of nodeButtonsById) {
        const active = candidateId === blockId;
        button.classList.toggle("selected", active);
        button.setAttribute("aria-pressed", active ? "true" : "false");
      }
      const connectedEdgeIds = new Set(connectedEdgeIdsByBlockId.get(blockId) || []);
      for (const [edgeId, edgeElements] of edgeElementsById) {
        const active = connectedEdgeIds.has(edgeId);
        edgeElements.path.classList.toggle("active", active);
        edgeElements.path.classList.toggle("dimmed", !active);
        edgeElements.label.classList.toggle("active", active);
        edgeElements.label.classList.toggle("dimmed", !active);
      }
      renderLogicSelection(
        selected,
        outgoingBySourceId.get(blockId) || [],
        blocksById,
        detailPanel,
        graphContext
      );
      if (moveFocus) nodeButtonsById.get(blockId)?.focus();
    }

    /** Shows complete source meaning and transfers for the selected graph node. */
    function renderLogicSelection(block, outgoing, blocksById, panel, graphContext) {
      clearElement(panel);
      const header = document.createElement("div");
      const name = document.createElement("strong");
      const confidence = createBadge(block.confidence, "confidence " + block.confidence);
      const detail = document.createElement("p");
      const meta = document.createElement("div");
      header.className = "logic-selection-header";
      name.textContent = block.label;
      detail.className = "logic-selection-detail";
      detail.textContent = block.detail;
      meta.className = "logic-selection-meta";
      meta.textContent = [block.branchLabel, block.sourceLocation].filter(Boolean).join(" · ");
      header.append(createBadge(formatLogicKind(block.kind), "logic-kind " + block.kind), name, confidence);
      panel.append(header, detail);
      if (meta.textContent) panel.append(meta);

      if (block.valueChanges && block.valueChanges.length > 0) {
        const changes = document.createElement("div");
        const title = document.createElement("strong");
        changes.className = "logic-selection-value-section";
        title.textContent = "Values changed here";
        changes.append(
          title,
          createLogicValueChangeList(block.valueChanges, "logic-selection-value-changes")
        );
        panel.append(changes);
      }

      if (outgoing.length > 0) {
        const transfers = document.createElement("div");
        transfers.className = "logic-selection-transfers";
        for (const edge of outgoing) {
          const target = blocksById.get(edge.targetId);
          transfers.append(createBadge(
            formatLogicEdge(edge) + (target ? " → " + completeTargetLabel(target) : ""),
            "logic-transfer " + edge.kind
              + (edge.relation ? " " + edge.relation : "")
              + (edge.confidence === "inferred" ? " inferred" : "")
          ));
        }
        panel.append(transfers);
      }

      if (block.drillTargets && block.drillTargets.length > 0) {
        const callees = document.createElement("div");
        const title = document.createElement("strong");
        callees.className = "logic-selection-callees";
        title.textContent = block.drillTargets.some((target) => target.relation === "render")
          ? "Continue into rendered or called code"
          : "Continue into called code";
        callees.append(title);
        for (const target of block.drillTargets) {
          callees.append(createDrillTargetButton(target, block, graphContext));
        }
        panel.append(callees);
      }

      if (block.evidenceToken) {
        const source = document.createElement("button");
        source.type = "button";
        source.className = "logic-button logic-open-statement";
        source.textContent = "Open statement";
        source.title = "Open statement" + (block.sourceLocation ? " · " + block.sourceLocation : "");
        source.addEventListener("click", () => openLogicEvidence(block.evidenceToken));
        panel.append(source);
      }
    }

    /** Creates SVG nodes without interpolating Host text into markup. */
    function createLogicSvgElement(name) {
      return document.createElementNS(LOGIC_SVG_NAMESPACE, name);
    }

    /** Reveals one Host-approved source range without sending paths or offsets. */
    function openLogicEvidence(evidenceToken) {
      if (!state.graph) return;
      vscode.postMessage({
        type: "codeFlow/openEvidence",
        payload: { graphVersion: state.graph.version, evidenceToken }
      });
      elements.status.textContent = "Statement opened for verification";
    }

    /** Formats concise statement-role labels for graph nodes. */
    function formatLogicKind(kind) {
      if (kind === "entry") return "START";
      if (kind === "exit") return "END";
      if (kind === "condition") return "IF";
      if (kind === "render") return "JSX";
      if (kind === "event") return "EVENT";
      if (kind === "mutation") return "STATE";
      return kind;
    }

    /** Builds exact/inferred value rows shared by graph nodes and selection details. */
    function createLogicValueChangeList(changes, className) {
      const list = document.createElement("span");
      list.className = className;
      for (const change of changes) {
        const row = document.createElement("span");
        const kind = document.createElement("span");
        const value = document.createElement("code");
        row.className = "logic-value-change " + change.confidence;
        row.title = change.confidence === "exact"
          ? "Source syntax proves this value change"
          : "The receiver may change; verify the called method";
        kind.className = "logic-value-target-kind";
        kind.textContent = formatLogicValueTargetKind(change.targetKind)
          + (change.confidence === "inferred" ? " · MAY CHANGE" : " · CHANGES");
        value.textContent = formatLogicValueChange(change);
        row.append(kind, value);
        list.append(row);
      }
      return list;
    }

    /** Formats one value transition without claiming a runtime value. */
    function formatLogicValueChange(change) {
      return change.target + " " + change.operator
        + (change.value ? " " + change.value : "");
    }

    /** Keeps graph target categories compact but textually distinguishable. */
    function formatLogicValueTargetKind(kind) {
      if (kind === "receiver") return "RECEIVER";
      if (kind === "property") return "FIELD";
      return "VAR";
    }

    /** Maps arbitrary analyzer nesting onto a small, stable visual tint scale. */
    function normalizeLogicVisualDepth(depth) {
      const value = Number(depth);
      return Number.isFinite(value)
        ? Math.min(5, Math.max(0, Math.floor(value)))
        : 0;
    }

    /** Keeps edge semantics explicit instead of implying observed execution. */
    function formatLogicEdge(edge) {
      if (edge.label) return edge.label;
      if (edge.kind === "next") return "then";
      if (edge.kind === "iterate") return "enter loop";
      if (edge.kind === "exit") return "leave";
      return edge.kind;
    }

    /** Creates a complete target hint for accessibility and transfer details. */
    function completeTargetLabel(block) {
      if (block.kind === "exit") return "END";
      if (block.kind === "entry") return "START";
      return block.label || block.kind;
    }

    /** Summarizes internal logic rather than call-graph size. */
    function createFunctionLogicSummaryText(logic) {
      const summary = logic.summary;
      const parts = [summary.blockCount + " logic block" + plural(summary.blockCount)];
      if (summary.branchCount) parts.push(summary.branchCount + " branch" + plural(summary.branchCount));
      if (summary.loopCount) parts.push(summary.loopCount + " loop" + plural(summary.loopCount));
      const renderCount = logic.blocks.filter((block) => block.kind === "render").length;
      const eventCount = logic.blocks.filter((block) => block.kind === "event").length;
      if (renderCount) parts.push(renderCount + " JSX step" + plural(renderCount));
      if (eventCount) parts.push(eventCount + " event binding" + plural(eventCount));
      if (summary.effectCount) parts.push(summary.effectCount + " possible effect" + plural(summary.effectCount));
      if (summary.valueChangeCount) parts.push(
        summary.valueChangeCount + " value change" + plural(summary.valueChangeCount)
      );
      else if (summary.mutationCount) parts.push(
        summary.mutationCount + " mutation" + plural(summary.mutationCount)
      );
      return parts.join(" · ");
    }
  `;
}
