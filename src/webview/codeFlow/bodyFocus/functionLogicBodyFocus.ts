/**
 * Pure hierarchy and projection rules for the dynamic Function Logic body
 * frame. The module has no DOM dependency, so nested/cyclic parent metadata
 * can be verified independently from Webview rendering.
 */

/** Minimum analyzer block identity needed to discover body ancestry. */
export type FunctionLogicBodyBlock = {
  id: string;
  parentBlockId?: string;
};

/** Minimum compound-group identity retained by the body focus projection. */
export type FunctionLogicBodyGroup = {
  ownerBlockId: string;
};

/** Iterative body-owner index shared by the initial and focused projections. */
export type FunctionLogicBodyHierarchy<Group extends FunctionLogicBodyGroup> = {
  groupsByOwnerBlockId: Map<string, Group>;
  parentOwnerBlockIdByOwnerBlockId: Map<string, string>;
  outerOwnerBlockIds: string[];
};

/** Visible frame set plus its root-to-focus navigation path. */
export type FunctionLogicBodyFocusProjection<Group extends FunctionLogicBodyGroup> = {
  focusedOwnerBlockId?: string;
  visibleGroups: Group[];
  pathOwnerBlockIds: string[];
};

/**
 * Finds the nearest containing body owner for every compound group. Parent
 * chains are walked iteratively with per-owner cycle guards; malformed cycles
 * are then cut deterministically so every component retains an outer frame.
 */
export function createFunctionLogicBodyHierarchy<Group extends FunctionLogicBodyGroup>(
  blocks: FunctionLogicBodyBlock[],
  groups: Group[]
): FunctionLogicBodyHierarchy<Group> {
  const blocksById = new Map(blocks.map((block) => [block.id, block]));
  const groupsByOwnerBlockId = new Map(
    groups.map((group) => [group.ownerBlockId, group])
  );
  const parentOwnerBlockIdByOwnerBlockId = new Map<string, string>();

  for (const group of groups) {
    const visitedBlockIds = new Set([group.ownerBlockId]);
    let candidateId = blocksById.get(group.ownerBlockId)?.parentBlockId;
    while (candidateId && !visitedBlockIds.has(candidateId)) {
      visitedBlockIds.add(candidateId);
      if (groupsByOwnerBlockId.has(candidateId)) {
        parentOwnerBlockIdByOwnerBlockId.set(group.ownerBlockId, candidateId);
        break;
      }
      candidateId = blocksById.get(candidateId)?.parentBlockId;
    }
  }

  // A malformed analyzer cycle must not hide every body in that component.
  for (const group of groups) {
    const path: string[] = [];
    const pathIndexByOwnerId = new Map<string, number>();
    let cursor: string | undefined = group.ownerBlockId;
    while (cursor) {
      const cycleStart = pathIndexByOwnerId.get(cursor);
      if (cycleStart !== undefined) {
        const cycleOwnerIds = path.slice(cycleStart).sort((left, right) =>
          left.localeCompare(right)
        );
        const outerFallback = cycleOwnerIds[0];
        if (outerFallback) parentOwnerBlockIdByOwnerBlockId.delete(outerFallback);
        break;
      }
      pathIndexByOwnerId.set(cursor, path.length);
      path.push(cursor);
      cursor = parentOwnerBlockIdByOwnerBlockId.get(cursor);
    }
  }

  const outerOwnerBlockIds = groups
    .map((group) => group.ownerBlockId)
    .filter((ownerBlockId) => !parentOwnerBlockIdByOwnerBlockId.has(ownerBlockId));
  if (outerOwnerBlockIds.length === 0 && groups[0]) {
    outerOwnerBlockIds.push(groups[0].ownerBlockId);
  }

  return {
    groupsByOwnerBlockId,
    parentOwnerBlockIdByOwnerBlockId,
    outerOwnerBlockIds
  };
}

/**
 * Shows every outer body initially, or exactly one selected body after drill-in.
 * The breadcrumb path is assembled with a visited set instead of recursion.
 */
export function createFunctionLogicBodyFocusProjection<
  Group extends FunctionLogicBodyGroup
>(
  hierarchy: FunctionLogicBodyHierarchy<Group>,
  requestedOwnerBlockId?: string
): FunctionLogicBodyFocusProjection<Group> {
  const focusedOwnerBlockId = requestedOwnerBlockId
    && hierarchy.groupsByOwnerBlockId.has(requestedOwnerBlockId)
    ? requestedOwnerBlockId
    : undefined;
  if (!focusedOwnerBlockId) {
    return {
      visibleGroups: hierarchy.outerOwnerBlockIds
        .map((ownerBlockId) => hierarchy.groupsByOwnerBlockId.get(ownerBlockId))
        .filter((group): group is Group => Boolean(group)),
      pathOwnerBlockIds: []
    };
  }

  const reversePath: string[] = [];
  const visitedOwnerIds = new Set<string>();
  let cursor: string | undefined = focusedOwnerBlockId;
  while (cursor && !visitedOwnerIds.has(cursor)) {
    visitedOwnerIds.add(cursor);
    reversePath.push(cursor);
    cursor = hierarchy.parentOwnerBlockIdByOwnerBlockId.get(cursor);
  }
  reversePath.reverse();

  const focusedGroup = hierarchy.groupsByOwnerBlockId.get(focusedOwnerBlockId);
  return {
    focusedOwnerBlockId,
    visibleGroups: focusedGroup ? [focusedGroup] : [],
    pathOwnerBlockIds: reversePath
  };
}
