/**
 * Browser-only Function Logic viewport controller. One transform state owns
 * free pointer/trackpad pan, focal zoom, Center, Fit, resize preservation, and
 * graph-rebuild restoration without invoking analyzer or layout code.
 */

import { getFunctionLogicViewportGeometryBrowserSource } from "./functionLogicViewportGeometry";

/** Returns CSP-safe transform controls for the shared Function Logic renderer. */
export function getFunctionLogicViewportBrowserSource(): string {
  return /* javascript */ `
    ${getFunctionLogicViewportGeometryBrowserSource()}

    const FUNCTION_LOGIC_ZOOM_LEVELS = [
      0.01, 0.02, 0.033, 0.05, 0.067, 0.08, 0.1, 0.125, 0.16,
      0.2, 0.25, 0.33, 0.4, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 2.5, 3
    ];

    /** Creates one unbounded-feeling transform surface over a finite graph world. */
    function createFunctionLogicViewportController(options) {
      const viewport = options.viewport;
      const stage = options.stage;
      const canvas = options.canvas;
      const layout = options.layout;
      let transform;
      let controls;
      let active = false;
      let pan;
      let resizeObserver;
      let viewportWidth = 0;
      let viewportHeight = 0;
      let announcementTimer;

      /** Reads concrete dimensions after the graph has entered the document. */
      function readViewportSize() {
        return {
          width: Math.max(1, Number(viewport.clientWidth) || 1),
          height: Math.max(1, Number(viewport.clientHeight) || 1)
        };
      }

      /** Packages the immutable world dimensions for pure viewport formulas. */
      function geometry() {
        const size = readViewportSize();
        return {
          worldWidth: layout.width,
          worldHeight: layout.height,
          viewportWidth: size.width,
          viewportHeight: size.height,
          padding: FUNCTION_LOGIC_VIEW_PADDING
        };
      }

      /** Applies one transform and records it in the owning graph session. */
      function commit(nextTransform, announce) {
        transform = normalizeFunctionLogicViewportTransform(nextTransform);
        canvas.style.setProperty(
          "transform",
          "translate3d(" + transform.x + "px, " + transform.y + "px, 0) scale(" + transform.scale + ")"
        );
        const gridSize = Math.max(6, 18 * transform.scale);
        viewport.style.setProperty("--logic-grid-size", gridSize + "px");
        viewport.style.setProperty("--logic-grid-x", transform.x + "px");
        viewport.style.setProperty("--logic-grid-y", transform.y + "px");
        if (options.writeTransform) options.writeTransform({ ...transform });
        updateControls(Boolean(announce));
      }

      /** Keeps toolbar labels and accessible zoom state synchronized. */
      function updateControls(announce) {
        if (!controls || !transform) return;
        const percentage = Math.max(1, Math.round(transform.scale * 100));
        controls.level.textContent = percentage + "%";
        controls.level.title = "Reset function graph zoom to 100%; current zoom "
          + percentage + "%";
        controls.level.setAttribute("aria-label", controls.level.title);
        controls.zoomOut.disabled = transform.scale <= FUNCTION_LOGIC_MIN_SCALE + 0.00001;
        controls.zoomIn.disabled = transform.scale >= FUNCTION_LOGIC_MAX_SCALE - 0.00001;
        if (!announce) return;
        if (announcementTimer !== undefined) clearTimeout(announcementTimer);
        announcementTimer = setTimeout(() => {
          controls.announcement.textContent = "Function graph zoom " + percentage + " percent";
          announcementTimer = undefined;
        }, 180);
      }

      /** Activates listeners only after the viewport is attached and measurable. */
      function initialize() {
        if (active) return;
        active = true;
        const size = readViewportSize();
        viewportWidth = size.width;
        viewportHeight = size.height;
        const stored = options.readTransform ? options.readTransform() : undefined;
        commit(stored || createDefaultFunctionLogicViewportTransform(geometry(), 1), false);
        viewport.addEventListener("wheel", handleWheel, { passive: false });
        viewport.addEventListener("keydown", handleKeydown);
        viewport.addEventListener("pointerdown", handlePointerDown);
        viewport.addEventListener("pointermove", handlePointerMove);
        viewport.addEventListener("pointerup", finishPan);
        viewport.addEventListener("pointercancel", finishPan);
        if (typeof ResizeObserver === "function") {
          resizeObserver = new ResizeObserver(handleResize);
          resizeObserver.observe(viewport);
        }
      }

      /** Releases listeners before a graph DOM replacement. */
      function dispose() {
        if (!active) return;
        active = false;
        viewport.removeEventListener("wheel", handleWheel);
        viewport.removeEventListener("keydown", handleKeydown);
        viewport.removeEventListener("pointerdown", handlePointerDown);
        viewport.removeEventListener("pointermove", handlePointerMove);
        viewport.removeEventListener("pointerup", finishPan);
        viewport.removeEventListener("pointercancel", finishPan);
        if (resizeObserver) resizeObserver.disconnect();
        resizeObserver = undefined;
        if (announcementTimer !== undefined) clearTimeout(announcementTimer);
        announcementTimer = undefined;
      }

      /** Returns a defensive copy for graph-rebuild anchor preservation. */
      function getTransform() {
        return transform ? { ...transform } : undefined;
      }

      /** Restores an explicit transform without synthesizing scroll boundaries. */
      function setTransform(nextTransform, announce) {
        if (!nextTransform) return;
        commit(nextTransform, announce);
      }

      /** Preserves the viewport-center world point while changing scale. */
      function zoomTo(nextScale, focalX, focalY, announce) {
        if (!transform) return;
        const size = readViewportSize();
        commit(createFunctionLogicFocalZoom({
          ...geometry(),
          transform,
          focalX: Number.isFinite(focalX) ? focalX : size.width / 2,
          focalY: Number.isFinite(focalY) ? focalY : size.height / 2,
          nextScale
        }), announce);
      }

      /** Selects the next stable toolbar zoom level. */
      function zoomStep(direction) {
        if (!transform) return;
        if (direction > 0) {
          for (const level of FUNCTION_LOGIC_ZOOM_LEVELS) {
            if (level > transform.scale + 0.0005) {
              zoomTo(level, undefined, undefined, true);
              return;
            }
          }
          zoomTo(FUNCTION_LOGIC_MAX_SCALE, undefined, undefined, true);
          return;
        }
        for (let index = FUNCTION_LOGIC_ZOOM_LEVELS.length - 1; index >= 0; index -= 1) {
          if (FUNCTION_LOGIC_ZOOM_LEVELS[index] < transform.scale - 0.0005) {
            zoomTo(FUNCTION_LOGIC_ZOOM_LEVELS[index], undefined, undefined, true);
            return;
          }
        }
        zoomTo(FUNCTION_LOGIC_MIN_SCALE, undefined, undefined, true);
      }

      /** Moves the world freely in screen space with only a numeric safety bound. */
      function panBy(deltaX, deltaY) {
        if (!transform) return;
        commit({
          scale: transform.scale,
          x: transform.x + deltaX,
          y: transform.y + deltaY
        }, false);
      }

      /** Centers the graph without changing its current zoom. */
      function center() {
        if (!transform) return;
        commit(createCenteredFunctionLogicViewportTransform(
          geometry(),
          transform.scale
        ), false);
      }

      /** Fits and centers the complete graph using both viewport dimensions. */
      function fit() {
        commit(createFitFunctionLogicViewportTransform(geometry()), true);
      }

      /** Converts trackpad units into pan or cursor-centered pinch zoom. */
      function handleWheel(event) {
        if (!transform) return;
        event.preventDefault();
        const size = readViewportSize();
        const unit = event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? size.height
            : 1;
        const deltaX = Math.max(-1000, Math.min(1000, (Number(event.deltaX) || 0) * unit));
        const deltaY = Math.max(-1000, Math.min(1000, (Number(event.deltaY) || 0) * unit));
        if (event.ctrlKey || event.metaKey) {
          const rect = viewport.getBoundingClientRect();
          zoomTo(
            transform.scale * Math.exp(-deltaY * 0.0015),
            event.clientX - rect.left,
            event.clientY - rect.top,
            true
          );
          return;
        }
        const horizontal = event.shiftKey && Math.abs(deltaX) < 0.01 ? deltaY : deltaX;
        const vertical = event.shiftKey && Math.abs(deltaX) < 0.01 ? 0 : deltaY;
        panBy(-horizontal, -vertical);
      }

      /** Starts left-button background drag or middle-button pan from any target. */
      function handlePointerDown(event) {
        const target = event.target;
        const interactive = target && typeof target.closest === "function"
          ? target.closest("button, input, a, [role='button'], .logic-graph-node")
          : undefined;
        if (event.button !== 1 && (event.button !== 0 || interactive)) return;
        if (!transform) return;
        pan = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          x: transform.x,
          y: transform.y
        };
        viewport.classList.add("panning");
        if (viewport.setPointerCapture) viewport.setPointerCapture(event.pointerId);
        event.preventDefault();
      }

      /** Applies captured pointer movement directly to the transform. */
      function handlePointerMove(event) {
        if (!pan || pan.pointerId !== event.pointerId) return;
        commit({
          scale: transform.scale,
          x: pan.x + event.clientX - pan.startX,
          y: pan.y + event.clientY - pan.startY
        }, false);
        event.preventDefault();
      }

      /** Ends one captured drag without changing graph selection. */
      function finishPan(event) {
        if (!pan || pan.pointerId !== event.pointerId) return;
        if (viewport.releasePointerCapture && viewport.hasPointerCapture
          && viewport.hasPointerCapture(event.pointerId)) {
          viewport.releasePointerCapture(event.pointerId);
        }
        pan = undefined;
        viewport.classList.remove("panning");
      }

      /** Provides graph-local zoom, Center, and Fit shortcuts. */
      function handleKeydown(event) {
        if ((event.target && event.target !== viewport)
          || event.ctrlKey || event.metaKey || event.altKey) return;
        if (event.key === "+" || event.key === "=") {
          event.preventDefault();
          zoomStep(1);
        } else if (event.key === "-") {
          event.preventDefault();
          zoomStep(-1);
        } else if (event.key === "0") {
          event.preventDefault();
          zoomTo(1, undefined, undefined, true);
        } else if (event.key === "c" || event.key === "C") {
          event.preventDefault();
          center();
        } else if (event.key === "f" || event.key === "F") {
          event.preventDefault();
          fit();
        }
      }

      /** Preserves the old visible world center across drawer/editor resizing. */
      function handleResize() {
        if (!transform) return;
        const size = readViewportSize();
        if (size.width === viewportWidth && size.height === viewportHeight) return;
        const next = resizeFunctionLogicViewportTransform({
          transform,
          previousViewportWidth: viewportWidth || size.width,
          previousViewportHeight: viewportHeight || size.height,
          nextViewportWidth: size.width,
          nextViewportHeight: size.height
        });
        viewportWidth = size.width;
        viewportHeight = size.height;
        commit(next, false);
      }

      /** Connects toolbar records after the graph header is assembled. */
      function attachControls(nextControls) {
        controls = nextControls;
        updateControls(false);
      }

      return {
        initialize,
        dispose,
        getTransform,
        setTransform,
        zoomTo,
        zoomStep,
        panBy,
        center,
        fit,
        attachControls
      };
    }

    /** Builds accessible zoom, Center, and Fit controls for one controller. */
    function createFunctionLogicViewportControls(controller) {
      const group = document.createElement("div");
      const zoomOut = createFunctionLogicViewportButton("−", "Zoom out function graph");
      const level = createFunctionLogicViewportButton("100%", "Reset function graph zoom to 100%");
      const zoomIn = createFunctionLogicViewportButton("+", "Zoom in function graph");
      const center = createFunctionLogicViewportButton("Center", "Center function graph (C)");
      const fit = createFunctionLogicViewportButton("Fit", "Fit complete function graph (F)");
      const announcement = document.createElement("span");
      group.className = "logic-viewport-controls";
      group.setAttribute("role", "group");
      group.setAttribute("aria-label", "Function graph viewport controls");
      level.classList.add("logic-zoom-level");
      center.classList.add("logic-center-button");
      fit.classList.add("logic-fit-button");
      center.setAttribute("aria-keyshortcuts", "C");
      fit.setAttribute("aria-keyshortcuts", "F");
      announcement.className = "logic-viewport-announcement";
      announcement.setAttribute("aria-live", "polite");
      zoomOut.addEventListener("click", () => controller.zoomStep(-1));
      level.addEventListener("click", () => controller.zoomTo(1, undefined, undefined, true));
      zoomIn.addEventListener("click", () => controller.zoomStep(1));
      center.addEventListener("click", controller.center);
      fit.addEventListener("click", controller.fit);
      group.append(zoomOut, level, zoomIn, center, fit, announcement);
      controller.attachControls({ zoomOut, level, zoomIn, center, fit, announcement });
      return group;
    }

    /** Creates one shared viewport action button. */
    function createFunctionLogicViewportButton(label, title) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "logic-zoom-button";
      button.textContent = label;
      button.title = title;
      return button;
    }
  `;
}
