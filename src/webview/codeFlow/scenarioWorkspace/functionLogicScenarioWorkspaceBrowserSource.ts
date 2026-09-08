/**
 * Browser-local Scenario Workspace session and compact Values renderer.
 * The registry deliberately owns only transient Webview state: it evaluates
 * opaque Tutor data, never reads source/VS Code APIs, and expires on root disposal.
 */
import { getFunctionLogicScenarioPathPlannerBrowserSource } from "./functionLogicScenarioPathPlannerBrowserSource";

export function getFunctionLogicScenarioWorkspaceBrowserSource(): string {
  return /* js */ `
    ${getFunctionLogicScenarioPathPlannerBrowserSource()}
    const functionLogicScenarioWorkspaceRegistry = new Map();

    /** Returns one bounded session for a stable root graph and Tutor payload. */
    function acquireFunctionLogicScenarioWorkspace(sessionKey, tutor) {
      const fingerprint = String(tutor?.fingerprint || tutor?.id || tutor?.program?.id || "no-tutor");
      const key = sessionKey + "::" + fingerprint;
      let workspace = functionLogicScenarioWorkspaceRegistry.get(key);
      if (workspace) return workspace;
      let phase = tutor?.seeds?.length ? "idle" : "empty";
      let selectedSeedId = tutor?.seeds?.[0]?.id || "";
      let selectedPathIndex = 0;
      let modified = false;
      // This transient marker is driven by the shared single playback card.
      // It never creates a per-row scheduler or persists outside this root session.
      let playbackSeedId = ""; let playbackPathIndex = 0; let playbackPhase = "idle";
      let consumers = 0;
      const results = new Map(); const errors = new Map(); const subscribers = new Set();
      const snapshot = new Map();
      function notify() { for (const subscriber of subscribers) subscriber(read()); }
      function read() { return { phase, selectedSeedId, selectedPathIndex, modified, results, errors, snapshot, playbackSeedId, playbackPathIndex, playbackPhase }; }
      function calculate() {
        if (!tutor?.seeds?.length || phase === "calculating" || phase === "ready" || phase === "partial") return;
        phase = "calculating"; notify();
        // The interpreter is bounded; calculate synchronously at explicit activation
        // so root teardown cannot leave a timer that mutates a disposed Webview.
        if (consumers < 1) { phase = "paused"; notify(); return; }
        for (const seed of tutor.seeds) {
          if (results.has(seed.id) || errors.has(seed.id)) continue;
          try {
            const evaluated = functionTutorRunScenario(tutor, seed);
            const paths = functionTutorResolveScenarioPaths(tutor, seed, evaluated);
            if (!paths?.length) errors.set(seed.id, true); else results.set(seed.id, paths);
          } catch (_error) { errors.set(seed.id, true); }
        }
        phase = errors.size ? "partial" : "ready"; notify();
      }
      workspace = {
        acquire() {
          consumers += 1;
          // A ready session must retain the element that received pointerdown.
          // Re-rendering it here would remove the button before its click event.
          if (phase === "paused") phase = "idle";
          calculate();
        },
        release() { consumers = Math.max(0, consumers - 1); if (consumers === 0 && phase === "calculating") { phase = "paused"; notify(); } },
        dispose() { consumers = 0; subscribers.clear(); functionLogicScenarioWorkspaceRegistry.delete(key); },
        read, subscribe(subscriber) { subscribers.add(subscriber); return () => subscribers.delete(subscriber); },
        appendSeeds(seeds) {
          const parameters = new Set((tutor?.parameters || []).map((parameter) => parameter.id));
          const existing = new Set((tutor?.seeds || []).map((seed) => seed.id));
          let added = 0;
          for (const seed of seeds || []) {
            if (!seed || seed.source !== "model" || !seed.id || existing.has(seed.id) || tutor.seeds.length >= 20
              || !Array.isArray(seed.inputs) || seed.inputs.length !== parameters.size
              || new Set(seed.inputs.map((input) => input.parameterId)).size !== parameters.size
              || seed.inputs.some((input) => !parameters.has(input.parameterId))) continue;
            existing.add(seed.id); tutor.seeds.push({ ...seed, ordinal: tutor.seeds.length + 1 }); added += 1;
          }
          if (added) { phase = "idle"; if (consumers > 0) calculate(); else notify(); }
          return added;
        },
        select(seedId, pathIndex) {
          const nextSeedId = seedId || selectedSeedId;
          const nextPathIndex = Math.max(0, Number(pathIndex) || 0);
          if (nextSeedId === selectedSeedId && nextPathIndex === selectedPathIndex) return;
          selectedSeedId = nextSeedId; selectedPathIndex = nextPathIndex; notify();
        },
        markModified() { if (modified) return; modified = true; notify(); },
        markApplied() { if (!modified) return; modified = false; notify(); },
        setPlaybackState(seedId, pathIndex, nextPhase) {
          const nextSeedId = seedId || "";
          const nextPathIndex = Math.max(0, Number(pathIndex) || 0);
          const normalizedPhase = nextPhase || "idle";
          // Playback updates can repeat within one arrival. Avoid rebuilding
          // both retained scenario tables when their visible state is unchanged.
          if (playbackSeedId === nextSeedId && playbackPathIndex === nextPathIndex && playbackPhase === normalizedPhase) return;
          playbackSeedId = nextSeedId; playbackPathIndex = nextPathIndex; playbackPhase = normalizedPhase; notify();
        },
        clearPlaybackState() {
          if (!playbackSeedId && playbackPathIndex === 0 && playbackPhase === "idle") return;
          playbackSeedId = ""; playbackPathIndex = 0; playbackPhase = "idle"; notify();
        },
        setSnapshot(nextSnapshot) { snapshot.clear(); for (const [key, value] of nextSnapshot || []) snapshot.set(key, value); notify(); },
        clearSnapshot() { snapshot.clear(); notify(); },
        selected() {
          const seed = tutor?.seeds?.find((candidate) => candidate.id === selectedSeedId) || tutor?.seeds?.[0];
          const paths = seed ? results.get(seed.id) : undefined;
          const pathIndex = Math.min(selectedPathIndex, Math.max(0, (paths?.length || 1) - 1));
          return { seed, pathIndex, path: paths?.[pathIndex], paths, error: Boolean(seed && errors.get(seed.id)) };
        }
      };
      functionLogicScenarioWorkspaceRegistry.set(key, workspace);
      return workspace;
    }

    /** Flattens evaluated seed paths so every scenario remains discoverable. */
    function readFunctionTutorScenarioRows(state, seeds) {
      const rows = [];
      for (const seed of seeds) {
        const paths = state.results.get(seed.id);
        if (!paths?.length) rows.push({ seed, pathIndex: 0, path: undefined });
        else for (let pathIndex = 0; pathIndex < paths.length; pathIndex += 1) rows.push({ seed, pathIndex, path: paths[pathIndex] });
        if (rows.length >= 48) break;
      }
      return rows.slice(0, 48);
    }

    /** Renders Values' path-centric scenario table and delegates side effects to composition. */
    function createFunctionLogicScenarioWorkspace(session, callbacks) {
      const section = document.createElement("section"); const heading = document.createElement("h3"); const intro = document.createElement("p"); const status = document.createElement("p");
      const table = document.createElement("table"); const head = document.createElement("thead"); const body = document.createElement("tbody"); const detail = document.createElement("article");
      section.className = "logic-scenario-workspace"; section.setAttribute("aria-label", projectAnalyzerText("scenario-workspace"));
      heading.className = "logic-scenario-workspace-heading"; intro.className = "logic-scenario-workspace-intro";
      status.className = "logic-scenario-workspace-status"; status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
      table.className = "logic-scenario-workspace-table"; detail.className = "logic-scenario-workspace-detail";
      table.append(head, body); section.append(heading, intro);
      if (callbacks.inputSuggestions) section.append(callbacks.inputSuggestions.element);
      section.append(status, table, detail);
      let unsubscribe;
      function render() {
        callbacks.inputSuggestions?.refresh();
        const state = session.read(); const selected = session.selected(); const seeds = callbacks.tutor?.seeds || []; const rows = readFunctionTutorScenarioRows(state, seeds);
        section.setAttribute("aria-label", projectAnalyzerText("scenario-workspace")); heading.textContent = projectAnalyzerText("scenario-workspace"); intro.textContent = projectAnalyzerText("scenario-workspace-help");
        const labels = ["scenario", "path-conditions", "expected-effects", "confidence-gaps", "scenario-action"];
        status.textContent = projectAnalyzerText("scenario-workspace-" + state.phase)
          + (state.phase === "ready" || state.phase === "partial" ? " · " + projectAnalyzerText("scenario-count", { count: rows.filter((row) => row.path).length }) : "")
          + (state.modified ? " · " + projectAnalyzerText("scenario-workspace-modified") : "");
        const branchEdges = new Set((callbacks.tutor?.program?.blocks || []).flatMap((block) => (block.decision?.outcomes || []).filter((outcome) => ["true", "false", "loop-exit"].includes(outcome.matches)).map((outcome) => outcome.edgeId)));
        if (branchEdges.size && seeds.some((seed) => seed.quality)) {
          const covered = new Set(seeds.flatMap((seed) => (seed.quality?.checkedEdgeIds || []).filter((id) => branchEdges.has(id))));
          status.textContent += " · " + projectAnalyzerText("scenario-quality-coverage", { covered: covered.size, total: branchEdges.size });
        }
        const headerRow = document.createElement("tr");
        for (const key of labels) { const cell = document.createElement("th"); cell.scope = "col"; cell.textContent = projectAnalyzerText(key); headerRow.append(cell); }
        head.replaceChildren(headerRow); body.replaceChildren();
        for (let index = 0; index < rows.length; index += 1) {
          const item = rows[index]; const seed = item.seed; const path = item.path; const row = document.createElement("tr"); const titleCell = document.createElement("th"); const selector = document.createElement("button");
          const isSelected = seed.id === selected.seed?.id && item.pathIndex === selected.pathIndex;
          const isActive = state.playbackSeedId === seed.id && state.playbackPathIndex === item.pathIndex;
          const isPlaying = isActive && (state.playbackPhase === "playing" || state.playbackPhase === "dwell");
          const isPaused = isActive && state.playbackPhase === "paused"; const isComplete = isActive && state.playbackPhase === "complete";
          const title = seed.source === "model" ? seed.title : path?.scenario ? functionTutorScenarioTitle(path, item.pathIndex + 1) : formatTutorSeedTitle(seed);
          row.className = "logic-scenario-workspace-row" + (isSelected ? " selected" : "") + (path?.symbolic ? " symbolic" : "");
          titleCell.scope = "row"; titleCell.dataset.label = projectAnalyzerText(labels[0]);
          selector.type = "button"; selector.className = "logic-scenario-workspace-row-selector"; selector.setAttribute("aria-current", isSelected ? "true" : "false"); selector.tabIndex = isSelected ? 0 : -1;
          const titleText = document.createElement("strong"); const sourceText = document.createElement("small"); titleText.textContent = title; sourceText.textContent = projectAnalyzerText("tutor-seed-" + seed.source, { ordinal: seed.ordinal }); selector.append(titleText, sourceText); titleCell.append(selector);
          selector.addEventListener("click", () => { session.select(seed.id, item.pathIndex); callbacks.onPreview?.(session.selected().path); table.querySelectorAll(".logic-scenario-workspace-row-selector")[index]?.focus(); });
          selector.addEventListener("keydown", (event) => { if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return; event.preventDefault(); const next = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : (index + (event.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length; session.select(rows[next].seed.id, rows[next].pathIndex); callbacks.onPreview?.(session.selected().path); render(); table.querySelectorAll(".logic-scenario-workspace-row-selector")[next]?.focus(); });
          const condition = document.createElement("td"); condition.dataset.label = projectAnalyzerText(labels[1]); condition.textContent = path ? functionTutorScenarioConditionText(path) : projectAnalyzerText(state.phase === "idle" ? "scenario-workspace-idle" : "scenario-workspace-partial");
          const outcome = document.createElement("td"); outcome.dataset.label = projectAnalyzerText(labels[2]); outcome.textContent = state.phase === "calculating" ? projectAnalyzerText("calculating") : !path ? projectAnalyzerText("scenario-workspace-partial") : path.scenario ? functionTutorScenarioEffectText(path) : functionTutorScenarioOutcomeText(path);
          const evidence = document.createElement("td"); evidence.dataset.label = projectAnalyzerText(labels[3]); evidence.textContent = projectAnalyzerText(path?.symbolic ? "scenario-symbolic" : seed.certainty === "exact" || seed.certainty === "inferred" ? seed.certainty : "unknown");
          const action = document.createElement("td"); action.dataset.label = projectAnalyzerText(labels[4]); action.className = "logic-scenario-workspace-action"; const play = document.createElement("button");
          play.type = "button"; play.className = "logic-scenario-workspace-play"; const unavailable = !path;
          const actionState = unavailable ? projectAnalyzerText("scenario-workspace-play-unavailable-action") : isPlaying ? projectAnalyzerText("scenario-workspace-playing") : isPaused ? projectAnalyzerText("scenario-workspace-paused-action") : isComplete ? projectAnalyzerText("replay") : projectAnalyzerText("apply-play");
          play.textContent = actionState; play.disabled = unavailable || isPlaying; play.title = projectAnalyzerText("scenario-workspace-play-title", { scenario: title, state: actionState }); play.setAttribute("aria-label", play.title);
          play.addEventListener("click", () => { if (!path || isPlaying) return; session.select(seed.id, item.pathIndex); callbacks.onPreview?.(session.selected().path); callbacks.onApplyPlay?.(seed, session.selected().path, item.pathIndex); session.markApplied(); });
          action.append(play); row.append(titleCell, condition, outcome, evidence, action); body.append(row);
        }
        renderFunctionTutorScenarioDetail(detail, selected, state, callbacks, session);
      }
      unsubscribe = session.subscribe(render); render();
      // Mounting and locale refresh are calculation-free. The first direct
      // Workspace focus or pointer interaction acquires the bounded evaluator.
      let activated = false;
      function activate() { if (activated) return; activated = true; session.acquire(); }
      /** Releases this surface only; the shared Guide may still own a calculation consumer. */
      function deactivate() { if (!activated) return; activated = false; session.release(); callbacks.onPreview?.(undefined); }
      section.addEventListener("focusin", activate); section.addEventListener("pointerdown", activate);
      return { element: section, activate, deactivate, markModified() { session.markModified(); }, refresh: render, dispose() { callbacks.inputSuggestions?.dispose(); unsubscribe?.(); deactivate(); } };
    }

    /** Renders named inputs, source decisions, effects, and transitions for one row. */
    function renderFunctionTutorScenarioDetail(detail, selected, state, callbacks, session) {
      detail.replaceChildren(); if (!selected.seed) return;
      const heading = document.createElement("h4"); heading.textContent = selected.seed.source === "model" ? selected.seed.title : selected.path?.scenario ? functionTutorScenarioTitle(selected.path, selected.pathIndex + 1) : formatTutorSeedTitle(selected.seed); detail.append(heading);
      renderFunctionTutorInputQuality(detail, selected.seed, callbacks.tutor);
      if (!selected.path) { if (state.phase !== "calculating") { const note = document.createElement("p"); note.textContent = projectAnalyzerText(selected.error ? "scenario-workspace-error" : "scenario-workspace-partial"); detail.append(note); } return; }
      if (selected.path.symbolic) { const note = document.createElement("p"); note.className = "logic-scenario-workspace-note"; note.textContent = projectAnalyzerText("scenario-symbolic-note"); detail.append(note); }
      const inputSection = document.createElement("section"); const inputHeading = document.createElement("h5"); const inputs = document.createElement("dl"); inputHeading.textContent = projectAnalyzerText("recommended-inputs");
      const parameters = new Map((callbacks.tutor?.parameters || []).map((parameter) => [parameter.id, parameter]));
      for (const input of selected.seed.inputs || []) { const term = document.createElement("dt"); const value = document.createElement("dd"); const parameter = parameters.get(input.parameterId); term.textContent = parameter ? parameter.name + (parameter.typeText ? " · " + parameter.typeText : "") : projectAnalyzerText("input"); term.setAttribute("translate", "no"); value.textContent = functionTutorValueText(input.value); inputs.append(term, value); }
      inputSection.append(inputHeading, inputs); detail.append(inputSection);
      const decisions = selected.path.scenario?.decisions || [];
      if (decisions.length) { const decisionSection = document.createElement("section"); const title = document.createElement("h5"); const list = document.createElement("ol"); title.textContent = projectAnalyzerText("path-conditions"); for (const decision of decisions) { const item = document.createElement("li"); item.textContent = decision.label + " → " + projectAnalyzerText("scenario-outcome-" + decision.outcome); list.append(item); } decisionSection.append(title, list); detail.append(decisionSection); }
      const effects = selected.path.scenario?.effects || [];
      if (selected.path.scenario) { const effectSection = document.createElement("section"); const title = document.createElement("h5"); const list = document.createElement("ol"); title.textContent = projectAnalyzerText("expected-effects"); if (!effects.length) { const item = document.createElement("li"); item.textContent = projectAnalyzerText("scenario-effect-none"); list.append(item); } else for (const effect of effects) { const item = document.createElement("li"); item.textContent = effect.label; list.append(item); } effectSection.append(title, list); detail.append(effectSection); }
      const changes = (selected.path.transitions || []).slice(0, 12);
      if (changes.length) { const changeSection = document.createElement("section"); const title = document.createElement("h5"); const list = document.createElement("ol"); title.textContent = projectAnalyzerText("possible-change"); list.className = "logic-scenario-workspace-changes"; for (const transition of changes) { const item = document.createElement("li"); item.textContent = (transition.target || transition.targetName || projectAnalyzerText("value")) + ": " + functionTutorValueText(transition.before) + " → " + functionTutorValueText(transition.after) + " · " + projectAnalyzerText(transition.certainty || "unknown"); list.append(item); } changeSection.append(title, list); detail.append(changeSection); }
      const actions = document.createElement("div"); actions.className = "logic-scenario-workspace-detail-actions"; const apply = document.createElement("button"); const known = (selected.seed.inputs || []).filter((input) => input.value?.kind !== "unknown"); apply.type = "button"; apply.textContent = projectAnalyzerText("apply-inputs"); apply.disabled = known.length === 0; apply.addEventListener("click", () => { callbacks.onApplyInputs?.(selected.seed); session.markApplied(); }); actions.append(apply);
      if (state.snapshot.size > 0) { const restore = document.createElement("button"); restore.type = "button"; restore.textContent = projectAnalyzerText("restore-prior-choices"); restore.addEventListener("click", () => { callbacks.onRestore?.(state.snapshot); session.clearSnapshot(); }); actions.append(restore); }
      detail.append(actions);
    }

    /** Explains model intent separately from the statically checked prefix. */
    function renderFunctionTutorInputQuality(detail, seed, tutor) {
      const quality = seed.quality; if (!quality) return;
      const section = document.createElement("section"); section.className = "logic-scenario-input-quality";
      const heading = document.createElement("h5"); heading.textContent = projectAnalyzerText("scenario-quality-heading");
      const reason = document.createElement("p");
      const conditions = (quality.targetBlockIds || []).map((id) => tutor?.program?.blocks?.find((block) => block.blockId === id)?.label).filter(Boolean).join(" · ");
      reason.textContent = quality.reason || projectAnalyzerText("scenario-quality-" + quality.purpose, { conditions });
      const checked = document.createElement("p"); checked.className = "logic-scenario-input-check";
      checked.textContent = projectAnalyzerText("scenario-quality-" + quality.status, { count: quality.branchCount || 0 })
        + (quality.gapReason ? " · " + projectAnalyzerText("scenario-quality-gap-" + quality.gapReason) : "");
      section.append(heading, reason, checked);
      if (quality.assumptions?.length) { const assumptions = document.createElement("p"); assumptions.textContent = projectAnalyzerText("scenario-quality-assumptions", { text: quality.assumptions.join(" · ") }); section.append(assumptions); }
      detail.append(section);
    }
  `;
}
