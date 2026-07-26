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
        empty.textContent = "No function-body graph is available for this source.";
        elements.flowSteps.append(empty);
        return;
      }

      const graphRendering = createFunctionLogicGraph(logic, graphContext);
      elements.flowSteps.append(graphRendering.element);
      graphRendering.activateViewport();
      state.activeLogicViewportController = graphRendering.viewportController;
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
        logic, comprehension, valueFlowRendering, viewportController);
      const hasJsxFlow = logic.blocks.some((block) => block.kind === "render");
      const hasEventFlow = logic.blocks.some((block) => block.kind === "event");
      const hasRenderFlow = hasJsxFlow || hasEventFlow;
      const hasValueChanges = logic.blocks.some((block) =>
        block.valueChanges && block.valueChanges.length > 0
      );
      const graphHeader = createLogicGraphHeader(
        viewportController,
        inspector.toggle,
        createFunctionLogicLensToolbar(comprehension),
        createFunctionLogicLensLegend(comprehension),
        graphContext?.graphTitle || (hasRenderFlow
          ? (hasValueFlow || hasValueChanges
              ? "Control, render, event & value flow"
              : hasJsxFlow && hasEventFlow
                ? "Control, JSX & event boundaries"
                : hasJsxFlow ? "Control & JSX render flow" : "Control & event boundaries")
          : (hasValueFlow || hasValueChanges ? "Control & value flow" : "Control paths")),
        tutorRendering?.toggle
      );
      graph.className = "logic-graph";
      viewport.className = "logic-graph-viewport";
      viewport.setAttribute("role", "region");
      const graphSemantics = ["Function control"];
      if (hasJsxFlow) graphSemantics.push("JSX render");
      if (hasEventFlow) graphSemantics.push("event boundaries");
      if (hasValueFlow) graphSemantics.push("lexical value consume and sink flow");
      viewport.setAttribute("aria-label", graphSemantics.join(", ") + " graph");
      viewport.setAttribute("aria-keyshortcuts", "+ - 0 C F");
      viewport.title = "Drag empty space or use a trackpad to pan; use Ctrl/Command + wheel to zoom";
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
      inspector.appendSections(
        tutorRendering?.section,
        valueFlowRendering?.valuePreviewEditor,
        valueFlowRendering?.scenarioTrace,
        valueFlowRendering?.playback,
        valueFlowRendering?.toolbar,
        createFunctionLogicStaticFlowLedger(logic, comprehension),
        createLogicCalleeExplorer(logic.callees || [], logic.omittedCalleeCount || 0),
        createLogicSignature(logic.signature)
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

    /** Draws every routed edge and label behind the interactive HTML nodes. */
    function createLogicEdgeSvg(layout, edgesById, graphContext, onBranchChoice) {
      const svg = createLogicSvgElement("svg");
      const elementsById = new Map();
      svg.setAttribute("class", "logic-edge-layer");
      svg.setAttribute("width", String(layout.width));
      svg.setAttribute("height", String(layout.height));
      svg.setAttribute("viewBox", "0 0 " + layout.width + " " + layout.height);
      svg.setAttribute("role", "group");
      svg.setAttribute("aria-label", "Control paths");
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
      layer.setAttribute("aria-label", "Branch choices");
      for (const edgeLayout of layout.edges) {
        const edge = edgesById.get(edgeLayout.edgeId);
        const elements = elementsById.get(edgeLayout.edgeId);
        if (!edge || !elements || !isFunctionLogicBranchChoiceEdge(edge)) continue;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "logic-edge-choice-button logic-edge-choice-" + edge.kind;
        button.textContent = formatLogicEdge(edge);
        button.title = "Choose path: " + formatLogicEdge(edge);
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
      const valueChangeText = (block.valueChanges || []).map((change) =>
        formatLogicValueChange(change) + " (" + change.confidence + ")"
      ).join(", ");
      const valueAccessText = (block.valueAccesses || []).map((access) =>
        formatFunctionLogicBindingKind(access.bindingKind, access.valueRole) + " "
          + access.name + " " + formatFunctionLogicValueUsage(access)
      ).join(", ");
      const outgoingText = outgoing.map((edge) => {
        const target = blocksById.get(edge.targetId);
        return formatLogicEdge(edge) + (target ? " to " + completeTargetLabel(target) : "");
      }).join(", ");
      const expandable = Boolean(block.drillTargets && block.drillTargets.length > 0);
      const rendersOnly = expandable && block.drillTargets.every((target) =>
        target.relation === "render"
      );
      const eventHandlersOnly = expandable && block.drillTargets.every((target) =>
        target.relation === "event"
      );
      const expandableRole = rendersOnly
        ? "rendered component"
        : eventHandlersOnly ? "event handler" : "called function";
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
      const baseNodeTitle = "Select logic · " + block.label;
      node.dataset.logicBaseTitle = baseNodeTitle;
      node.title = baseNodeTitle
        + (ownsCompoundBody ? " · Show this body as the outer frame" : "");
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
        + (valueAccessText ? ". Value flow: " + valueAccessText : "")
        + (outgoingText ? ". Paths: " + outgoingText : "")
        + (expandable
          ? ". Child flows are available through the Inspector."
          : "")
        + (ownsCompoundBody
          ? ". Activate to show this component body as the outer body frame."
          : ""));
      node.setAttribute("aria-pressed", "false");
      top.className = "logic-node-top";
      branch.className = "logic-node-branch";
      branch.textContent = block.branchLabel || "";
      label.className = "logic-node-label";
      mountCodeSnippet(label, block.label);
      meta.className = "logic-node-meta";
      meta.textContent = block.sourceLocation || block.detail;
      top.append(kind);
      if (block.kind === "embedded") {
        top.append(createBadge(
          describeEmbeddedBoundaryTiming(block),
          "logic-node-embedded-timing"
        ));
      }
      if (ownsCompoundBody) {
        top.append(createBadge("BODY", "logic-node-body-focus"));
      }
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
      if (block.valueAccesses && block.valueAccesses.length > 0) {
        node.append(createFunctionLogicValueAccessList(
          block.valueAccesses,
          "logic-node-value-accesses"
        ));
      }
      node.append(meta);
      return node;
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
      if (kind === "embedded") return "TEXT";
      if (kind === "callable") return "FN";
      if (kind === "render") return "JSX";
      if (kind === "event") return "EVENT";
      if (kind === "mutation") return "STATE";
      return kind;
    }

    /**
     * Names the parser-proven embedded-code timing from the boundary's stable
     * analyzer label. It never evaluates source text or claims an observed run.
     */
    function describeEmbeddedBoundaryTiming(block) {
      const label = String(block.label || "");
      if (label.startsWith("execute code text · eval")) return "DIRECT EVAL · STATIC";
      if (label.startsWith("execute code text · globalThis.eval")
        || label.startsWith("execute code text · window.eval")) return "GLOBAL EVAL · STATIC";
      if (label.startsWith("schedule code text")) return "DEFERRED · STATIC";
      if (label.startsWith("create callable from")) return "CREATED · NOT INVOKED";
      return "STATIC PROGRAM";
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
        mountCodeSnippet(value, formatLogicValueChange(change));
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
      if (edge.kind === "defines") return "defined body; not invoked";
      if (edge.kind === "deferred") return "scheduled separately";
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
      const bindingCount = (logic.valueBindings || []).length;
      if (bindingCount) parts.push(
        bindingCount + " tracked binding" + plural(bindingCount)
      );
      return parts.join(" · ");
    }
  `;
}
