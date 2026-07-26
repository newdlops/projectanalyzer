/**
 * CSP-safe Function Guide Inspector renderer.
 *
 * The Guide builds a stable reading shell once, then replaces only the active
 * answer or scenario detail. Graph changes remain explicit integration actions.
 */

/** Returns the Function Guide browser renderer appended after the safe interpreter. */
export function getFunctionTutorGuideBrowserSource(): string {
  return /* js */ `
    let functionTutorGuidePanelSequence = 0;

    /** Builds one source-backed Guide panel for the Inspector's guide mode. */
    function createFunctionTutorPanel(logic, callbacks) {
      const tutor = logic.tutor; if (!tutor) return undefined;
      functionTutorGuidePanelSequence += 1;
      const panelId = "logic-function-guide-" + functionTutorGuidePanelSequence;
      const section = document.createElement("section"); const content = document.createElement("div");
      const status = document.createElement("p"); const chapterSlot = document.createElement("div");
      const scenarioSlot = document.createElement("div"); const toggle = document.createElement("button");
      const chapters = tutor.guide?.chapters || []; const questionButtons = [];
      let active = false; let chapterIndex = Math.max(0, chapters.findIndex((chapter) => chapter.id === tutor.guide?.initialChapterId));
      let scenariosOpen = false; let scenarioPhase = "idle"; let scenarioIndex = 0; let scenarioGeneration = 0;
      const resultsBySeed = new Map(); const errorsBySeed = new Map(); let selectedSeedId; let selectedPathIndex = 0;

      section.id = panelId; section.className = "logic-function-guide"; section.hidden = true;
      section.setAttribute("aria-label", "Function Guide");
      content.className = "logic-function-guide-content";
      status.className = "logic-guide-status"; status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
      status.textContent = tutor.availability === "unavailable"
        ? "Some source-backed Guide evidence is unavailable; Function Logic remains readable."
        : "Source-backed static analysis · no code runs.";
      chapterSlot.className = "logic-guide-chapter-slot";
      scenarioSlot.className = "logic-guide-scenario-slot";
      toggle.type = "button"; toggle.className = "logic-guide-toggle"; toggle.textContent = "Function Guide";
      toggle.title = "Open a source-backed guide to this function and its codebase context";
      toggle.setAttribute("aria-expanded", "false"); toggle.setAttribute("aria-controls", panelId);

      const navigation = createFunctionGuideNavigation(chapters, chapterIndex, selectChapter, questionButtons);
      content.append(status, createFunctionGuideOverview(tutor), navigation, chapterSlot, scenarioSlot, createFunctionGuideLimits(tutor));
      section.append(content);
      renderChapter(); renderScenarios();

      /** Selects a question without changing lens, selection, or viewport. */
      function selectChapter(nextIndex, focus) {
        if (nextIndex < 0 || nextIndex >= chapters.length || nextIndex === chapterIndex) return;
        chapterIndex = nextIndex; selectedPathIndex = 0;
        for (let index = 0; index < questionButtons.length; index += 1) {
          const button = questionButtons[index]; const selected = index === chapterIndex;
          button.setAttribute("aria-current", selected ? "true" : "false"); button.tabIndex = selected ? 0 : -1;
        }
        callbacks?.onGuideFocus?.(chapters[chapterIndex]);
        renderChapter();
        if (focus) questionButtons[chapterIndex]?.focus();
      }

      /** Replaces the active answer only; navigation and reading position persist. */
      function renderChapter() {
        chapterSlot.replaceChildren();
        const chapter = chapters[chapterIndex];
        if (!chapter) { chapterSlot.append(createFunctionGuideEmpty("No source-backed Guide questions are available for this function.")); return; }
        chapterSlot.append(createFunctionGuideChapter(chapter, tutor, {
          onShowGraph(current) { callbacks?.onShowGraph?.(current); status.textContent = "Showing " + current.question + " evidence on the function graph."; },
          onOpenEvidence(token) { callbacks?.onOpenEvidence?.(token); },
          onMoveQuestion(delta) { selectChapter(Math.max(0, Math.min(chapters.length - 1, chapterIndex + delta)), true); }
        }));
      }

      /** Starts or resumes bounded scenario calculation without source execution. */
      function startScenarioCalculation() {
        if (!scenariosOpen || scenarioPhase === "running" || scenarioPhase === "complete" || scenarioPhase === "complete-with-errors") return;
        if (!tutor.seeds?.length) { scenarioPhase = "complete"; renderScenarios(); return; }
        scenarioPhase = "running"; const generation = ++scenarioGeneration; renderScenarios();
        const runNext = () => {
          if (generation !== scenarioGeneration) return;
          if (!active || !scenariosOpen) { scenarioPhase = "paused"; renderScenarios(); return; }
          if (scenarioIndex >= tutor.seeds.length) {
            scenarioPhase = errorsBySeed.size ? "complete-with-errors" : "complete";
            status.textContent = errorsBySeed.size
              ? "Static input case calculation completed with gaps."
              : "Static input cases are ready.";
            renderScenarios(); return;
          }
          const seed = tutor.seeds[scenarioIndex];
          try { resultsBySeed.set(seed.id, functionTutorRunScenario(tutor, seed)); }
          catch (error) { errorsBySeed.set(seed.id, "This static input case could not be calculated."); }
          scenarioIndex += 1; renderScenarios(); setTimeout(runNext, 0);
        };
        runNext();
      }

      /** Replaces only the lazy scenario disclosure and retains calculated state. */
      function renderScenarios() {
        scenarioSlot.replaceChildren(createFunctionGuideScenarios());
      }

      function createFunctionGuideScenarios() {
        const details = document.createElement("details"); const summary = document.createElement("summary"); const body = document.createElement("div");
        const seeds = tutor.seeds || []; const completed = resultsBySeed.size + errorsBySeed.size;
        details.className = "logic-guide-scenarios"; details.open = scenariosOpen;
        details.setAttribute("aria-busy", scenarioPhase === "running" ? "true" : "false");
        summary.textContent = "Static Input Cases · " + seeds.length + " cases";
        summary.title = "Open Static Input Cases"; body.className = "logic-guide-scenario-body";
        details.append(summary, body);
        details.addEventListener("toggle", () => {
          scenariosOpen = details.open;
          if (scenariosOpen) startScenarioCalculation();
          else if (scenarioPhase === "running") { scenarioPhase = "paused"; scenarioGeneration += 1; }
        });
        if (!scenariosOpen) { body.append(createFunctionGuideEmpty("Calculate bounded possible outcomes only when you need a concrete input comparison.")); return details; }
        const progress = document.createElement("p"); progress.className = "logic-guide-scenario-progress";
        progress.textContent = scenarioPhase === "idle" ? "Ready to calculate static cases."
          : scenarioPhase === "paused" ? "Calculation paused; reopen this section to continue."
            : scenarioPhase === "running" ? "Calculating " + completed + " of " + seeds.length + " static cases…"
              : scenarioPhase === "complete-with-errors" ? "Calculated " + completed + " cases; some gaps remain."
                : "Calculated " + completed + " static cases.";
        body.append(progress);
        if (!seeds.length) { body.append(createFunctionGuideEmpty("No safe static input cases could be inferred. Unknown facts remain visible in the Guide.")); return details; }
        if (!selectedSeedId) selectedSeedId = seeds[0].id;
        const table = document.createElement("table"); const caption = document.createElement("caption"); const head = document.createElement("thead"); const headerRow = document.createElement("tr"); const tableBody = document.createElement("tbody");
        table.className = "logic-guide-scenario-table"; caption.textContent = "Possible static input cases";
        for (const label of ["Case", "Possible outcome"]) { const cell = document.createElement("th"); cell.scope = "col"; cell.textContent = label; headerRow.append(cell); }
        head.append(headerRow);
        for (let seedIndex = 0; seedIndex < seeds.length; seedIndex += 1) {
          const seed = seeds[seedIndex]; const row = document.createElement("tr"); const title = document.createElement("th"); const select = document.createElement("button");
          const result = resultsBySeed.get(seed.id); const error = errorsBySeed.get(seed.id); const primary = result?.[0]; const selected = seed.id === selectedSeedId;
          select.type = "button"; select.className = "logic-guide-scenario-select" + (selected ? " selected" : ""); select.textContent = seed.title;
          select.title = "Preview static input case · " + seed.title; select.setAttribute("aria-current", selected ? "true" : "false"); select.tabIndex = selected ? 0 : -1;
          select.addEventListener("click", () => { selectedSeedId = seed.id; selectedPathIndex = 0; if (primary) callbacks?.onScenarioPreview?.(primary); renderScenarios(); });
          select.addEventListener("keydown", (event) => {
            let nextIndex; if (event.key === "ArrowDown") nextIndex = (seedIndex + 1) % seeds.length;
            else if (event.key === "ArrowUp") nextIndex = (seedIndex + seeds.length - 1) % seeds.length;
            else if (event.key === "Home") nextIndex = 0; else if (event.key === "End") nextIndex = seeds.length - 1; else return;
            event.preventDefault(); selectedSeedId = seeds[nextIndex].id; selectedPathIndex = 0; const path = resultsBySeed.get(selectedSeedId)?.[0]; if (path) callbacks?.onScenarioPreview?.(path); renderScenarios();
          });
          title.scope = "row"; title.append(select);
          const outcome = document.createElement("td"); const certainty = createFunctionGuideCertainty(seed.certainty);
          outcome.append(document.createTextNode(error ? error : !result ? "Calculating…" : functionTutorScenarioOutcomeText(primary)), certainty);
          row.append(title, outcome); tableBody.append(row);
        }
        table.append(caption, head, tableBody); body.append(table);
        const selected = seeds.find((seed) => seed.id === selectedSeedId) || seeds[0]; const paths = selected ? resultsBySeed.get(selected.id) : undefined;
        if (!selected || !paths?.length) return details;
        if (selectedPathIndex >= paths.length) selectedPathIndex = 0;
        const path = paths[selectedPathIndex]; const detail = document.createElement("section"); const detailHeading = document.createElement("h4"); const inputs = document.createElement("dl");
        detail.className = "logic-guide-scenario-detail"; detailHeading.textContent = selected.title; detail.append(detailHeading);
        for (const input of selected.inputs) { const term = document.createElement("dt"); const definition = document.createElement("dd"); term.textContent = tutor.parameters.find((parameter) => parameter.id === input.parameterId)?.name || "input"; definition.textContent = functionTutorValueText(input.value); inputs.append(term, definition); }
        detail.append(inputs, createFunctionGuideCertainty(selected.certainty));
        const description = document.createElement("p"); description.className = "logic-guide-scenario-description"; description.textContent = "This is a possible static path for the selected inputs" + (path.limited ? "; the interpreter reached a safety bound." : "."); detail.append(description);
        if (paths.length > 1) {
          const label = document.createElement("label"); const select = document.createElement("select"); const pathId = panelId + "-path";
          label.textContent = "Possible path"; label.htmlFor = pathId; select.id = pathId;
          for (let index = 0; index < paths.length; index += 1) { const option = document.createElement("option"); option.value = String(index); option.textContent = "Path " + (index + 1) + (paths[index].limited ? " · bounded" : ""); select.append(option); }
          select.value = String(selectedPathIndex); select.addEventListener("change", () => { selectedPathIndex = Number(select.value) || 0; callbacks?.onScenarioPreview?.(paths[selectedPathIndex]); renderScenarios(); }); detail.append(label, select);
        }
        const known = selected.inputs.filter((input) => input.value.kind !== "unknown"); const load = document.createElement("button");
        load.type = "button"; load.className = "logic-guide-action"; load.textContent = "Load Inputs & Open Values"; load.title = "Load selected static inputs into Scenario values"; load.disabled = known.length === 0;
        load.addEventListener("click", () => { callbacks?.onLoadInputs?.(selected); status.textContent = "Loaded " + known.length + " known input" + (known.length === 1 ? "" : "s") + " into Values" + (known.length === selected.inputs.length ? "." : "; unknown inputs were skipped."); }); detail.append(load);
        const transitions = path.transitions || [];
        if (transitions.length) {
          const transitionTable = document.createElement("table"); const transitionHead = document.createElement("thead"); const transitionHeader = document.createElement("tr"); const transitionBody = document.createElement("tbody");
          transitionTable.className = "logic-guide-transition-table";
          for (const label of ["Value", "Possible change", "Evidence"]) { const cell = document.createElement("th"); cell.scope = "col"; cell.textContent = label; transitionHeader.append(cell); }
          transitionHead.append(transitionHeader);
          for (const transition of transitions) { const row = document.createElement("tr"); const name = document.createElement("th"); const change = document.createElement("td"); const evidence = document.createElement("td"); name.scope = "row"; name.textContent = transition.target; change.textContent = functionTutorValueText(transition.before) + " → " + functionTutorValueText(transition.after); evidence.append(createFunctionGuideCertainty(transition.certainty)); row.append(name, change, evidence); transitionBody.append(row); }
          transitionTable.append(transitionHead, transitionBody); detail.append(transitionTable);
        }
        body.append(detail); return details;
      }

      return {
        section, toggle,
        /** Called only by the Inspector mode controller. */
        setActive(nextActive) {
          active = Boolean(nextActive); section.hidden = !active;
          if (active && scenariosOpen && scenarioPhase === "paused") startScenarioCalculation();
          if (!active) { if (scenarioPhase === "running") { scenarioPhase = "paused"; scenarioGeneration += 1; } callbacks?.onClearGuideFocus?.(); callbacks?.onClearScenarioPreview?.(); }
        }
      };
    }

    function functionTutorScenarioOutcomeText(path) {
      if (!path) return "Calculating…";
      if (path.terminal?.kind === "return") return "May return " + functionTutorValueText(path.terminal.value);
      return path.terminal?.kind ? "May " + path.terminal.kind : "Possible path";
    }
    function createFunctionGuideCertainty(value) { const badge = document.createElement("span"); const normalized = value === "exact" || value === "inferred" ? value : "unknown"; badge.className = "flow-badge confidence " + normalized + " logic-guide-certainty"; badge.textContent = normalized === "exact" ? "Exact" : normalized === "inferred" ? "Inferred" : "Unknown"; return badge; }

    function createFunctionGuideOverview(tutor) {
      const section = document.createElement("section"); const heading = document.createElement("h3"); const list = document.createElement("dl"); const context = tutor.context || {}; const guide = tutor.guide || { chapters: [] };
      section.className = "logic-guide-overview"; heading.textContent = "At a Glance"; section.append(heading, list);
      const chapter = (kind) => guide.chapters?.find((candidate) => candidate.kind === kind); const count = (kind, key) => Number(chapter(kind)?.answer?.counts?.[key] || 0);
      const architecture = context.architecture; const entrypoints = Number(context.counts?.totalEntrypointCount || 0); const callers = Number(context.counts?.totalCallerCount || 0);
      const reached = entrypoints + " entrypoint" + (entrypoints === 1 ? "" : "s") + functionTutorOmittedText(context.counts?.omittedEntrypointCount) + " · " + callers + " direct caller" + (callers === 1 ? "" : "s") + functionTutorOmittedText(context.counts?.omittedCallerCount);
      const decisions = count("decisions", "decisionCount"); const loops = count("decisions", "loopCount"); const changes = count("work", "valueChangeCount"); const relations = count("work", "outgoingRelationCount");
      const leads = (context.counts?.totalLocalCalleeCount || 0) + " local · " + (context.counts?.totalExternalCalleeCount || 0) + " external · " + (context.counts?.totalUnresolvedCalleeCount || 0) + " unresolved" + functionTutorOmittedText(context.counts?.omittedCalleeCount);
      for (const [term, definition] of [["Codebase Role", architecture ? architecture.layer + " · " + functionTutorCertaintyText(architecture.confidence) : "Not classified in the current graph"], ["Reached From", reached], ["Internal Shape", decisions + " decision" + (decisions === 1 ? "" : "s") + " · " + loops + " loop" + (loops === 1 ? "" : "s") + " · " + changes + " value change" + (changes === 1 ? "" : "s")], ["Leads To", relations + " relation" + (relations === 1 ? "" : "s") + " · " + leads]]) { const dt = document.createElement("dt"); const dd = document.createElement("dd"); dt.textContent = term; dd.textContent = definition; list.append(dt, dd); }
      return section;
    }
    function functionTutorCertaintyText(value) { return value === "high" ? "Exact" : value === "unknown" ? "Unknown" : "Inferred"; }
    function functionTutorOmittedText(count) { const value = Number(count || 0); return value > 0 ? " (+" + value + " not shown)" : ""; }

    function createFunctionGuideNavigation(chapters, selectedIndex, onSelect, buttons) {
      const section = document.createElement("section"); const heading = document.createElement("h3"); const list = document.createElement("ol"); section.className = "logic-guide-navigation"; heading.textContent = "Read in 5 Questions"; section.append(heading, list);
      for (let index = 0; index < chapters.length; index += 1) { const chapter = chapters[index]; const item = document.createElement("li"); const button = document.createElement("button"); button.type = "button"; button.className = "logic-guide-question"; button.textContent = (index + 1) + " " + chapter.question; button.setAttribute("aria-current", index === selectedIndex ? "true" : "false"); button.tabIndex = index === selectedIndex ? 0 : -1; button.addEventListener("click", () => onSelect(index, false)); button.addEventListener("keydown", (event) => { let next; if (event.key === "ArrowDown") next = (index + 1) % chapters.length; else if (event.key === "ArrowUp") next = (index + chapters.length - 1) % chapters.length; else if (event.key === "Home") next = 0; else if (event.key === "End") next = chapters.length - 1; else return; event.preventDefault(); onSelect(next, true); }); buttons.push(button); item.append(button); list.append(item); }
      return section;
    }

    function createFunctionGuideChapter(chapter, tutor, callbacks) {
      const section = document.createElement("section"); const progress = document.createElement("p"); const heading = document.createElement("h3"); const answer = document.createElement("p"); const facts = document.createElement("ul"); const actions = document.createElement("div");
      section.className = "logic-guide-chapter"; progress.className = "logic-guide-progress"; progress.textContent = "Question " + chapter.ordinal + " of 5"; heading.textContent = chapter.question; answer.className = "logic-guide-answer"; answer.textContent = chapter.answer?.text || "No static answer is available."; facts.className = "logic-guide-facts"; actions.className = "logic-guide-actions";
      const visibleFacts = (chapter.facts || []).slice(0, 3); const hiddenFacts = (chapter.facts || []).slice(3);
      for (const fact of visibleFacts) facts.append(createFunctionGuideFact(fact));
      if (!facts.children.length) facts.append(createFunctionGuideEmpty(chapter.status === "unavailable" ? "This question has no source-backed facts in the current bounded analysis." : "No additional fact is available."));
      if (hiddenFacts.length) { const more = document.createElement("details"); const summary = document.createElement("summary"); const list = document.createElement("ul"); more.className = "logic-guide-more-facts"; summary.textContent = "More Facts · " + hiddenFacts.length; for (const fact of hiddenFacts) list.append(createFunctionGuideFact(fact)); more.append(summary, list); facts.append(more); }
      const show = document.createElement("button"); show.type = "button"; show.className = "logic-guide-action"; show.textContent = "Show on Graph"; show.disabled = !chapter.primaryBlockId && !(chapter.attentionBlockIds || []).length; show.addEventListener("click", () => callbacks?.onShowGraph?.(chapter)); actions.append(show);
      const firstToken = chapter.facts?.flatMap((fact) => fact.evidenceTokens || [])[0]; if (firstToken) { const source = createFunctionGuideEvidenceButton(firstToken, callbacks); source.textContent = "Open First Source"; actions.append(source); }
      const sourceBasis = document.createElement("details"); const sourceSummary = document.createElement("summary"); const sourceList = document.createElement("ul"); sourceBasis.className = "logic-guide-source-basis"; sourceSummary.textContent = "Source Basis · " + (chapter.facts || []).length + " facts";
      for (const fact of chapter.facts || []) { const item = document.createElement("li"); item.append(document.createTextNode(fact.label + " · "), createFunctionGuideCertainty(fact.certainty)); if (fact.evidenceTokens?.[0]) item.append(createFunctionGuideEvidenceButton(fact.evidenceTokens[0], callbacks)); sourceList.append(item); }
      sourceBasis.append(sourceSummary, sourceList);
      const navigation = document.createElement("div"); navigation.className = "logic-guide-actions"; const previous = document.createElement("button"); const next = document.createElement("button"); previous.type = "button"; next.type = "button"; previous.textContent = "Previous Question"; next.textContent = "Next Question"; previous.disabled = chapter.ordinal === 1; next.disabled = chapter.ordinal === 5; previous.addEventListener("click", () => callbacks?.onMoveQuestion?.(-1)); next.addEventListener("click", () => callbacks?.onMoveQuestion?.(1)); navigation.append(previous, next);
      section.append(progress, heading, answer, facts, actions, sourceBasis, navigation); return section;
    }
    function createFunctionGuideFact(fact) { const item = document.createElement("li"); const claim = document.createElement("strong"); const detail = document.createElement("span"); claim.textContent = fact.label; detail.textContent = fact.detail; item.append(claim, detail, createFunctionGuideCertainty(fact.certainty)); return item; }
    function createFunctionGuideEvidenceButton(token, callbacks) { const button = document.createElement("button"); button.type = "button"; button.className = "logic-guide-source-action"; button.textContent = "Open Source"; button.addEventListener("click", () => callbacks?.onOpenEvidence?.(token)); return button; }
    function createFunctionGuideLimits(tutor) { const details = document.createElement("details"); const summary = document.createElement("summary"); const list = document.createElement("ul"); details.className = "logic-guide-limits"; summary.textContent = "Unknowns & Limits · " + (tutor.gaps?.length || 0); for (const gap of (tutor.gaps || []).slice(0, 8)) { const item = document.createElement("li"); item.textContent = gap.summary; list.append(item); } if (!list.children.length) { const item = document.createElement("li"); item.textContent = "No additional static limits were reported."; list.append(item); } details.append(summary, list); return details; }
    function createFunctionGuideEmpty(text) { const empty = document.createElement("p"); empty.className = "logic-guide-empty"; empty.textContent = text; return empty; }
  `;
}
