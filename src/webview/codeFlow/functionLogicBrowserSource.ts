/**
 * Browser rendering fragment for the bounded Function Logic graph. It draws
 * Host-positioned nodes and routed control edges, then keeps full statement
 * evidence in a keyboard-accessible inspector drawer. Optional graph contexts
 * let the editor tab attach multiple function fragments to one graph canvas.
 */
import { getFunctionLogicCompoundGroupBrowserSource } from "./functionLogicCompoundGroupBrowserSource";
import { getFunctionLogicDrillBrowserSource } from "./functionLogicDrillBrowserSource";
import { getFunctionLogicBranchChoicesBrowserSource } from "./branchChoices";
import { getFunctionLogicBodyFocusBrowserSource } from "./bodyFocus";
import { getFunctionLogicDataFlowBrowserSource } from "./dataFlow";
import { getFunctionLogicInspectorBrowserSource } from "./inspector";
import { getFunctionLogicSelectionBrowserSource } from "./functionLogicSelectionBrowserSource";
import { getFunctionLogicComprehensionBrowserSource } from "./comprehension";
import { getFunctionLogicGraphHeaderBrowserSource } from "./presentation";
import { getCodeSnippetBrowserSource } from "../codePresentation";
import {
  getFunctionLogicScenarioEvaluatorBrowserSource,
  getFunctionLogicScenarioTraceBrowserSource,
  getFunctionLogicValuePreviewBrowserSource
} from "./valuePreview";
import { getFunctionLogicViewportBrowserSource } from "./viewport";
import { getFunctionTutorBrowserSource, getFunctionTutorIntegrationBrowserSource } from "./tutor";
/** Returns browser functions for rendering the function-local control graph. */
export function getFunctionLogicBrowserSource(): string {
  return /* js */ `
    const LOGIC_SVG_NAMESPACE = "http://www.w3.org/2000/svg";

    ${getCodeSnippetBrowserSource()}
    ${getFunctionLogicCompoundGroupBrowserSource()}
    ${getFunctionLogicBodyFocusBrowserSource()}
    ${getFunctionLogicDrillBrowserSource()}
    ${getFunctionLogicBranchChoicesBrowserSource()}
    ${getFunctionLogicValuePreviewBrowserSource()}
    ${getFunctionLogicScenarioEvaluatorBrowserSource()}
    ${getFunctionLogicScenarioTraceBrowserSource()}
    ${getFunctionLogicDataFlowBrowserSource()}
    ${getFunctionLogicInspectorBrowserSource()}
    ${getFunctionLogicSelectionBrowserSource()}
    ${getFunctionLogicComprehensionBrowserSource()}
    ${getFunctionLogicGraphHeaderBrowserSource()}
    ${getFunctionLogicViewportBrowserSource()}
    ${getFunctionTutorBrowserSource()}
    ${getFunctionTutorIntegrationBrowserSource()}
    /** Disposes the active viewport controller before its graph DOM is removed. */
    function disposeActiveFunctionLogicViewport() {
      state.activeLogicGraphRendering = undefined;
      state.activeLogicValueFlowRendering?.dispose?.();
      state.activeLogicValueFlowRendering = undefined;
      if (!state.activeLogicViewportController) return;
      state.activeLogicViewportController.dispose();
      state.activeLogicViewportController = undefined;
    }
    /** Renders one graph-first surface with supporting UI inside its drawer. */
    function renderFunctionLogic(logic, graphContext) {
      disposeActiveFunctionLogicViewport();
      if (logic.blocks.length === 0 || logic.layout.nodes.length === 0) {
        const empty = document.createElement("div");
        empty.className = "flow-empty";
        empty.textContent = projectAnalyzerText("no-function-body");
        elements.flowSteps.append(empty);
        state.activeLogicGraphRendering = { updateLanguage() { empty.textContent = projectAnalyzerText("no-function-body"); } };
        return;
      }

      const graphRendering = createFunctionLogicGraph(logic, graphContext);
      elements.flowSteps.append(graphRendering.element);
      graphRendering.activateViewport();
      state.activeLogicViewportController = graphRendering.viewportController;
      state.activeLogicValueFlowRendering = graphRendering.valueFlowRendering;
      state.activeLogicGraphRendering = graphRendering;
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
      const nodeButtonsById = new Map();
      const rootBlock = logic.blocks.find((block) => block.kind === "entry") || logic.blocks[0];
      const choiceSessionKey = (state.graph?.version || "graph") + "::" + rootBlock.id;
      const bodyFocusController = createFunctionLogicBodyFocusController({
        sessionKey: choiceSessionKey,
        blocks: logic.blocks,
        groups: compoundGroups,
        blocksById,
        nodeButtonsById
      });
      let selectionGraphContext = {
        ...(graphContext || {}),
        isBodyOwner: (blockId) => compoundOwnerIds.has(blockId),
        focusBody: (blockId) => bodyFocusController.focus(blockId)
      };
      const hasValueFlow = (logic.valueBindings || []).length > 0;
      // Scenario Variables are an invariant Inspector surface. It must remain
      // discoverable even when analyzer-backed value bindings are incomplete.
      const inspector = createFunctionLogicInspector(choiceSessionKey);
      let branchChoices = readFunctionLogicBranchChoices(choiceSessionKey, logic.edges);
      let edgeRendering;
      let valueFlowRendering;
      const applyBranchChoice = (edge) => {
        branchChoices = edge
          ? toggleFunctionLogicBranchChoiceSession(choiceSessionKey, logic.edges, edge)
          : clearFunctionLogicBranchChoiceSession(choiceSessionKey);
        applyFunctionLogicBranchChoicePresentation(
          logic.blocks,
          logic.edges,
          branchChoices,
          nodeButtonsById,
          edgeRendering.elementsById
        );
        if (valueFlowRendering) valueFlowRendering.resetPlayback();
        const selectedBlockId = edge?.sourceId || state.selectedLogicBlockId || rootBlock.id;
        selectLogicGraphNode(
          selectedBlockId,
          nodeButtonsById,
          blocksById,
          outgoingBySourceId,
          connectedEdgeIdsByBlockId,
          edgeRendering.elementsById,
          inspector,
          false,
          selectionGraphContext,
          applyBranchChoice,
          applyConditionCase,
          branchChoices
        );
      };
      /** Applies one table row's short-circuit decisions as a coherent scenario. */
      const applyConditionCase = (row, sourceBlockId) => {
        branchChoices = toggleFunctionLogicBranchChoiceCaseSession(
          choiceSessionKey,
          logic.edges,
          row.choiceEdgeIds
        );
        applyFunctionLogicBranchChoicePresentation(
          logic.blocks,
          logic.edges,
          branchChoices,
          nodeButtonsById,
          edgeRendering.elementsById
        );
        if (valueFlowRendering) valueFlowRendering.resetPlayback();
        selectLogicGraphNode(
          sourceBlockId || row.targetBlockId,
          nodeButtonsById,
          blocksById,
          outgoingBySourceId,
          connectedEdgeIdsByBlockId,
          edgeRendering.elementsById,
          inspector,
          false,
          selectionGraphContext,
          applyBranchChoice,
          applyConditionCase,
          branchChoices
        );
      };
      edgeRendering = createLogicEdgeSvg(
        logic.layout,
        edgesById,
        graphContext,
        applyBranchChoice
      );
      const edgeChoiceLayer = createLogicEdgeChoiceLayer(
        logic.layout,
        edgesById,
        edgeRendering.elementsById,
        applyBranchChoice
      );
      const comprehension = createFunctionLogicComprehensionController(
        choiceSessionKey, logic, nodeButtonsById, edgeRendering.elementsById);
      selectionGraphContext = {
        ...selectionGraphContext,
        focusEmbedded: (boundaryId) => comprehension.setEmbeddedFocus(boundaryId),
        isEmbeddedFocused: (boundaryId) =>
          comprehension.getState().embeddedFocusBoundaryId === boundaryId
      };
      /** Keeps mouse and keyboard graph activation on the same selection path. */
      const activateLogicBlock = (blockId, moveFocus) => {
        selectLogicGraphNode(
          blockId,
          nodeButtonsById,
          blocksById,
          outgoingBySourceId,
          connectedEdgeIdsByBlockId,
          edgeRendering.elementsById,
          inspector,
          moveFocus,
          selectionGraphContext,
          applyBranchChoice,
          applyConditionCase,
          branchChoices
        );
      };
      comprehension.setNodeActivation(activateLogicBlock);
      comprehension.subscribe((readerState) => inspector.setLens(readerState.lens)); inspector.setLens(comprehension.getState().lens);
      valueFlowRendering = createFunctionLogicValueFlowRendering(
        logic,
        nodeLayoutsByBlockId,
        nodeButtonsById,
        edgeRendering.elementsById,
        choiceSessionKey,
        (bindingId) => {
          comprehension.setLens("values");
          comprehension.selectBinding(bindingId || undefined);
        }
      );
      const readTransform = graphContext && graphContext.readViewportTransform
        ? graphContext.readViewportTransform
        : () => state.logicGraphViewportTransform;
      const writeTransform = graphContext && graphContext.writeViewportTransform
        ? graphContext.writeViewportTransform
        : (value) => {
            state.logicGraphViewportTransform = value;
            state.logicGraphScale = value.scale;
          };
      const viewportController = createFunctionLogicViewportController({
        viewport,
        stage,
        canvas,
        layout: logic.layout,
        readTransform,
        writeTransform
      });
      const tutorRendering = createFunctionTutorIntegration(
        logic, comprehension, valueFlowRendering, viewportController, inspector);
      const hasJsxFlow = logic.blocks.some((block) => block.kind === "render");
      const hasEventFlow = logic.blocks.some((block) => block.kind === "event");
      const hasRenderFlow = hasJsxFlow || hasEventFlow;
      const hasValueChanges = logic.blocks.some((block) =>
        block.valueChanges && block.valueChanges.length > 0
      );
      const graphTitle = () => graphContext?.graphTitle
        ? (typeof graphContext.graphTitle === "function" ? graphContext.graphTitle() : graphContext.graphTitle)
        : (hasRenderFlow
          ? (hasValueFlow || hasValueChanges
              ? projectAnalyzerText("graph-control-render-event-value")
              : hasJsxFlow && hasEventFlow
                ? projectAnalyzerText("graph-control-jsx-event")
                : hasJsxFlow ? projectAnalyzerText("graph-control-jsx") : projectAnalyzerText("graph-control-event"))
          : (hasValueFlow || hasValueChanges ? projectAnalyzerText("control-value-flow") : projectAnalyzerText("control-paths")));
      const graphHeader = createLogicGraphHeader(
        viewportController,
        inspector.toggle,
        createFunctionLogicLensToolbar(comprehension),
        createFunctionLogicLensLegend(comprehension),
        graphTitle,
        tutorRendering?.toggle
      );
      graph.className = "logic-graph";
      viewport.className = "logic-graph-viewport";
      viewport.setAttribute("role", "region");
      const graphSemantics = [projectAnalyzerText("function-control")];
      if (hasJsxFlow) graphSemantics.push(projectAnalyzerText("jsx-render"));
      if (hasEventFlow) graphSemantics.push(projectAnalyzerText("event-boundaries"));
      if (hasValueFlow) graphSemantics.push(projectAnalyzerText("value-flow"));
      viewport.setAttribute("aria-label", graphSemantics.join(", ") + " " + projectAnalyzerText("graph"));
      viewport.setAttribute("aria-keyshortcuts", "+ - 0 C F");
      viewport.title = projectAnalyzerText("drag-to-pan");
      viewport.tabIndex = 0;
      stage.className = "logic-graph-stage";
      canvas.className = "logic-graph-canvas";
      canvas.style.setProperty("width", logic.layout.width + "px");
      canvas.style.setProperty("height", logic.layout.height + "px");
      canvas.append(bodyFocusController.layer, edgeRendering.svg);
      if (valueFlowRendering?.svg) canvas.append(valueFlowRendering.svg);
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
          comprehension.activateBlock(block.id, true);
          // Opening source is deliberately an Inspector-only action. Selecting
          // a graph node must preserve the reader's current editor and canvas.
          // Child attachment is intentionally available only from the
          // Inspector's named Attach/Collapse actions. A primary node click
          // remains a predictable selection operation.
        });
        nodeButtonsById.set(block.id, node);
        comprehension.registerNode(block.id, node);
        canvas.append(node);
      }
      canvas.append(edgeChoiceLayer);
      bodyFocusController.refresh();
      comprehension.refresh();
      applyFunctionLogicBranchChoicePresentation(
        logic.blocks,
        logic.edges,
        branchChoices,
        nodeButtonsById,
        edgeRendering.elementsById
      );
      if (valueFlowRendering) valueFlowRendering.refresh();
      stage.append(canvas);
      viewport.append(stage);
      inspector.attachViewport(viewport);
      inspector.registerGuide(tutorRendering);
      const staticLedger = createFunctionLogicStaticFlowLedger(logic, comprehension);
      const calleeExplorer = createLogicCalleeExplorer(logic.callees || [], logic.omittedCalleeCount || 0);
      const signature = createLogicSignature(logic.signature);
      inspector.appendSections(
        valueFlowRendering?.valuePreviewEditor,
        valueFlowRendering?.scenarioTrace,
        valueFlowRendering?.playback,
        valueFlowRendering?.toolbar,
        staticLedger,
        calleeExplorer,
        signature
      );
      graph.append(graphHeader);
      graph.append(bodyFocusController.navigation);
      graph.append(inspector.workspace);

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
        inspector,
        false,
        selectionGraphContext,
        applyBranchChoice,
        applyConditionCase,
        branchChoices
      );
      comprehension.selectBlock(preferredBlock.id);
      return {
        element: graph,
        viewport,
        viewportController,
        activateViewport: viewportController.initialize,
        nodeButtonsById,
        nodeLayoutsByBlockId,
        valueFlowRendering,
        /** Rewrites retained locale copy without rebuilding graph geometry or state. */
        updateLanguage(language) {
          edgeRendering.svg.setAttribute("aria-label", projectAnalyzerText("control-paths"));
          edgeChoiceLayer.setAttribute("aria-label", projectAnalyzerText("branch-choices"));
          const semantics = [projectAnalyzerText("function-control")];
          if (hasJsxFlow) semantics.push(projectAnalyzerText("jsx-render"));
          if (hasEventFlow) semantics.push(projectAnalyzerText("event-boundaries"));
          if (hasValueFlow) semantics.push(projectAnalyzerText("value-flow"));
          viewport.setAttribute("aria-label", semantics.join(", ") + " " + projectAnalyzerText("graph"));
          viewport.title = projectAnalyzerText("drag-to-pan");
          for (const edge of logic.edges) {
            const rendered = edgeRendering.elementsById.get(edge.id);
            if (!rendered) continue;
            const label = formatLogicEdge(edge);
            rendered.label.textContent = label;
            if (rendered.choiceButton) {
              rendered.choiceButton.textContent = label;
              rendered.choiceButton.title = projectAnalyzerText("choose-path", { label: label });
            }
          }
          for (const [blockId, button] of nodeButtonsById) {
            const block = blocksById.get(blockId);
            if (!block) continue;
            button.refreshLanguage?.();
          }
          valueFlowRendering?.updateLanguage(language);
          bodyFocusController.refresh();
          graphHeader.refreshLanguage?.();
          signature.refreshLanguage?.();
          calleeExplorer?.refreshLanguage?.();
          inspector.refreshLanguage?.();
          comprehension.refreshLanguage?.();
          viewportController.refreshLanguage?.();
          const retainedSelection = blocksById.get(state.selectedLogicBlockId || preferredBlock.id);
          if (retainedSelection) {
            renderLogicSelection(retainedSelection, outgoingBySourceId.get(retainedSelection.id) || [], blocksById, inspector.selectionPanel, selectionGraphContext, applyBranchChoice, applyConditionCase, branchChoices);
            inspector.setSelection(retainedSelection);
          }
          // Do not select again: selection can focus the drawer and changes no
          // graph state, but this locale pass must be completely side-effect free.
        }
      };
    }
    /** Creates the compact current-function header above the graph. */
    function createLogicSignature(signatureText) {
      const signature = document.createElement("div");
      const signatureLabel = document.createElement("span");
      const signatureCode = document.createElement("code");
      signature.className = "logic-signature";
      signatureLabel.textContent = projectAnalyzerText("function-signature");
      signatureCode.textContent = signatureText;
      signature.append(signatureLabel, signatureCode);
      signature.refreshLanguage = () => { signatureLabel.textContent = projectAnalyzerText("function-signature"); };
      return signature;
    }

    /** Draws every routed edge and label behind the interactive HTML nodes. */
    function createLogicEdgeSvg(layout, edgesById, graphContext, onBranchChoice) {
      const svg = createLogicSvgElement("svg");
      const elementsById = new Map();
      svg.setAttribute("class", "logic-edge-layer");
      svg.setAttribute("width", String(layout.width));
      svg.setAttribute("height", String(layout.height));
      svg.setAttribute("viewBox", "0 0 " + layout.width + " " + layout.height);
      svg.setAttribute("role", "group");
      svg.setAttribute("aria-label", projectAnalyzerText("control-paths"));
      svg.append(createLogicArrowMarker());

      for (const edgeLayout of layout.edges) {
        const edge = edgesById.get(edgeLayout.edgeId);
        if (!edge || edgeLayout.points.length < 2) continue;
        const path = createLogicSvgElement("path");
        const label = createLogicSvgElement("text");
        const choice = isFunctionLogicBranchChoiceEdge(edge);
        const entering = Boolean(
          graphContext && graphContext.isEdgeEntering
          && graphContext.isEdgeEntering(edge)
        );
        path.setAttribute("class", "logic-edge logic-edge-" + edge.kind
          + (edge.relation === "call" ? " logic-edge-call" : "")
          + (edge.relation === "event" ? " logic-edge-event" : "")
          + (edge.relation === "callReturn" ? " logic-edge-call-return" : "")
          + (edge.confidence === "inferred" ? " inferred" : "")
          + (edgeLayout.route === "back" ? " back-edge" : "")
          + (edgeLayout.route === "long" ? " long-edge" : "")
          + (entering ? " logic-edge-entering" : ""));
        path.setAttribute("d", createLogicEdgePath(edgeLayout.points));
        path.setAttribute("marker-end", "url(#logic-graph-arrow)");
        label.setAttribute("class", "logic-edge-label logic-edge-label-" + edge.kind
          + (edge.relation === "call" ? " logic-edge-label-call" : "")
          + (edge.relation === "event" ? " logic-edge-label-event" : "")
          + (edge.relation === "callReturn" ? " logic-edge-label-call-return" : "")
          + (choice ? " logic-edge-choice" : "")
          + (entering ? " logic-edge-label-entering" : ""));
        label.setAttribute("x", String(edgeLayout.labelX));
        label.setAttribute("y", String(edgeLayout.labelY));
        if (edgeLayout.route !== "forward") label.setAttribute("text-anchor", "end");
        label.textContent = formatLogicEdge(edge);
        path.setAttribute("aria-hidden", "true");
        label.setAttribute("aria-hidden", "true");
        svg.append(path, label);
        elementsById.set(edge.id, { path, label, choice });
      }
      return { svg, elementsById };
    }

    /** Places native branch buttons above SVG routes without making SVG text interactive. */
    function createLogicEdgeChoiceLayer(layout, edgesById, elementsById, onBranchChoice) {
      const layer = document.createElement("div");
      layer.className = "logic-edge-choice-layer";
      layer.setAttribute("aria-label", projectAnalyzerText("branch-choices"));
      for (const edgeLayout of layout.edges) {
        const edge = edgesById.get(edgeLayout.edgeId);
        const elements = elementsById.get(edgeLayout.edgeId);
        if (!edge || !elements || !isFunctionLogicBranchChoiceEdge(edge)) continue;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "logic-edge-choice-button logic-edge-choice-" + edge.kind;
        button.textContent = formatLogicEdge(edge);
        button.title = projectAnalyzerText("choose-path", { label: formatLogicEdge(edge) });
        button.setAttribute("aria-pressed", "false");
        button.style.setProperty("left", edgeLayout.labelX + "px");
        button.style.setProperty("top", edgeLayout.labelY + "px");
        button.addEventListener("click", () => onBranchChoice(edge));
        elements.choiceButton = button;
        layer.append(button);
      }
      return layer;
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
      let embeddedTimingBadge;
      let bodyBadge;
      let childCountBadge;
      const valueChangeText = (block.valueChanges || []).map((change) =>
        formatLogicValueChange(change) + " (" + projectAnalyzerText("logic-confidence-" + (change.confidence || "unknown")) + ")"
      ).join(", ");
      const valueAccessText = (block.valueAccesses || []).map((access) =>
        formatFunctionLogicBindingKind(access.bindingKind, access.valueRole) + " "
          + access.name + " " + formatFunctionLogicValueUsage(access)
      ).join(", ");
      const outgoingText = outgoing.map((edge) => {
        const target = blocksById.get(edge.targetId);
        return formatLogicEdge(edge) + (target
          ? projectAnalyzerText("logic-target-transfer", { target: completeTargetLabel(target) }) : "");
      }).join(", ");
      const expandable = Boolean(block.drillTargets && block.drillTargets.length > 0);
      const rendersOnly = expandable && block.drillTargets.every((target) =>
        target.relation === "render"
      );
      const eventHandlersOnly = expandable && block.drillTargets.every((target) =>
        target.relation === "event"
      );
      const expandableRole = rendersOnly
        ? projectAnalyzerText("rendered-component")
        : eventHandlersOnly ? projectAnalyzerText("event-handler") : projectAnalyzerText("child-function");
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
      const renderedLabel = formatLogicBlockLabel(block); const baseNodeTitle = projectAnalyzerText("select-logic", { label: renderedLabel });
      node.dataset.logicBaseTitle = baseNodeTitle;
      node.title = baseNodeTitle
        + (ownsCompoundBody ? " · " + projectAnalyzerText("body-show-outer") : "");
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
      node.setAttribute("aria-label", projectAnalyzerText("logic-node-aria", {
        label: renderedLabel,
        changes: valueChangeText || projectAnalyzerText("logic-aria-none"),
        flow: valueAccessText || projectAnalyzerText("logic-aria-none"),
        paths: outgoingText || projectAnalyzerText("logic-aria-none"),
        child: expandable ? projectAnalyzerText("logic-aria-child-available") : projectAnalyzerText("logic-aria-none"),
        outer: ownsCompoundBody ? projectAnalyzerText("logic-aria-outer-available") : projectAnalyzerText("logic-aria-none")
      }));
      node.setAttribute("aria-pressed", "false");
      top.className = "logic-node-top";
      branch.className = "logic-node-branch";
      branch.textContent = block.branchPresentation
        ? projectAnalyzerText(block.branchPresentation.key, block.branchPresentation.params)
        : block.branchLabel || "";
      label.className = "logic-node-label";
      mountCodeSnippet(label, renderedLabel);
      meta.className = "logic-node-meta";
      meta.textContent = block.sourceLocation || formatLogicBlockDetail(block);
      top.append(kind);
      if (block.kind === "embedded") {
        embeddedTimingBadge = createBadge(
          describeEmbeddedBoundaryTiming(block),
          "logic-node-embedded-timing"
        );
        top.append(embeddedTimingBadge);
      }
      if (ownsCompoundBody) {
        bodyBadge = createBadge(projectAnalyzerText("body"), "logic-node-body-focus");
        top.append(bodyBadge);
      }
      if (block.functionLabel) {
        top.append(createBadge(block.functionLabel, "logic-node-function"));
      }
      if (block.drillTargets && block.drillTargets.length > 0) {
        childCountBadge = createBadge(
          projectAnalyzerText("logic-child-count", { count: block.drillTargets.length }),
          "logic-node-callee"
        );
        top.append(childCountBadge);
      }
      if (branch.textContent) top.append(branch);
      node.append(top, label);
      if (block.valueChanges && block.valueChanges.length > 0) {
        node.append(createLogicValueChangeList(block.valueChanges, "logic-node-value-changes"));
      }
      if (block.valueAccesses && block.valueAccesses.length > 0) {
        node.append(createFunctionLogicValueAccessList(
          block.valueAccesses,
          "logic-node-value-accesses"
        ));
      }
      node.append(meta);
      node.refreshLanguage = () => {
        const nextLabel = formatLogicBlockLabel(block);
        const changes = (block.valueChanges || []).map((change) => formatLogicValueChange(change) + " (" + projectAnalyzerText("logic-confidence-" + (change.confidence || "unknown")) + ")").join(", ");
        const accesses = (block.valueAccesses || []).map((access) => formatFunctionLogicBindingKind(access.bindingKind, access.valueRole) + " " + access.name + " " + formatFunctionLogicValueUsage(access)).join(", ");
        const paths = outgoing.map((edge) => { const target = blocksById.get(edge.targetId); return formatLogicEdge(edge) + (target ? projectAnalyzerText("logic-target-transfer", { target: completeTargetLabel(target) }) : ""); }).join(", ");
        node.dataset.logicBaseTitle = projectAnalyzerText("select-logic", { label: nextLabel });
        node.title = node.dataset.logicBaseTitle + (ownsCompoundBody ? " · " + projectAnalyzerText("body-show-outer") : "");
        node.setAttribute("aria-label", projectAnalyzerText("logic-node-aria", { label: nextLabel, changes: changes || projectAnalyzerText("logic-aria-none"), flow: accesses || projectAnalyzerText("logic-aria-none"), paths: paths || projectAnalyzerText("logic-aria-none"), child: expandable ? projectAnalyzerText("logic-aria-child-available") : projectAnalyzerText("logic-aria-none"), outer: ownsCompoundBody ? projectAnalyzerText("logic-aria-outer-available") : projectAnalyzerText("logic-aria-none") }));
        kind.textContent = formatLogicKind(block.kind);
        branch.textContent = block.branchPresentation ? projectAnalyzerText(block.branchPresentation.key, block.branchPresentation.params) : block.branchLabel || "";
        // Preserve syntax-token rendering while retaining the node button itself.
        clearElement(label);
        mountCodeSnippet(label, nextLabel);
        meta.textContent = block.sourceLocation || formatLogicBlockDetail(block);
        embeddedTimingBadge && (embeddedTimingBadge.textContent = describeEmbeddedBoundaryTiming(block));
        bodyBadge && (bodyBadge.textContent = projectAnalyzerText("body"));
        childCountBadge && (childCountBadge.textContent = projectAnalyzerText("logic-child-count", { count: block.drillTargets.length }));
        for (const child of node.children) child.refreshLanguage?.();
      };
      return node;
    }

    /** Reveals one Host-approved source range without sending paths or offsets. */
    function openLogicEvidence(evidenceToken) {
      if (!state.graph) return;
      vscode.postMessage({
        type: "codeFlow/openEvidence",
        payload: { graphVersion: state.graph.version, evidenceToken }
      });
      elements.status.textContent = projectAnalyzerText("statement-opened");
    }

    /** Formats concise statement-role labels for graph nodes. */
    function formatLogicKind(kind) {
      const key = "logic-" + String(kind || "unknown");
      const localized = projectAnalyzerText(key);
      return localized === key ? projectAnalyzerText("logic-unknown") : localized;
    }

    /**
     * Names the parser-proven embedded-code timing from the boundary's stable
     * analyzer metadata. It never evaluates source text or claims an observed run.
     */
    function describeEmbeddedBoundaryTiming(block) {
      if (block.embeddedPresentationKind === "directEval") return projectAnalyzerText("embedded-direct-eval");
      if (block.embeddedPresentationKind === "globalEval") return projectAnalyzerText("embedded-global-eval");
      if (block.embeddedPresentationKind === "deferred") return projectAnalyzerText("embedded-deferred");
      if (block.embeddedPresentationKind === "created") return projectAnalyzerText("embedded-created");
      return projectAnalyzerText("embedded-static");
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
          ? projectAnalyzerText("value-change-exact") : projectAnalyzerText("value-change-inferred");
        kind.className = "logic-value-target-kind";
        kind.textContent = formatLogicValueTargetKind(change.targetKind)
          + " · " + projectAnalyzerText(change.confidence === "inferred" ? "may-change" : "changes");
        mountCodeSnippet(value, formatLogicValueChange(change));
        row.append(kind, value);
        list.append(row);
        row.refreshLanguage = () => {
          row.title = change.confidence === "exact" ? projectAnalyzerText("value-change-exact") : projectAnalyzerText("value-change-inferred");
          kind.textContent = formatLogicValueTargetKind(change.targetKind) + " · " + projectAnalyzerText(change.confidence === "inferred" ? "may-change" : "changes");
        };
      }
      list.refreshLanguage = () => {
        for (const row of list.children) row.refreshLanguage?.();
      };
      return list;
    }

    /** Formats one value transition without claiming a runtime value. */
    function formatLogicValueChange(change) {
      return change.target + " " + change.operator
        + (change.value ? " " + change.value : "");
    }

    /** Keeps graph target categories compact but textually distinguishable. */
    function formatLogicValueTargetKind(kind) {
      if (kind === "receiver") return projectAnalyzerText("receiver"); if (kind === "property") return projectAnalyzerText("field"); return projectAnalyzerText("variable");
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
      if (edge.presentation) return projectAnalyzerText(edge.presentation.key, edge.presentation.params);
      return projectAnalyzerText("logic-edge-" + String(edge.kind || "next"));
    }

    /** Creates a complete target hint for accessibility and transfer details. */
    function completeTargetLabel(block) {
      if (block.kind === "exit") return projectAnalyzerText("logic-exit");
      if (block.kind === "entry") return projectAnalyzerText("logic-entry");
      return formatLogicBlockLabel(block) || block.kind;
    }

    /** Formats finite block prose while leaving syntax-bearing params untouched. */
    function formatLogicBlockLabel(block) { return block?.presentation ? projectAnalyzerText(block.presentation.labelKey, block.presentation.labelParams) : String(block?.label || block?.kind || ""); }
    function formatLogicBlockDetail(block) { return block?.presentation ? projectAnalyzerText(block.presentation.detailKey, block.presentation.detailParams) : String(block?.detail || ""); }

    /** Summarizes internal logic rather than call-graph size. */
    function createFunctionLogicSummaryText(logic) {
      const summary = logic.summary;
      const parts = [projectAnalyzerText("logic-block-count", { count: summary.blockCount })];
      if (summary.branchCount) parts.push(projectAnalyzerText("summary-branches", { count: summary.branchCount }));
      if (summary.loopCount) parts.push(projectAnalyzerText("summary-loops", { count: summary.loopCount }));
      const renderCount = logic.blocks.filter((block) => block.kind === "render").length;
      const eventCount = logic.blocks.filter((block) => block.kind === "event").length;
      if (renderCount) parts.push(projectAnalyzerText("summary-jsx-steps", { count: renderCount }));
      if (eventCount) parts.push(projectAnalyzerText("summary-event-bindings", { count: eventCount }));
      if (summary.effectCount) parts.push(projectAnalyzerText("summary-effects", { count: summary.effectCount }));
      if (summary.valueChangeCount) parts.push(
        projectAnalyzerText("summary-value-changes", { count: summary.valueChangeCount })
      );
      else if (summary.mutationCount) parts.push(
        projectAnalyzerText("summary-mutations", { count: summary.mutationCount })
      );
      const bindingCount = (logic.valueBindings || []).length;
      if (bindingCount) parts.push(
        projectAnalyzerText("tracked-binding-count", { count: bindingCount })
      );
      return parts.join(" · ");
    }
  `;
}
