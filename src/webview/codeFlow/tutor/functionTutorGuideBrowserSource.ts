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
      // These maps hold only semantic UI affordances. They are deliberately
      // independent of translated labels so a locale refresh can replace a
      // bounded subtree without changing what the reader had opened or focused.
      const disclosureOpenByKey = new Map(); let focusedControlKey;
      let statusPresentation = tutor.availability === "unavailable" ? { key: "guide-unavailable" } : { key: "guide-static-only" };
      const formatStatus = (descriptor) => {
        if (descriptor.key === "showing-evidence") {
          const chapter = chapters.find((candidate) => candidate.id === descriptor.chapterId);
          return projectAnalyzerText("showing-evidence", { question: formatTutorQuestion(chapter) });
        }
        if (descriptor.key === "loaded-known-inputs") return projectAnalyzerText("loaded-known-inputs", { count: descriptor.count, suffix: descriptor.allKnown ? "." : projectAnalyzerText("unknown-inputs-skipped") });
        return projectAnalyzerText(descriptor.key, descriptor.params);
      };

      section.id = panelId; section.className = "logic-function-guide"; section.hidden = true;
      section.setAttribute("aria-label", projectAnalyzerText("function-guide"));
      content.className = "logic-function-guide-content";
      status.className = "logic-guide-status"; status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
      status.textContent = formatStatus(statusPresentation);
      chapterSlot.className = "logic-guide-chapter-slot";
      scenarioSlot.className = "logic-guide-scenario-slot";
      toggle.type = "button"; toggle.className = "logic-guide-toggle"; toggle.textContent = projectAnalyzerText("function-guide");
      toggle.title = projectAnalyzerText("function-guide-description");
      toggle.setAttribute("aria-expanded", "false"); toggle.setAttribute("aria-controls", panelId);

      const overview = createFunctionGuideOverview(tutor);
      const navigation = createFunctionGuideNavigation(chapters, chapterIndex, selectChapter, questionButtons);
      const limits = createFunctionGuideLimits(tutor);
      content.append(status, overview, navigation, chapterSlot, scenarioSlot, limits);
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

      /** Stores owned status semantics so a retained locale pass can reformat it. */
      function setStatus(key, params) {
        statusPresentation = { key, ...(params || {}) };
        status.textContent = formatStatus(statusPresentation);
      }

      /** Replaces the active answer only; navigation and reading position persist. */
      function renderChapter() {
        retainFunctionGuideInteraction(chapterSlot, disclosureOpenByKey, (key) => { focusedControlKey = key; });
        chapterSlot.replaceChildren();
        const chapter = chapters[chapterIndex];
        if (!chapter) { chapterSlot.append(createFunctionGuideEmpty(projectAnalyzerText("no-guide-questions"))); return; }
        chapterSlot.append(createFunctionGuideChapter(chapter, tutor, {
          onShowGraph(current) { callbacks?.onShowGraph?.(current); setStatus("showing-evidence", { chapterId: current.id }); },
          onOpenEvidence(token) { callbacks?.onOpenEvidence?.(token); },
          onMoveQuestion(delta) { selectChapter(Math.max(0, Math.min(chapters.length - 1, chapterIndex + delta)), true); }
        }));
        restoreFunctionGuideInteraction(chapterSlot, disclosureOpenByKey, focusedControlKey);
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
            setStatus(errorsBySeed.size ? "static-cases-gaps" : "static-cases-ready-status");
            renderScenarios(); return;
          }
          const seed = tutor.seeds[scenarioIndex];
          try { resultsBySeed.set(seed.id, functionTutorRunScenario(tutor, seed)); }
          catch (error) { errorsBySeed.set(seed.id, { key: "static-case-failed" }); }
          scenarioIndex += 1; renderScenarios(); setTimeout(runNext, 0);
        };
        runNext();
      }

      /** Replaces only the lazy scenario disclosure and retains calculated state. */
      function renderScenarios() {
        retainFunctionGuideInteraction(scenarioSlot, disclosureOpenByKey, (key) => { focusedControlKey = key; });
        scenarioSlot.replaceChildren(createFunctionGuideScenarios());
        restoreFunctionGuideInteraction(scenarioSlot, disclosureOpenByKey, focusedControlKey);
      }

      function createFunctionGuideScenarios() {
        const details = document.createElement("details"); const summary = document.createElement("summary"); const body = document.createElement("div");
        const seeds = tutor.seeds || []; const completed = resultsBySeed.size + errorsBySeed.size;
        details.className = "logic-guide-scenarios"; details.dataset.guideKey = "scenarios"; details.open = scenariosOpen;
        details.setAttribute("aria-busy", scenarioPhase === "running" ? "true" : "false");
        summary.textContent = projectAnalyzerText("static-input-cases", { count: seeds.length });
        summary.title = projectAnalyzerText("open-static-input-cases"); body.className = "logic-guide-scenario-body";
        details.append(summary, body);
        details.addEventListener("toggle", () => {
          scenariosOpen = details.open;
          if (scenariosOpen) startScenarioCalculation();
          else if (scenarioPhase === "running") { scenarioPhase = "paused"; scenarioGeneration += 1; }
        });
        if (!scenariosOpen) { body.append(createFunctionGuideEmpty(projectAnalyzerText("calculate-static-cases"))); return details; }
        const progress = document.createElement("p"); progress.className = "logic-guide-scenario-progress";
        progress.textContent = scenarioPhase === "idle" ? projectAnalyzerText("static-cases-ready")
          : scenarioPhase === "paused" ? projectAnalyzerText("calculation-paused")
            : scenarioPhase === "running" ? projectAnalyzerText("calculating-static-cases", { completed: completed, total: seeds.length })
              : scenarioPhase === "complete-with-errors" ? projectAnalyzerText("static-cases-errors", { count: completed })
                : projectAnalyzerText("static-cases-complete", { count: completed });
        body.append(progress);
        if (!seeds.length) { body.append(createFunctionGuideEmpty(projectAnalyzerText("no-safe-cases"))); return details; }
        if (!selectedSeedId) selectedSeedId = seeds[0].id;
        const table = document.createElement("table"); const caption = document.createElement("caption"); const head = document.createElement("thead"); const headerRow = document.createElement("tr"); const tableBody = document.createElement("tbody");
        table.className = "logic-guide-scenario-table"; caption.textContent = projectAnalyzerText("possible-static-input-cases");
        for (const label of [projectAnalyzerText("case"), projectAnalyzerText("possible-outcome")]) { const cell = document.createElement("th"); cell.scope = "col"; cell.textContent = label; headerRow.append(cell); }
        head.append(headerRow);
        for (let seedIndex = 0; seedIndex < seeds.length; seedIndex += 1) {
          const seed = seeds[seedIndex]; const row = document.createElement("tr"); const title = document.createElement("th"); const select = document.createElement("button");
          const result = resultsBySeed.get(seed.id); const error = errorsBySeed.get(seed.id); const primary = result?.[0]; const selected = seed.id === selectedSeedId;
          const seedTitle = formatTutorSeedTitle(seed); select.type = "button"; select.className = "logic-guide-scenario-select" + (selected ? " selected" : ""); select.dataset.guideKey = "scenario-seed:" + seed.id; select.textContent = seedTitle;
          select.title = projectAnalyzerText("preview-static-case", { title: seedTitle }); select.setAttribute("aria-current", selected ? "true" : "false"); select.tabIndex = selected ? 0 : -1;
          select.addEventListener("click", () => { selectedSeedId = seed.id; selectedPathIndex = 0; if (primary) callbacks?.onScenarioPreview?.(primary); renderScenarios(); });
          select.addEventListener("keydown", (event) => {
            let nextIndex; if (event.key === "ArrowDown") nextIndex = (seedIndex + 1) % seeds.length;
            else if (event.key === "ArrowUp") nextIndex = (seedIndex + seeds.length - 1) % seeds.length;
            else if (event.key === "Home") nextIndex = 0; else if (event.key === "End") nextIndex = seeds.length - 1; else return;
            event.preventDefault(); selectedSeedId = seeds[nextIndex].id; selectedPathIndex = 0; const path = resultsBySeed.get(selectedSeedId)?.[0]; if (path) callbacks?.onScenarioPreview?.(path); renderScenarios();
          });
          title.scope = "row"; title.append(select);
          const outcome = document.createElement("td"); const certainty = createFunctionGuideCertainty(seed.certainty);
          outcome.append(document.createTextNode(error ? projectAnalyzerText(error.key, error.params) : !result ? projectAnalyzerText("calculating") : functionTutorScenarioOutcomeText(primary)), certainty);
          row.append(title, outcome); tableBody.append(row);
        }
        table.append(caption, head, tableBody); body.append(table);
        const selected = seeds.find((seed) => seed.id === selectedSeedId) || seeds[0]; const paths = selected ? resultsBySeed.get(selected.id) : undefined;
        if (!selected || !paths?.length) return details;
        if (selectedPathIndex >= paths.length) selectedPathIndex = 0;
        const path = paths[selectedPathIndex]; const detail = document.createElement("section"); const detailHeading = document.createElement("h4"); const inputs = document.createElement("dl");
        detail.className = "logic-guide-scenario-detail"; detailHeading.textContent = formatTutorSeedTitle(selected); detail.append(detailHeading);
        for (const input of selected.inputs) { const term = document.createElement("dt"); const definition = document.createElement("dd"); term.textContent = tutor.parameters.find((parameter) => parameter.id === input.parameterId)?.name || projectAnalyzerText("input"); definition.textContent = functionTutorValueText(input.value); inputs.append(term, definition); }
        detail.append(inputs, createFunctionGuideCertainty(selected.certainty));
        const description = document.createElement("p"); description.className = "logic-guide-scenario-description"; description.textContent = projectAnalyzerText("possible-static-path", { suffix: path.limited ? projectAnalyzerText("safety-bound") : "." }); detail.append(description);
        if (paths.length > 1) {
          const label = document.createElement("label"); const select = document.createElement("select"); const pathId = panelId + "-path";
          label.textContent = projectAnalyzerText("possible-path"); label.htmlFor = pathId; select.id = pathId; select.dataset.guideKey = "scenario-path:" + selected.id;
          for (let index = 0; index < paths.length; index += 1) { const option = document.createElement("option"); option.value = String(index); option.textContent = projectAnalyzerText("path", { count: index + 1, suffix: paths[index].limited ? projectAnalyzerText("bounded") : "" }); select.append(option); }
          select.value = String(selectedPathIndex); select.addEventListener("change", () => { selectedPathIndex = Number(select.value) || 0; callbacks?.onScenarioPreview?.(paths[selectedPathIndex]); renderScenarios(); }); detail.append(label, select);
        }
        const known = selected.inputs.filter((input) => input.value.kind !== "unknown"); const load = document.createElement("button");
        load.type = "button"; load.className = "logic-guide-action"; load.dataset.guideKey = "scenario-load-inputs:" + selected.id; load.textContent = projectAnalyzerText("load-inputs"); load.title = projectAnalyzerText("load-static-inputs"); load.disabled = known.length === 0;
        load.addEventListener("click", () => { callbacks?.onLoadInputs?.(selected); setStatus("loaded-known-inputs", { count: known.length, allKnown: known.length === selected.inputs.length }); }); detail.append(load);
        const transitions = path.transitions || [];
        if (transitions.length) {
          const transitionTable = document.createElement("table"); const transitionHead = document.createElement("thead"); const transitionHeader = document.createElement("tr"); const transitionBody = document.createElement("tbody");
          transitionTable.className = "logic-guide-transition-table";
          for (const label of [projectAnalyzerText("value"), projectAnalyzerText("possible-change"), projectAnalyzerText("evidence")]) { const cell = document.createElement("th"); cell.scope = "col"; cell.textContent = label; transitionHeader.append(cell); }
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
        },
        /** Rewrites Guide-owned copy only; semantic reading/scenario state is retained. */
        refreshLanguage() {
          section.setAttribute("aria-label", projectAnalyzerText("function-guide"));
          toggle.textContent = projectAnalyzerText("function-guide");
          toggle.title = projectAnalyzerText("function-guide-description");
          status.textContent = formatStatus(statusPresentation);
          overview.refreshLanguage?.();
          navigation.refreshLanguage?.();
          limits.refreshLanguage?.();
          // These are bounded Guide subviews. They retain chapter/scenario
          // semantic state and never touch graph, playback, or Host state.
          renderChapter();
          renderScenarios();
        }
      };
    }

    function functionTutorScenarioOutcomeText(path) {
      if (!path) return projectAnalyzerText("calculating");
      if (path.terminal?.kind === "return") return projectAnalyzerText("may-return", { value: functionTutorValueText(path.terminal.value) });
      return path.terminal?.kind ? projectAnalyzerText("may", { value: projectAnalyzerText("tutor-terminal-" + path.terminal.kind) }) : projectAnalyzerText("possible-path");
    }
    function createFunctionGuideCertainty(value) { const badge = document.createElement("span"); const normalized = value === "exact" || value === "inferred" ? value : "unknown"; badge.className = "flow-badge confidence " + normalized + " logic-guide-certainty"; badge.textContent = projectAnalyzerText(normalized); return badge; }

    function createFunctionGuideOverview(tutor) {
      const section = document.createElement("section"); const heading = document.createElement("h3"); const list = document.createElement("dl"); const context = tutor.context || {}; const guide = tutor.guide || { chapters: [] };
      section.className = "logic-guide-overview"; heading.textContent = projectAnalyzerText("at-a-glance"); section.append(heading, list);
      const chapter = (kind) => guide.chapters?.find((candidate) => candidate.kind === kind); const count = (kind, key) => Number(chapter(kind)?.answer?.counts?.[key] || 0);
      const architecture = context.architecture; const entrypoints = Number(context.counts?.totalEntrypointCount || 0); const callers = Number(context.counts?.totalCallerCount || 0);
      const reached = projectAnalyzerText("tutor-entrypoints", { count: entrypoints }) + functionTutorOmittedText(context.counts?.omittedEntrypointCount) + " · " + projectAnalyzerText("tutor-direct-callers", { count: callers }) + functionTutorOmittedText(context.counts?.omittedCallerCount);
      const decisions = count("decisions", "decisionCount"); const loops = count("decisions", "loopCount"); const changes = count("work", "valueChangeCount"); const relations = count("work", "outgoingRelationCount");
      const leads = projectAnalyzerText("tutor-local", { count: context.counts?.totalLocalCalleeCount || 0 }) + " · " + projectAnalyzerText("tutor-external", { count: context.counts?.totalExternalCalleeCount || 0 }) + " · " + projectAnalyzerText("tutor-unresolved", { count: context.counts?.totalUnresolvedCalleeCount || 0 }) + functionTutorOmittedText(context.counts?.omittedCalleeCount);
      for (const [term, definition] of [[projectAnalyzerText("codebase-role"), architecture ? functionTutorArchitectureLayerText(architecture.layer) + " · " + functionTutorCertaintyText(architecture.confidence) : projectAnalyzerText("not-classified")], [projectAnalyzerText("reached-from"), reached], [projectAnalyzerText("internal-shape"), projectAnalyzerText("tutor-overview-internal-shape", { decisions: decisions, loops: loops, changes: changes })], [projectAnalyzerText("leads-to"), relations + " · " + leads]]) { const dt = document.createElement("dt"); const dd = document.createElement("dd"); dt.textContent = term; dd.textContent = definition; list.append(dt, dd); }
      section.refreshLanguage = () => { const replacement = createFunctionGuideOverview(tutor); section.replaceChildren(...replacement.children); };
      return section;
    }
    function functionTutorCertaintyText(value) { return projectAnalyzerText(value === "high" ? "exact" : value === "unknown" ? "unknown" : "inferred"); }
    function functionTutorOmittedText(count) { const value = Number(count || 0); return value > 0 ? projectAnalyzerText("more-facts", { count: value }) : ""; }

    function createFunctionGuideNavigation(chapters, selectedIndex, onSelect, buttons) {
      const section = document.createElement("section"); const heading = document.createElement("h3"); const list = document.createElement("ol"); section.className = "logic-guide-navigation"; heading.textContent = projectAnalyzerText("read-questions"); section.append(heading, list);
      for (let index = 0; index < chapters.length; index += 1) { const chapter = chapters[index]; const item = document.createElement("li"); const button = document.createElement("button"); button.type = "button"; button.className = "logic-guide-question"; button.textContent = (index + 1) + " " + formatTutorQuestion(chapter); button.setAttribute("aria-current", index === selectedIndex ? "true" : "false"); button.tabIndex = index === selectedIndex ? 0 : -1; button.addEventListener("click", () => onSelect(index, false)); button.addEventListener("keydown", (event) => { let next; if (event.key === "ArrowDown") next = (index + 1) % chapters.length; else if (event.key === "ArrowUp") next = (index + chapters.length - 1) % chapters.length; else if (event.key === "Home") next = 0; else if (event.key === "End") next = chapters.length - 1; else return; event.preventDefault(); onSelect(next, true); }); buttons.push(button); item.append(button); list.append(item); }
      section.refreshLanguage = () => { heading.textContent = projectAnalyzerText("read-questions"); for (let index = 0; index < buttons.length; index += 1) buttons[index].textContent = (index + 1) + " " + formatTutorQuestion(chapters[index]); };
      return section;
    }

    function createFunctionGuideChapter(chapter, tutor, callbacks) {
      const section = document.createElement("section"); const progress = document.createElement("p"); const heading = document.createElement("h3"); const answer = document.createElement("p"); const facts = document.createElement("ul"); const actions = document.createElement("div");
      section.className = "logic-guide-chapter"; progress.className = "logic-guide-progress"; progress.textContent = projectAnalyzerText("question-progress", { current: chapter.ordinal }); heading.textContent = formatTutorQuestion(chapter); answer.className = "logic-guide-answer"; answer.textContent = formatTutorAnswer(chapter); facts.className = "logic-guide-facts"; actions.className = "logic-guide-actions";
      const visibleFacts = (chapter.facts || []).slice(0, 3); const hiddenFacts = (chapter.facts || []).slice(3);
      for (const fact of visibleFacts) facts.append(createFunctionGuideFact(fact));
      if (!facts.children.length) facts.append(createFunctionGuideEmpty(projectAnalyzerText(chapter.status === "unavailable" ? "guide-no-facts-unavailable" : "guide-no-facts")));
      if (hiddenFacts.length) { const more = document.createElement("details"); const summary = document.createElement("summary"); const list = document.createElement("ul"); more.className = "logic-guide-more-facts"; more.dataset.guideKey = "chapter-more-facts:" + chapter.id; summary.textContent = projectAnalyzerText("more-facts", { count: hiddenFacts.length }); for (const fact of hiddenFacts) list.append(createFunctionGuideFact(fact)); more.append(summary, list); facts.append(more); }
      const show = document.createElement("button"); show.type = "button"; show.className = "logic-guide-action"; show.dataset.guideKey = "chapter-show-graph:" + chapter.id; show.textContent = projectAnalyzerText("show-graph"); show.disabled = !chapter.primaryBlockId && !(chapter.attentionBlockIds || []).length; show.addEventListener("click", () => callbacks?.onShowGraph?.(chapter)); actions.append(show);
      const firstToken = chapter.facts?.flatMap((fact) => fact.evidenceTokens || [])[0]; if (firstToken) { const source = createFunctionGuideEvidenceButton(firstToken, callbacks); source.textContent = projectAnalyzerText("open-first-source"); actions.append(source); }
      const sourceBasis = document.createElement("details"); const sourceSummary = document.createElement("summary"); const sourceList = document.createElement("ul"); sourceBasis.className = "logic-guide-source-basis"; sourceBasis.dataset.guideKey = "chapter-source-basis:" + chapter.id; sourceSummary.textContent = projectAnalyzerText("source-basis", { count: (chapter.facts || []).length });
      for (const fact of chapter.facts || []) { const item = document.createElement("li"); item.append(document.createTextNode(formatTutorFactLabel(fact) + " · "), createFunctionGuideCertainty(fact.certainty)); if (fact.evidenceTokens?.[0]) item.append(createFunctionGuideEvidenceButton(fact.evidenceTokens[0], callbacks)); sourceList.append(item); }
      sourceBasis.append(sourceSummary, sourceList);
      const navigation = document.createElement("div"); navigation.className = "logic-guide-actions"; const previous = document.createElement("button"); const next = document.createElement("button"); previous.type = "button"; next.type = "button"; previous.dataset.guideKey = "chapter-previous:" + chapter.id; next.dataset.guideKey = "chapter-next:" + chapter.id; previous.textContent = projectAnalyzerText("previous-question"); next.textContent = projectAnalyzerText("next-question"); previous.disabled = chapter.ordinal === 1; next.disabled = chapter.ordinal === 5; previous.addEventListener("click", () => callbacks?.onMoveQuestion?.(-1)); next.addEventListener("click", () => callbacks?.onMoveQuestion?.(1)); navigation.append(previous, next);
      section.append(progress, heading, answer, facts, actions, sourceBasis, navigation); return section;
    }
    /** Captures bounded details/focus state with iterative traversal before replacement. */
    function retainFunctionGuideInteraction(root, disclosures, setFocusedKey) {
      const pending = [root]; const active = document.activeElement;
      while (pending.length) {
        const current = pending.pop(); if (!current) continue;
        const key = current.dataset?.guideKey;
        if (key && current.tagName === "DETAILS") disclosures.set(key, Boolean(current.open));
        if (key && current === active) setFocusedKey(key);
        for (let index = current.children.length - 1; index >= 0; index -= 1) pending.push(current.children[index]);
      }
    }
    /** Restores semantic Guide affordances after replacement without touching graph state. */
    function restoreFunctionGuideInteraction(root, disclosures, focusedKey) {
      const pending = [root]; let focused;
      while (pending.length) {
        const current = pending.pop(); if (!current) continue;
        const key = current.dataset?.guideKey;
        if (key && current.tagName === "DETAILS" && disclosures.has(key)) current.open = disclosures.get(key);
        if (key && key === focusedKey) focused = current;
        for (let index = current.children.length - 1; index >= 0; index -= 1) pending.push(current.children[index]);
      }
      focused?.focus();
    }
    function createFunctionGuideFact(fact) { const item = document.createElement("li"); const claim = document.createElement("strong"); const detail = document.createElement("span"); claim.textContent = formatTutorFactLabel(fact); detail.textContent = fact.presentationKey ? projectAnalyzerText(fact.presentationKey) : fact.detail; item.append(claim, detail, createFunctionGuideCertainty(fact.certainty)); return item; }
    function formatTutorFactLabel(fact) { if (!fact?.labelPresentationKey) return fact?.label || ""; const values = { ...(fact.labelPresentationParams || {}) }; if (fact.labelPresentationKey === "tutor-label-owner") values.kind = projectAnalyzerText(values.kind); if (fact.labelPresentationKey === "tutor-label-architecture") values.layer = functionTutorArchitectureLayerText(values.layer); return projectAnalyzerText(fact.labelPresentationKey, values); }
    function formatTutorSeedTitle(seed) { return projectAnalyzerText("tutor-seed-" + seed.source, { ordinal: seed.ordinal }); }
    function functionTutorArchitectureLayerText(layer) { return projectAnalyzerText("architecture-" + layer); }
    function formatTutorQuestion(chapter) { return chapter.questionKey ? projectAnalyzerText("tutor-question-" + chapter.questionKey) : chapter.question; }
    function formatTutorAnswer(chapter) { if (!chapter.answerKey) return chapter.answer?.text || projectAnalyzerText("no-static-answer"); const c = chapter.answer?.counts || {}; return projectAnalyzerText("tutor-answer-" + chapter.answerKey, c); }
    function createFunctionGuideEvidenceButton(token, callbacks) { const button = document.createElement("button"); button.type = "button"; button.className = "logic-guide-source-action"; button.textContent = projectAnalyzerText("open-source"); button.addEventListener("click", () => callbacks?.onOpenEvidence?.(token)); return button; }
    function createFunctionGuideLimits(tutor) { const details = document.createElement("details"); const summary = document.createElement("summary"); const list = document.createElement("ul"); details.className = "logic-guide-limits"; summary.textContent = projectAnalyzerText("unknowns-limits", { count: tutor.gaps?.length || 0 }); for (const gap of (tutor.gaps || []).slice(0, 8)) { const item = document.createElement("li"); item.textContent = gap.presentationKey ? projectAnalyzerText(gap.presentationKey, gap.presentationParams) : gap.summary; list.append(item); } if (!list.children.length) { const item = document.createElement("li"); item.textContent = projectAnalyzerText("no-additional-limits"); list.append(item); } details.append(summary, list); details.refreshLanguage = () => { const replacement = createFunctionGuideLimits(tutor); details.replaceChildren(...replacement.children); }; return details; }
    function createFunctionGuideEmpty(text) { const empty = document.createElement("p"); empty.className = "logic-guide-empty"; empty.textContent = text; return empty; }
  `;
}
