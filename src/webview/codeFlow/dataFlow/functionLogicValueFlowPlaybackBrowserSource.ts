/**
 * Browser-only, user-controlled value-flow playback controls. The helper owns
 * timing and accessible status while its caller retains graph-specific styling.
 */

/** Returns CSP-safe helpers for stepping through one selected value-flow route. */
export function getFunctionLogicValueFlowPlaybackBrowserSource(): string {
  return /* js */ `
    const FUNCTION_LOGIC_VALUE_FLOW_PLAYBACK_MIN_DURATION_MS = 1400;
    const FUNCTION_LOGIC_VALUE_FLOW_PLAYBACK_MAX_DURATION_MS = 2800;
    const FUNCTION_LOGIC_VALUE_FLOW_PLAYBACK_DWELL_MS = 750;

    /**
     * Builds explicit playback controls for bounded static Scenario frames.
     * A frame may have a lexical hop, but derived/write frames never invent one.
     */
    function createFunctionLogicValueFlowPlayback(options) {
      const section = document.createElement("section");
      const header = document.createElement("div");
      const title = document.createElement("strong");
      const status = document.createElement("span");
      const controls = document.createElement("div");
      let copy = createFunctionLogicValueFlowPlaybackCopy(options.language);
      const guide = document.createElement("ol");
      const variableTokens = document.createElement("div");
      const speedField = document.createElement("label");
      const speedText = document.createElement("span");
      const speedSelect = document.createElement("select");
      const previous = createFunctionLogicValueFlowPlaybackButton(copy.previous, copy.previousTitle);
      const playPause = createFunctionLogicValueFlowPlaybackButton(copy.play, copy.playTitle);
      const next = createFunctionLogicValueFlowPlaybackButton(copy.next, copy.nextTitle);
      const replay = createFunctionLogicValueFlowPlaybackButton(copy.replay, copy.replayTitle);
      const motionQuery = typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : undefined;
      let activeIndex = -1;
      let phase = "idle";
      let scheduled;
      let activeBindingId = "";
      let pendingIndex = -1;
      let pendingPrevious;
      let pendingProgress = 0;
      let pendingDurationMs = FUNCTION_LOGIC_VALUE_FLOW_PLAYBACK_MIN_DURATION_MS;
      // Card-local only: finite presets preserve the existing 1x cadence by default.
      let speed = 1;

      section.className = "logic-value-flow-playback";
      section.setAttribute("aria-label", copy.regionLabel);
      if (copy.language === "ko") section.lang = "ko";
      header.className = "logic-value-flow-playback-header";
      title.textContent = copy.title;
      status.className = "logic-value-flow-playback-status";
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      controls.className = "logic-value-flow-playback-controls";
      speedField.className = "logic-value-flow-playback-speed";
      speedSelect.className = "logic-value-flow-playback-speed-select";
      speedSelect.id = "logic-value-flow-playback-speed-" + String(options.id || "default");
      speedField.htmlFor = speedSelect.id;
      for (const preset of [0.5, 1, 1.5, 2]) {
        const option = document.createElement("option"); option.value = String(preset); option.textContent = preset + "×";
        if (preset === speed) option.selected = true;
        speedSelect.append(option);
      }
      speedText.textContent = copy.speedLabel + " ";
      speedField.append(speedText, speedSelect);
      guide.className = "logic-value-flow-playback-guide";
      variableTokens.className = "logic-value-flow-playback-tokens";
      variableTokens.setAttribute("aria-label", copy.tokensLabel);
      renderGuide();
      header.append(title, status, speedField);
      controls.append(previous, playPause, next, replay);
      section.append(header, variableTokens, guide, controls);

      const onVisibilityChange = () => {
        if (document.hidden) pause();
      };
      document.addEventListener?.("visibilitychange", onVisibilityChange);

      previous.addEventListener("click", () => move(-1));
      next.addEventListener("click", () => move(1));
      replay.addEventListener("click", () => {
        stop();
        setActive(0, false);
        play();
      });
      speedSelect.addEventListener("change", () => {
        const nextSpeed = Number(speedSelect.value);
        // Ignore malformed DOM input instead of adding a second timing state.
        if ([0.5, 1, 1.5, 2].includes(nextSpeed)) speed = nextSpeed;
        speedSelect.value = String(speed);
        update();
      });
      playPause.addEventListener("click", () => {
        if (phase !== "idle" && phase !== "complete" && phase !== "paused") {
          pause();
          return;
        }
        play();
      });

      /** Stops pending progression so a new selection cannot animate stale hops. */
      function stop() {
        phase = "idle";
        pendingIndex = -1;
        pendingPrevious = undefined;
        pendingProgress = 0;
        cancelScheduledWork();
        options.onCancel?.();
        update();
      }

      /** Freezes an in-flight curve at its sampled position for an exact resume. */
      function pause() {
        if (phase === "idle" || phase === "complete") return;
        phase = "paused";
        cancelScheduledWork();
        // Cancelling rAF intentionally leaves the SVG token at its last sampled point.
        options.onCancel?.();
        update();
      }

      /** Advances after the current hop becomes visible; reduced motion stays immediate. */
      function advance() {
        if (phase !== "playing") return;
        const frames = readFrames();
        const nextIndex = activeIndex + 1;
        if (nextIndex >= frames.length) {
          phase = "complete";
          update();
          return;
        }
        if (activeIndex < 0 || motionQuery?.matches || document.hidden) {
          setActive(nextIndex, false);
          scheduleAdvance(nextIndex, frames.length);
          return;
        }
        pendingIndex = nextIndex;
        pendingPrevious = frames[activeIndex];
        pendingProgress = 0;
        // The graph renderer resolves path visibility and samples before rAF; frame work only paints.
        let transition;
        try {
          transition = options.onTransitionStart?.(frames[pendingIndex], pendingPrevious, pendingIndex, frames.length);
        } catch (error) {
          // Geometry and camera work are presentational. A detached/invalid SVG
          // path must degrade to a discrete arrival instead of freezing the story.
          reportTransitionError(error, "start");
          transition = undefined;
        }
        pendingDurationMs = Number(transition?.durationMs);
        if (!Number.isFinite(pendingDurationMs) || pendingDurationMs <= 0) {
          // Missing geometry is a discrete arrival, never an empty animation gap.
          pendingIndex = -1;
          pendingPrevious = undefined;
          setActive(nextIndex, false);
          scheduleAdvance(nextIndex, frames.length);
          return;
        }
        pendingDurationMs = Math.max(FUNCTION_LOGIC_VALUE_FLOW_PLAYBACK_MIN_DURATION_MS, Math.min(
          FUNCTION_LOGIC_VALUE_FLOW_PLAYBACK_MAX_DURATION_MS, Number(transition?.durationMs) || FUNCTION_LOGIC_VALUE_FLOW_PLAYBACK_MIN_DURATION_MS
        ));
        resumePendingTransition();
      }

      /** Continues the single pending lexical transition from its frozen path progress. */
      function resumePendingTransition() {
        const frames = readFrames();
        if (phase !== "playing" || pendingIndex < 0 || !pendingPrevious || pendingIndex >= frames.length) return;
        const remainingMs = Math.max(0,
          ((1 - pendingProgress) * pendingDurationMs) / speed);
        const transition = (progress) => options.onTransition?.(
          frames[pendingIndex], pendingPrevious, pendingIndex, frames.length, progress, {
            previous: pendingPrevious,
            direction: 1,
            phase: "transition",
            startProgress: pendingProgress
          });
        scheduleFrame((progress) => {
          pendingProgress = Math.max(pendingProgress, progress);
          try {
            transition(pendingProgress);
          } catch (error) {
            // Preserve the source-backed arrival even when one visual sample
            // fails. The next dwell/transition then continues on one scheduler.
            reportTransitionError(error, "frame");
            pendingProgress = 1;
          }
          if (pendingProgress < 1) return false;
          const arrivedIndex = pendingIndex;
          pendingIndex = -1;
          pendingPrevious = undefined;
          pendingProgress = 0;
          setActive(arrivedIndex, false);
          scheduleAdvance(arrivedIndex, frames.length);
          return true;
        }, remainingMs);
      }

      /** Gives each arrived frame a readable dwell before the next possible hop. */
      function scheduleAdvance(index, frameCount) {
        if (index >= frameCount - 1) {
          phase = "complete";
          update();
          return;
        }
        phase = "dwell";
        scheduleTimeout(() => {
          phase = "playing";
          advance();
        }, FUNCTION_LOGIC_VALUE_FLOW_PLAYBACK_DWELL_MS / speed);
      }

      /** Steps once in either direction without starting automatic progression. */
      function move(direction) {
        stop();
        const frames = readFrames();
        if (frames.length === 0) return;
        const fallback = direction > 0 ? 0 : frames.length - 1;
        const nextIndex = activeIndex < 0
          ? fallback
          : Math.max(0, Math.min(frames.length - 1, activeIndex + direction));
        setActive(nextIndex, false, direction);
      }

      /** Publishes one active frame without relying on color or animation alone. */
      function setActive(index, animated, direction) {
        const frames = readFrames();
        activeIndex = index >= 0 && index < frames.length ? index : -1;
        const active = activeIndex >= 0 ? frames[activeIndex] : undefined;
        options.onActiveFrame(active, activeIndex, frames.length, {
          animated: Boolean(animated && !motionQuery?.matches),
          direction: direction || 1,
          phase: "arrival"
        });
        update();
      }

      /** Updates disabled, playing, complete, and empty states as the graph changes. */
      function update() {
        const frames = readFrames();
        const active = activeIndex >= 0 ? frames[activeIndex] : undefined;
        renderVariableTokens(frames, activeIndex);
        previous.disabled = frames.length === 0 || activeIndex <= 0;
        next.disabled = frames.length === 0 || activeIndex >= frames.length - 1;
        replay.disabled = frames.length === 0;
        playPause.disabled = frames.length === 0;
        const isPlaying = phase === "playing" || phase === "dwell";
        speedSelect.disabled = isPlaying;
        speedText.textContent = copy.speedLabel + " ";
        playPause.textContent = isPlaying ? copy.pause : copy.play;
        playPause.title = isPlaying ? copy.pauseTitle : copy.playTitle;
        playPause.setAttribute("aria-label", playPause.title);
        options.onPlaybackState?.(activeBindingId, phase);
        if (frames.length === 0) {
          status.textContent = activeBindingId
            ? copy.noRoute
            : copy.select;
          return;
        }
        if (!active) {
          status.textContent = copy.ready(frames.length);
          return;
        }
        status.textContent = copy.status(active, activeIndex, frames.length, phase);
      }

      /** Keeps the current hop only while the selected binding remains unchanged. */
      function sync(bindingId) {
        if (activeBindingId !== bindingId) {
          activeBindingId = bindingId || "";
          renderGuide();
          stop();
          setActive(-1, false);
          return;
        }
        const frames = readFrames();
        if (activeIndex >= frames.length) setActive(-1, false);
        else update();
      }

      function readFrames() {
        return options.readFrames(activeBindingId) || [];
      }

      /** Relabels this self-contained card without changing scheduler or playback state. */
      function setLanguage(language) {
        const localizedCopy = createFunctionLogicValueFlowPlaybackCopy(language);
        if (localizedCopy.language === copy.language) return;
        copy = localizedCopy;
        section.setAttribute("aria-label", copy.regionLabel);
        if (copy.language === "ko") section.lang = "ko";
        else section.removeAttribute("lang");
        title.textContent = copy.title;
        variableTokens.setAttribute("aria-label", copy.tokensLabel);
        speedText.textContent = copy.speedLabel + " ";
        previous.textContent = copy.previous; previous.title = copy.previousTitle; previous.setAttribute("aria-label", copy.previousTitle);
        next.textContent = copy.next; next.title = copy.nextTitle; next.setAttribute("aria-label", copy.nextTitle);
        replay.textContent = copy.replay; replay.title = copy.replayTitle; replay.setAttribute("aria-label", copy.replayTitle);
        renderGuide();
        update();
      }
      function renderGuide() {
        guide.replaceChildren();
        const instructions = activeBindingId === "__scenario_workspace__" ? copy.scenarioGuide : copy.guide;
        for (const instruction of instructions) {
          const item = document.createElement("li");
          item.textContent = instruction;
          guide.append(item);
        }
      }

      /**
       * Shows one stable source-backed variable/field fact per opaque identity.
       * Future facts intentionally remain pending; the story/status still owns
       * non-variable narration and no extra progression state is introduced.
       */
      function renderVariableTokens(frames, arrivedIndex) {
        const records = new Map();
        for (let index = 0; index < frames.length; index += 1) {
          const frame = frames[index];
          const transition = frame?.transition;
          const targetName = String(transition?.targetName || "");
          if (!transition || !targetName) continue;
          const bindingId = String(transition.targetBindingId || frame.binding?.id || frame.access?.bindingId || frame.bindingId || targetName);
          const fieldTarget = String(transition.targetPath || targetName);
          const key = bindingId + "\u0000" + fieldTarget;
          let record = records.get(key);
          if (!record) {
            record = { identity: targetName, initial: formatPlaybackTokenValue(transition.before), before: undefined, after: undefined, arrived: false };
            records.set(key, record);
          }
          if (index <= arrivedIndex) {
            record.before = formatPlaybackTokenValue(transition.before);
            record.after = formatPlaybackTokenValue(transition.after);
            record.afterKnown = isKnownPlaybackTokenValue(transition.after);
            record.arrived = true;
          }
        }
        variableTokens.replaceChildren();
        for (const record of records.values()) {
          const token = document.createElement("div");
          const identity = document.createElement("code");
          const initial = document.createElement("span");
          const before = document.createElement("span");
          const arrow = document.createElement("span");
          const after = document.createElement("span");
          token.className = "logic-value-flow-playback-token" + (record.arrived ? " arrived" : " pending");
          identity.className = "logic-value-flow-playback-token-identity";
          initial.className = "logic-value-flow-playback-token-initial";
          before.className = "logic-value-flow-playback-token-before";
          arrow.className = "logic-value-flow-playback-token-arrow";
          after.className = "logic-value-flow-playback-token-after" + (record.arrived && record.afterKnown ? " changed" : "");
          identity.textContent = record.identity;
          initial.textContent = copy.tokenInitial + " " + record.initial;
          before.textContent = record.arrived ? record.before : copy.tokenPending;
          arrow.textContent = " → ";
          after.textContent = record.arrived ? record.after : copy.tokenUnknown;
          token.append(identity, initial, before, arrow, after);
          variableTokens.append(token);
        }
      }

      /** Formats source-projected values without reading user objects or HTML. */
      function formatPlaybackTokenValue(value) {
        return typeof formatFunctionLogicScenarioState === "function"
          ? formatFunctionLogicScenarioState(value)
          : String(value?.value ?? value ?? copy.tokenUnknown);
      }

      /** Only a known arrived after value receives semantic emphasis. */
      function isKnownPlaybackTokenValue(value) {
        return Boolean(value && value.kind === "known");
      }

      function play() {
        if (document.hidden || readFrames().length === 0) return;
        const resumesExistingPass = phase === "paused";
        if (phase === "complete" || activeIndex >= readFrames().length - 1) setActive(0, false);
        if (!resumesExistingPass) options.onPassStart?.();
        phase = "playing";
        update();
        advance();
      }

      /** Maintains one scheduler handle: a transition rAF or a dwell timeout. */
      function scheduleFrame(draw, duration) {
        const startedAt = performance.now();
        let lastNow = -1;
        const tick = (now) => {
          if (phase !== "playing") return;
          // Deterministic webview tests can invoke rAF synchronously with a frozen clock.
          // Settle that synthetic frame rather than recursively enqueueing it forever.
          const progress = now <= lastNow ? 1 : Math.min(1, (now - startedAt) / Math.max(1, duration));
          lastNow = now;
          if (draw(progress)) { scheduled = undefined; return; }
          scheduled = { type: "frame", id: requestAnimationFrame(tick) };
        };
        scheduled = { type: "frame", id: requestAnimationFrame(tick) };
      }
      function scheduleTimeout(callback, delay) {
        scheduled = { type: "timeout", id: setTimeout(() => { scheduled = undefined; callback(); }, delay) };
      }
      function cancelScheduledWork() {
        if (!scheduled) return;
        if (scheduled.type === "frame") cancelAnimationFrame(scheduled.id);
        else clearTimeout(scheduled.id);
        scheduled = undefined;
      }

      /** Reports optional visual failures without letting diagnostics break recovery. */
      function reportTransitionError(error, stage) {
        try { options.onTransitionError?.(error, stage); } catch (_reportError) {}
      }

      return {
        element: section,
        /** Starts one explicit pass (binding selection or Scenario Apply & Play) with the single scheduler. */
        playFromStart() {
          stop();
          setActive(readFrames().length > 0 ? 0 : -1, false);
          play();
        },
        reset() {
          stop();
          setActive(readFrames().length > 0 ? 0 : -1, false);
        },
        sync,
        pause,
        setLanguage,
        dispose() {
          stop();
          document.removeEventListener?.("visibilitychange", onVisibilityChange);
        }
      };
    }

    /** Provides one complete card locale, leaving source values and identifiers untouched. */
    function createFunctionLogicValueFlowPlaybackCopy(language) {
      const korean = language === "ko";
      const confidence = (value) => korean
        ? ({ exact: "정확", inferred: "추론", unknown: "알 수 없음" }[value] || "알 수 없음")
        : value || "unknown";
      if (korean) return { language: "ko", regionLabel: "값 흐름 재생", title: "흐름 재생", tokensLabel: "변수 값 토큰", tokenInitial: "처음", tokenPending: "대기", tokenUnknown: "알 수 없음",
        guide: ["값 선택", "재생", "토큰이 실제 간선을 따라감", "도착 시 값 변경 확인"],
        scenarioGuide: ["시나리오 선택", "재생", "카메라가 소스 경로를 따라감", "조건과 효과를 순서대로 확인"],
        previous: "이전", previousTitle: "이전 값 흐름 단계", play: "재생", playTitle: "값 흐름 재생",
        pause: "일시정지", pauseTitle: "값 흐름 일시정지", next: "다음", nextTitle: "다음 값 흐름 단계",
        replay: "다시 재생", replayTitle: "값 흐름 처음부터 재생", speedLabel: "재생 속도", select: "값을 선택하여 흐름을 단계별로 확인하세요.",
        noRoute: "선택한 값에 도달 가능한 정적 흐름이 없습니다.", ready: (count) => count + "개의 가능한 정적 프레임이 준비되었습니다. 재생하거나 단계를 선택하세요.",
        status: (active, index, count, phase) => "프레임 " + (index + 1) + "/" + count + " · "
          + (phase === "paused" ? "일시정지" : phase === "complete" ? "완료" : "가능한 정적 흐름")
          + " · " + describeFunctionLogicValueFlowPlaybackFrame(active, "시작 ", "값 ")
          + " · " + confidence(active.confidence || active.access?.confidence) };
      return { language: "en", regionLabel: "Value flow playback", title: "Flow playback", tokensLabel: "Variable value tokens", tokenInitial: "Initial", tokenPending: "Pending", tokenUnknown: "Unknown",
        guide: ["Select a value", "Play", "Token follows the real edge", "Value changes on arrival"],
        scenarioGuide: ["Choose a scenario", "Play", "Camera follows its source path", "Read decisions and effects in order"],
        previous: "Previous", previousTitle: "Previous value-flow hop", play: "Play", playTitle: "Play value flow",
        pause: "Pause", pauseTitle: "Pause value flow", next: "Next", nextTitle: "Next value-flow hop",
        replay: "Replay", replayTitle: "Replay value flow", speedLabel: "Playback speed", select: "Select a value to step through its value flow.",
        noRoute: "No reachable possible static flow for this selection.", ready: (count) => count + " possible static frame" + (count === 1 ? " is" : "s are") + " ready. Play or step through the route.",
        status: (active, index, count, phase) => "Frame " + (index + 1) + " of " + count + " · "
          + (phase === "paused" ? "paused" : phase === "complete" ? "complete" : "possible static flow")
          + " · " + describeFunctionLogicValueFlowPlaybackFrame(active, "START ", "carrying ")
          + " · " + confidence(active.confidence || active.access?.confidence) };
    }

    /** Formats a complete semantic mutation without relying on the optional SVG traveler. */
    function describeFunctionLogicValueFlowPlaybackFrame(active, startPrefix, carryingPrefix) {
      if (active.storyText) return active.storyText;
      if (active.transition) {
        const before = typeof formatFunctionLogicScenarioState === "function"
          ? formatFunctionLogicScenarioState(active.transition.before)
          : String(active.transition.before?.value);
        const after = typeof formatFunctionLogicScenarioState === "function"
          ? formatFunctionLogicScenarioState(active.transition.after)
          : String(active.transition.after?.value);
        return active.transition.targetName + ": " + before + " → " + after;
      }
      return active.type === "start"
        ? startPrefix + active.binding.name + " = " + active.carriedValue
        : carryingPrefix + active.carriedValue;
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
