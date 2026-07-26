/**
 * CSP-safe Function Guide Inspector renderer.
 *
 * This browser fragment renders only Host-projected static facts. It owns Guide
 * disclosure and lazy scenario presentation, while graph focus and source
 * navigation remain explicit callbacks supplied by the integration adapter.
 */

/** Returns the Function Guide browser renderer appended after the safe interpreter. */
export function getFunctionTutorGuideBrowserSource(): string {
  return /* js */ `
    function createFunctionTutorPanel(logic, callbacks) {
      const tutor = logic.tutor; if (!tutor) return undefined;
      const section = document.createElement("section"); const content = document.createElement("div"); const toggle = document.createElement("button");
      let open = false; let chapterIndex = 0; let scenariosOpen = false; let scenarioStarted = false; let scenarioGeneration = 0;
      const resultsBySeed = new Map(); const errorsBySeed = new Map(); let selectedSeedId; let selectedPathIndex = 0;
      const panelId = "logic-function-guide-" + String(tutor.functionId || "session").replace(/[^A-Za-z0-9_-]/g, "-");
      section.id = panelId; section.className = "logic-function-guide"; section.hidden = true; section.setAttribute("aria-label", "Function Guide");
      content.className = "logic-function-guide-content";
      toggle.type = "button"; toggle.className = "logic-guide-toggle"; toggle.textContent = "Function Guide";
      toggle.title = "Open a source-backed guide to this function and its codebase context";
      toggle.setAttribute("aria-expanded", "false"); toggle.setAttribute("aria-controls", panelId);
      toggle.addEventListener("click", () => {
        open = !open; section.hidden = !open; toggle.setAttribute("aria-expanded", open ? "true" : "false");
        if (open) render(); else { callbacks?.onClearGuideFocus?.(); callbacks?.onClearScenarioPreview?.(); }
      });

      function render() {
        clearElement(content);
        const eyebrow = document.createElement("span"); const title = document.createElement("h2"); const intro = document.createElement("p");
        eyebrow.className = "logic-guide-kicker"; eyebrow.textContent = "SOURCE-BACKED GUIDE";
        title.className = "logic-guide-title"; title.textContent = "Understand This Function";
        intro.className = "logic-guide-intro"; intro.textContent = "Read its codebase role, inputs, decisions, work, and outcomes. Static analysis only; no code is run.";
        const status = document.createElement("div"); status.className = "logic-guide-status"; status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
        status.textContent = tutor.availability === "unavailable" ? "Some Function Guide evidence is unavailable; Function Logic remains readable." : "Static source-backed evidence. No code is run.";
        content.append(eyebrow, title, intro, status, createFunctionGuideOverview(tutor));
        const chapters = tutor.guide?.chapters || [];
        if (chapterIndex >= chapters.length) chapterIndex = 0;
        const navigation = createFunctionGuideNavigation(chapters, chapterIndex, (nextIndex, focus) => {
          chapterIndex = nextIndex; selectedPathIndex = 0;
          const chapter = chapters[chapterIndex]; callbacks?.onGuideFocus?.(chapter);
          render(); if (focus) content.querySelector(".logic-guide-question[aria-current='true']")?.focus();
        });
        content.append(navigation);
        const chapter = chapters[chapterIndex];
        const chapterCallbacks = Object.assign({}, callbacks, { onMoveQuestion(delta) {
          const nextIndex = Math.max(0, Math.min(chapters.length - 1, chapterIndex + delta));
          if (nextIndex === chapterIndex) return;
          chapterIndex = nextIndex; callbacks?.onGuideFocus?.(chapters[chapterIndex]); render();
        } });
        if (chapter) content.append(createFunctionGuideChapter(chapter, tutor, chapterCallbacks, status));
        else content.append(createFunctionGuideEmpty("No source-backed Guide questions are available for this function."));
        content.append(createFunctionGuideScenarios(tutor, callbacks, status));
        content.append(createFunctionGuideLimits(tutor));
      }

      function startScenarioCalculation() {
        if (scenarioStarted) return;
        scenarioStarted = true; const generation = ++scenarioGeneration; const seeds = tutor.seeds || [];
        const runNext = (index) => {
          if (!open || generation !== scenarioGeneration || index >= seeds.length) return;
          const seed = seeds[index];
          try { resultsBySeed.set(seed.id, functionTutorRunScenario(tutor, seed)); } catch (error) { errorsBySeed.set(seed.id, "This static input case could not be calculated."); }
          render();
          setTimeout(() => runNext(index + 1), 0);
        };
        runNext(0);
      }

      function createFunctionGuideScenarios(currentTutor, guideCallbacks, guideStatus) {
        const details = document.createElement("details"); const summary = document.createElement("summary"); const body = document.createElement("div");
        details.className = "logic-guide-scenarios"; details.open = scenariosOpen;
        summary.textContent = "Static Input Cases · " + (currentTutor.seeds?.length || 0) + " cases"; summary.title = "Open Static Input Cases";
        body.className = "logic-guide-scenario-body"; details.append(summary, body);
        details.addEventListener("toggle", () => {
          scenariosOpen = details.open;
          if (scenariosOpen) { startScenarioCalculation(); render(); }
        });
        if (!scenariosOpen) {
          const hint = document.createElement("p"); hint.textContent = "Calculate bounded possible outcomes only when you need a concrete input comparison."; body.append(hint);
          return details;
        }
        const seeds = currentTutor.seeds || [];
        if (!seeds.length) { body.append(createFunctionGuideEmpty("No safe static input cases could be inferred. Unknown facts remain visible in the Guide.")); return details; }
        if (!selectedSeedId && seeds[0]) selectedSeedId = seeds[0].id;
        const table = document.createElement("table"); const caption = document.createElement("caption"); const head = document.createElement("thead"); const headerRow = document.createElement("tr"); const tableBody = document.createElement("tbody");
        table.className = "logic-guide-scenario-table"; caption.textContent = "Possible static input cases";
        for (const label of ["Case", "Inputs", "Possible outcome", "Certainty"]) { const cell = document.createElement("th"); cell.scope = "col"; cell.textContent = label; headerRow.append(cell); }
        head.append(headerRow);
        for (const seed of seeds) {
          const row = document.createElement("tr"); const title = document.createElement("th"); const select = document.createElement("button");
          const result = resultsBySeed.get(seed.id); const error = errorsBySeed.get(seed.id); const primary = result?.[0];
          select.type = "button"; select.className = "logic-guide-scenario-select" + (seed.id === selectedSeedId ? " selected" : ""); select.textContent = seed.title; select.title = "Preview static input case · " + seed.title; select.setAttribute("aria-current", seed.id === selectedSeedId ? "true" : "false");
          select.addEventListener("click", () => { selectedSeedId = seed.id; selectedPathIndex = 0; if (primary) guideCallbacks?.onScenarioPreview?.(primary); render(); });
          title.scope = "row"; title.append(select);
          const inputs = document.createElement("td"); inputs.textContent = seed.inputs.map((input) => currentTutor.parameters.find((parameter) => parameter.id === input.parameterId)?.name + " = " + functionTutorValueText(input.value)).join(", ");
          const outcome = document.createElement("td"); outcome.textContent = error ? error : !result ? "Calculating…" : primary?.terminal?.kind === "return" ? "May return " + functionTutorValueText(primary.terminal.value) : primary?.terminal?.kind || "Possible path";
          const certainty = document.createElement("td"); certainty.textContent = seed.certainty + (primary?.limited ? " · bounded" : ""); row.append(title, inputs, outcome, certainty); tableBody.append(row);
        }
        table.append(caption, head, tableBody); body.append(table);
        const selected = seeds.find((seed) => seed.id === selectedSeedId) || seeds[0]; const paths = selected ? resultsBySeed.get(selected.id) : undefined;
        if (!selected || !paths?.length) return details;
        if (selectedPathIndex >= paths.length) selectedPathIndex = 0;
        const primary = paths[selectedPathIndex]; const description = document.createElement("p"); description.className = "logic-guide-scenario-description";
        description.textContent = "This is a possible static path for the selected inputs" + (primary?.limited ? "; the interpreter reached a safety bound." : "."); body.append(description);
        if (paths.length > 1) {
          const label = document.createElement("label"); const select = document.createElement("select"); label.textContent = "Possible path"; label.htmlFor = "logic-guide-path"; select.id = "logic-guide-path";
          for (let index = 0; index < paths.length; index += 1) { const option = document.createElement("option"); option.value = String(index); option.textContent = "Path " + (index + 1) + (paths[index].limited ? " · bounded" : ""); select.append(option); }
          select.value = String(selectedPathIndex); select.addEventListener("change", () => { selectedPathIndex = Number(select.value) || 0; guideCallbacks?.onScenarioPreview?.(paths[selectedPathIndex]); render(); }); body.append(label, select);
        }
        const load = document.createElement("button"); const known = selected.inputs.filter((input) => input.value.kind !== "unknown"); load.type = "button"; load.className = "logic-guide-action"; load.textContent = "Load Inputs into Values"; load.title = "Load selected static inputs into Values"; load.disabled = known.length === 0;
        load.addEventListener("click", () => { guideCallbacks?.onLoadInputs?.(selected); guideStatus.textContent = "Loaded " + known.length + " known input" + (known.length === 1 ? "" : "s") + " into Values" + (known.length === selected.inputs.length ? "." : "; unknown inputs were skipped."); });
        body.append(load);
        const transitions = primary?.transitions || [];
        if (transitions.length) {
          const transitionTable = document.createElement("table"); const transitionHead = document.createElement("thead"); const transitionHeader = document.createElement("tr"); const transitionBody = document.createElement("tbody"); transitionTable.className = "logic-guide-transition-table";
          for (const label of ["Value", "Before", "After", "Certainty"]) { const cell = document.createElement("th"); cell.scope = "col"; cell.textContent = label; transitionHeader.append(cell); }
          transitionHead.append(transitionHeader);
          for (const transition of transitions) { const row = document.createElement("tr"); const name = document.createElement("th"); const before = document.createElement("td"); const after = document.createElement("td"); const certainty = document.createElement("td"); name.scope = "row"; name.textContent = transition.target; before.textContent = functionTutorValueText(transition.before); after.textContent = functionTutorValueText(transition.after); certainty.textContent = transition.certainty; row.append(name, before, after, certainty); transitionBody.append(row); }
          transitionTable.append(transitionHead, transitionBody); body.append(transitionTable);
        }
        return details;
      }

      section.append(content);
      return { section, toggle, open() { open = true; section.hidden = false; toggle.setAttribute("aria-expanded", "true"); render(); } };
    }

    function createFunctionGuideOverview(tutor) {
      const section = document.createElement("section"); const heading = document.createElement("h3"); const list = document.createElement("dl"); const context = tutor.context || {}; const guide = tutor.guide || { chapters: [] };
      section.className = "logic-guide-overview"; heading.textContent = "At a Glance"; section.append(heading, list);
      const architecture = context.architecture; const reached = (context.entrypoints?.length || 0) + " entrypoint" + ((context.entrypoints?.length || 0) === 1 ? "" : "s") + " · " + (context.callers?.length || 0) + " direct caller" + ((context.callers?.length || 0) === 1 ? "" : "s");
      const decisions = guide.chapters?.find((chapter) => chapter.kind === "decisions")?.facts?.length || 0; const outcomes = guide.chapters?.find((chapter) => chapter.kind === "outcomes")?.facts?.length || 0;
      const leads = (context.counts?.totalLocalCalleeCount || 0) + " local · " + (context.counts?.totalExternalCalleeCount || 0) + " external · " + (context.counts?.totalUnresolvedCalleeCount || 0) + " unresolved";
      for (const [term, definition] of [["Codebase Role", architecture ? architecture.layer + " · " + architecture.confidence : "Not classified in the current graph"], ["Reached From", reached], ["Internal Shape", decisions + " decision facts · " + outcomes + " outcome facts"], ["Leads To", leads]]) { const dt = document.createElement("dt"); const dd = document.createElement("dd"); dt.textContent = term; dd.textContent = definition; list.append(dt, dd); }
      return section;
    }

    function createFunctionGuideNavigation(chapters, selectedIndex, onSelect) {
      const section = document.createElement("section"); const heading = document.createElement("h3"); const list = document.createElement("ol");
      section.className = "logic-guide-navigation"; heading.textContent = "Read in 5 Questions"; section.append(heading, list);
      for (let index = 0; index < chapters.length; index += 1) {
        const chapter = chapters[index]; const item = document.createElement("li"); const button = document.createElement("button"); button.type = "button"; button.className = "logic-guide-question"; button.textContent = (index + 1) + " " + chapter.question; button.setAttribute("aria-current", index === selectedIndex ? "true" : "false"); button.tabIndex = index === selectedIndex ? 0 : -1;
        button.addEventListener("click", () => onSelect(index, false)); button.addEventListener("keydown", (event) => { let next; if (event.key === "ArrowDown") next = (index + 1) % chapters.length; else if (event.key === "ArrowUp") next = (index + chapters.length - 1) % chapters.length; else if (event.key === "Home") next = 0; else if (event.key === "End") next = chapters.length - 1; else return; event.preventDefault(); onSelect(next, true); }); item.append(button); list.append(item);
      }
      return section;
    }

    function createFunctionGuideChapter(chapter, tutor, callbacks, status) {
      const section = document.createElement("section"); const progress = document.createElement("p"); const heading = document.createElement("h3"); const answer = document.createElement("p"); const facts = document.createElement("ul"); const actions = document.createElement("div");
      section.className = "logic-guide-chapter"; progress.className = "logic-guide-progress"; progress.textContent = "Question " + chapter.ordinal + " of 5"; heading.textContent = chapter.question; answer.className = "logic-guide-answer"; answer.textContent = chapter.answer?.text || "No static answer is available."; facts.className = "logic-guide-facts"; actions.className = "logic-guide-actions";
      for (const fact of chapter.facts || []) { const item = document.createElement("li"); const claim = document.createElement("strong"); const detail = document.createElement("span"); const certainty = document.createElement("span"); claim.textContent = fact.label; detail.textContent = fact.detail; certainty.className = "logic-guide-certainty"; certainty.textContent = fact.certainty; item.append(claim, detail, certainty); if (fact.evidenceTokens?.[0]) item.append(createFunctionGuideEvidenceButton(fact.evidenceTokens[0], callbacks)); facts.append(item); }
      if (!facts.children.length) facts.append(createFunctionGuideEmpty(chapter.status === "unavailable" ? "This question has no source-backed facts in the current bounded analysis." : "No additional fact is available."));
      const show = document.createElement("button"); show.type = "button"; show.className = "logic-guide-action"; show.textContent = "Show on Graph"; show.disabled = !chapter.primaryBlockId && !(chapter.attentionBlockIds || []).length; show.addEventListener("click", () => { callbacks?.onShowGraph?.(chapter); status.textContent = "Showing " + chapter.question + " evidence on the function graph."; }); actions.append(show);
      const firstToken = chapter.facts?.flatMap((fact) => fact.evidenceTokens || [])[0]; if (firstToken) actions.append(createFunctionGuideEvidenceButton(firstToken, callbacks));
      const sourceBasis = document.createElement("details"); const sourceSummary = document.createElement("summary"); const sourceList = document.createElement("ul"); sourceBasis.className = "logic-guide-source-basis"; sourceSummary.textContent = "Source Basis · " + (chapter.facts || []).length + " facts";
      for (const fact of chapter.facts || []) { const item = document.createElement("li"); item.textContent = fact.label + " · " + fact.certainty; if (fact.evidenceTokens?.[0]) item.append(createFunctionGuideEvidenceButton(fact.evidenceTokens[0], callbacks)); sourceList.append(item); }
      sourceBasis.append(sourceSummary, sourceList);
      const navigation = document.createElement("div"); navigation.className = "logic-guide-actions"; const previous = document.createElement("button"); const next = document.createElement("button"); previous.type = "button"; next.type = "button"; previous.textContent = "Previous Question"; next.textContent = "Next Question"; previous.disabled = chapter.ordinal === 1; next.disabled = chapter.ordinal === 5; previous.addEventListener("click", () => callbacks?.onMoveQuestion?.(-1)); next.addEventListener("click", () => callbacks?.onMoveQuestion?.(1)); navigation.append(previous, next);
      section.append(progress, heading, answer, facts, actions, sourceBasis, navigation); return section;
    }

    function createFunctionGuideEvidenceButton(token, callbacks) { const button = document.createElement("button"); button.type = "button"; button.className = "logic-guide-source-action"; button.textContent = "Open Source"; button.addEventListener("click", () => callbacks?.onOpenEvidence?.(token)); return button; }
    function createFunctionGuideLimits(tutor) { const details = document.createElement("details"); const summary = document.createElement("summary"); const list = document.createElement("ul"); details.className = "logic-guide-limits"; summary.textContent = "Unknowns & Limits · " + (tutor.gaps?.length || 0); for (const gap of (tutor.gaps || []).slice(0, 8)) { const item = document.createElement("li"); item.textContent = gap.summary; list.append(item); } if (!list.children.length) { const item = document.createElement("li"); item.textContent = "No additional static limits were reported."; list.append(item); } details.append(summary, list); return details; }
    function createFunctionGuideEmpty(text) { const empty = document.createElement("p"); empty.className = "logic-guide-empty"; empty.textContent = text; return empty; }
  `;
}
