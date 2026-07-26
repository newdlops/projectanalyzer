/**
 * Browser-only, user-controlled value-flow playback controls. The helper owns
 * timing and accessible status while its caller retains graph-specific styling.
 */

/** Returns CSP-safe helpers for stepping through one selected value-flow route. */
export function getFunctionLogicValueFlowPlaybackBrowserSource(): string {
  return /* js */ `
    const FUNCTION_LOGIC_VALUE_FLOW_PLAYBACK_DURATION_MS = 220;

    /**
     * Builds explicit playback controls for a bounded sequence of value-flow hops.
     * Playback never begins on selection; callers receive one active record at a time.
     */
    function createFunctionLogicValueFlowPlayback(options) {
      const section = document.createElement("section");
      const header = document.createElement("div");
      const title = document.createElement("strong");
      const status = document.createElement("span");
      const controls = document.createElement("div");
      const previous = createFunctionLogicValueFlowPlaybackButton("Previous", "Previous value-flow hop");
      const playPause = createFunctionLogicValueFlowPlaybackButton("Play", "Play value flow");
      const next = createFunctionLogicValueFlowPlaybackButton("Next", "Next value-flow hop");
      const replay = createFunctionLogicValueFlowPlaybackButton("Replay", "Replay value flow");
      const motionQuery = typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : undefined;
      let activeIndex = -1;
      let playing = false;
      let timer;
      let activeBindingId = "";

      section.className = "logic-value-flow-playback";
      section.setAttribute("aria-label", "Value flow playback");
      header.className = "logic-value-flow-playback-header";
      title.textContent = "Flow playback";
      status.className = "logic-value-flow-playback-status";
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      controls.className = "logic-value-flow-playback-controls";
      header.append(title, status);
      controls.append(previous, playPause, next, replay);
      section.append(header, controls);

      previous.addEventListener("click", () => move(-1));
      next.addEventListener("click", () => move(1));
      replay.addEventListener("click", () => {
        stop();
        setActive(0, false);
      });
      playPause.addEventListener("click", () => {
        if (playing) {
          stop();
          return;
        }
        if (activeIndex >= readHops().length - 1) activeIndex = -1;
        playing = true;
        update();
        advance();
      });

      /** Stops pending progression so a new selection cannot animate stale hops. */
      function stop() {
        playing = false;
        if (timer !== undefined) {
          clearTimeout(timer);
          timer = undefined;
        }
        update();
      }

      /** Advances after the current hop becomes visible; reduced motion stays immediate. */
      function advance() {
        if (!playing) return;
        const hops = readHops();
        const nextIndex = activeIndex + 1;
        if (nextIndex >= hops.length) {
          stop();
          return;
        }
        setActive(nextIndex, true);
        if (nextIndex >= hops.length - 1) {
          stop();
          return;
        }
        timer = setTimeout(advance, motionQuery?.matches
          ? 0
          : FUNCTION_LOGIC_VALUE_FLOW_PLAYBACK_DURATION_MS);
      }

      /** Steps once in either direction without starting automatic progression. */
      function move(direction) {
        stop();
        const hops = readHops();
        if (hops.length === 0) return;
        const fallback = direction > 0 ? 0 : hops.length - 1;
        const nextIndex = activeIndex < 0
          ? fallback
          : Math.max(0, Math.min(hops.length - 1, activeIndex + direction));
        setActive(nextIndex, false);
      }

      /** Publishes the active semantic hop without relying on color or animation alone. */
      function setActive(index, animated) {
        const hops = readHops();
        activeIndex = index >= 0 && index < hops.length ? index : -1;
        const active = activeIndex >= 0 ? hops[activeIndex] : undefined;
        options.onActiveHop(active, activeIndex, hops.length, Boolean(animated && !motionQuery?.matches));
        update();
      }

      /** Updates disabled, playing, complete, and empty states as the graph changes. */
      function update() {
        const hops = readHops();
        const active = activeIndex >= 0 ? hops[activeIndex] : undefined;
        previous.disabled = hops.length === 0 || activeIndex <= 0;
        next.disabled = hops.length === 0 || activeIndex >= hops.length - 1;
        replay.disabled = hops.length === 0;
        playPause.disabled = hops.length === 0;
        playPause.textContent = playing ? "Pause" : "Play";
        playPause.title = playing ? "Pause value flow" : "Play value flow";
        playPause.setAttribute("aria-label", playPause.title);
        if (hops.length === 0) {
          status.textContent = activeBindingId
            ? "No reachable value-flow hops for this selection."
            : "Select a variable to step through its value flow.";
          return;
        }
        if (!active) {
          status.textContent = hops.length + " hop" + (hops.length === 1 ? "" : "s")
            + " ready. Play or step through the route.";
          return;
        }
        const outcome = active.flow.targetUsage === "sink"
          ? "sink"
          : active.flow.targetUsage === "consume"
            ? "consume"
            : active.flow.targetAccess === "readwrite" ? "read and update" : "read";
        status.textContent = "Hop " + (activeIndex + 1) + " of " + hops.length
          + " · " + outcome
          + (active.flow.confidence === "inferred" ? " · inferred" : "");
      }

      /** Keeps the current hop only while the selected binding remains unchanged. */
      function sync(bindingId) {
        if (activeBindingId !== bindingId) {
          activeBindingId = bindingId || "";
          stop();
          setActive(-1, false);
          return;
        }
        const hops = readHops();
        if (activeIndex >= hops.length) setActive(-1, false);
        else update();
      }

      function readHops() {
        return options.readHops(activeBindingId) || [];
      }

      return {
        element: section,
        /** Starts one pass only after the user explicitly selects a variable. */
        playFromStart() {
          stop();
          activeIndex = -1;
          playing = true;
          update();
          advance();
        },
        reset() {
          stop();
          setActive(-1, false);
        },
        sync
      };
    }

    /** Builds one consistently labeled compact playback button. */
    function createFunctionLogicValueFlowPlaybackButton(label, title) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "logic-value-flow-playback-button";
      button.textContent = label;
      button.title = title;
      button.setAttribute("aria-label", title);
      return button;
    }
  `;
}
