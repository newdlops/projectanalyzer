/**
 * Browser adapter for dynamic Function Logic body frames. It retains one
 * graph-session focus, replaces only the decorative frame layer, and exposes
 * in-flow navigation without rebuilding control nodes or routes.
 */

import {
  createFunctionLogicBodyFocusProjection,
  createFunctionLogicBodyHierarchy
} from "./functionLogicBodyFocus";

/** Returns CSP-safe body-focus state and DOM controller declarations. */
export function getFunctionLogicBodyFocusBrowserSource(): string {
  const pureSource = [
    createFunctionLogicBodyHierarchy,
    createFunctionLogicBodyFocusProjection
  ].map((value) => value.toString()).join("\n");
  return `${pureSource}
    let functionLogicBodyFocusSessionKey = "";
    let functionLogicFocusedBodyOwnerId;

    /** Retains body focus only while the root graph identity remains stable. */
    function readFunctionLogicBodyFocusSession(sessionKey, hierarchy) {
      if (functionLogicBodyFocusSessionKey !== sessionKey) {
        functionLogicBodyFocusSessionKey = sessionKey;
        functionLogicFocusedBodyOwnerId = undefined;
      }
      if (functionLogicFocusedBodyOwnerId
        && !hierarchy.groupsByOwnerBlockId.has(functionLogicFocusedBodyOwnerId)) {
        functionLogicFocusedBodyOwnerId = undefined;
      }
      return functionLogicFocusedBodyOwnerId;
    }

    /** Owns frame projection, owner affordances, and parent/root navigation. */
    function createFunctionLogicBodyFocusController(options) {
      const hierarchy = createFunctionLogicBodyHierarchy(options.blocks, options.groups);
      const layer = createLogicCompoundGroupLayer([], options.blocksById);
      const navigation = document.createElement("nav");
      navigation.className = "logic-body-focus-navigation";
      navigation.setAttribute("aria-label", "Dynamic body frame navigation");
      navigation.setAttribute("aria-live", "polite");
      let focusedOwnerBlockId = readFunctionLogicBodyFocusSession(
        options.sessionKey,
        hierarchy
      );

      /** Replaces the frame and navigation projections without moving graph nodes. */
      function refresh() {
        const projection = createFunctionLogicBodyFocusProjection(
          hierarchy,
          focusedOwnerBlockId
        );
        focusedOwnerBlockId = projection.focusedOwnerBlockId;
        renderLogicCompoundGroupLayer(
          layer,
          projection.visibleGroups,
          options.blocksById
        );
        renderFunctionLogicBodyFocusNavigation(
          navigation,
          hierarchy,
          projection,
          options.blocksById,
          focus,
          reset
        );

        const visibleOwnerIds = new Set(
          projection.visibleGroups.map((group) => group.ownerBlockId)
        );
        for (const group of options.groups) {
          const node = options.nodeButtonsById.get(group.ownerBlockId);
          if (!node) continue;
          const parentOwnerId = hierarchy.parentOwnerBlockIdByOwnerBlockId.get(
            group.ownerBlockId
          );
          const focused = projection.focusedOwnerBlockId === group.ownerBlockId;
          node.classList.toggle("logic-node-body-current", visibleOwnerIds.has(group.ownerBlockId));
          node.classList.toggle("logic-node-body-nested", Boolean(parentOwnerId));
          node.classList.toggle("logic-node-body-focused", focused);
          node.setAttribute("aria-current", focused ? "true" : "false");
          const baseTitle = node.dataset.logicBaseTitle || node.title;
          const bodyAction = focused
            ? "Current outer body frame"
            : visibleOwnerIds.has(group.ownerBlockId)
              ? "Show only this body as the outer frame"
              : "Show this body as the outer frame";
          node.title = baseTitle + " · " + bodyAction;
        }
      }

      /** Promotes one body owner to the sole visible outer frame. */
      function focus(ownerBlockId) {
        if (!hierarchy.groupsByOwnerBlockId.has(ownerBlockId)) return false;
        functionLogicBodyFocusSessionKey = options.sessionKey;
        functionLogicFocusedBodyOwnerId = ownerBlockId;
        focusedOwnerBlockId = ownerBlockId;
        refresh();
        return true;
      }

      /** Returns to the initial projection containing all outermost bodies. */
      function reset() {
        functionLogicBodyFocusSessionKey = options.sessionKey;
        functionLogicFocusedBodyOwnerId = undefined;
        focusedOwnerBlockId = undefined;
        refresh();
      }

      return { layer, navigation, focus, refresh, reset };
    }

    /** Renders an in-flow breadcrumb plus explicit parent and outermost actions. */
    function renderFunctionLogicBodyFocusNavigation(
      navigation,
      hierarchy,
      projection,
      blocksById,
      onFocus,
      onReset
    ) {
      navigation.replaceChildren();
      const hasNestedBodies = hierarchy.groupsByOwnerBlockId.size
        > hierarchy.outerOwnerBlockIds.length;
      if (!projection.focusedOwnerBlockId && !hasNestedBodies) {
        navigation.hidden = true;
        return;
      }

      const summary = document.createElement("strong");
      const path = document.createElement("div");
      navigation.hidden = false;
      summary.className = "logic-body-focus-summary";
      path.className = "logic-body-focus-path";
      if (!projection.focusedOwnerBlockId) {
        summary.textContent = "BODY VIEW · OUTERMOST";
        const hint = document.createElement("span");
        hint.className = "logic-body-focus-hint";
        hint.textContent = "Nested frames are hidden. Select a BODY owner to open its frame.";
        navigation.append(summary, hint);
        return;
      }

      const focusedBlock = blocksById.get(projection.focusedOwnerBlockId);
      summary.textContent = "BODY VIEW · "
        + formatLogicKind(focusedBlock?.kind || "body").toUpperCase() + " BODY";
      for (let index = 0; index < projection.pathOwnerBlockIds.length; index += 1) {
        const ownerBlockId = projection.pathOwnerBlockIds[index];
        const block = blocksById.get(ownerBlockId);
        if (index > 0) {
          const separator = document.createElement("span");
          separator.className = "logic-body-focus-separator";
          separator.textContent = "›";
          separator.setAttribute("aria-hidden", "true");
          path.append(separator);
        }
        if (ownerBlockId === projection.focusedOwnerBlockId) {
          const current = document.createElement("span");
          current.className = "logic-body-focus-current";
          current.textContent = block?.label || formatLogicKind(block?.kind || "body");
          path.append(current);
        } else {
          const ancestor = document.createElement("button");
          ancestor.type = "button";
          ancestor.className = "logic-body-focus-crumb";
          ancestor.textContent = block?.label || formatLogicKind(block?.kind || "body");
          ancestor.title = "Show " + ancestor.textContent + " as the outer body frame";
          ancestor.addEventListener("click", () => onFocus(ownerBlockId));
          path.append(ancestor);
        }
      }

      const actions = document.createElement("div");
      const parent = document.createElement("button");
      const outermost = document.createElement("button");
      const parentOwnerBlockId = hierarchy.parentOwnerBlockIdByOwnerBlockId.get(
        projection.focusedOwnerBlockId
      );
      actions.className = "logic-body-focus-actions";
      parent.type = "button";
      parent.className = "logic-body-focus-action";
      parent.textContent = "Parent body";
      parent.title = parentOwnerBlockId
        ? "Show parent body as outer frame"
        : "Show all outermost body frames";
      parent.addEventListener("click", () => {
        if (parentOwnerBlockId) onFocus(parentOwnerBlockId);
        else onReset();
      });
      outermost.type = "button";
      outermost.className = "logic-body-focus-action";
      outermost.textContent = "Outermost";
      outermost.title = "Show all outermost body frames";
      outermost.addEventListener("click", onReset);
      actions.append(parent, outermost);
      navigation.append(summary, path, actions);
    }
  `;
}
