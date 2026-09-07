/**
 * Browser adapter for the Function Logic comprehension state. It batches
 * integrated attention attributes in one frame and keeps the static legend
 * DOM-local without changing graph semantics.
 */

import { getFunctionLogicAttentionProjectionBrowserSource } from "./functionLogicAttentionProjection";
import { getFunctionLogicComprehensionStateBrowserSource } from "./functionLogicComprehensionState";

/** Returns CSP-safe integrated attention and legend DOM adapter helpers. */
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
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        refresh,
        /** Notifies retained toolbar/legend/ledger subscribers after a locale change. */
        refreshLanguage() { for (const listener of listeners) listener(comprehensionState); }
      };
    }

    /** Renders a non-interactive legend for semantics shown together in one graph. */
    function createFunctionLogicIntegratedLegend() {
      const disclosure = document.createElement("details");
      const summary = document.createElement("summary");
      const legend = document.createElement("div");
      disclosure.className = "logic-graph-key";
      disclosure.append(summary, legend);
      const render = () => {
        summary.textContent = projectAnalyzerText("reading-legend");
        clearElement(legend);
        for (const [text, className] of [["legend-solid-exact", "exact"], ["legend-dashed-inferred", "inferred"], ["legend-choose-path", "choice"], ["legend-declaration-use", "value-flow"], ["legend-value-changed", "value-change"], ["legend-solid-immediate-call", "callable"], ["legend-return-throw", "event"]]) {
          legend.append(createBadge(projectAnalyzerText(text), "logic-legend " + className));
        }
      };
      legend.className = "logic-graph-legend";
      render();
      disclosure.refreshLanguage = render;
      return disclosure;
    }

  `;
}
