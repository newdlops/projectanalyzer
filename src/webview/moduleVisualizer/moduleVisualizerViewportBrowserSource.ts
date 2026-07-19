/**
 * Browser interaction controller for Module Flow zoom, fit, resize, and pan.
 *
 * The generated functions share the parent nonce script's `dom` and `state`
 * objects. They only enqueue viewport commits; they never invoke graph layout
 * or rebuild node/edge DOM.
 */

/** Returns viewport-only browser functions for the Module Flow editor tab. */
export function getModuleVisualizerViewportBrowserSource(): string {
  return /* javascript */ `
    const MODULE_FLOW_ZOOM_LEVELS = [
      0.01, 0.02, 0.033, 0.05, 0.067, 0.08, 0.1, 0.125, 0.16,
      0.2, 0.25, 0.33, 0.4, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 2.5, 3
    ];

    /** Returns the next stable toolbar scale around the current/pending value. */
    function nextModuleFlowZoomLevel(direction) {
      const current = state.pendingZoom ? state.pendingZoom.scale : state.scale;
      if (direction > 0) {
        for (const level of MODULE_FLOW_ZOOM_LEVELS) {
          if (level > current + 0.0005) return level;
        }
        return MODULE_FLOW_MAX_SCALE;
      }
      for (let index = MODULE_FLOW_ZOOM_LEVELS.length - 1; index >= 0; index -= 1) {
        if (MODULE_FLOW_ZOOM_LEVELS[index] < current - 0.0005) {
          return MODULE_FLOW_ZOOM_LEVELS[index];
        }
      }
      return MODULE_FLOW_MIN_SCALE;
    }

    /** Enqueues an absolute focal zoom; repeated wheel events merge per frame. */
    function queueModuleFlowZoom(scale, focalX, focalY, moveToOrigin, announce) {
      if (!state.layout) return;
      state.pendingZoom = {
        scale: clampModuleFlowScale(scale),
        focalX: focalX,
        focalY: focalY,
        moveToOrigin: Boolean(moveToOrigin),
        announce: Boolean(announce)
      };
      queueGraphCommit({ viewport: true });
    }

    /** Uses the visible viewport center for toolbar and keyboard zoom controls. */
    function queueCenteredModuleFlowZoom(scale, announce) {
      queueModuleFlowZoom(
        scale,
        dom.viewport.clientWidth / 2,
        dom.viewport.clientHeight / 2,
        false,
        announce
      );
    }

    /** Fits the complete logical layout with screen-sized padding and centering. */
    function fitModuleFlowGraph() {
      if (!state.layout) return;
      const scale = createModuleFlowFitScale({
        worldWidth: state.layout.width,
        worldHeight: state.layout.height,
        viewportWidth: dom.viewport.clientWidth,
        viewportHeight: dom.viewport.clientHeight,
        padding: MODULE_FLOW_STAGE_PADDING
      });
      queueModuleFlowZoom(
        scale,
        dom.viewport.clientWidth / 2,
        dom.viewport.clientHeight / 2,
        true,
        true
      );
    }

    /** Updates only zoom chrome and its debounced accessible announcement. */
    function updateModuleFlowZoomControls(announce) {
      const percentage = Math.max(1, Math.round(state.scale * 100));
      dom.zoomLevel.textContent = percentage + "%";
      dom.zoomLevel.setAttribute("aria-label", "Reset zoom to 100 percent; current zoom " + percentage + " percent");
      dom.zoomOut.disabled = state.scale <= MODULE_FLOW_MIN_SCALE + 0.0005;
      dom.zoomIn.disabled = state.scale >= MODULE_FLOW_MAX_SCALE - 0.0005;
      if (!announce) return;
      if (state.zoomAnnouncementTimer !== undefined) {
        window.clearTimeout(state.zoomAnnouncementTimer);
      }
      state.zoomAnnouncementTimer = window.setTimeout(function () {
        dom.zoomAnnouncement.textContent = "Zoom " + percentage + " percent";
        state.zoomAnnouncementTimer = undefined;
      }, 240);
    }

    /** Converts wheel units and preserves the cursor's world coordinate. */
    function handleModuleFlowWheel(event) {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = dom.viewport.getBoundingClientRect();
      const unit = event.deltaMode === 1
        ? 16
        : event.deltaMode === 2
          ? Math.max(1, dom.viewport.clientHeight)
          : 1;
      const delta = Math.max(-600, Math.min(600, event.deltaY * unit));
      const current = state.pendingZoom ? state.pendingZoom.scale : state.scale;
      queueModuleFlowZoom(
        current * Math.exp(-delta * 0.0015),
        event.clientX - rect.left,
        event.clientY - rect.top,
        false,
        true
      );
    }

    /** Provides graph-local shortcuts without stealing VS Code browser zoom keys. */
    function handleModuleFlowViewportKeydown(event) {
      if (event.target !== dom.viewport || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        queueCenteredModuleFlowZoom(nextModuleFlowZoomLevel(1), true);
      } else if (event.key === "-") {
        event.preventDefault();
        queueCenteredModuleFlowZoom(nextModuleFlowZoomLevel(-1), true);
      } else if (event.key === "0") {
        event.preventDefault();
        queueCenteredModuleFlowZoom(1, true);
      } else if (event.key === "f" || event.key === "F") {
        event.preventDefault();
        fitModuleFlowGraph();
      }
    }

    /** Starts background drag panning while preserving card and edge activation. */
    function handleModuleFlowPointerDown(event) {
      const target = event.target instanceof Element ? event.target : undefined;
      const interactive = target && target.closest(".module-card, .module-edge, .module-edge-hit, button, input, label, a");
      if (event.button !== 1 && (event.button !== 0 || interactive)) return;
      state.pan = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        scrollLeft: dom.viewport.scrollLeft,
        scrollTop: dom.viewport.scrollTop
      };
      dom.viewport.classList.add("panning");
      if (dom.viewport.setPointerCapture) dom.viewport.setPointerCapture(event.pointerId);
      event.preventDefault();
    }

    /** Changes native scroll offsets directly; panning never schedules layout. */
    function handleModuleFlowPointerMove(event) {
      if (!state.pan || state.pan.pointerId !== event.pointerId) return;
      dom.viewport.scrollLeft = state.pan.scrollLeft - (event.clientX - state.pan.startX);
      dom.viewport.scrollTop = state.pan.scrollTop - (event.clientY - state.pan.startY);
      event.preventDefault();
    }

    /** Ends a captured pan without changing selection or graph state. */
    function finishModuleFlowPan(event) {
      if (!state.pan || state.pan.pointerId !== event.pointerId) return;
      if (dom.viewport.releasePointerCapture && dom.viewport.hasPointerCapture
        && dom.viewport.hasPointerCapture(event.pointerId)) {
        dom.viewport.releasePointerCapture(event.pointerId);
      }
      state.pan = undefined;
      dom.viewport.classList.remove("panning");
    }

    /** Preserves the old world center when the detail rail or editor is resized. */
    function handleModuleFlowResize() {
      if (!state.layout || !state.viewportFrame) return;
      const frame = state.viewportFrame;
      state.pendingResizeCenter = {
        worldX: (dom.viewport.scrollLeft + frame.viewportWidth / 2 - frame.offsetX) / state.scale,
        worldY: (dom.viewport.scrollTop + frame.viewportHeight / 2 - frame.offsetY) / state.scale
      };
      queueGraphCommit({ viewport: true });
    }

    /** Wires all viewport controls once for the lifetime of this Webview. */
    function initializeModuleFlowViewport() {
      dom.zoomOut.addEventListener("click", function () {
        queueCenteredModuleFlowZoom(nextModuleFlowZoomLevel(-1), true);
      });
      dom.zoomIn.addEventListener("click", function () {
        queueCenteredModuleFlowZoom(nextModuleFlowZoomLevel(1), true);
      });
      dom.zoomLevel.addEventListener("click", function () {
        queueCenteredModuleFlowZoom(1, true);
      });
      dom.fit.addEventListener("click", fitModuleFlowGraph);
      dom.viewport.addEventListener("wheel", handleModuleFlowWheel, { passive: false });
      dom.viewport.addEventListener("keydown", handleModuleFlowViewportKeydown);
      dom.viewport.addEventListener("pointerdown", handleModuleFlowPointerDown);
      dom.viewport.addEventListener("pointermove", handleModuleFlowPointerMove);
      dom.viewport.addEventListener("pointerup", finishModuleFlowPan);
      dom.viewport.addEventListener("pointercancel", finishModuleFlowPan);
      if (typeof ResizeObserver === "function") {
        state.resizeObserver = new ResizeObserver(handleModuleFlowResize);
        state.resizeObserver.observe(dom.viewport);
      } else {
        window.addEventListener("resize", handleModuleFlowResize);
      }
      updateModuleFlowZoomControls(false);
    }
  `;
}
