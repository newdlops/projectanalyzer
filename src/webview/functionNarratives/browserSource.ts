/** Explicit LLM generation controls; construction never evaluates scenarios or contacts a model. */
import { isFunctionNarrative, isFunctionNarrativeLanguage } from "../../shared/functionNarratives";

export function getFunctionNarrativesBrowserSource(): string {
  return /* js */ `
    ${isFunctionNarrative.toString()}
    ${isFunctionNarrativeLanguage.toString()}
    const functionNarrativeRequests = new Map();
    const functionNarrativeResults = new Map();
    let nextFunctionNarrativeRequestId = 0;
    let nextFunctionNarrativeWidgetId = 0;

    /** Only the exact mounted request and active graph may accept a model result. */
    function acceptFunctionNarrativesResponse(payload) {
      const pending = functionNarrativeRequests.get(payload?.requestId);
      if (!pending || pending.request.flowId !== payload.flowId || pending.request.graphVersion !== payload.graphVersion
        || state.graph?.version !== payload.graphVersion) return;
      functionNarrativeRequests.delete(payload.requestId); pending.accept(payload);
    }

    /** A response's snippet bounds and source token matrix must match every narrative step. */
    function validFunctionNarrativesResponse(payload) {
      const snippets = payload?.snippets;
      if (!Array.isArray(snippets) || !snippets.length || snippets.length > 5 || snippets.some((snippet) => !snippet
        || typeof snippet.id !== "string" || snippet.id.length > 80 || !Number.isSafeInteger(snippet.startLine)
        || !Number.isSafeInteger(snippet.endLine) || snippet.startLine < 1 || snippet.endLine < snippet.startLine || snippet.endLine - snippet.startLine > 159)) return false;
      if (!isFunctionNarrative(payload.narrative, snippets) || !["ko", "en"].includes(payload.language)
        || typeof payload.modelName !== "string" || payload.modelName.length > 100 || typeof payload.limited !== "boolean" || typeof payload.cacheHit !== "boolean") return false;
      return Array.isArray(payload.evidenceTokens) && payload.evidenceTokens.length === payload.narrative.scenarios.length
        && payload.evidenceTokens.every((tokens, index) => Array.isArray(tokens) && tokens.length === payload.narrative.scenarios[index].steps.length
          && tokens.every((token) => typeof token === "string" && /^code-evidence:[0-9a-f]{64}$/.test(token)));
    }

    /** Inert Guide section, supporting symbolic languages and parameterless functions. */
    function createFunctionNarratives(tutor, callbacks) {
      if (!tutor?.narratives?.available) return undefined;
      const graphVersion = state.graph?.version;
      const key = graphVersion + ":" + tutor.functionId + ":" + (tutor.narratives.contextId || tutor.fingerprint || "");
      for (const [id, result] of functionNarrativeResults) if (result.graphVersion !== graphVersion) functionNarrativeResults.delete(id);
      const widgetId = "function-narrative-" + (++nextFunctionNarrativeWidgetId);
      const element = document.createElement("section"); element.className = "logic-function-narratives";
      const heading = document.createElement("h3"); const actions = document.createElement("div");
      const requestButton = document.createElement("button"); const cancelButton = document.createElement("button");
      const refreshButton = document.createElement("button"); refreshButton.type = "button"; refreshButton.className = "logic-guide-action logic-narrative-refresh";
      const help = document.createElement("p"); const status = document.createElement("p"); const results = document.createElement("div");
      requestButton.type = "button"; requestButton.className = "logic-guide-action logic-narrative-request";
      cancelButton.type = "button"; cancelButton.className = "logic-guide-action logic-narrative-cancel";
      actions.className = "logic-guide-actions"; help.className = "logic-summary-note"; status.className = "logic-narrative-status";
      status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
      results.className = "logic-narrative-results";
      actions.append(requestButton, cancelButton, refreshButton); element.append(heading, actions, help, status, results);
      let result = functionNarrativeResults.get(key + ":" + state.uiLanguage);
      let phase = result ? "ready" : "idle"; let request; let disposed = false;
      // At most four disclosures per language. Capture current native state
      // before replacement; queued toggle events never request work or mutate a new result.
      const evidenceOpenByKey = new Map(); const evidenceElements = new Map();

      /** Updates only this reading section; graph, scenario inputs and evaluation remain untouched. */
      function render() {
        const focusedId = document.activeElement?.id;
        heading.textContent = projectAnalyzerText("narrative-heading");
        requestButton.textContent = projectAnalyzerText(result?.language === state.uiLanguage ? "narrative-complete" : "narrative-action");
        requestButton.disabled = phase === "pending" || result?.language === state.uiLanguage;
        requestButton.hidden = requestButton.disabled || phase === "stale";
        cancelButton.textContent = projectAnalyzerText("narrative-cancel"); cancelButton.hidden = phase !== "pending";
        refreshButton.textContent = projectAnalyzerText("narrative-refresh");
        refreshButton.hidden = phase !== "stale" || !tutor.narratives.sourceToken || !callbacks?.onRefreshFunction;
        actions.hidden = requestButton.hidden && cancelButton.hidden && refreshButton.hidden;
        help.textContent = projectAnalyzerText("narrative-help");
        help.hidden = Boolean(result);
        status.textContent = phase === "ready" && result ? projectAnalyzerText("narrative-completion-status", { count: result.narrative.scenarios.length }) : projectAnalyzerText("narrative-" + phase);
        element.setAttribute("aria-busy", phase === "pending" ? "true" : "false");
        for (const [id, disclosure] of evidenceElements) evidenceOpenByKey.set(id, Boolean(disclosure.open));
        evidenceElements.clear(); results.replaceChildren();
        if (result) {
          const basis = document.createElement("p"); basis.className = "logic-summary-basis";
          basis.textContent = projectAnalyzerText("narrative-ready") + " · " + result.modelName + " · " + projectAnalyzerText("narrative-language", { language: projectAnalyzerText("narrative-language-" + result.language) })
            + (result.cacheHit ? " · " + projectAnalyzerText("narrative-cached") : "");
          const summary = document.createElement("p"); summary.className = "logic-summary-purpose"; summary.textContent = result.narrative.summary;
          results.append(basis, summary);
          if (result.limited) { const limit = document.createElement("p"); limit.className = "logic-summary-note"; limit.textContent = projectAnalyzerText("narrative-limited"); results.append(limit); }
          for (let index = 0; index < result.narrative.scenarios.length; index += 1) {
            const scenario = result.narrative.scenarios[index];
            const article = document.createElement("section"); article.className = "logic-narrative-scenario";
            const title = document.createElement("h4"); title.textContent = (index + 1) + ". " + scenario.title; article.append(title);
            const paragraph = document.createElement("p"); paragraph.className = "logic-narrative-paragraph";
            // Older responses already contain source-cited claims. Compose them
            // verbatim rather than inventing a new model interpretation on mount.
            paragraph.textContent = scenario.explanation || [...scenario.when, ...scenario.steps.flatMap((step) => [step.text, step.reason, step.effect]), scenario.outcome]
              .filter(Boolean).map((value) => /[.!?。！？]$/.test(value.trim()) ? value.trim() : value.trim() + ".").join(" ");
            article.append(paragraph);
            const evidence = document.createElement("details"); const evidenceSummary = document.createElement("summary"); const evidenceBody = document.createElement("div");
            evidence.className = "logic-narrative-evidence"; evidenceBody.className = "logic-narrative-evidence-body";
            evidenceSummary.id = widgetId + "-evidence-" + index;
            evidenceSummary.textContent = projectAnalyzerText("narrative-evidence");
            const disclosureKey = result.language + ":" + index;
            evidence.open = evidenceOpenByKey.get(disclosureKey) || false; evidenceElements.set(disclosureKey, evidence);
            const sourceHelp = document.createElement("p"); sourceHelp.className = "logic-summary-note logic-narrative-source-note";
            sourceHelp.textContent = projectAnalyzerText("narrative-source-help"); evidenceBody.append(sourceHelp);
            appendFacts(evidenceBody, "narrative-when", scenario.when);
            const steps = document.createElement("ol"); steps.className = "logic-narrative-steps";
            for (let stepIndex = 0; stepIndex < scenario.steps.length; stepIndex += 1) {
              const step = scenario.steps[stepIndex]; const row = document.createElement("li");
              const text = document.createElement("p"); text.textContent = step.text;
              const source = document.createElement("button"); source.type = "button"; source.className = "logic-guide-action logic-narrative-source";
              source.id = widgetId + "-source-" + index + "-" + stepIndex;
              source.textContent = projectAnalyzerText("narrative-source", { scenario: index + 1, step: stepIndex + 1, start: step.source.startLine, end: step.source.endLine });
              source.addEventListener("click", () => {
                if (!disposed && state.graph?.version === graphVersion && tutor.narratives.contextId) {
                  vscode.postMessage({ type: "codeFlow/openFunctionNarrativeSource", payload: { graphVersion, flowId: tutor.functionId,
                    contextId: tutor.narratives.contextId, language: result.language, scenarioIndex: index, stepIndex } });
                }
              });
              row.append(text);
              appendFacts(row, "narrative-reason", step.reason ? [step.reason] : []);
              appendFacts(row, "narrative-effect", step.effect ? [step.effect] : []);
              row.append(source); steps.append(row);
            }
            evidenceBody.append(steps); appendFacts(evidenceBody, "narrative-outcome", [scenario.outcome]);
            appendFacts(evidenceBody, "narrative-assumptions", scenario.assumptions);
            evidence.append(evidenceSummary, evidenceBody); article.append(evidence); results.append(article);
          }
          appendFacts(results, "narrative-limitations", result.narrative.limitations);
        }
        if (focusedId?.startsWith(widgetId + "-source-") || focusedId?.startsWith(widgetId + "-evidence-")) document.getElementById(focusedId)?.focus();
      }
      function appendFacts(parent, copyKey, values) {
        if (!values.length) return;
        const region = document.createElement("div"); region.className = "logic-narrative-facts";
        const label = document.createElement("strong"); label.textContent = projectAnalyzerText(copyKey);
        const list = document.createElement("ul");
        for (const value of values) { const item = document.createElement("li"); item.textContent = value; list.append(item); }
        region.append(label, list); parent.append(region);
      }
      function cancel() {
        if (!request) return;
        functionNarrativeRequests.delete(request.requestId);
        vscode.postMessage({ type: "codeFlow/cancelFunctionNarratives", payload: request });
        request = undefined; phase = "cancelled"; if (!disposed) render();
      }
      requestButton.addEventListener("click", () => {
        if (disposed || request || requestButton.disabled || state.graph?.version !== graphVersion) return;
        const movePendingFocus = document.activeElement === requestButton;
        request = { graphVersion, flowId: tutor.functionId, requestId: ++nextFunctionNarrativeRequestId };
        functionNarrativeRequests.set(request.requestId, { request, accept(payload) {
          if (disposed || !request || request.requestId !== payload.requestId) return;
          const restoreFocus = document.activeElement === cancelButton;
          request = undefined;
          const statuses = ["ready", "unavailable", "cancelled", "denied", "timeout", "invalid-response", "language-mismatch", "context-too-large", "failed", "stale"];
          phase = statuses.includes(payload.status) ? payload.status : "failed";
          if (phase === "ready") {
            if (!validFunctionNarrativesResponse(payload)) phase = "invalid-response";
            else if (!isFunctionNarrativeLanguage(payload.narrative, payload.language)) phase = "language-mismatch";
            else {
              result = payload; functionNarrativeResults.set(key + ":" + payload.language, payload);
              while (functionNarrativeResults.size > 8) functionNarrativeResults.delete(functionNarrativeResults.keys().next().value);
            }
          }
          render();
          if (restoreFocus) {
            if (!refreshButton.hidden) refreshButton.focus();
            else if (!requestButton.hidden) requestButton.focus();
            else { status.tabIndex = -1; status.focus(); }
          }
        } });
        phase = "pending"; render();
        if (movePendingFocus) cancelButton.focus();
        vscode.postMessage({ type: "codeFlow/requestFunctionNarratives", payload: request });
      });
      cancelButton.addEventListener("click", () => { cancel(); requestButton.focus(); });
      // A retained history detail can outlive the eight Host contexts. Reload only on this explicit action.
      refreshButton.addEventListener("click", () => { if (!disposed && phase === "stale" && state.graph?.version === graphVersion) callbacks?.onRefreshFunction?.(tutor.narratives.sourceToken); });
      render();
      return { element, refreshLanguage() { result = functionNarrativeResults.get(key + ":" + state.uiLanguage) || result; render(); },
        dispose() { disposed = true; cancel(); } };
    }
  `;
}
