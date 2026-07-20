/**
 * Browser-side compound-scene builder for the Function Visualizer. It merges
 * lazily loaded function fragments into one bounded graph and recomputes a
 * layered layout whose orthogonal routes stay inside empty rank gaps.
 */

import { getCompoundFunctionLogicDimensionsSource } from "./compoundFunctionLogicDimensionsSource";
import { getCompoundFunctionLogicRoutingSource } from "./compoundFunctionLogicRoutingSource";

/** Returns CSP-compatible helpers for composing attached functions in one canvas. */
export function getCompoundFunctionLogicGraphSource(): string {
  return /* js */ `
    const COMPOUND_LANE_GAP = 44;
    const COMPOUND_RANK_GAP = 84;
    const COMPOUND_MARGIN_X = 44;
    const COMPOUND_MARGIN_Y = 32;
    const COMPOUND_CHANNEL_GAP = 16;
    const COMPOUND_CHANNEL_OFFSET = 28;
    const COMPOUND_EDGE_TRACK_GAP = 12;
    const COMPOUND_EDGE_TRACK_PADDING = 16;
    const COMPOUND_NODE_PORT_PADDING = 18;

    ${getCompoundFunctionLogicDimensionsSource()}
    ${getCompoundFunctionLogicRoutingSource()}

    /**
     * Namespaces every function fragment, adds callsite connectors, and lays
     * the resulting control blocks out as one graph rather than nested views.
     */
    function createAttachedFunctionGraphScene(
      rootLogic,
      rootScopeId,
      rootTitle,
      expansions
    ) {
      const orderedScopes = [{
        id: rootScopeId,
        title: rootTitle,
        logic: rootLogic,
        expansion: undefined,
        isRoot: true
      }];
      const knownScopeIds = new Set([rootScopeId]);
      const pendingScopeIds = [rootScopeId];
      let scopeCursor = 0;

      // Expansion state is a tree, but an explicit queue keeps deep code flows
      // bounded by the browser limits without recursive rendering or traversal.
      while (scopeCursor < pendingScopeIds.length) {
        const parentScopeId = pendingScopeIds[scopeCursor];
        scopeCursor += 1;
        for (const expansion of expansions) {
          if (expansion.parentScopeId !== parentScopeId || knownScopeIds.has(expansion.id)) {
            continue;
          }
          knownScopeIds.add(expansion.id);
          pendingScopeIds.push(expansion.id);
          orderedScopes.push(createAttachedFunctionScope(expansion));
        }
      }

      const blocks = [];
      const edges = [];
      const valueBindings = [];
      const valueFlows = [];
      const dimensionsByBlockId = new Map();
      const routeHintByEdgeId = new Map();
      const compoundBlockIdByScopeBlock = new Map();
      const compoundBindingIdByScopeBinding = new Map();
      const blockIdentityById = new Map();
      const firstBlockIdByScopeId = new Map();
      const terminalBlockIdsByScopeId = new Map();

      // Namespace every identity before copying blocks so parent references do
      // not depend on source order and cannot collide across attached scopes.
      for (const scope of orderedScopes) {
        for (const block of scope.logic.blocks) {
          compoundBlockIdByScopeBlock.set(
            createScopeBlockKey(scope.id, block.id),
            createCompoundBlockId(scope.id, block.id)
          );
        }
        for (const binding of scope.logic.valueBindings || []) {
          compoundBindingIdByScopeBinding.set(
            createScopeBindingKey(scope.id, binding.id),
            createCompoundBindingId(scope.id, binding.id)
          );
        }
      }

      for (const scope of orderedScopes) {
        const nodeLayoutByBlockId = new Map(
          scope.logic.layout.nodes.map((node) => [node.blockId, node])
        );
        for (let blockIndex = 0; blockIndex < scope.logic.blocks.length; blockIndex += 1) {
          const block = scope.logic.blocks[blockIndex];
          const compoundBlockId = compoundBlockIdByScopeBlock.get(
            createScopeBlockKey(scope.id, block.id)
          );
          if (!compoundBlockId) continue;
          const sourceLayout = nodeLayoutByBlockId.get(block.id);
          const functionLabel = scope.isRoot
            ? undefined
            : completeAttachedFunctionLabel(scope.title);
          const compoundBlock = {
            ...block,
            id: compoundBlockId,
            parentBlockId: block.parentBlockId
              ? compoundBlockIdByScopeBlock.get(
                  createScopeBlockKey(scope.id, block.parentBlockId)
                )
              : undefined,
            valueAccesses: (block.valueAccesses || []).flatMap((access) => {
              const bindingId = compoundBindingIdByScopeBinding.get(
                createScopeBindingKey(scope.id, access.bindingId)
              );
              return bindingId ? [{ ...access, bindingId }] : [];
            }),
            functionLabel,
            functionScopeId: scope.id,
            sourceBlockId: block.id
          };
          blocks.push(compoundBlock);
          blockIdentityById.set(compoundBlockId, {
            scopeId: scope.id,
            sourceBlockId: block.id
          });
          if (!firstBlockIdByScopeId.has(scope.id) || block.kind === "entry") {
            firstBlockIdByScopeId.set(scope.id, compoundBlockId);
          }
          dimensionsByBlockId.set(compoundBlockId, measureCompoundBlockDimensions(
            compoundBlock,
            {
              width: sourceLayout?.width || 184,
              height: sourceLayout?.height || 72
            }
          ));
        }

        const sourceEdgeLayoutById = new Map(
          scope.logic.layout.edges.map((edge) => [edge.edgeId, edge])
        );
        for (const edge of scope.logic.edges) {
          const sourceId = compoundBlockIdByScopeBlock.get(
            createScopeBlockKey(scope.id, edge.sourceId)
          );
          const targetId = compoundBlockIdByScopeBlock.get(
            createScopeBlockKey(scope.id, edge.targetId)
          );
          if (!sourceId || !targetId) continue;
          const compoundEdgeId = createCompoundEdgeId(scope.id, edge.id);
          edges.push({ ...edge, id: compoundEdgeId, sourceId, targetId });
          routeHintByEdgeId.set(
            compoundEdgeId,
            sourceEdgeLayoutById.get(edge.id)?.route || "forward"
          );
        }

        for (const binding of scope.logic.valueBindings || []) {
          const id = compoundBindingIdByScopeBinding.get(
            createScopeBindingKey(scope.id, binding.id)
          );
          const definitionBlockId = compoundBlockIdByScopeBlock.get(
            createScopeBlockKey(scope.id, binding.definitionBlockId)
          );
          if (id && definitionBlockId) {
            valueBindings.push({ ...binding, id, definitionBlockId });
          }
        }
        for (const valueFlow of scope.logic.valueFlows || []) {
          const bindingId = compoundBindingIdByScopeBinding.get(
            createScopeBindingKey(scope.id, valueFlow.bindingId)
          );
          const sourceBlockId = compoundBlockIdByScopeBlock.get(
            createScopeBlockKey(scope.id, valueFlow.sourceBlockId)
          );
          const targetBlockId = compoundBlockIdByScopeBlock.get(
            createScopeBlockKey(scope.id, valueFlow.targetBlockId)
          );
          if (bindingId && sourceBlockId && targetBlockId) {
            valueFlows.push({
              ...valueFlow,
              id: createCompoundValueFlowId(scope.id, valueFlow.id),
              bindingId,
              sourceBlockId,
              targetBlockId
            });
          }
        }

        const explicitExitIds = scope.logic.blocks
          .filter((block) => block.kind === "exit")
          .map((block) => compoundBlockIdByScopeBlock.get(
            createScopeBlockKey(scope.id, block.id)
          ))
          .filter(Boolean);
        const localOutgoingSourceIds = new Set(scope.logic.edges.map((edge) => edge.sourceId));
        const fallbackTerminalIds = scope.logic.blocks
          .filter((block) => !localOutgoingSourceIds.has(block.id))
          .map((block) => compoundBlockIdByScopeBlock.get(
            createScopeBlockKey(scope.id, block.id)
          ))
          .filter(Boolean);
        terminalBlockIdsByScopeId.set(
          scope.id,
          explicitExitIds.length > 0 ? explicitExitIds : fallbackTerminalIds
        );
      }

      attachFunctionScopesToCallsites({
        orderedScopes,
        blocks,
        edges,
        dimensionsByBlockId,
        routeHintByEdgeId,
        compoundBlockIdByScopeBlock,
        firstBlockIdByScopeId,
        terminalBlockIdsByScopeId
      });

      return {
        logic: {
          ...rootLogic,
          blocks,
          edges,
          valueBindings,
          valueFlows,
          layout: createCompoundFunctionGraphLayout(
            blocks,
            edges,
            dimensionsByBlockId,
            routeHintByEdgeId
          )
        },
        blockIdentityById,
        attachedFunctionCount: Math.max(0, orderedScopes.length - 1)
      };
    }

    /**
     * Inserts synchronous children before a caller continuation and attaches
     * event handlers as terminal dispatch branches. Event handlers deliberately
     * receive no return edge because dispatch does not resume registration code.
     */
    function attachFunctionScopesToCallsites(scene) {
      const scopesById = new Map(scene.orderedScopes.map((scope) => [scope.id, scope]));
      const blocksById = new Map(scene.blocks.map((block) => [block.id, block]));
      const expansionsByAnchor = new Map();
      for (const scope of scene.orderedScopes) {
        const expansion = scope.expansion;
        if (!expansion) continue;
        const anchorKey = createScopeBlockKey(
          expansion.parentScopeId,
          expansion.anchorBlockId
        );
        const values = expansionsByAnchor.get(anchorKey) || [];
        values.push(expansion);
        expansionsByAnchor.set(anchorKey, values);
      }

      for (const [anchorKey, expansions] of expansionsByAnchor) {
        const firstExpansion = expansions[0];
        if (!firstExpansion) continue;
        const sourceId = scene.compoundBlockIdByScopeBlock.get(anchorKey);
        const sourceBlock = sourceId ? blocksById.get(sourceId) : undefined;
        if (!sourceId || !sourceBlock) continue;
        const callerScope = scopesById.get(firstExpansion.parentScopeId);
        const synchronousExpansions = expansions.filter((expansion) =>
          expansion.target.relation !== "event"
        );
        const firstSynchronousExpansion = synchronousExpansions[0];
        const callerOutgoing = scene.edges.filter((edge) =>
          edge.sourceId === sourceId && !edge.relation
        );
        let continuationId;

        if (firstSynchronousExpansion && callerOutgoing.length > 0) {
          continuationId = "compound-resume:" + anchorKey;
          const sourceDimensions = scene.dimensionsByBlockId.get(sourceId)
            || { width: 184, height: 72 };
          const continuationBlock = {
            id: continuationId,
            kind: isControlContinuationKind(sourceBlock.kind)
              ? sourceBlock.kind
              : "operation",
            label: "Resume · " + completeAttachedContinuationLabel(sourceBlock.label),
            detail: firstSynchronousExpansion.target.relation === "render"
              ? "The rendered component flow rejoins the parent render path here."
              : "Called code returns here before the caller continues.",
            depth: sourceBlock.depth,
            branchLabel: "after child",
            confidence: sourceBlock.confidence,
            parentBlockId: sourceBlock.parentBlockId,
            functionLabel: callerScope?.isRoot
              ? undefined
              : completeAttachedFunctionLabel(callerScope?.title)
          };
          scene.blocks.push(continuationBlock);
          blocksById.set(continuationId, continuationBlock);
          scene.dimensionsByBlockId.set(
            continuationId,
            measureCompoundBlockDimensions(continuationBlock, {
              width: Math.max(COMPOUND_MIN_NODE_WIDTH, sourceDimensions.width),
              height: 76
            })
          );
          for (const edge of callerOutgoing) edge.sourceId = continuationId;
        }

        for (const expansion of expansions) {
          const targetId = scene.firstBlockIdByScopeId.get(expansion.id);
          if (!targetId) continue;
          const eventHandler = expansion.target.relation === "event";
          const callEdgeId = (eventHandler ? "attached-event:" : "attached-call:")
            + expansion.id;
          scene.edges.push({
            id: callEdgeId,
            sourceId,
            targetId,
            kind: "next",
            label: (eventHandler
              ? "event handler "
              : expansion.target.relation === "render" ? "renders " : "calls ")
              + attachedFunctionTargetLabel(expansion),
            confidence: expansion.target.confidence === "inferred" ? "inferred" : "exact",
            relation: eventHandler ? "event" : "call"
          });
          scene.routeHintByEdgeId.set(callEdgeId, "forward");

          if (eventHandler || !continuationId) continue;
          const terminalIds = scene.terminalBlockIdsByScopeId.get(expansion.id) || [];
          for (let terminalIndex = 0; terminalIndex < terminalIds.length; terminalIndex += 1) {
            const returnEdgeId = "attached-return:" + expansion.id + ":" + terminalIndex;
            scene.edges.push({
              id: returnEdgeId,
              sourceId: terminalIds[terminalIndex],
              targetId: continuationId,
              kind: "next",
              label: expansion.target.relation === "render"
                ? "returns to render path"
                : "returns to caller",
              confidence: expansion.target.confidence === "inferred" ? "inferred" : "exact",
              relation: "callReturn"
            });
            scene.routeHintByEdgeId.set(returnEdgeId, "forward");
          }
        }
      }
    }

    /** Retains decision styling on the post-call continuation gateway. */
    function isControlContinuationKind(kind) {
      return kind === "condition" || kind === "loop" || kind === "switch" || kind === "try";
    }

    /** Preserves the complete caller cue shown in a continuation box. */
    function completeAttachedContinuationLabel(label) {
      return String(label || "caller flow");
    }

    /** Converts loading, cycle, limit, and failure states into real graph nodes. */
    function createAttachedFunctionScope(expansion) {
      if (expansion.status === "loaded" && expansion.detail?.logic) {
        return {
          id: expansion.id,
          title: expansion.detail.title || attachedFunctionTargetLabel(expansion),
          logic: expansion.detail.logic,
          expansion,
          isRoot: false
        };
      }

      const targetLabel = attachedFunctionTargetLabel(expansion);
      const status = createAttachedFunctionStatus(expansion.status, targetLabel, expansion.error);
      const blockId = "attached-status";
      return {
        id: expansion.id,
        title: targetLabel,
        expansion,
        isRoot: false,
        logic: {
          blocks: [{
            id: blockId,
            kind: "unknown",
            label: status.label,
            detail: status.detail,
            depth: expansion.depth,
            confidence: expansion.target.confidence === "inferred" ? "inferred" : "exact"
          }],
          edges: [],
          layout: {
            width: 252,
            height: 104,
            nodes: [{
              blockId,
              x: 0,
              y: 0,
              width: 252,
              height: 86,
              rank: 0,
              lane: 0
            }],
            edges: []
          }
        }
      };
    }

    /** Creates honest graph-node copy for an expansion that has no child CFG yet. */
    function createAttachedFunctionStatus(status, targetLabel, error) {
      if (status === "cycle") {
        return {
          label: "Call cycle · " + targetLabel,
          detail: "This function is already visible in the ancestor flow."
        };
      }
      if (status === "limited") {
        return {
          label: "Depth limit · " + targetLabel,
          detail: "The attached-function depth limit was reached."
        };
      }
      if (status === "failed") {
        return {
          label: targetLabel + " unavailable",
          detail: error || "This related function flow is unavailable."
        };
      }
      return {
        label: "Loading · " + targetLabel,
        detail: "Reading the related function body into this graph."
      };
    }

    /** Assigns layered ranks and variable-size boxes for the merged function DAG. */
    function createCompoundFunctionGraphLayout(
      blocks,
      edges,
      dimensionsByBlockId,
      routeHintByEdgeId
    ) {
      if (blocks.length === 0) {
        return { width: 0, height: 0, nodes: [], edges: [] };
      }
      const blocksById = new Map(blocks.map((block) => [block.id, block]));
      const blockIndexById = new Map(blocks.map((block, index) => [block.id, index]));
      const validEdges = edges.filter((edge) =>
        blocksById.has(edge.sourceId) && blocksById.has(edge.targetId)
      );
      const backEdgeIds = new Set(validEdges.filter((edge) => {
        const hint = routeHintByEdgeId.get(edge.id);
        if (hint === "back") return true;
        const sourceIndex = blockIndexById.get(edge.sourceId) || 0;
        const targetIndex = blockIndexById.get(edge.targetId) || 0;
        return (edge.kind === "repeat" || edge.kind === "continue")
          && targetIndex <= sourceIndex;
      }).map((edge) => edge.id));
      const rankByBlockId = assignCompoundFunctionRanks(
        blocks,
        validEdges,
        backEdgeIds,
        blockIndexById
      );
      const blocksByRank = new Map();
      for (const block of blocks) {
        const rank = rankByBlockId.get(block.id) || 0;
        const values = blocksByRank.get(rank) || [];
        values.push(block);
        blocksByRank.set(rank, values);
      }
      const orderedRanks = [...blocksByRank.keys()].sort((left, right) => left - right);
      orderCompoundBlocksByParentLane(
        blocksByRank,
        orderedRanks,
        validEdges,
        rankByBlockId,
        backEdgeIds,
        blockIndexById
      );
      const contentWidth = Math.max(252, ...orderedRanks.map((rank) => {
        const rankBlocks = blocksByRank.get(rank) || [];
        return rankBlocks.reduce((total, block, index) => {
          const dimensions = dimensionsByBlockId.get(block.id) || { width: 184, height: 72 };
          return total + dimensions.width + (index > 0 ? COMPOUND_LANE_GAP : 0);
        }, 0);
      }));
      const channelEdges = validEdges.filter((edge) => {
        const sourceRank = rankByBlockId.get(edge.sourceId) || 0;
        const targetRank = rankByBlockId.get(edge.targetId) || 0;
        return backEdgeIds.has(edge.id)
          || routeHintByEdgeId.get(edge.id) === "long"
          || targetRank !== sourceRank + 1;
      });
      const contentRight = COMPOUND_MARGIN_X + contentWidth;
      const channelSpace = channelEdges.length > 0
        ? COMPOUND_CHANNEL_OFFSET + channelEdges.length * COMPOUND_CHANNEL_GAP
        : 0;
      const width = contentRight + COMPOUND_MARGIN_X + channelSpace;
      const nodes = [];
      const rankBounds = new Map();
      const rankSpacing = createCompoundRankSpacing(
        orderedRanks,
        validEdges,
        rankByBlockId,
        backEdgeIds,
        routeHintByEdgeId
      );
      let nextY = rankSpacing.topMargin;

      for (const rank of orderedRanks) {
        const rankBlocks = blocksByRank.get(rank) || [];
        const rankHeight = Math.max(...rankBlocks.map((block) =>
          (dimensionsByBlockId.get(block.id) || { width: 184, height: 72 }).height
        ));
        const rankWidth = rankBlocks.reduce((total, block, index) => {
          const dimensions = dimensionsByBlockId.get(block.id) || { width: 184, height: 72 };
          return total + dimensions.width + (index > 0 ? COMPOUND_LANE_GAP : 0);
        }, 0);
        let nextX = COMPOUND_MARGIN_X + (contentWidth - rankWidth) / 2;
        for (let lane = 0; lane < rankBlocks.length; lane += 1) {
          const block = rankBlocks[lane];
          const dimensions = dimensionsByBlockId.get(block.id) || { width: 184, height: 72 };
          nodes.push({
            blockId: block.id,
            x: Math.round(nextX),
            y: Math.round(nextY + (rankHeight - dimensions.height) / 2),
            width: dimensions.width,
            height: dimensions.height,
            rank,
            lane
          });
          nextX += dimensions.width + COMPOUND_LANE_GAP;
        }
        rankBounds.set(rank, { top: nextY, bottom: nextY + rankHeight });
        nextY += rankHeight + (rankSpacing.gapAfterRank.get(rank) || COMPOUND_RANK_GAP);
      }

      const bottom = Math.max(...nodes.map((node) => node.y + node.height));
      const height = bottom + rankSpacing.bottomMargin
        + (channelEdges.length > 0 ? COMPOUND_CHANNEL_OFFSET : 0);
      const nodeLayoutById = new Map(nodes.map((node) => [node.blockId, node]));
      const channelIndexByEdgeId = new Map(
        channelEdges.map((edge, index) => [edge.id, index])
      );
      const edgeRouting = createCompoundEdgeRoutingIndex(
        validEdges,
        nodeLayoutById,
        rankByBlockId,
        backEdgeIds,
        routeHintByEdgeId
      );
      const routedEdges = validEdges.map((edge) => routeCompoundFunctionEdge(
        edge,
        nodeLayoutById,
        rankBounds,
        rankByBlockId,
        backEdgeIds,
        routeHintByEdgeId,
        channelIndexByEdgeId,
        edgeRouting,
        contentRight
      )).filter(Boolean);
      return { width: Math.round(width), height: Math.round(height), nodes, edges: routedEdges };
    }

    /** Computes longest-path ranks after excluding explicit loop-back transfers. */
    function assignCompoundFunctionRanks(
      blocks,
      edges,
      backEdgeIds,
      blockIndexById
    ) {
      const indegreeById = new Map(blocks.map((block) => [block.id, 0]));
      const outgoingById = new Map();
      const rankConstraints = createCompoundForwardRankConstraints(
        blocks,
        edges,
        backEdgeIds
      );
      for (const constraint of rankConstraints) {
        indegreeById.set(
          constraint.targetId,
          (indegreeById.get(constraint.targetId) || 0) + 1
        );
        const outgoing = outgoingById.get(constraint.sourceId) || [];
        outgoing.push(constraint);
        outgoingById.set(constraint.sourceId, outgoing);
      }
      const rankById = new Map(blocks.map((block) => [block.id, 0]));
      const ready = blocks.filter((block) => (indegreeById.get(block.id) || 0) === 0);
      let readyCursor = 0;
      const processed = new Set();
      while (readyCursor < ready.length) {
        const block = ready[readyCursor];
        readyCursor += 1;
        if (processed.has(block.id)) continue;
        processed.add(block.id);
        const sourceRank = rankById.get(block.id) || 0;
        const outgoing = outgoingById.get(block.id) || [];
        outgoing.sort((left, right) =>
          (blockIndexById.get(left.targetId) || 0) - (blockIndexById.get(right.targetId) || 0)
            || left.orderKey.localeCompare(right.orderKey)
        );
        for (const constraint of outgoing) {
          rankById.set(
            constraint.targetId,
            Math.max(rankById.get(constraint.targetId) || 0, sourceRank + 1)
          );
          const nextIndegree = Math.max(
            0,
            (indegreeById.get(constraint.targetId) || 0) - 1
          );
          indegreeById.set(constraint.targetId, nextIndegree);
          if (nextIndegree === 0) {
            const target = blocks[blockIndexById.get(constraint.targetId) ?? -1];
            if (target) ready.push(target);
          }
        }
      }
      let fallbackRank = Math.max(0, ...rankById.values());
      for (const block of blocks) {
        if (processed.has(block.id)) continue;
        fallbackRank += 1;
        rankById.set(block.id, fallbackRank);
      }
      return rankById;
    }

    /** Keeps post-loop continuations below every body terminal in the visual DAG. */
    function createCompoundForwardRankConstraints(blocks, edges, backEdgeIds) {
      const blocksById = new Map(blocks.map((block) => [block.id, block]));
      const constraints = [];
      const constraintKeys = new Set();
      const exitEdgesByLoopId = new Map();

      for (const edge of edges) {
        if (backEdgeIds.has(edge.id)) continue;
        addCompoundRankConstraint(
          constraints,
          constraintKeys,
          edge.sourceId,
          edge.targetId,
          edge.id
        );
        if ((blocksById.get(edge.sourceId) || {}).kind === "loop" && edge.kind === "exit") {
          const exits = exitEdgesByLoopId.get(edge.sourceId) || [];
          exits.push(edge);
          exitEdgesByLoopId.set(edge.sourceId, exits);
        }
      }

      for (const backEdge of edges) {
        if (!backEdgeIds.has(backEdge.id)
          || (blocksById.get(backEdge.targetId) || {}).kind !== "loop") {
          continue;
        }
        for (const exitEdge of exitEdgesByLoopId.get(backEdge.targetId) || []) {
          addCompoundRankConstraint(
            constraints,
            constraintKeys,
            backEdge.sourceId,
            exitEdge.targetId,
            "loop-boundary:" + backEdge.id + ":" + exitEdge.id
          );
        }
      }
      return constraints;
    }

    /** Adds one layout-only rank edge without changing the rendered control graph. */
    function addCompoundRankConstraint(
      constraints,
      keys,
      sourceId,
      targetId,
      orderKey
    ) {
      const key = sourceId + "\\0" + targetId;
      if (keys.has(key)) return;
      keys.add(key);
      constraints.push({ sourceId, targetId, orderKey });
    }

    /** Routes adjacent edges in rank gaps and non-local edges through outer channels. */
    function routeCompoundFunctionEdge(
      edge,
      nodeLayoutById,
      rankBounds,
      rankByBlockId,
      backEdgeIds,
      routeHintByEdgeId,
      channelIndexByEdgeId,
      edgeRouting,
      contentRight
    ) {
      const source = nodeLayoutById.get(edge.sourceId);
      const target = nodeLayoutById.get(edge.targetId);
      if (!source || !target) return undefined;
      const sourceRank = rankByBlockId.get(edge.sourceId) || 0;
      const targetRank = rankByBlockId.get(edge.targetId) || 0;
      const routing = edgeRouting.get(edge.id) || {};
      const sourcePoint = {
        x: routing.sourceX ?? source.x + source.width / 2,
        y: source.y + source.height
      };
      const targetPoint = {
        x: routing.targetX ?? target.x + target.width / 2,
        y: target.y
      };
      const adjacent = isCompoundAdjacentEdge(
        edge,
        sourceRank,
        targetRank,
        backEdgeIds,
        routeHintByEdgeId
      );
      if (adjacent) {
        const sourceBounds = rankBounds.get(sourceRank);
        const gapY = (sourceBounds?.bottom || sourcePoint.y)
          + COMPOUND_EDGE_TRACK_PADDING
          + (routing.sourceTrackIndex || 0) * COMPOUND_EDGE_TRACK_GAP;
        return {
          edgeId: edge.id,
          points: compactCompoundRoute([
            sourcePoint,
            { x: sourcePoint.x, y: gapY },
            { x: targetPoint.x, y: gapY },
            targetPoint
          ]),
          labelX: (sourcePoint.x + targetPoint.x) / 2,
          labelY: gapY - 5,
          route: "forward"
        };
      }

      const channelIndex = channelIndexByEdgeId.get(edge.id) || 0;
      const channelX = contentRight + COMPOUND_CHANNEL_OFFSET
        + channelIndex * COMPOUND_CHANNEL_GAP;
      const sourceBounds = rankBounds.get(sourceRank);
      const targetBounds = rankBounds.get(targetRank);
      const sourceGapY = (sourceBounds?.bottom || sourcePoint.y)
        + COMPOUND_EDGE_TRACK_PADDING
        + (routing.sourceTrackIndex || 0) * COMPOUND_EDGE_TRACK_GAP;
      const targetGapY = Math.max(6,
        (targetBounds?.top || targetPoint.y)
          - COMPOUND_EDGE_TRACK_PADDING
          - (routing.targetTrackIndex || 0) * COMPOUND_EDGE_TRACK_GAP
      );
      return {
        edgeId: edge.id,
        points: compactCompoundRoute([
          sourcePoint,
          { x: sourcePoint.x, y: sourceGapY },
          { x: channelX, y: sourceGapY },
          { x: channelX, y: targetGapY },
          { x: targetPoint.x, y: targetGapY },
          targetPoint
        ]),
        labelX: channelX - 5,
        labelY: (sourceGapY + targetGapY) / 2,
        route: targetRank <= sourceRank ? "back" : "long"
      };
    }

    /** Drops duplicate turns while retaining an orthogonal polyline. */
    function compactCompoundRoute(points) {
      const compact = [];
      for (const point of points) {
        const previous = compact[compact.length - 1];
        if (previous && previous.x === point.x && previous.y === point.y) continue;
        compact.push({ x: Math.round(point.x), y: Math.round(point.y) });
      }
      return compact;
    }

    /** Creates stable browser-only identities without exposing new Host authority. */
    function createCompoundBlockId(scopeId, blockId) {
      return "compound-block:" + scopeId + ":" + blockId;
    }

    /** Creates stable browser-only edge identities inside one compound scene. */
    function createCompoundEdgeId(scopeId, edgeId) {
      return "compound-edge:" + scopeId + ":" + edgeId;
    }

    /** Namespaces one value binding inside its attached function scope. */
    function createCompoundBindingId(scopeId, bindingId) {
      return "compound-binding:" + scopeId + ":" + bindingId;
    }

    /** Namespaces one value-flow relation inside its attached function scope. */
    function createCompoundValueFlowId(scopeId, valueFlowId) {
      return "compound-value-flow:" + scopeId + ":" + valueFlowId;
    }

    /** Indexes an original block within its function scope. */
    function createScopeBlockKey(scopeId, blockId) {
      return scopeId + "::" + blockId;
    }

    /** Joins scope and binding identities without relying on display labels. */
    function createScopeBindingKey(scopeId, bindingId) {
      return scopeId + "\u0000" + bindingId;
    }

    /** Returns the safest visible label for an attached function target. */
    function attachedFunctionTargetLabel(expansion) {
      return expansion.target.qualifiedName || expansion.target.name || "Called function";
    }

    /** Preserves the complete function badge inside variable-size graph boxes. */
    function completeAttachedFunctionLabel(label) {
      return String(label || "Called function");
    }
  `;
}
