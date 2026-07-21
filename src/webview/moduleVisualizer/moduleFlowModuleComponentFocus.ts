/**
 * Single-module ownership policy for Module Flow component branches.
 *
 * Child-module branches remain available as navigation context, while boundary
 * functions and their attached Function Logic graphs belong to exactly one
 * selected module. The pure selector is shared by unit tests and the generated
 * browser program; the browser wrapper also invalidates superseded requests.
 */

/** Minimal expansion shape needed to decide component-branch ownership. */
export type ModuleFlowComponentFocusExpansion = {
  expansion?: string;
  anchorModuleId?: string;
  anchorFunctionId?: string;
  nodes?: readonly { id: string }[];
};

/** Stable keys retained or removed when one module becomes the component focus. */
export type ModuleFlowComponentFocusSelection = {
  retainedKeys: string[];
  removedKeys: string[];
};

/**
 * Selects the component branches owned by one module without recursive walks.
 * Structural child-module expansions are retained so an attached child card
 * cannot disappear merely because the user selected it as the next focus.
 */
export function selectModuleFlowComponentFocus(
  entries: Iterable<readonly [string, ModuleFlowComponentFocusExpansion]>,
  moduleId: string
): ModuleFlowComponentFocusSelection {
  const stableEntries = Array.from(entries);
  const retainedKeySet = new Set<string>();
  const focusedFunctionIds = new Set<string>();

  for (const [key, expansion] of stableEntries) {
    if (expansion.expansion === "functionLogic") {
      continue;
    }
    if (expansion.expansion !== "boundaryFunctions") {
      retainedKeySet.add(key);
      continue;
    }
    if (expansion.anchorModuleId !== moduleId) {
      continue;
    }
    retainedKeySet.add(key);
    for (const node of expansion.nodes ?? []) {
      focusedFunctionIds.add(node.id);
    }
  }

  for (const [key, expansion] of stableEntries) {
    if (expansion.expansion === "functionLogic"
      && expansion.anchorFunctionId
      && focusedFunctionIds.has(expansion.anchorFunctionId)) {
      retainedKeySet.add(key);
    }
  }

  const retainedKeys: string[] = [];
  const removedKeys: string[] = [];
  for (const [key] of stableEntries) {
    (retainedKeySet.has(key) ? retainedKeys : removedKeys).push(key);
  }
  return { retainedKeys, removedKeys };
}

/** Serializes the focus policy and its browser-state adapter into the Webview. */
export function getModuleFlowModuleComponentFocusBrowserSource(): string {
  return /* javascript */ `
    ${selectModuleFlowComponentFocus.toString()}

    /** Releases component branches and late requests owned by other modules. */
    function focusModuleComponents(moduleId, moduleNode) {
      const focusChanged = state.focusedModuleId !== moduleId;
      state.focusedModuleId = moduleId;
      state.focusedModuleNode = moduleNode;
      const selection = selectModuleFlowComponentFocus(
        state.expansions.entryPairs(),
        moduleId
      );
      for (const key of selection.removedKeys) state.expansions.delete(key);
      const retainedKeys = new Set(selection.retainedKeys);
      let cancelledRequestCount = 0;
      for (const pair of Array.from(state.pending.entries())) {
        const requestId = pair[0];
        const pending = pair[1];
        const supersededBoundaryExpansion = pending.operation === "expand"
          && pending.expansion === "boundaryFunctions"
          && pending.moduleId !== moduleId;
        const orphanFunctionLogic = pending.operation === "functionLogic"
          && !retainedKeys.has(pending.ownerExpansionKey);
        if (!supersededBoundaryExpansion && !orphanFunctionLogic) continue;
        state.pending.delete(requestId);
        if (pending.moduleId) state.pendingNodeIds.delete(pending.moduleId);
        if (pending.anchorNodeId) state.pendingNodeIds.delete(pending.anchorNodeId);
        cancelledRequestCount += 1;
      }
      if (selection.removedKeys.length > 0) {
        state.enteringNodeIds.clear();
        state.enteringEdgeIds.clear();
      }
      return {
        focusChanged: focusChanged,
        removedBranchCount: selection.removedKeys.length,
        cancelledRequestCount: cancelledRequestCount
      };
    }
  `;
}
