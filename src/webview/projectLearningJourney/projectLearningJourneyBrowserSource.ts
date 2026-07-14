/**
 * Browser renderer and progress recorder for the Project Learning Journey.
 *
 * Only observable guide actions are stored. The UI never converts visits into
 * claims that the project is understood, mastered, or production-ready.
 */

import { createProjectLearningCurriculum } from "../../shared/projectLearningJourney";

/** Returns the bounded curriculum renderer injected into the sidebar script. */
export function getProjectLearningJourneyBrowserSource(): string {
  const curriculum = JSON.stringify(createProjectLearningCurriculum()).replace(/</gu, "\\u003c");

  return /* js */ `
    const projectLearningCurriculum = ${curriculum};
    const projectLearningProgress = {
      graphVersion: undefined,
      lastAnnouncedProgress: undefined,
      visitedActionIds: new Set()
    };

    /** Renders current orientation guidance and the complete onboarding roadmap. */
    function renderProjectLearningJourney() {
      const progress = document.getElementById("learning-progress");
      const current = document.getElementById("learning-current");
      const roadmap = document.getElementById("learning-roadmap");
      if (!progress || !current || !roadmap) {
        return;
      }

      syncProjectLearningProgress();
      current.replaceChildren();
      roadmap.replaceChildren();

      if (!state.graph) {
        updateProjectLearningProgressText(
          progress,
          "Analyze a workspace to start the evidence-based learning journey."
        );
        appendProjectLearningRoadmap(roadmap);
        return;
      }

      const visitedCount = projectLearningProgress.visitedActionIds.size;
      const actionCount = projectLearningCurriculum.orientationActions.length;
      updateProjectLearningProgressText(
        progress,
        String(visitedCount) + " of " + String(actionCount)
          + " orientation actions visited · not a readiness score"
      );

      const nextAction = projectLearningCurriculum.orientationActions.find(
        (action) => !projectLearningProgress.visitedActionIds.has(action.id)
      );
      if (nextAction) {
        appendProjectLearningAction(current, nextAction, visitedCount + 1, actionCount);
      } else {
        appendProjectLearningContinuation(current);
      }
      appendProjectLearningRoadmap(roadmap);
    }

    /** Records an analyzer-backed action without claiming comprehension. */
    function recordProjectLearningAction(actionId) {
      syncProjectLearningProgress();
      const actionExists = projectLearningCurriculum.orientationActions.some(
        (action) => action.id === actionId
      );
      const nextAction = projectLearningCurriculum.orientationActions.find(
        (action) => !projectLearningProgress.visitedActionIds.has(action.id)
      );
      if (!state.graph || !actionExists || nextAction?.id !== actionId) {
        return;
      }

      projectLearningProgress.visitedActionIds.add(actionId);
      persistProjectLearningProgress();
      renderProjectLearningJourney();
    }

    /** Resets or restores only progress belonging to the active graph snapshot. */
    function syncProjectLearningProgress() {
      const graphVersion = state.graph?.version;
      if (projectLearningProgress.graphVersion === graphVersion) {
        return;
      }

      projectLearningProgress.graphVersion = graphVersion;
      projectLearningProgress.lastAnnouncedProgress = undefined;
      projectLearningProgress.visitedActionIds = new Set();
      if (!graphVersion || typeof vscode.getState !== "function") {
        return;
      }

      const saved = vscode.getState()?.projectLearningJourney;
      if (
        saved?.graphVersion !== graphVersion
        || saved.curriculumVersion !== projectLearningCurriculum.version
        || !Array.isArray(saved.visitedActionIds)
      ) {
        return;
      }

      const savedActionIds = new Set(
        saved.visitedActionIds.filter((actionId) => typeof actionId === "string")
      );
      for (const action of projectLearningCurriculum.orientationActions) {
        if (!savedActionIds.has(action.id)) {
          break;
        }
        projectLearningProgress.visitedActionIds.add(action.id);
      }
    }

    /** Persists no project paths, symbol identities, answers, or search terms. */
    function persistProjectLearningProgress() {
      if (!state.graph || typeof vscode.setState !== "function") {
        return;
      }

      const existing = typeof vscode.getState === "function" ? vscode.getState() : undefined;
      const base = existing && typeof existing === "object" ? existing : {};
      vscode.setState({
        ...base,
        projectLearningJourney: {
          curriculumVersion: projectLearningCurriculum.version,
          graphVersion: state.graph.version,
          visitedActionIds: Array.from(projectLearningProgress.visitedActionIds)
        }
      });
    }

    /** Shows the pedagogical frame for the next observable orientation action. */
    function appendProjectLearningAction(parent, action, position, actionCount) {
      const card = document.createElement("section");
      const heading = document.createElement("div");
      card.className = "learning-action";
      heading.className = "learning-action-heading";
      heading.textContent = "Next " + String(position) + "/" + String(actionCount) + " · " + action.title;
      card.append(heading);
      appendProjectLearningField(card, "Why", action.whyItMatters);
      appendProjectLearningField(card, "Learn", action.learn);
      appendProjectLearningField(card, "Inspect", action.inspectEvidence);
      appendProjectLearningField(card, "Do", action.activity);
      appendProjectLearningField(card, "Explain back", action.explainBack);
      appendProjectLearningField(card, "Exit", action.exitCriteria);
      parent.append(card);
    }

    /** Makes the boundary after the three-action vertical slice explicit. */
    function appendProjectLearningContinuation(parent) {
      const card = document.createElement("section");
      const heading = document.createElement("div");
      card.className = "learning-action";
      heading.className = "learning-action-heading";
      heading.textContent = "Orientation actions visited";
      card.append(heading);
      appendProjectLearningText(
        card,
        "Continue with team-confirmed context and runtime proof. Source-open requests alone do not complete onboarding.",
        "learning-action-copy"
      );
      appendProjectLearningField(
        card,
        "Explain back",
        "State the project purpose, one request path, its first boundary, and every unresolved question."
      );
      parent.append(card);
    }

    /** Renders all stages as a syllabus, never as inferred completion state. */
    function appendProjectLearningRoadmap(parent) {
      for (const [index, stage] of projectLearningCurriculum.roadmap.entries()) {
        const row = document.createElement("div");
        const heading = document.createElement("div");
        const objective = document.createElement("div");
        const states = document.createElement("div");
        const evidence = document.createElement("div");
        const exit = document.createElement("div");
        row.className = "learning-roadmap-stage";
        heading.className = "learning-roadmap-heading";
        objective.className = "learning-roadmap-objective";
        states.className = "learning-roadmap-states";
        evidence.className = "learning-roadmap-evidence";
        exit.className = "learning-roadmap-exit";
        heading.textContent = String(index + 1) + ". " + stage.title;
        objective.textContent = stage.objective;
        states.textContent = "Accepted evidence levels: " + stage.evidenceStates
          .map(formatProjectLearningEvidenceState)
          .join(" · ");
        evidence.textContent = "Evidence needed: " + stage.evidenceNeeded;
        exit.textContent = "Exit: " + stage.exitCriteria;
        row.append(heading, objective, states, evidence, exit);
        parent.append(row);
      }
    }

    function formatProjectLearningEvidenceState(value) {
      return value.charAt(0).toUpperCase() + value.slice(1);
    }

    /** Appends a labelled lesson field using text-only DOM operations. */
    function appendProjectLearningField(parent, label, value) {
      const field = document.createElement("div");
      const fieldLabel = document.createElement("span");
      const fieldValue = document.createElement("span");
      field.className = "learning-action-field";
      fieldLabel.className = "learning-action-label";
      fieldValue.className = "learning-action-copy";
      fieldLabel.textContent = label;
      fieldValue.textContent = value;
      field.append(fieldLabel, fieldValue);
      parent.append(field);
    }

    function appendProjectLearningText(parent, value, className) {
      const element = document.createElement("div");
      element.className = className;
      element.textContent = value;
      parent.append(element);
    }

    /** Updates the live region only when graph-scoped progress changes. */
    function updateProjectLearningProgressText(parent, value) {
      if (projectLearningProgress.lastAnnouncedProgress === value) {
        return;
      }
      projectLearningProgress.lastAnnouncedProgress = value;
      parent.replaceChildren();
      appendProjectLearningText(parent, value, "learning-progress-copy");
    }
  `;
}
