/**
 * Browser-injected rendering helpers for the two-stage Project Reading Plan.
 * The initial view is capped at three scope cards; evidence-ranked entrypoints
 * and source areas render only after the Host returns a selected scope.
 */

import { getProjectLearningJourneyBrowserSource } from "./projectLearningJourney";

/** Returns self-contained helper declarations injected into the sidebar script. */
export function getReadingGuideBrowserSource(): string {
  const learningJourneySource = getProjectLearningJourneyBrowserSource();

  return /* js */ `
    ${learningJourneySource}

    /** Renders the bounded first-read scope index and selected lazy detail. */
    function renderProjectReadingGuide() {
      renderProjectLearningJourney();
      elements.guideSummary.replaceChildren();
      elements.guideScopes.replaceChildren();
      elements.guideScopeDetail.replaceChildren();

      if (!state.readingGuide) {
        appendGuideEmpty(
          elements.guideSummary,
          state.graph ? "Building project map..." : "Analyze a workspace to map project scopes"
        );
        return;
      }

      appendGuideSummary(state.readingGuide);
      for (const scope of state.readingGuide.scopes.slice(0, 3)) {
        appendGuideScope(scope);
      }

      if (state.readingGuide.omittedScopeCount > 0) {
        appendGuideEmpty(
          elements.guideScopes,
          "+" + String(state.readingGuide.omittedScopeCount) + " more scopes available in structure details"
        );
      }

      if (state.scopeGuideLoading) {
        appendGuideEmpty(elements.guideScopeDetail, "Loading selected scope...");
      } else if (state.scopeGuide && state.scopeGuide.scope.id === state.selectedScopeId) {
        recordProjectLearningAction("inspectScope");
        appendScopeGuide(state.scopeGuide);
      }
    }

    /** Appends the one-line identity and measured analysis footprint. */
    function appendGuideSummary(guide) {
      const headline = document.createElement("div");
      const detail = document.createElement("div");
      headline.className = "guide-headline";
      detail.className = "guide-detail";
      headline.textContent = guide.headline;
      detail.textContent = guide.detail;
      elements.guideSummary.append(headline, detail);
    }

    /** Creates one selectable rootPath scope without exposing individual symbols. */
    function appendGuideScope(scope) {
      const button = document.createElement("button");
      const path = document.createElement("span");
      const stack = document.createElement("span");
      const execution = document.createElement("span");

      button.type = "button";
      button.className = "guide-scope";
      button.classList.toggle("selected", state.selectedScopeId === scope.id);
      button.title = "Inspect " + scope.displayPath;
      path.className = "guide-scope-path";
      stack.className = "guide-scope-stack";
      execution.className = "guide-scope-execution";
      path.textContent = scope.displayPath;
      stack.textContent = formatScopeStack(scope);
      execution.textContent = formatScopeExecution(scope.execution);
      button.append(path, stack, execution);
      button.addEventListener("click", () => requestScopeReadingGuide(scope.id));
      elements.guideScopes.append(button);
    }

    /** Requests detail only when a different scope or graph snapshot is selected. */
    function requestScopeReadingGuide(scopeId) {
      if (
        !state.graph
        || (state.selectedScopeId === scopeId && (state.scopeGuide || state.scopeGuideLoading))
      ) {
        state.selectedScopeId = scopeId;
        renderProjectReadingGuide();
        return;
      }

      state.selectedScopeId = scopeId;
      state.scopeGuide = undefined;
      state.scopeGuideLoading = true;
      renderProjectReadingGuide();
      vscode.postMessage({
        type: "project/readingGuideScope",
        payload: { graphVersion: state.graph.version, scopeId }
      });
    }

    /** Applies a scope failure only to the still-selected snapshot request. */
    function handleProjectReadingGuideScopeFailure(payload) {
      if (!isCurrentGraphVersion(payload.graphVersion) || payload.scopeId !== state.selectedScopeId) {
        return;
      }
      state.scopeGuideLoading = false;
      elements.status.textContent = payload.message;
      renderProjectReadingGuide();
    }

    /** Renders evidence-ranked entrypoints before the supporting source map. */
    function appendScopeGuide(guide) {
      const heading = document.createElement("div");
      heading.className = "guide-detail-heading";
      heading.textContent = "Inside " + guide.scope.displayPath;
      elements.guideScopeDetail.append(heading);

      appendGuideSectionLabel(elements.guideScopeDetail, "Recommended entrypoints");
      appendGuideNote(
        elements.guideScopeDetail,
        "Ranked by explainable layer coverage and mapping evidence, not runtime importance."
      );
      if (guide.recommendedFlows.length === 0) {
        appendGuideEmpty(
          elements.guideScopeDetail,
          guide.unmappedEntrypointCount > 0
            ? "No uniquely mapped source path in this scope"
            : "No HTTP or GraphQL path in this scope"
        );
      } else {
        for (const flow of guide.recommendedFlows.slice(0, 3)) {
          appendGuideFlow(flow);
        }
      }
      if (guide.omittedFlowCount > 0) {
        appendGuideEmpty(
          elements.guideScopeDetail,
          "+" + String(guide.omittedFlowCount) + " other mapped paths in Explore Code Flows"
        );
      }

      appendGuideSectionLabel(elements.guideScopeDetail, "Source areas");
      if (guide.areas.length === 0) {
        appendGuideEmpty(elements.guideScopeDetail, "No distinct source areas in the analyzed graph");
      } else {
        for (const area of guide.areas.slice(0, 5)) {
          appendGuideArea(area);
        }
      }
      if (guide.omittedAreaCount > 0) {
        appendGuideEmpty(elements.guideScopeDetail, "+" + String(guide.omittedAreaCount) + " more areas");
      }
    }

    /** Appends one measured directory footprint and bounded, non-interactive file examples. */
    function appendGuideArea(area) {
      const row = document.createElement("div");
      const path = document.createElement("span");
      const counts = document.createElement("span");
      const files = document.createElement("div");
      row.className = "guide-area";
      path.className = "guide-area-path";
      counts.className = "guide-area-counts";
      files.className = "guide-area-files";
      path.textContent = area.displayPath;
      counts.textContent =
        String(area.analyzedFileCount) + " files · " +
        String(area.callableCount) + " callables" +
        (area.entrypointCount > 0 ? " · " + String(area.entrypointCount) + " entries" : "");
      row.append(path, counts);

      for (const filePath of (area.representativeFilePaths ?? []).slice(0, 3)) {
        const file = document.createElement("span");
        file.className = "guide-area-file";
        file.title = filePath;
        file.textContent = filePath;
        files.append(file);
      }
      if (files.children.length > 0) {
        row.append(files);
      }
      elements.guideScopeDetail.append(row);
    }

    /** Keeps each recommended path collapsed until the user asks for its evidence. */
    function appendGuideFlow(flow) {
      const disclosure = document.createElement("details");
      const summary = document.createElement("summary");
      const summaryTitle = document.createElement("span");
      const summaryReason = document.createElement("span");
      const steps = document.createElement("div");
      disclosure.className = "guide-flow";
      summary.className = "guide-flow-summary";
      summaryTitle.className = "guide-flow-title";
      summaryReason.className = "guide-flow-reason";
      steps.className = "guide-flow-steps";
      summaryTitle.textContent = flow.name + " · " + formatTransport(flow.transport);
      summaryReason.textContent = formatBusinessReach(flow.recommendation.businessReach)
        + " · mapping " + formatMappingConfidence(flow.confidence);
      summary.append(summaryTitle, summaryReason);
      summary.title = "Study recommended path: " + flow.name;
      summary.addEventListener("click", () => {
        recordProjectLearningAction("traceRepresentativePath");
      });
      disclosure.append(summary);

      const explanation = document.createElement("div");
      explanation.className = "guide-flow-explanation";
      explanation.textContent = flow.recommendation.explanation;
      steps.append(explanation);

      const layers = document.createElement("div");
      layers.className = "guide-flow-layers";
      layers.textContent = flow.steps
        .map((step) => formatArchitectureLayer(step.architecture?.layer))
        .join(" → ");
      steps.append(layers);

      for (const reason of flow.recommendation.whyRecommended.slice(0, 3)) {
        appendGuideEvidenceLine(steps, "Why", reason);
      }

      for (const [index, step] of flow.steps.slice(0, 5).entries()) {
        appendGuideStep(steps, step, index, flow.recommendation.targetStepIndex);
      }
      if (flow.omittedStepCount > 0) {
        appendGuideEmpty(steps, String(flow.omittedStepCount) + " analyzed flow steps not shown");
      }
      for (const unknown of flow.recommendation.unknowns.slice(0, 3)) {
        appendGuideEvidenceLine(steps, "Unknown", unknown);
      }
      disclosure.append(steps);
      elements.guideScopeDetail.append(disclosure);
    }

    /** Appends layer evidence and a source button only for concrete identities. */
    function appendGuideStep(parent, step, index, targetStepIndex) {
      const item = document.createElement(step.sourceToken ? "button" : "div");
      const role = document.createElement("span");
      const label = document.createElement("span");
      const location = document.createElement("span");
      const evidence = document.createElement("span");
      const architecture = step.architecture || {
        layer: "unclassified",
        confidence: "unknown",
        businessLogic: "unknown",
        purity: "unknown",
        evidence: []
      };
      item.className = "guide-step";
      item.classList.toggle("recommended", index === targetStepIndex);
      role.className = "guide-step-role";
      label.className = "guide-step-label";
      location.className = "guide-step-location";
      evidence.className = "guide-step-evidence";
      role.textContent = formatArchitectureLayer(architecture.layer);
      label.textContent = step.label;
      const locationPrefix = step.sourceLocationKind === "callsite"
        ? "call site: "
        : step.sourceLocationKind === "evidence" ? "evidence: " : "";
      const displayLocation = step.sourceLocation
        ? locationPrefix + step.sourceLocation
        : "";
      location.textContent = displayLocation;
      const cue = formatReadingCue(step.readingCues || [], architecture.businessLogic);
      const contextualEvidence = step.contextInference?.evidence?.[0];
      const layerEvidence = architecture.conflicted && architecture.alternatives?.length > 0
        ? "Conflicting evidence: " + architecture.alternatives.map(formatArchitectureLayer).join(" vs ")
        : contextualEvidence
          ? contextualEvidence + " Layer remains Unclassified."
        : architecture.evidence?.[0] || "No stable layer evidence identified.";
      const evidenceConfidence = step.contextInference
        ? "low-confidence topology"
        : formatArchitectureConfidence(architecture.confidence);
      evidence.textContent = (cue ? cue + " · " : "")
        + evidenceConfidence + " · " + layerEvidence;
      if (step.sourceToken) {
        item.type = "button";
        item.title = (index === targetStepIndex ? "Open recommended start: " : "Open ")
          + step.label + (displayLocation ? " · " + displayLocation : "");
        item.addEventListener("click", () => {
          postRequest("node/openSource", { nodeId: step.sourceToken }, "Opening reading path source");
          recordProjectLearningAction("verifyConcreteSource");
        });
      }
      item.append(role, label);
      if (step.sourceLocation) {
        item.append(location);
      }
      item.append(evidence);
      parent.append(item);
    }

    function appendGuideEvidenceLine(parent, label, value) {
      const line = document.createElement("div");
      const prefix = document.createElement("span");
      const copy = document.createElement("span");
      line.className = "guide-evidence-line";
      prefix.className = "guide-evidence-label";
      copy.className = "guide-evidence-copy";
      prefix.textContent = label;
      copy.textContent = value;
      line.append(prefix, copy);
      parent.append(line);
    }

    function appendGuideSectionLabel(parent, label) {
      const element = document.createElement("div");
      element.className = "guide-section-label";
      element.textContent = label;
      parent.append(element);
    }

    function appendGuideEmpty(parent, message) {
      const empty = document.createElement("div");
      empty.className = "guide-empty";
      empty.textContent = message;
      parent.append(empty);
    }

    function appendGuideNote(parent, message) {
      const note = document.createElement("div");
      note.className = "guide-note";
      note.textContent = message;
      parent.append(note);
    }

    function formatScopeStack(scope) {
      const names = scope.frameworks.slice(0, 3);
      if (names.length > 0) {
        return names.join(" + ") + (scope.omittedFrameworkCount > 0 ? " +" + scope.omittedFrameworkCount : "");
      }
      return scope.basis === "source" ? "Source structure" : "Framework scope";
    }

    function formatScopeExecution(execution) {
      const parts = [];
      if (execution.httpRouteCount > 0) {
        parts.push(String(execution.httpRouteCount) + " HTTP");
      }
      const graphqlCount = execution.graphqlQueryCount + execution.graphqlMutationCount
        + execution.graphqlSubscriptionCount + execution.graphqlOtherCount;
      if (graphqlCount > 0) {
        const operationParts = [];
        if (execution.graphqlQueryCount > 0) operationParts.push("Q" + execution.graphqlQueryCount);
        if (execution.graphqlMutationCount > 0) operationParts.push("M" + execution.graphqlMutationCount);
        if (execution.graphqlSubscriptionCount > 0) operationParts.push("S" + execution.graphqlSubscriptionCount);
        if (execution.graphqlOtherCount > 0) operationParts.push("Other " + execution.graphqlOtherCount);
        parts.push("GraphQL " + operationParts.join(" "));
      }
      return parts.length > 0 ? parts.join(" · ") : "No mapped request surface";
    }

    function formatTransport(transport) {
      if (transport === "http") return "HTTP";
      if (transport === "graphqlQuery") return "GraphQL Query";
      if (transport === "graphqlMutation") return "GraphQL Mutation";
      if (transport === "graphqlSubscription") return "GraphQL Subscription";
      return "GraphQL";
    }

    function formatBusinessReach(reach) {
      if (reach === "domainCandidateReached") return "Domain-rule candidate found";
      if (reach === "applicationCandidateReached") return "Application-workflow candidate found";
      if (reach === "workflowBridgeCandidateReached") return "Workflow bridge candidate found · low confidence";
      if (reach === "analysisLimited") return "Start at handler · deeper layers limited";
      return "Start at handler · no business layer identified";
    }

    function formatArchitectureLayer(layer) {
      if (layer === "entrypoint") return "Entry";
      if (layer === "interface") return "Interface";
      if (layer === "application") return "Application";
      if (layer === "domain") return "Domain";
      if (layer === "dataAccess") return "Data access";
      if (layer === "infrastructure") return "Infrastructure";
      if (layer === "crossCutting") return "Cross-cutting";
      if (layer === "test") return "Test";
      return "Unclassified";
    }

    function formatArchitectureConfidence(confidence) {
      if (confidence === "high") return "strong evidence";
      if (confidence === "medium") return "moderate evidence";
      if (confidence === "low") return "weak evidence";
      return "unknown";
    }

    function formatMappingConfidence(confidence) {
      if (confidence === "exact") return "exact";
      if (confidence === "resolved") return "resolved";
      if (confidence === "inferred") return "inferred";
      return "unknown";
    }

    function formatReadingCue(cues, businessLogic) {
      if (cues.includes("startHere")) return "START HERE";
      if (businessLogic === "domainRuleCandidate") return "DOMAIN CANDIDATE";
      if (businessLogic === "applicationWorkflowCandidate") return "WORKFLOW CANDIDATE";
      if (cues.includes("workflowBridgeCandidate")) return "WORKFLOW BRIDGE · LOW CONFIDENCE";
      if (cues.includes("boundary")) return "BOUNDARY";
      if (cues.includes("evidenceGap")) return "EVIDENCE GAP";
      return "";
    }
  `;
}
