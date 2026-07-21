/**
 * Keyed scene renderer for the Module Flow Webview.
 *
 * The browser program separates structural invalidation from selection,
 * loading, viewport, and animation state. Existing cards and SVG groups keep
 * their DOM identity across expansion/collapse, while layout and writes are
 * coalesced through one animation-frame scheduler.
 */

/** Returns scene reconciliation and frame-commit functions for the Webview. */
export function getModuleVisualizerGraphRendererSource(): string {
  return /* javascript */ `
    /** Marks either structure or lightweight presentation dirty for one frame. */
    function renderGraph(anchor, sceneChanged) {
      if (sceneChanged) state.sceneDirty = true;
      else state.presentationDirty = true;
      if (anchor) state.pendingAnchor = anchor;
      queueGraphCommit({});
    }

    /** Merges dirty flags without allocating another animation-frame callback. */
    function queueGraphCommit(options) {
      if (options && options.viewport) state.viewportDirty = true;
      if (options && options.presentation) state.presentationDirty = true;
      state.frameScheduler.schedule();
    }

    /** Commits the latest structure, viewport, and class state in stable order. */
    function flushGraphCommit() {
      const rebuildScene = state.sceneDirty || !state.layout;
      const anchor = state.pendingAnchor;
      const pendingZoom = state.pendingZoom;
      const pendingResizeCenter = state.pendingResizeCenter;
      const updateViewport = state.viewportDirty;
      state.sceneDirty = false;
      state.presentationDirty = false;
      state.viewportDirty = false;
      state.pendingAnchor = undefined;
      state.pendingZoom = undefined;
      state.pendingResizeCenter = undefined;

      if (rebuildScene) rebuildModuleFlowScene(anchor);
      if (pendingResizeCenter && state.layout) {
        applyModuleFlowViewportFrame(state.layout);
        restoreModuleFlowWorldCenter(pendingResizeCenter);
      } else if (updateViewport && !pendingZoom && state.layout) {
        applyModuleFlowViewportFrame(state.layout);
      }
      if (pendingZoom && state.layout) applyPendingModuleFlowZoom(pendingZoom);
      applyModuleFlowPresentationState();
    }

    /** Builds presentation inputs only after the merged scene has changed. */
    function rebuildModuleFlowScene(anchor) {
      const scene = collectScene();
      state.nodesById = scene.nodes;
      state.edgesById = scene.edges;
      const depthByModuleId = createModuleDepthIndex(scene.nodes);
      const layoutNodes = [];
      const layoutEdges = [];
      for (const node of scene.nodes.values()) layoutNodes.push(toLayoutNode(node));
      for (const edge of scene.edges.values()) {
        layoutEdges.push({
          id: edge.id,
          sourceId: edge.sourceId,
          targetId: edge.targetId,
          label: edgeLabel(edge),
          kind: edge.presentationKind
        });
      }
      layoutNodes.sort(function (left, right) { return compareModuleFlowIdentity(left.id, right.id); });
      layoutEdges.sort(function (left, right) { return compareModuleFlowIdentity(left.id, right.id); });
      // The Host snapshot and expansion identities already define structure.
      // Keeping serialized node/edge payloads as cache keys duplicated the
      // complete scene up to four times and made every rebuild stringify it.
      const expansionLayoutKeys = Array.from(state.expansions.entryPairs()).map(function (pair) {
        const payloadRevision = pair[1] && Number.isInteger(pair[1].requestId)
          ? pair[1].requestId
          : 0;
        return pair[0] + ":" + payloadRevision;
      });
      const layoutKey = state.baseSceneKey + "\\n"
        + expansionLayoutKeys.sort(compareModuleFlowIdentity).join("\\n");
      let layout = state.layoutCache.get(layoutKey);
      if (!layout) {
        layout = createModuleFlowGraphLayout(layoutNodes, layoutEdges);
        state.layoutCache.set(layoutKey, layout);
      }
      state.layout = layout;
      state.layoutByNodeId = new Map(layout.nodes.map(function (node) { return [node.nodeId, node]; }));
      applyModuleFlowViewportFrame(layout);
      reconcileModuleFlowCycles(layout);
      const createdEdgeIds = reconcileModuleFlowEdges(layout, scene.edges);
      const createdNodeIds = reconcileModuleFlowNodes(layout, scene.nodes, depthByModuleId);
      state.enteringNodeIds = intersectModuleFlowIds(state.enteringNodeIds, createdNodeIds);
      state.enteringEdgeIds = intersectModuleFlowIds(state.enteringEdgeIds, createdEdgeIds);
      restoreViewportAnchor(anchor, layout);
      scheduleModuleFlowEntryCleanup();
    }

    /** Uses locale-independent opaque identity ordering in structural cache keys. */
    function compareModuleFlowIdentity(left, right) {
      return left < right ? -1 : left > right ? 1 : 0;
    }

    /** Keeps only newly allocated delta elements eligible for entry animation. */
    function intersectModuleFlowIds(candidates, createdIds) {
      const result = new Set();
      for (const identity of candidates) {
        if (createdIds.has(identity)) result.add(identity);
      }
      return result;
    }

    /** Applies one transform to the shared world and sizes only the scroll stage. */
    function applyModuleFlowViewportFrame(layout) {
      const frame = createModuleFlowViewportFrame({
        worldWidth: layout.width,
        worldHeight: layout.height,
        viewportWidth: dom.viewport.clientWidth,
        viewportHeight: dom.viewport.clientHeight,
        scale: state.scale,
        padding: MODULE_FLOW_STAGE_PADDING
      });
      state.scale = frame.scale;
      state.viewportFrame = frame;
      dom.stage.style.width = frame.stageWidth + "px";
      dom.stage.style.height = frame.stageHeight + "px";
      dom.scene.style.width = layout.width + "px";
      dom.scene.style.height = layout.height + "px";
      dom.scene.style.transformOrigin = "0 0";
      dom.scene.style.transform = "translate3d(" + frame.offsetX + "px, " + frame.offsetY + "px, 0) scale(" + frame.scale + ")";
      for (const layer of [dom.cycles, dom.edges, dom.nodes]) {
        layer.style.width = layout.width + "px";
        layer.style.height = layout.height + "px";
      }
      dom.edges.setAttribute("viewBox", "0 0 " + Math.max(1, layout.width) + " " + Math.max(1, layout.height));
      dom.edges.setAttribute("width", String(Math.max(1, layout.width)));
      dom.edges.setAttribute("height", String(Math.max(1, layout.height)));
      dom.viewport.classList.toggle("overview", state.scale < 0.25);
      updateModuleFlowZoomControls(false);
    }

    /** Applies focal math after structure/resize so zoom never invokes layout. */
    function applyPendingModuleFlowZoom(pending) {
      const layout = state.layout;
      const result = createModuleFlowFocalZoom({
        worldWidth: layout.width,
        worldHeight: layout.height,
        viewportWidth: dom.viewport.clientWidth,
        viewportHeight: dom.viewport.clientHeight,
        scale: state.scale,
        scrollLeft: dom.viewport.scrollLeft,
        scrollTop: dom.viewport.scrollTop,
        focalX: pending.focalX,
        focalY: pending.focalY,
        nextScale: pending.scale,
        padding: MODULE_FLOW_STAGE_PADDING
      });
      state.scale = result.scale;
      applyModuleFlowViewportFrame(layout);
      dom.viewport.scrollLeft = pending.moveToOrigin ? 0 : result.scrollLeft;
      dom.viewport.scrollTop = pending.moveToOrigin ? 0 : result.scrollTop;
      updateModuleFlowZoomControls(pending.announce);
    }

    /** Restores the world center captured before a responsive viewport resize. */
    function restoreModuleFlowWorldCenter(center) {
      const frame = state.viewportFrame;
      dom.viewport.scrollLeft = clampModuleFlowScroll(
        frame.offsetX + center.worldX * state.scale - frame.viewportWidth / 2,
        frame.maxScrollLeft
      );
      dom.viewport.scrollTop = clampModuleFlowScroll(
        frame.offsetY + center.worldY * state.scale - frame.viewportHeight / 2,
        frame.maxScrollTop
      );
    }

    /** Reconciles SCC enclosures by stable component identity. */
    function reconcileModuleFlowCycles(layout) {
      const retained = new Set();
      const additions = document.createDocumentFragment();
      for (const group of layout.cycleGroups) {
        retained.add(group.id);
        let element = state.cycleElementsById.get(group.id);
        if (!element) {
          element = document.createElement("div");
          element.className = "cycle-group";
          state.cycleElementsById.set(group.id, element);
          additions.appendChild(element);
        }
        const geometryKey = [group.x, group.y, group.width, group.height].join(":");
        if (element.dataset.geometryKey !== geometryKey) {
          element.dataset.geometryKey = geometryKey;
          element.style.left = group.x + "px";
          element.style.top = group.y + "px";
          element.style.width = group.width + "px";
          element.style.height = group.height + "px";
        }
        if (element.textContent !== group.label) element.textContent = group.label;
      }
      removeStaleModuleFlowElements(state.cycleElementsById, retained, function (element) { return element; });
      dom.cycles.appendChild(additions);
    }

    /** Reconciles orthogonal routes without replacing retained SVG groups. */
    function reconcileModuleFlowEdges(layout, edgesById) {
      const retained = new Set();
      const created = new Set();
      const additions = document.createDocumentFragment();
      for (const edgeLayout of layout.edges) {
        const edge = edgesById.get(edgeLayout.edgeId);
        if (!edge || edgeLayout.points.length < 2) continue;
        retained.add(edge.id);
        let record = state.edgeElementsById.get(edge.id);
        if (!record) {
          const group = document.createElementNS(SVG_NS, "g");
          group.dataset.edgeId = edge.id;
          const hit = document.createElementNS(SVG_NS, "path");
          hit.setAttribute("class", "module-edge-hit");
          hit.setAttribute("aria-hidden", "true");
          const path = document.createElementNS(SVG_NS, "path");
          path.setAttribute("marker-end", "url(#module-arrow)");
          path.setAttribute("tabindex", "0");
          path.setAttribute("role", "button");
          const direction = document.createElementNS(SVG_NS, "path");
          direction.setAttribute("aria-hidden", "true");
          group.appendChild(hit);
          group.appendChild(path);
          group.appendChild(direction);
          record = {
            group: group,
            hit: hit,
            path: path,
            direction: direction,
            label: undefined
          };
          state.edgeElementsById.set(edge.id, record);
          additions.appendChild(group);
          created.add(edge.id);
        }
        const bridges = edgeLayout.bridges || [];
        const pathData = createModuleFlowEdgePath(edgeLayout.points, bridges);
        const directionData = createModuleFlowBridgeDirectionPath(edgeLayout.points, bridges);
        const crossingCount = bridges.reduce(function (count, bridge) {
          return count + (bridge.crossingCount || 1);
        }, 0);
        const labelValue = edgeLabel(edge);
        const entryOrder = String(edge.entryOrder || 0);
        if (record.group.dataset.entryOrder !== entryOrder) {
          record.group.dataset.entryOrder = entryOrder;
          record.group.style.setProperty("--entry-order", entryOrder);
        }
        const geometryKey = pathData + "\\n" + directionData + "\\n" + edgeLayout.labelX + ":" + edgeLayout.labelY + "\\n" + labelValue + "\\n" + edge.presentationKind;
        if (record.group.dataset.geometryKey !== geometryKey) {
          record.group.dataset.geometryKey = geometryKey;
          record.group.dataset.crossingCount = String(crossingCount);
          record.hit.setAttribute("d", pathData);
          record.path.setAttribute("d", pathData);
          record.path.setAttribute(
            "class",
            "module-edge " + edge.presentationKind + (crossingCount > 0 ? " crossed" : "")
          );
          record.path.setAttribute(
            "aria-label",
            "Inspect relationship: " + labelValue
              + (crossingCount > 0
                ? "; " + crossingCount + " crossed line" + (crossingCount === 1 ? "" : "s") + " bridged"
                : "")
          );
          record.direction.setAttribute("d", directionData);
          record.direction.setAttribute(
            "class",
            "module-edge-direction " + edge.presentationKind
          );
          if (labelValue) {
            if (!record.label) {
              record.label = document.createElementNS(SVG_NS, "text");
              record.label.setAttribute("class", "edge-label");
              record.group.appendChild(record.label);
            }
            record.label.setAttribute("x", String(edgeLayout.labelX));
            record.label.setAttribute("y", String(edgeLayout.labelY));
            record.label.textContent = labelValue;
          } else if (record.label) {
            record.label.remove();
            record.label = undefined;
          }
        }
      }
      removeStaleModuleFlowElements(state.edgeElementsById, retained, function (record) { return record.group; });
      dom.edges.appendChild(additions);
      return created;
    }

    /** Reconciles variable-height cards and rebuilds text only on payload change. */
    function reconcileModuleFlowNodes(layout, nodesById, depthByModuleId) {
      const retained = new Set();
      const created = new Set();
      const additions = document.createDocumentFragment();
      for (const nodeLayout of layout.nodes) {
        const node = nodesById.get(nodeLayout.nodeId);
        if (!node) continue;
        retained.add(node.id);
        let card = state.nodeElementsById.get(node.id);
        if (!card) {
          card = document.createElement("button");
          card.type = "button";
          card.dataset.nodeId = node.id;
          state.nodeElementsById.set(node.id, card);
          additions.appendChild(card);
          created.add(node.id);
        }
        const cardKindClass = node.kind === "logicBlock"
          ? "logic-block"
          : node.kind === "function" ? "function" : "module";
        card.className = "module-card " + cardKindClass
          + (node.external ? " external" : "");
        const entryOrder = String(node.entryOrder || 0);
        if (card.dataset.entryOrder !== entryOrder) {
          card.dataset.entryOrder = entryOrder;
          card.style.setProperty("--entry-order", entryOrder);
        }
        const depth = depthByModuleId.get(node.id) || 0;
        const geometryKey = [nodeLayout.x, nodeLayout.y, nodeLayout.width, nodeLayout.height, depth].join(":");
        if (card.dataset.geometryKey !== geometryKey) {
          card.dataset.geometryKey = geometryKey;
          card.style.left = nodeLayout.x + "px";
          card.style.top = nodeLayout.y + "px";
          card.style.width = nodeLayout.width + "px";
          card.style.height = nodeLayout.height + "px";
          card.style.setProperty("--module-depth", String(depth));
        }
        const presentationKey = createModuleFlowNodePresentationKey(node);
        if (card.dataset.presentationKey !== presentationKey) {
          card.dataset.presentationKey = presentationKey;
          updateModuleFlowNodeContent(card, node);
        }
      }
      removeStaleModuleFlowElements(state.nodeElementsById, retained, function (element) { return element; });
      dom.nodes.appendChild(additions);
      return created;
    }

    /** Creates a stable key from only card-visible values, excluding source tokens. */
    function createModuleFlowNodePresentationKey(node) {
      return JSON.stringify([
        node.kind, node.label, node.detail, node.locationLabel, node.external,
        node.basis, node.confidence, node.frameworks, node.ecosystems, node.metrics,
        node.incomingBoundaryCount, node.outgoingBoundaryCount, node.expandable,
        node.blockKind, node.branchLabel, node.valueChanges, node.valueAccesses,
        node.drillTargets
      ]);
    }

    /** Mounts complete text through textContent when a card payload actually changes. */
    function updateModuleFlowNodeContent(card, node) {
      card.replaceChildren();
      const kindLabel = node.kind === "logicBlock"
        ? "Function · " + node.blockKind
        : node.kind === "function" ? "Entry / boundary function" : node.detail;
      appendText(card, "div", "module-card-kind", kindLabel);
      appendText(card, "div", "module-card-title", node.label);
      appendText(card, "div", "module-card-detail", node.detail);
      if (node.locationLabel) appendText(card, "div", "module-card-location", node.locationLabel);
      const badges = document.createElement("div");
      badges.className = "module-card-badges";
      const badgeValues = node.kind === "logicBlock"
        ? [node.blockKind, node.confidence]
        : node.kind === "function"
        ? [node.confidence || "static"]
        : [node.basis, node.confidence].concat(node.frameworks || [], node.ecosystems || []);
      for (const value of badgeValues) appendText(badges, "span", "module-badge", value);
      card.appendChild(badges);
      if (node.kind === "logicBlock") {
        appendText(card, "div", "module-card-metric",
          (node.valueChanges || []).length + " value changes · "
            + (node.valueAccesses || []).length + " value accesses");
        if (node.branchLabel) appendText(card, "div", "module-card-hint", "Branch · " + node.branchLabel);
      } else if (node.kind === "function") {
        appendText(card, "div", "module-card-metric", node.incomingBoundaryCount + " incoming · " + node.outgoingBoundaryCount + " outgoing boundary calls");
        appendText(card, "div", "module-card-hint", "Click to attach function graph");
      } else if (!node.external) {
        const metrics = node.metrics || {};
        appendText(card, "div", "module-card-metric", (metrics.callableCount || 0) + " direct functions · " + (metrics.entrypointCount || 0) + " entrypoints");
        appendText(card, "div", "module-card-hint", expansionHint(node));
      }
    }

    /** Iteratively removes only identities absent from the next keyed scene. */
    function removeStaleModuleFlowElements(registry, retained, elementOf) {
      for (const [identity, record] of registry) {
        if (retained.has(identity)) continue;
        elementOf(record).remove();
        registry.delete(identity);
      }
    }

    /** Patches classes and ARIA without changing geometry, listeners, or focus. */
    function applyModuleFlowPresentationState() {
      for (const [nodeId, card] of state.nodeElementsById) {
        card.classList.toggle("selected", state.selectedNodeId === nodeId);
        card.classList.toggle("loading", state.pendingNodeIds.has(nodeId));
        card.classList.toggle("entering", state.enteringNodeIds.has(nodeId));
        card.setAttribute("aria-busy", state.pendingNodeIds.has(nodeId) ? "true" : "false");
      }
      for (const [edgeId, record] of state.edgeElementsById) {
        record.path.classList.toggle("selected", state.selectedEdgeId === edgeId);
        record.path.classList.toggle("entering", state.enteringEdgeIds.has(edgeId));
        record.direction.classList.toggle("selected", state.selectedEdgeId === edgeId);
        record.direction.classList.toggle("entering", state.enteringEdgeIds.has(edgeId));
      }
    }

    /** Removes animation classes after their CSS duration without remounting DOM. */
    function scheduleModuleFlowEntryCleanup() {
      if (state.enteringNodeIds.size === 0 && state.enteringEdgeIds.size === 0) return;
      if (state.enteringTimer !== undefined) window.clearTimeout(state.enteringTimer);
      state.enteringTimer = window.setTimeout(function () {
        state.enteringNodeIds.clear();
        state.enteringEdgeIds.clear();
        state.enteringTimer = undefined;
        renderGraph(undefined, false);
      }, 480);
    }

    /** Creates the shared arrow marker and delegated activation listeners once. */
    function initializeModuleFlowSceneRenderer() {
      const defs = document.createElementNS(SVG_NS, "defs");
      const marker = document.createElementNS(SVG_NS, "marker");
      marker.setAttribute("id", "module-arrow");
      marker.setAttribute("viewBox", "0 0 10 10");
      marker.setAttribute("refX", "9");
      marker.setAttribute("refY", "5");
      marker.setAttribute("markerWidth", "8");
      marker.setAttribute("markerHeight", "8");
      marker.setAttribute("orient", "auto-start-reverse");
      const arrow = document.createElementNS(SVG_NS, "path");
      arrow.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
      arrow.setAttribute("fill", "context-stroke");
      marker.appendChild(arrow);
      defs.appendChild(marker);
      dom.edges.appendChild(defs);
      dom.nodes.addEventListener("click", function (event) {
        const target = event.target instanceof Element ? event.target.closest("[data-node-id]") : undefined;
        if (!target || !dom.nodes.contains(target)) return;
        const node = state.nodesById.get(target.dataset.nodeId);
        if (node) selectNode(node);
      });
      dom.edges.addEventListener("click", function (event) {
        const target = event.target instanceof Element ? event.target.closest("[data-edge-id]") : undefined;
        if (!target || !dom.edges.contains(target)) return;
        const edge = state.edgesById.get(target.dataset.edgeId);
        if (edge) selectEdge(edge);
      });
      dom.edges.addEventListener("keydown", function (event) {
        if (event.key !== "Enter" && event.key !== " ") return;
        const target = event.target instanceof Element ? event.target.closest("[data-edge-id]") : undefined;
        if (!target || !dom.edges.contains(target)) return;
        const edge = state.edgesById.get(target.dataset.edgeId);
        if (!edge) return;
        event.preventDefault();
        selectEdge(edge);
      });
    }

    /** Invalidates snapshot-local cache/DOM while leaving the marker installed. */
    function resetModuleFlowScene() {
      for (const element of state.nodeElementsById.values()) element.remove();
      for (const record of state.edgeElementsById.values()) record.group.remove();
      for (const element of state.cycleElementsById.values()) element.remove();
      state.nodeElementsById.clear();
      state.edgeElementsById.clear();
      state.cycleElementsById.clear();
      state.layoutCache.clear();
      state.layout = undefined;
      state.layoutByNodeId.clear();
      state.viewportFrame = undefined;
    }
  `;
}
