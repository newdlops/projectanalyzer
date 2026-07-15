/**
 * Browser-injected controller and renderer for the project-specific Guided
 * Tour. It owns Guide/Explore navigation and records a source visit only after
 * a correlated Extension Host acknowledgment.
 */

/** Returns the self-contained Guided Tour browser controller declarations. */
export function getGuidedTourBrowserSource(): string {
  return /* js */ `
    /** Binds the two top-level surfaces without requesting additional data. */
    function bindGuidedTourControls() {
      elements.guideTab.addEventListener("click", () => setSidebarSurface("guide", false));
      elements.exploreTab.addEventListener("click", () => setSidebarSurface("explore", false));
      elements.guideTab.addEventListener("keydown", (event) => handleSurfaceTabKeydown(event, "guide"));
      elements.exploreTab.addEventListener("keydown", (event) => handleSurfaceTabKeydown(event, "explore"));
    }

    /** Implements the two-tab keyboard contract with no hidden third state. */
    function handleSurfaceTabKeydown(event, currentSurface) {
      let nextSurface;
      if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
        nextSurface = currentSurface === "guide" ? "explore" : "guide";
      } else if (event.key === "Home") {
        nextSurface = "guide";
      } else if (event.key === "End") {
        nextSurface = "explore";
      }

      if (!nextSurface) {
        return;
      }
      event.preventDefault();
      setSidebarSurface(nextSurface, true);
    }

    /** Switches the visible surface while preserving all Explore disclosure state. */
    function setSidebarSurface(surface, focusTab) {
      state.activeSurface = surface === "explore" ? "explore" : "guide";
      renderSidebarSurfaceState();
      if (focusTab) {
        (state.activeSurface === "guide" ? elements.guideTab : elements.exploreTab).focus();
      }
    }

    /** Clears only browser navigation facts belonging to the previous graph. */
    function resetGuidedTourBrowserState() {
      state.activeSurface = "guide";
      state.guidedTour = undefined;
      state.guidedTourCurrentStopIndex = 0;
      state.guidedTourOpenedStopIds = new Set();
      state.guidedTourPendingOpen = undefined;
      state.guidedTourOpenError = undefined;
      state.guidedTourOpenRequestSequence = 0;
      state.guidedTourFocusCurrentStop = false;
    }

    /** Consumes only Guided Tour responses and rejects every stale correlation. */
    function handleGuidedTourHostMessage(message) {
      if (message.type === "project/guidedTourLoaded") {
        if (!isCurrentGraphVersion(message.payload.graphVersion)) {
          return true;
        }
        const sameMission = state.guidedTour?.availability === "ready"
          && message.payload.availability === "ready"
          && state.guidedTour.graphVersion === message.payload.graphVersion
          && state.guidedTour.mission.id === message.payload.mission.id;
        state.guidedTour = message.payload;
        if (sameMission) {
          return true;
        }
        state.guidedTourCurrentStopIndex = 0;
        state.guidedTourOpenedStopIds = new Set();
        state.guidedTourPendingOpen = undefined;
        state.guidedTourOpenError = undefined;
        elements.status.textContent = message.payload.availability === "ready"
          ? "Guided Tour ready"
          : "Guided Tour evidence is limited";
        renderGuidedTour();
        return true;
      }

      if (message.type === "project/guidedTourSourceOpened") {
        if (!matchesPendingGuidedTourOpen(message.payload)) {
          return true;
        }
        state.guidedTourOpenedStopIds.add(message.payload.stopId);
        state.guidedTourPendingOpen = undefined;
        state.guidedTourOpenError = undefined;
        state.guidedTourFocusCurrentStop = true;
        elements.status.textContent = "Source opened for the current stop";
        renderGuidedTour();
        return true;
      }

      if (message.type === "project/guidedTourSourceOpenFailed") {
        if (!matchesPendingGuidedTourOpen(message.payload)) {
          return true;
        }
        state.guidedTourPendingOpen = undefined;
        state.guidedTourOpenError = message.payload.message || "Source could not be opened";
        state.guidedTourFocusCurrentStop = true;
        elements.status.textContent = state.guidedTourOpenError;
        renderGuidedTour();
        return true;
      }

      return false;
    }

    /** Matches every field in the in-flight source-open tuple. */
    function matchesPendingGuidedTourOpen(payload) {
      const pending = state.guidedTourPendingOpen;
      return Boolean(
        pending
        && isCurrentGraphVersion(payload.graphVersion)
        && payload.graphVersion === pending.graphVersion
        && payload.missionId === pending.missionId
        && payload.stopId === pending.stopId
        && payload.sourceToken === pending.sourceToken
        && payload.requestId === pending.requestId
      );
    }

    /** Renders the tab state and exactly one current Guided Tour stop. */
    function renderGuidedTour() {
      renderSidebarSurfaceState();
      elements.guidedTourContent.replaceChildren();

      if (!state.guidedTour) {
        appendGuidedTourEmpty(
          state.analysisState === "running"
            ? "Finding one source-backed learning mission..."
            : state.graph
            ? "Building one source-backed learning mission..."
            : "Analyze a workspace to start a project-specific guide."
        );
        return;
      }

      if (state.guidedTour.availability === "unavailable") {
        appendGuidedTourUnavailable(state.guidedTour.unavailable);
        return;
      }

      appendGuidedTourMission(state.guidedTour.mission);
    }

    /** Keeps only the selected top-level tabpanel visible and focusable. */
    function renderSidebarSurfaceState() {
      const showsGuide = state.activeSurface === "guide";
      elements.guideTab.classList.toggle("active", showsGuide);
      elements.exploreTab.classList.toggle("active", !showsGuide);
      elements.guideTab.setAttribute("aria-selected", showsGuide ? "true" : "false");
      elements.exploreTab.setAttribute("aria-selected", showsGuide ? "false" : "true");
      elements.guideTab.tabIndex = showsGuide ? 0 : -1;
      elements.exploreTab.tabIndex = showsGuide ? -1 : 0;
      elements.guidedTourSurface.hidden = !showsGuide;
      elements.exploreSurface.hidden = showsGuide;
    }

    /** Explains why a mission cannot be fabricated from the current evidence. */
    function appendGuidedTourUnavailable(unavailable) {
      const card = document.createElement("section");
      const heading = document.createElement("div");
      const explanation = document.createElement("div");
      card.className = "guided-tour-unavailable";
      heading.className = "guided-tour-mission-title";
      explanation.className = "guided-tour-copy";
      heading.textContent = "No source-backed mission is available";
      explanation.textContent = unavailable.explanation;
      card.append(heading, explanation);
      if (unavailable.observedEvidence?.length > 0) {
        appendGuidedTourList(card, "Observed evidence", unavailable.observedEvidence.slice(0, 3));
      }
      appendGuidedTourText(
        card,
        "Use Explore to inspect supported entrypoints and mapping gaps without treating missing evidence as missing business logic.",
        "guided-tour-note"
      );
      const explore = document.createElement("button");
      explore.type = "button";
      explore.className = "primary-button guided-tour-primary";
      if (unavailable.nextAction?.lookFor) {
        appendGuidedTourField(card, "Look for", unavailable.nextAction.lookFor);
      }
      explore.textContent = unavailable.nextAction?.label || "Explore evidence";
      explore.title = "Open Explore evidence";
      explore.addEventListener("click", () => setSidebarSurface("explore", true));
      card.append(explore);
      elements.guidedTourContent.append(card);
    }

    /** Appends mission context followed by one and only one current stop. */
    function appendGuidedTourMission(mission) {
      const header = document.createElement("section");
      const title = document.createElement("div");
      const context = document.createElement("div");
      const objective = document.createElement("div");
      header.className = "guided-tour-mission";
      title.className = "guided-tour-mission-title";
      context.className = "guided-tour-context";
      objective.className = "guided-tour-objective";
      title.textContent = mission.title;
      context.textContent = mission.scopeLabel + " · Trigger: " + mission.trigger;
      objective.textContent = mission.objective;
      header.append(title, context, objective);
      appendGuidedTourDisclosure(
        header,
        "Why this mission",
        mission.selectionReasons.slice(0, 3),
        mission.unknowns.concat(mission.limitations || []).slice(0, 4)
      );
      elements.guidedTourContent.append(header);

      if (!Array.isArray(mission.stops) || mission.stops.length === 0) {
        appendGuidedTourUnavailable({
          explanation: "The mission has no concrete source stop.",
          observedEvidence: [],
          nextAction: {
            label: "Explore mapping evidence",
            lookFor: "Find the entrypoint mapping or unresolved call that prevented a definition stop."
          }
        });
        return;
      }

      const boundedIndex = Math.min(
        Math.max(0, state.guidedTourCurrentStopIndex),
        mission.stops.length - 1
      );
      state.guidedTourCurrentStopIndex = boundedIndex;
      appendGuidedTourStop(mission, mission.stops[boundedIndex], boundedIndex);
    }

    /** Builds the teaching card and its single context-sensitive primary action. */
    function appendGuidedTourStop(mission, stop, stopIndex) {
      const card = document.createElement("section");
      const progress = document.createElement("div");
      const label = document.createElement("div");
      const location = document.createElement("div");
      const architecture = document.createElement("div");
      card.className = "guided-tour-stop";
      card.setAttribute("aria-current", "step");
      card.setAttribute("tabindex", "-1");
      progress.className = "guided-tour-progress";
      label.className = "guided-tour-stop-label";
      location.className = "guided-tour-location";
      architecture.className = "guided-tour-architecture";
      progress.textContent = "Step " + String(stopIndex + 1) + " of "
        + String(mission.stops.length) + " · " + formatGuidedTourStopKind(stop.kind);
      label.textContent = stop.label;
      location.textContent = stop.sourceLocation || "No concrete source location was projected";
      architecture.textContent = formatGuidedTourArchitecture(stop.architecture);
      card.append(progress, label, location, architecture);
      appendGuidedTourField(card, "Why now", stop.whyNow);
      appendGuidedTourList(card, "Look for", stop.lookFor.slice(0, 3));
      appendGuidedTourField(card, "Question", stop.question);
      appendGuidedTourDisclosure(
        card,
        "Evidence and unknowns",
        stop.evidence.slice(0, 2),
        stop.unknowns.slice(0, 2)
      );

      const hasSource = typeof stop.sourceToken === "string" && stop.sourceToken.length > 0;
      const sourceOpened = state.guidedTourOpenedStopIds.has(stop.id);
      if (!hasSource) {
        appendGuidedTourText(
          card,
          "This is an evidence-only stop. Static analysis did not project a source target.",
          "guided-tour-note"
        );
      }
      if (sourceOpened || !hasSource) {
        appendGuidedTourField(card, "Move on when", stop.moveOnWhen);
      }
      if (state.guidedTourOpenError) {
        appendGuidedTourText(card, state.guidedTourOpenError, "guided-tour-error");
      }

      appendGuidedTourActions(card, mission, stop, stopIndex, hasSource, sourceOpened);
      elements.guidedTourContent.append(card);
      if (state.guidedTourFocusCurrentStop) {
        state.guidedTourFocusCurrentStop = false;
        card.focus();
      }
    }

    /** Chooses Open, Retry, Next, or the final explain-back state. */
    function appendGuidedTourActions(parent, mission, stop, stopIndex, hasSource, sourceOpened) {
      const actions = document.createElement("div");
      const isLastStop = stopIndex >= mission.stops.length - 1;
      const pending = state.guidedTourPendingOpen;
      const isPending = Boolean(pending && pending.stopId === stop.id);
      const canMoveOn = !hasSource || sourceOpened;
      actions.className = "guided-tour-actions";

      if (stopIndex > 0) {
        const back = document.createElement("button");
        back.type = "button";
        back.className = "secondary-button guided-tour-back";
        back.textContent = "Back";
        back.title = "Back to the previous stop";
        back.disabled = isPending;
        back.addEventListener("click", () => moveGuidedTourStop(-1));
        actions.append(back);
      }

      if (!canMoveOn) {
        const open = document.createElement("button");
        open.type = "button";
        open.className = "primary-button guided-tour-primary";
        open.disabled = isPending;
        open.textContent = isPending
          ? "Opening source..."
          : state.guidedTourOpenError ? "Retry source" : "Open this function";
        open.title = (state.guidedTourOpenError ? "Retry current stop: " : "Open current stop: ") + stop.label;
        open.addEventListener("click", () => requestGuidedTourSourceOpen(mission, stop));
        actions.append(open);
      } else if (!isLastStop) {
        const next = document.createElement("button");
        next.type = "button";
        next.className = "primary-button guided-tour-primary";
        next.textContent = "Next stop";
        next.title = "Move to the next stop";
        next.addEventListener("click", () => moveGuidedTourStop(1));
        actions.append(next);
      }
      parent.append(actions);

      if (canMoveOn && isLastStop) {
        appendGuidedTourExit(parent, mission);
      }
    }

    /** Emits one tuple-bound source request without claiming it already opened. */
    function requestGuidedTourSourceOpen(mission, stop) {
      if (!state.graph || !stop.sourceToken || state.guidedTourPendingOpen) {
        return;
      }
      state.guidedTourOpenRequestSequence += 1;
      const payload = {
        graphVersion: state.graph.version,
        missionId: mission.id,
        stopId: stop.id,
        sourceToken: stop.sourceToken,
        requestId: state.guidedTourOpenRequestSequence
      };
      state.guidedTourPendingOpen = payload;
      state.guidedTourOpenError = undefined;
      state.guidedTourFocusCurrentStop = true;
      postRequest("project/guidedTourOpenSource", payload, "Opening current Guided Tour source");
      renderGuidedTour();
    }

    /** Moves locally inside the one bounded mission and never implies comprehension. */
    function moveGuidedTourStop(delta) {
      const mission = state.guidedTour?.availability === "ready"
        ? state.guidedTour.mission
        : undefined;
      if (!mission || state.guidedTourPendingOpen) {
        return;
      }
      const nextIndex = state.guidedTourCurrentStopIndex + delta;
      if (nextIndex < 0 || nextIndex >= mission.stops.length) {
        return;
      }
      state.guidedTourCurrentStopIndex = nextIndex;
      state.guidedTourOpenError = undefined;
      state.guidedTourFocusCurrentStop = true;
      renderGuidedTour();
    }

    /** Shows an explain-back checklist while avoiding a readiness score. */
    function appendGuidedTourExit(parent, mission) {
      const exit = document.createElement("section");
      const heading = document.createElement("div");
      exit.className = "guided-tour-exit";
      heading.className = "guided-tour-exit-heading";
      heading.textContent = "Exposed source stops visited · explain them back in your own words";
      exit.append(heading);
      appendGuidedTourList(exit, "Explain back", mission.explainBack.slice(0, 5));
      appendGuidedTourField(exit, "Exit when", mission.exitCriteria);
      if (mission.omittedStopCount > 0) {
        appendGuidedTourText(
          exit,
          String(mission.omittedStopCount)
            + " non-definition or unavailable stop(s) remain for Explore.",
          "guided-tour-note"
        );
      }
      appendGuidedTourText(
        exit,
        "Opened source locations are navigation evidence; they do not measure comprehension or readiness.",
        "guided-tour-note"
      );
      parent.append(exit);
    }

    /** Appends a compact labelled teaching field using text-only DOM operations. */
    function appendGuidedTourField(parent, label, value) {
      const field = document.createElement("div");
      const heading = document.createElement("span");
      const copy = document.createElement("span");
      field.className = "guided-tour-field";
      heading.className = "guided-tour-field-label";
      copy.className = "guided-tour-copy";
      heading.textContent = label;
      copy.textContent = value;
      field.append(heading, copy);
      parent.append(field);
    }

    /** Appends a bounded instruction or evidence list. */
    function appendGuidedTourList(parent, label, values) {
      if (!Array.isArray(values) || values.length === 0) {
        return;
      }
      const field = document.createElement("div");
      const heading = document.createElement("div");
      const list = document.createElement("ul");
      field.className = "guided-tour-list-field";
      heading.className = "guided-tour-field-label";
      list.className = "guided-tour-list";
      heading.textContent = label;
      for (const value of values) {
        const item = document.createElement("li");
        item.textContent = value;
        list.append(item);
      }
      field.append(heading, list);
      parent.append(field);
    }

    /** Keeps analyzer evidence secondary to the current source-reading action. */
    function appendGuidedTourDisclosure(parent, label, evidence, unknowns) {
      const disclosure = document.createElement("details");
      const summary = document.createElement("summary");
      disclosure.className = "guided-tour-evidence";
      summary.textContent = label;
      disclosure.append(summary);
      appendGuidedTourList(disclosure, "Evidence", evidence);
      appendGuidedTourList(disclosure, "Unknown", unknowns);
      parent.append(disclosure);
    }

    function appendGuidedTourText(parent, value, className) {
      const element = document.createElement("div");
      element.className = className;
      element.textContent = value;
      parent.append(element);
    }

    function appendGuidedTourEmpty(message) {
      appendGuidedTourText(elements.guidedTourContent, message, "guided-tour-empty");
    }

    function formatGuidedTourStopKind(kind) {
      if (kind === "decisionCandidate") return "Decision focus";
      if (kind === "collaborator") return "Collaborator";
      if (kind === "boundary") return "Effect boundary";
      if (kind === "evidenceGap") return "Evidence gap";
      return "First source stop";
    }

    function formatGuidedTourArchitecture(architecture) {
      const layer = formatGuidedTourLayer(architecture?.layer);
      const confidence = architecture?.confidence === "high"
        ? "strong evidence"
        : architecture?.confidence === "medium"
          ? "moderate evidence"
          : architecture?.confidence === "low" ? "weak evidence" : "unknown confidence";
      const business = architecture?.businessLogic === "domainRuleCandidate"
        ? "domain rule candidate"
        : architecture?.businessLogic === "applicationWorkflowCandidate"
          ? "application workflow candidate"
          : architecture?.businessLogic === "notBusinessLogic"
            ? "not identified as business logic"
            : "business role unknown";
      return layer + " · " + confidence + " · " + business + " · purity unknown";
    }

    function formatGuidedTourLayer(layer) {
      if (layer === "entrypoint") return "Entrypoint";
      if (layer === "interface") return "Interface";
      if (layer === "application") return "Application";
      if (layer === "domain") return "Domain";
      if (layer === "dataAccess") return "Data access";
      if (layer === "infrastructure") return "Infrastructure";
      if (layer === "crossCutting") return "Cross-cutting";
      if (layer === "test") return "Test";
      return "Unclassified";
    }
  `;
}
