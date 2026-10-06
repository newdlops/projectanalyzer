/** Explicit LLM generation controls; construction never evaluates scenarios or contacts a model. */
import { createFunctionNarrativeValidator, isFunctionNarrativeLanguage, isFunctionNarrativeExample } from "../../shared/functionNarratives";
import { getFunctionNarrativeInterpretationBrowserSource } from "./interpretationBrowserSource";
import { isModelTaskProgress } from "../../shared/modelTasks";

export function getFunctionNarrativesBrowserSource(): string {
  return /* js */ `
    ${isModelTaskProgress.toString()}
    ${isFunctionNarrativeExample.toString()}
    ${createFunctionNarrativeValidator.toString()}
    const isFunctionNarrative = createFunctionNarrativeValidator(isFunctionNarrativeExample);
    ${isFunctionNarrativeLanguage.toString()}
    ${getFunctionNarrativeInterpretationBrowserSource()}
    const functionNarrativeRequests = new Map();
    const functionNarrativeResults = new Map();
    let nextFunctionNarrativeRequestId = 0;
    let nextFunctionNarrativeWidgetId = 0;

    /** Only the exact mounted request and active graph may accept a model result. */
    function acceptFunctionNarrativesResponse(payload) {
      const pending = functionNarrativeRequests.get(payload?.requestId);
      if (!pending || pending.request.flowId !== payload.flowId || pending.request.graphVersion !== payload.graphVersion
        || state.graph?.version !== payload.graphVersion) return;
      if (payload.status !== "progress" && payload.status !== "working") functionNarrativeRequests.delete(payload.requestId);
      pending.accept(payload);
    }

    /** A response's snippet bounds and source token matrix must match every narrative step. */
    function validFunctionNarrativesResponse(payload) {
      const snippets = payload?.snippets;
      if (!Array.isArray(snippets) || !snippets.length || snippets.length > 5 || snippets.some((snippet) => !snippet
        || typeof snippet.id !== "string" || snippet.id.length > 80 || !Number.isSafeInteger(snippet.startLine)
        || !Number.isSafeInteger(snippet.endLine) || snippet.startLine < 1 || snippet.endLine < snippet.startLine || snippet.endLine - snippet.startLine > 159)) return false;
      if (!isFunctionNarrative(payload.narrative, snippets) || !["ko", "en"].includes(payload.language)
        || typeof payload.modelName !== "string" || payload.modelName.length > 100 || typeof payload.limited !== "boolean" || typeof payload.cacheHit !== "boolean") return false;
      if (payload.coverage !== undefined || payload.page !== undefined) {
        const coverage = payload.coverage; const page = payload.page;
        const integer = (value) => Number.isSafeInteger(value) && value >= 0;
        if (!coverage || !page || !integer(coverage.completed) || !integer(coverage.discovered) || coverage.discovered < coverage.completed
          || (coverage.total !== undefined && (!integer(coverage.total) || coverage.total !== coverage.discovered))
          || typeof coverage.complete !== "boolean" || typeof coverage.sourceLimited !== "boolean"
          || coverage.complete && (coverage.total === undefined || coverage.total !== coverage.completed)
          || !integer(page.index) || !integer(page.count) || page.count < 1 || page.index >= page.count || !integer(page.offset)
          || page.offset + payload.narrative.scenarios.length > coverage.completed) return false;
      }
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
      const pager = document.createElement("div"); const pageLabel = document.createElement("span");
      const previousButton = document.createElement("button"); const nextButton = document.createElement("button");
      pager.className = "logic-narrative-pagination"; pageLabel.className = "logic-narrative-page-label";
      previousButton.type = "button"; previousButton.className = "logic-guide-action logic-narrative-previous";
      nextButton.type = "button"; nextButton.className = "logic-guide-action logic-narrative-next";
      pager.append(pageLabel, previousButton, nextButton);
      requestButton.type = "button"; requestButton.className = "logic-guide-action logic-narrative-request";
      cancelButton.type = "button"; cancelButton.className = "logic-guide-action logic-narrative-cancel";
      actions.className = "logic-guide-actions"; help.className = "logic-summary-note"; status.className = "logic-narrative-status";
      status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
      results.className = "logic-narrative-results";
      actions.append(requestButton, cancelButton, refreshButton); element.append(heading, actions, help, status, results, pager);
      let result = functionNarrativeResults.get(key + ":" + state.uiLanguage);
      let phase = result ? "ready" : "idle"; let request; let disposed = false; let requestLanguage;
      let task;
      let selectedScenarioIndex=0;let selectedScenarioIdentity;let initialExamplesApplied=false;let nodeRequest;let nodeLookupKey;
      const nodeReader=createFunctionNarrativeNodeReader(callbacks,{id:widgetId,result:()=>result,index:()=>selectedScenarioIndex,scenario:()=>result?.narrative.scenarios[selectedScenarioIndex],
        loadNode:queryNode,openNodeSource(data,nodeIndex){if(disposed||state.graph?.version!==graphVersion)return;vscode.postMessage({type:"codeFlow/openFunctionNarrativeSource",payload:{graphVersion,flowId:tutor.functionId,contextId:tutor.narratives.contextId,language:data.language,scenarioIndex:data.scenarioIndex,stepIndex:0,nodeIndex,...(data.pageIndex!==undefined?{pageIndex:data.pageIndex}:{})}});}});
      element.append(nodeReader.element);
      // Retain only sixteen open disclosures across pages and languages. Capture native state
      // before replacement; queued toggle events never request work or mutate a new result.
      const evidenceOpenByKey = new Map(); const evidenceElements = new Map();

      /** Renders saved interpretations; only the first result fills empty example inputs automatically. */
      function render() {
        const focusedId = document.activeElement?.id;
        heading.textContent = projectAnalyzerText("narrative-heading");
        const complete = result?.language === state.uiLanguage && result?.coverage?.complete !== false;
        requestButton.textContent = projectAnalyzerText(complete ? "narrative-complete" : result?.language === state.uiLanguage ? "narrative-continue" : "narrative-action");
        requestButton.disabled = phase === "pending" || phase === "page-loading" || complete;
        requestButton.hidden = requestButton.disabled || phase === "stale";
        cancelButton.textContent = projectAnalyzerText("narrative-cancel"); cancelButton.hidden = phase !== "pending";
        refreshButton.textContent = projectAnalyzerText("narrative-refresh");
        refreshButton.hidden = phase !== "stale" || !tutor.narratives.sourceToken || !callbacks?.onRefreshFunction;
        actions.hidden = requestButton.hidden && cancelButton.hidden && refreshButton.hidden;
        help.textContent = projectAnalyzerText("narrative-help");
        help.hidden = Boolean(result);
        const coverage = phase === "pending" && result?.language !== requestLanguage ? undefined : result?.coverage;
        status.textContent = task && phase === "pending" ? projectAnalyzerText("model-task-" + task.phase, task)
          + (coverage ? " · " + projectAnalyzerText(coverage.total === undefined ? "narrative-progress" : "narrative-progress-total", { count: coverage.completed, total: coverage.total }) : "")
          : phase === "pending" && coverage ? projectAnalyzerText(coverage.total === undefined ? "narrative-progress" : "narrative-progress-total", { count: coverage.completed, total: coverage.total })
          : phase === "ready" && result ? projectAnalyzerText(coverage?.complete === false ? "narrative-partial-status" : "narrative-completion-status", { count: coverage?.completed ?? result.narrative.scenarios.length }) : projectAnalyzerText("narrative-" + phase);
        element.setAttribute("aria-busy", phase === "pending" || phase === "page-loading" ? "true" : "false");
        pager.hidden = !result?.page || result.page.count < 2;
        previousButton.textContent = projectAnalyzerText("narrative-previous"); nextButton.textContent = projectAnalyzerText("narrative-next");
        previousButton.disabled = phase === "pending" || phase === "page-loading" || !result?.page || result.page.index === 0;
        nextButton.disabled = phase === "pending" || phase === "page-loading" || !result?.page || result.page.index + 1 >= result.page.count;
        pageLabel.textContent = result?.page ? projectAnalyzerText("narrative-page-label", { page: result.page.index + 1, pages: result.page.count, start: result.page.offset + 1, end: result.page.offset + result.narrative.scenarios.length }) : "";
        for (const [id, disclosure] of evidenceElements) {
          if (disclosure.open) evidenceOpenByKey.set(id, true); else evidenceOpenByKey.delete(id);
        }
        while (evidenceOpenByKey.size > 16) evidenceOpenByKey.delete(evidenceOpenByKey.keys().next().value);
        evidenceElements.clear(); results.replaceChildren();
        if(result?.narrative.scenarios.some((scenario)=>scenario.example)){
          const identity=result.language+":"+(result.page?.offset||0);
          if(identity!==selectedScenarioIdentity){selectedScenarioIdentity=identity;selectedScenarioIndex=0;selectScenario(0,initialExamplesApplied?"none":"empty");initialExamplesApplied=true;}
        }
        if (result) {
          const basis = document.createElement("p"); basis.className = "logic-summary-basis";
          basis.textContent = projectAnalyzerText("narrative-ready") + " · " + result.modelName + " · " + projectAnalyzerText("narrative-language", { language: projectAnalyzerText("narrative-language-" + result.language) })
            + (result.cacheHit ? " · " + projectAnalyzerText("narrative-cached") : "");
          const summary = document.createElement("p"); summary.className = "logic-summary-purpose"; summary.textContent = result.narrative.summary;
          results.append(basis, summary);
          if (result.limited) { const limit = document.createElement("p"); limit.className = "logic-summary-note"; limit.textContent = projectAnalyzerText("narrative-limited"); results.append(limit); }
          if (coverage?.complete && coverage.sourceLimited) { const limit = document.createElement("p"); limit.className = "logic-summary-note"; limit.textContent = projectAnalyzerText("narrative-source-incomplete"); results.append(limit); }
          for (let index = 0; index < result.narrative.scenarios.length; index += 1) {
            const scenario = result.narrative.scenarios[index];
            const globalIndex = (result.page?.offset ?? 0) + index;
            const article = document.createElement("section"); article.className = "logic-narrative-scenario";
            const title = document.createElement("h4"); title.textContent = (globalIndex + 1) + ". " + scenario.title; article.append(title);
            const paragraph = document.createElement("p"); paragraph.className = "logic-narrative-paragraph";
            // Older responses already contain source-cited claims. Compose them
            // verbatim rather than inventing a new model interpretation on mount.
            paragraph.textContent = scenario.explanation || [...scenario.when, ...scenario.steps.flatMap((step) => [step.text, step.reason, step.effect]), scenario.outcome]
              .filter(Boolean).map((value) => /[.!?。！？]$/.test(value.trim()) ? value.trim() : value.trim() + ".").join(" ");
            article.append(paragraph);
            appendFunctionNarrativeAnalysis(article,scenario);
            appendFunctionNarrativeExample(article,scenario,index===selectedScenarioIndex,{id:widgetId+"-scenario-"+globalIndex,canApply:Boolean(callbacks?.onNarrativeScenario),canShowGraph:Boolean(callbacks?.onShowGraph),
              select(){selectScenario(index,"replace");render();},graph(){selectScenario(index,"none");callbacks?.onShowGraph?.({preferredLens:"flow",primaryBlockId:scenario.graph?.nodeIds[0],attentionBlockIds:scenario.graph?.nodeIds||[],attentionEdgeIds:scenario.graph?.edgeIds||[]});nodeReader.refresh();},
              apply(){selectScenario(index,"replace");callbacks?.onOpenNarrativeValues?.(scenario.example);render();}});
            const evidence = document.createElement("details"); const evidenceSummary = document.createElement("summary"); const evidenceBody = document.createElement("div");
            evidence.className = "logic-narrative-evidence"; evidenceBody.className = "logic-narrative-evidence-body";
            evidenceSummary.id = widgetId + "-evidence-" + globalIndex;
            evidenceSummary.textContent = projectAnalyzerText("narrative-evidence");
            const disclosureKey = result.language + ":" + globalIndex;
            evidence.open = evidenceOpenByKey.get(disclosureKey) || false; evidenceElements.set(disclosureKey, evidence);
            const sourceHelp = document.createElement("p"); sourceHelp.className = "logic-summary-note logic-narrative-source-note";
            sourceHelp.textContent = projectAnalyzerText("narrative-source-help"); evidenceBody.append(sourceHelp);
            appendFacts(evidenceBody, "narrative-when", scenario.when);
            const steps = document.createElement("ol"); steps.className = "logic-narrative-steps";
            for (let stepIndex = 0; stepIndex < scenario.steps.length; stepIndex += 1) {
              const step = scenario.steps[stepIndex]; const row = document.createElement("li");
              const text = document.createElement("p"); text.textContent = step.text;
              const source = document.createElement("button"); source.type = "button"; source.className = "logic-guide-action logic-narrative-source";
              source.id = widgetId + "-source-" + globalIndex + "-" + stepIndex;
              source.textContent = projectAnalyzerText("narrative-source", { scenario: globalIndex + 1, step: stepIndex + 1, start: step.source.startLine, end: step.source.endLine });
              source.addEventListener("click", () => {
                if (!disposed && state.graph?.version === graphVersion && tutor.narratives.contextId) {
                  vscode.postMessage({ type: "codeFlow/openFunctionNarrativeSource", payload: { graphVersion, flowId: tutor.functionId,
                    contextId: tutor.narratives.contextId, language: result.language, scenarioIndex: index, stepIndex,
                    ...(result.page ? { pageIndex: result.page.index } : {}) } });
                }
              });
              row.append(text);
              appendFacts(row, "narrative-syntax", step.syntax ? [step.syntax] : []);
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
        nodeReader.refresh();
        if (focusedId?.startsWith(widgetId + "-source-") || focusedId?.startsWith(widgetId + "-evidence-") || focusedId?.startsWith(widgetId + "-scenario-")) document.getElementById(focusedId)?.focus();
      }
      /** A scenario selection changes graph examples; cached navigation and progress preserve edited inputs. */
      function selectScenario(index,apply){selectedScenarioIndex=index;const scenario=result?.narrative.scenarios[index];if(scenario)callbacks?.onNarrativeScenario?.(scenario,{apply});nodeLookupKey=undefined;}
      /** Out-of-page node descriptions use the stored result index and never authorize inference. */
      function queryNode(nodeId){
        if(disposed||!result||state.graph?.version!==graphVersion||!/^function-logic-block:[0-9a-f]{32}$/.test(nodeId))return;
        const key=result.language+":"+(result.coverage?.completed||0)+":"+nodeId;if(key===nodeLookupKey)return;nodeLookupKey=key;
        if(nodeRequest)functionNarrativeRequests.delete(nodeRequest.requestId);
        nodeRequest={graphVersion,flowId:tutor.functionId,requestId:++nextFunctionNarrativeRequestId,nodeId,pageLanguage:result.language};
        const requested=nodeRequest;functionNarrativeRequests.set(requested.requestId,{request:requested,accept(payload){if(disposed||nodeRequest!==requested)return;nodeRequest=undefined;if(payload.status==="ready"&&validFunctionNarrativesResponse(payload)&&isFunctionNarrativeLanguage(payload.narrative,payload.language))nodeReader.remember(payload,nodeId);}});
        vscode.postMessage({type:"codeFlow/requestFunctionNarratives",payload:requested});
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
        request = undefined; task = undefined; phase = "cancelled"; if (!disposed) render();
      }
      /** Pagination only asks the Host for stored prose; the action without pageIndex analyzes remaining paths. */
      function startRequest(pageIndex) {
        const paging = pageIndex !== undefined;
        if (disposed || request || !paging && requestButton.disabled || state.graph?.version !== graphVersion) return;
        const movePendingFocus = document.activeElement === requestButton;
        const pageFocus = document.activeElement;
        requestLanguage = paging ? result.language : state.uiLanguage;
        task = undefined;
        request = { graphVersion, flowId: tutor.functionId, requestId: ++nextFunctionNarrativeRequestId,
          ...(paging ? { pageIndex, pageLanguage: result.language } : {}) };
        functionNarrativeRequests.set(request.requestId, { request, accept(payload) {
          if (disposed || !request || request.requestId !== payload.requestId) return;
          if (payload.status === "working") {
            if (!paging && isModelTaskProgress(payload.task) && (!task || Number(payload.task.id.split(":")[1]) >= Number(task.id.split(":")[1]))) {
              task = payload.task;
              // Queue transitions update one live region, preserving model prose, editable inputs and keyboard focus.
              status.textContent = projectAnalyzerText("model-task-" + task.phase, task);
            }
            return;
          }
          const restoreFocus = document.activeElement === cancelButton;
          const progress = payload.status === "progress";
          if (!progress) { request = undefined; task = undefined; }
          const statuses = ["ready", "progress", "queue-full", "unavailable", "download-failed", "cancelled", "denied", "timeout", "invalid-response", "language-mismatch", "context-too-large", "failed", "stale"];
          phase = progress ? "pending" : statuses.includes(payload.status) ? payload.status : "failed";
          if (payload.narrative || phase === "ready" || progress) {
            if (!validFunctionNarrativesResponse(payload)) phase = "invalid-response";
            else if (!isFunctionNarrativeLanguage(payload.narrative, payload.language)) phase = "language-mismatch";
            else {
              result = payload; functionNarrativeResults.set(key + ":" + payload.language, payload);
              while (functionNarrativeResults.size > 8) functionNarrativeResults.delete(functionNarrativeResults.keys().next().value);
            }
          }
          if (progress && phase !== "pending") {
            functionNarrativeRequests.delete(request.requestId);
            vscode.postMessage({ type: "codeFlow/cancelFunctionNarratives", payload: request }); request = undefined;
          }
          render();
          if (paging && (pageFocus === previousButton || pageFocus === nextButton)) {
            if (!pageFocus.disabled) pageFocus.focus();
            else if (!previousButton.disabled) previousButton.focus();
            else if (!nextButton.disabled) nextButton.focus();
            else { status.tabIndex = -1; status.focus(); }
          } else if (restoreFocus && !progress) {
            if (!refreshButton.hidden) refreshButton.focus();
            else if (!requestButton.hidden) requestButton.focus();
            else { status.tabIndex = -1; status.focus(); }
          }
        } });
        phase = paging ? "page-loading" : "pending"; render();
        if (movePendingFocus) cancelButton.focus();
        vscode.postMessage({ type: "codeFlow/requestFunctionNarratives", payload: request });
      }
      requestButton.addEventListener("click", () => startRequest());
      previousButton.addEventListener("click", () => { if (!previousButton.disabled) startRequest(result.page.index - 1); });
      nextButton.addEventListener("click", () => { if (!nextButton.disabled) startRequest(result.page.index + 1); });
      cancelButton.addEventListener("click", () => { cancel(); requestButton.focus(); });
      // A retained history detail can outlive the eight Host contexts. Reload only on this explicit action.
      refreshButton.addEventListener("click", () => { if (!disposed && phase === "stale" && state.graph?.version === graphVersion) callbacks?.onRefreshFunction?.(tutor.narratives.sourceToken); });
      render();
      return { element,start:()=>startRequest(), refreshLanguage() { result = functionNarrativeResults.get(key + ":" + state.uiLanguage) || result; render(); },
        dispose() { disposed = true; cancel();if(nodeRequest)functionNarrativeRequests.delete(nodeRequest.requestId);nodeReader.dispose(); } };
    }
  `;
}
