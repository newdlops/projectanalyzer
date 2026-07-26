/**
 * Browser adapter for the Function Logic comprehension state. It batches
 * attention attributes in one frame and keeps lens controls DOM-local.
 */

import { getFunctionLogicAttentionProjectionBrowserSource } from "./functionLogicAttentionProjection";
import { getFunctionLogicComprehensionStateBrowserSource } from "./functionLogicComprehensionState";

/** Returns CSP-safe lens controls and central attention DOM adapter helpers. */
export function getFunctionLogicComprehensionBrowserSource(): string {
  return /* js */ `
    ${getFunctionLogicAttentionProjectionBrowserSource()}
    ${getFunctionLogicComprehensionStateBrowserSource()}

    /** Creates one session controller without owning layout or Host interaction. */
    function createFunctionLogicComprehensionController(sessionKey, logic, nodeButtonsById, edgeElementsById) {
      let comprehensionState = createFunctionLogicComprehensionState(sessionKey);
      let framePending = false;
      const listeners = new Set();
      const layoutByBlockId = new Map((logic.layout?.nodes || []).map((node) => [node.blockId, node]));
      const outgoingBySourceId = new Map();
      const incomingByTargetId = new Map();
      let onNodeActivated;
      for (const edge of logic.edges) {
        const outgoing = outgoingBySourceId.get(edge.sourceId) || [];
        outgoing.push(edge);
        outgoingBySourceId.set(edge.sourceId, outgoing);
        const incoming = incomingByTargetId.get(edge.targetId) || [];
        incoming.push(edge);
        incomingByTargetId.set(edge.targetId, incoming);
      }

      /** Picks a stable keyboard destination without recursively walking cycles. */
      function findKeyboardTarget(blockId, key) {
        const currentLayout = layoutByBlockId.get(blockId);
        if (key === "Home") return logic.blocks.find((block) => block.kind === "entry")?.id || logic.blocks[0]?.id;
        if (key === "End") return logic.blocks.find((block) => block.kind === "exit")?.id || logic.blocks[logic.blocks.length - 1]?.id;
        if (key === "ArrowDown" || key === "ArrowUp") {
          const candidates = (key === "ArrowDown"
            ? outgoingBySourceId.get(blockId)
            : incomingByTargetId.get(blockId)
          ) || [];
          const kindPriority = ["next", "true", "iterate", "case", "exit"];
          return candidates.slice().sort((left, right) => {
            const leftPriority = kindPriority.indexOf(left.kind);
            const rightPriority = kindPriority.indexOf(right.kind);
            const normalizedLeft = leftPriority < 0 ? kindPriority.length : leftPriority;
            const normalizedRight = rightPriority < 0 ? kindPriority.length : rightPriority;
            if (normalizedLeft !== normalizedRight) return normalizedLeft - normalizedRight;
            return left.id.localeCompare(right.id);
          })[0]?.[key === "ArrowDown" ? "targetId" : "sourceId"];
        }
        if (!currentLayout || (key !== "ArrowLeft" && key !== "ArrowRight")) return undefined;
        const sameRank = [...layoutByBlockId.values()]
          .filter((layout) => layout.rank === currentLayout.rank && layout.blockId !== blockId)
          .sort((left, right) => left.lane - right.lane || left.x - right.x || left.blockId.localeCompare(right.blockId));
        const direction = key === "ArrowLeft" ? -1 : 1;
        const candidates = sameRank.filter((layout) => direction < 0
          ? layout.lane < currentLayout.lane || (layout.lane === currentLayout.lane && layout.x < currentLayout.x)
          : layout.lane > currentLayout.lane || (layout.lane === currentLayout.lane && layout.x > currentLayout.x));
        return (direction < 0 ? candidates[candidates.length - 1] : candidates[0])?.blockId;
      }

      /** Registers the only keyboard route into graph selection. */
      function registerNode(blockId, node) {
        node.addEventListener("keydown", (event) => {
          const targetId = findKeyboardTarget(blockId, event.key);
          if (!targetId) return;
          event.preventDefault();
          if (typeof event.stopPropagation === "function") event.stopPropagation();
          activateBlock(targetId, true);
        });
      }

      /** Makes a graph node active while leaving Inspector rendering to the adapter. */
      function activateBlock(blockId, moveFocus) {
        if (!nodeButtonsById.has(blockId)) return;
        dispatch({ type: "select-block", blockId });
        onNodeActivated?.(blockId, moveFocus);
      }

      /** Batches data attributes so a state change never interleaves DOM reads and writes. */
      function refresh() {
        if (framePending) return;
        framePending = true;
        requestAnimationFrame(() => {
          framePending = false;
          const projection = createFunctionLogicAttentionProjection(
            logic.blocks,
            logic.edges,
            comprehensionState
          );
          const fallbackBlock = logic.blocks.find((block) => block.kind === "entry") || logic.blocks[0];
          const tabbableBlockId = comprehensionState.selectedBlockId || fallbackBlock?.id;
          for (const [blockId, node] of nodeButtonsById) {
            node.setAttribute("data-attention", projection.nodeLevelById.get(blockId) || "muted");
            node.setAttribute(
              "data-scenario",
              projection.excludedNodeIds.has(blockId) ? "excluded" : "reachable"
            );
            // Roving tab stop keeps a dense graph keyboard-reachable without
            // forcing readers through every node before reaching the Inspector.
            node.setAttribute("tabindex", blockId === tabbableBlockId ? "0" : "-1");
          }
          for (const [edgeId, elements] of edgeElementsById) {
            const level = projection.edgeLevelById.get(edgeId) || "muted";
            const scenario = projection.excludedEdgeIds.has(edgeId) ? "excluded" : "reachable";
            elements.path.setAttribute("data-attention", level);
            elements.label.setAttribute("data-attention", level);
            elements.path.setAttribute("data-scenario", scenario);
            elements.label.setAttribute("data-scenario", scenario);
          }
          for (const listener of listeners) listener(comprehensionState);
        });
      }

      /** Reduces one reader event and publishes it after attention is refreshed. */
      function dispatch(event) {
        comprehensionState = reduceFunctionLogicComprehensionState(comprehensionState, event);
        refresh();
      }

      return {
        getState() { return comprehensionState; },
        dispatch,
        selectBlock(blockId) { dispatch({ type: "select-block", blockId }); },
        activateBlock,
        registerNode,
        setNodeActivation(handler) { onNodeActivated = handler; },
        selectBinding(bindingId) { dispatch({ type: "select-binding", bindingId }); },
        setEmbeddedFocus(boundaryId) { dispatch({ type: "set-embedded-focus", boundaryId }); },
        setGuideFocus(focus) { dispatch({ type: "set-guide-focus", primaryBlockId: focus?.primaryBlockId, blockIds: focus?.blockIds || [], edgeIds: focus?.edgeIds || [] }); },
        clearGuideFocus() { dispatch({ type: "clear-guide-focus" }); },
        setLens(lens) { dispatch({ type: "set-lens", lens }); },
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        refresh
      };
    }

    /** Builds four compact reader-question controls above the graph canvas. */
    function createFunctionLogicLensToolbar(controller) {
      const toolbar = document.createElement("div");
      const label = document.createElement("span");
      const buttons = new Map();
      toolbar.className = "logic-lens-toolbar";
      toolbar.setAttribute("role", "group");
      toolbar.setAttribute("aria-label", "Function reading lens");
      label.className = "logic-lens-label";
      label.textContent = "Show";
      toolbar.append(label);
      for (const descriptor of [
        ["flow", "Flow", "Control structure and possible paths"],
        ["values", "Values", "Declared values and changes"],
        ["calls", "Calls", "Called, rendered, and event code"],
        ["effects", "Effects", "Mutations, returns, and throws"]
      ]) {
        const [lens, text, title] = descriptor;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "logic-lens-button";
        button.textContent = text;
        button.title = title;
        button.setAttribute("aria-pressed", lens === controller.getState().lens ? "true" : "false");
        button.addEventListener("click", () => controller.setLens(lens));
        toolbar.append(button);
        buttons.set(lens, button);
      }
      controller.subscribe((readerState) => {
        for (const [lens, button] of buttons) {
          button.setAttribute("aria-pressed", lens === readerState.lens ? "true" : "false");
        }
      });
      return toolbar;
    }

    /** Keeps the header legend limited to the semantics of the active reader lens. */
    function createFunctionLogicLensLegend(controller) {
      const legend = document.createElement("div");
      const descriptorsByLens = {
        flow: [["solid · exact", "exact"], ["dashed · inferred", "inferred"], ["◇ choose path", "choice"]],
        values: [["Δ changed", "value-change"], ["⇢ declaration → use", "value-flow"], ["dashed · inferred", "inferred"]],
        calls: [["solid · immediate call", "exact"], ["dashed · deferred", "event"], ["ƒ defined · not invoked", "callable"]],
        effects: [["Δ mutation", "value-change"], ["return / throw", "event"], ["dashed · inferred", "inferred"]]
      };
      const render = (readerState) => {
        clearElement(legend);
        for (const [text, className] of descriptorsByLens[readerState.lens]) {
          legend.append(createBadge(text, "logic-legend " + className));
        }
      };
      legend.className = "logic-graph-legend";
      controller.subscribe(render);
      render(controller.getState());
      return legend;
    }

    /**
     * Renders a bounded, layout-ordered reading aid that shares the graph's
     * selected node. It intentionally describes possible static structure,
     * never an observed runtime trace.
     */
    function createFunctionLogicStaticFlowLedger(logic, controller) {
      const section = document.createElement("section");
      const orderedBlocks = logic.layout.nodes.slice()
        .sort((left, right) => left.rank - right.rank || left.lane - right.lane || left.x - right.x || left.blockId.localeCompare(right.blockId))
        .map((layout) => logic.blocks.find((block) => block.id === layout.blockId))
        .filter(Boolean);
      const render = (readerState) => {
        clearElement(section);
        const heading = document.createElement("strong");
        const detail = document.createElement("p");
        const list = document.createElement("ol");
        const selectedIndex = Math.max(0, orderedBlocks.findIndex((block) => block.id === readerState.selectedBlockId));
        const start = Math.max(0, Math.min(selectedIndex - 2, Math.max(0, orderedBlocks.length - 5)));
        heading.textContent = "Static Flow Ledger";
        detail.textContent = "Possible static reading order, not an execution trace.";
        list.className = "logic-static-ledger-list";
        for (const block of orderedBlocks.slice(start, start + 5)) {
          const item = document.createElement("li");
          const button = document.createElement("button");
          const kind = document.createElement("span");
          const label = document.createElement("strong");
          button.type = "button";
          button.className = "logic-static-ledger-step";
          button.title = "Select static step · " + block.label;
          button.setAttribute("aria-current", block.id === readerState.selectedBlockId ? "step" : "false");
          kind.textContent = formatLogicKind(block.kind);
          label.textContent = block.label;
          button.append(kind, label);
          button.addEventListener("click", () => controller.activateBlock(block.id, true));
          item.append(button);
          list.append(item);
        }
        section.append(heading, detail, list);
      };
      section.className = "logic-static-ledger";
      controller.subscribe(render);
      render(controller.getState());
      return section;
    }
  `;
}
