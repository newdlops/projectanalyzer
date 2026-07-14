/**
 * Browser-injected rendering helpers for the two-stage Project Reading Guide.
 * The initial view is capped at three scope cards; areas and representative
 * paths are rendered only after the Extension Host returns a selected scope.
 */

/** Returns self-contained helper declarations injected into the sidebar script. */
export function getReadingGuideBrowserSource(): string {
  return /* js */ `
    /** Renders the bounded first-read scope index and selected lazy detail. */
    function renderProjectReadingGuide() {
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
      if (!state.graph || (state.selectedScopeId === scopeId && state.scopeGuide)) {
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

    /** Renders source areas and collapsed representative paths for one scope. */
    function appendScopeGuide(guide) {
      const heading = document.createElement("div");
      heading.className = "guide-detail-heading";
      heading.textContent = "Inside " + guide.scope.displayPath;
      elements.guideScopeDetail.append(heading);

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

      appendGuideSectionLabel(elements.guideScopeDetail, "Representative reading paths");
      if (guide.representativeFlows.length === 0) {
        appendGuideEmpty(
          elements.guideScopeDetail,
          guide.unmappedEntrypointCount > 0
            ? "No uniquely mapped source path in this scope"
            : "No HTTP or GraphQL path in this scope"
        );
      } else {
        for (const flow of guide.representativeFlows.slice(0, 3)) {
          appendGuideFlow(flow);
        }
      }
      if (guide.omittedFlowCount > 0) {
        appendGuideEmpty(
          elements.guideScopeDetail,
          "+" + String(guide.omittedFlowCount) + " other mapped paths in Explore Code Flows"
        );
      }
    }

    /** Appends one measured directory footprint without claiming a business domain. */
    function appendGuideArea(area) {
      const row = document.createElement("div");
      const path = document.createElement("span");
      const counts = document.createElement("span");
      row.className = "guide-area";
      path.className = "guide-area-path";
      counts.className = "guide-area-counts";
      path.textContent = area.displayPath;
      counts.textContent =
        String(area.analyzedFileCount) + " files · " +
        String(area.callableCount) + " callables" +
        (area.entrypointCount > 0 ? " · " + String(area.entrypointCount) + " entries" : "");
      row.append(path, counts);
      elements.guideScopeDetail.append(row);
    }

    /** Keeps each representative path collapsed until the user asks for symbols. */
    function appendGuideFlow(flow) {
      const disclosure = document.createElement("details");
      const summary = document.createElement("summary");
      const steps = document.createElement("div");
      disclosure.className = "guide-flow";
      summary.className = "guide-flow-summary";
      steps.className = "guide-flow-steps";
      summary.textContent = flow.name + " · " + formatTransport(flow.transport);
      disclosure.append(summary);

      for (const step of flow.steps.slice(0, 5)) {
        appendGuideStep(steps, step);
      }
      if (flow.omittedStepCount > 0) {
        appendGuideEmpty(steps, String(flow.omittedStepCount) + " intermediate steps omitted");
      }
      disclosure.append(steps);
      elements.guideScopeDetail.append(disclosure);
    }

    /** Appends a source button only for concrete graph-backed function identities. */
    function appendGuideStep(parent, step) {
      const item = document.createElement(step.functionId ? "button" : "div");
      const role = document.createElement("span");
      const label = document.createElement("span");
      item.className = "guide-step";
      role.className = "guide-step-role";
      label.className = "guide-step-label";
      role.textContent = step.stages.includes("entrypoint") ? "entry" : step.role;
      label.textContent = step.label;
      if (step.functionId) {
        item.type = "button";
        item.title = "Open " + step.label;
        item.addEventListener("click", () => {
          postRequest("node/openSource", { nodeId: step.functionId }, "Opening reading path source");
        });
      }
      item.append(role, label);
      parent.append(item);
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
  `;
}
