/** Browser adapter for explicit, correlated model requests; input application stays in the workspace. */
export function getScenarioInputsBrowserSource(): string {
  return /* js */ `
    const scenarioInputRequests = new Map();
    let nextScenarioInputRequestId = 0;

    /** Accepts replies only for the exact still-mounted request and graph. */
    function acceptScenarioInputsResponse(payload) {
      const pending = scenarioInputRequests.get(payload?.requestId);
      if (!pending || pending.request.flowId !== payload.flowId || pending.request.graphVersion !== payload.graphVersion
        || state.graph?.version !== payload.graphVersion) return;
      scenarioInputRequests.delete(payload.requestId); pending.accept(payload);
    }

    /** Creates inert controls; focus, mounting and locale refresh never contact a model. */
    function createScenarioInputSuggestions(tutor, session) {
      if (!tutor?.inputSuggestions?.available || tutor?.program?.evaluationMode === "symbolic-only") return undefined;
      const element = document.createElement("section"); element.className = "logic-scenario-input-suggestions";
      const actions = document.createElement("div"); const requestButton = document.createElement("button"); const cancelButton = document.createElement("button");
      const neuralButton = document.createElement("button"); neuralButton.type = "button"; neuralButton.className = "logic-scenario-neural-request";
      const help = document.createElement("p"); const status = document.createElement("p"); const training = document.createElement("p");
      requestButton.type = "button"; requestButton.className = "logic-scenario-ai-request"; cancelButton.type = "button";
      help.className = "logic-scenario-ai-help"; status.className = "logic-scenario-ai-status"; status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
      training.className = "logic-scenario-ai-training";
      actions.append(requestButton, neuralButton, cancelButton); element.append(actions, help, status, training);
      let phase = "idle"; let mode = "fast"; let request; let details = {}; let disposed = false; let completion; let settle;
      function render() {
        requestButton.textContent = projectAnalyzerText("scenario-ai-action"); cancelButton.textContent = projectAnalyzerText("scenario-ai-cancel");
        neuralButton.textContent = projectAnalyzerText("scenario-neural-action"); neuralButton.title = projectAnalyzerText("scenario-neural-help");
        help.textContent = projectAnalyzerText("scenario-ai-help");
        const limited = (tutor.seeds || []).filter((seed) => seed.source === "model").length >= 8;
        requestButton.disabled = phase === "pending" || limited; neuralButton.disabled = requestButton.disabled; cancelButton.hidden = phase !== "pending";
        element.setAttribute("aria-busy", phase === "pending" ? "true" : "false");
        status.textContent = projectAnalyzerText(phase === "pending" && mode === "neural" ? "scenario-neural-pending" : "scenario-ai-" + phase, details)
          + (details.rejected ? " · " + projectAnalyzerText("scenario-ai-rejected", { count: details.rejected }) : "")
          + (limited ? " · " + projectAnalyzerText("scenario-ai-limit") : "");
        training.hidden = !details.training && !details.generation;
        const numberFormat = new Intl.NumberFormat(state.uiLanguage, { maximumFractionDigits: 3 });
        training.textContent = details.training ? projectAnalyzerText("scenario-neural-training", {
          training: numberFormat.format(details.training.training), validation: numberFormat.format(details.training.validation),
          error: numberFormat.format(details.training.error)
        }) : details.generation ? projectAnalyzerText("scenario-fast-generation", {
          evaluations: details.generation.evaluations, elapsed: numberFormat.format(details.generation.elapsedMs),
          reuse: details.generation.cacheHit ? projectAnalyzerText("scenario-fast-cache") : ""
        }) : "";
      }
      function cancel() {
        if (!request) return;
        scenarioInputRequests.delete(request.requestId);
        vscode.postMessage({ type: "codeFlow/cancelScenarioInputs", payload: request });
        request = undefined; phase = "cancelled"; details = {}; if (!disposed) render();
        settle?.("cancelled"); settle = undefined; completion = undefined;
      }
      /** Both explicit buttons share one correlated request and one cancellation lifecycle. */
      function requestInputs(nextMode = "fast") {
        if (completion) return completion;
        if (disposed || requestButton.disabled || !state.graph?.version) return Promise.resolve("unavailable");
        completion = new Promise((resolve) => { settle = resolve; });
        mode = nextMode === "neural" ? "neural" : "fast";
        request = { graphVersion: state.graph.version, flowId: tutor.functionId, requestId: ++nextScenarioInputRequestId, mode };
        scenarioInputRequests.set(request.requestId, { request, accept(payload) {
          if (disposed || !request || request.requestId !== payload.requestId) return;
          const restoreFocus = document.activeElement === cancelButton;
          request = undefined;
          const statuses = ["ready", "empty", "unavailable", "cancelled", "denied", "timeout", "invalid-response", "failed", "stale"];
          let nextPhase = statuses.includes(payload.status) ? payload.status : "failed";
          let count = 0;
          if (nextPhase === "ready" && Array.isArray(payload.seeds) && payload.seeds.length <= 8) count = session.appendSeeds(payload.seeds);
          if (nextPhase === "ready" && !count) nextPhase = "empty";
          phase = nextPhase;
          const report = payload.training;
          const validReport = report && Number.isInteger(report.trainingSamples) && report.trainingSamples > 0 && report.trainingSamples <= 1400
            && Number.isInteger(report.validationSamples) && report.validationSamples > 0 && report.validationSamples <= 1400
            && typeof report.validationError === "number" && Number.isFinite(report.validationError) && report.validationError >= 0 && report.validationError <= 1000000;
          const generation = payload.generation;
          const validGeneration = generation && Number.isInteger(generation.evaluations) && generation.evaluations >= 0 && generation.evaluations <= 192
            && Number.isFinite(generation.elapsedMs) && generation.elapsedMs >= 0 && generation.elapsedMs <= 5000
            && typeof generation.cacheHit === "boolean" && typeof generation.limitReached === "boolean";
          details = { count, model: String(payload.modelName || "").slice(0, 100), rejected: Number(payload.rejected) || 0,
            generation: validGeneration ? generation : undefined,
            training: validReport ? { training: report.trainingSamples, validation: report.validationSamples, error: report.validationError } : undefined }; render();
          settle?.(phase); settle = undefined; completion = undefined;
          if (restoreFocus) { if (requestButton.disabled) { status.tabIndex = -1; status.focus(); } else requestButton.focus(); }
        } });
        phase = "pending"; details = {}; render();
        vscode.postMessage({ type: "codeFlow/requestScenarioInputs", payload: request });
        return completion;
      }
      requestButton.addEventListener("click", () => requestInputs("fast"));
      neuralButton.addEventListener("click", () => requestInputs("neural"));
      cancelButton.addEventListener("click", () => { cancel(); requestButton.focus(); });
      render();
      return { element, request: requestInputs, cancel, didApply(seed) {
        // The recommendation button sits outside the workspace's focus boundary.
        // Its explicit application must prepare the story before exposing playback.
        session.acquire();
        try { session.select(seed.id, 0); session.markApplied(); } finally { session.release(); }
      },
        isDisposed: () => disposed, refresh: render, dispose() { disposed = true; cancel(); } };
    }
  `;
}
