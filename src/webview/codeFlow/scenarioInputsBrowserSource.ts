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
      if (!tutor?.inputSuggestions?.available) return undefined;
      const element = document.createElement("section"); element.className = "logic-scenario-input-suggestions";
      const actions = document.createElement("div"); const requestButton = document.createElement("button"); const cancelButton = document.createElement("button");
      const help = document.createElement("p"); const status = document.createElement("p");
      requestButton.type = "button"; requestButton.className = "logic-scenario-ai-request"; cancelButton.type = "button";
      help.className = "logic-scenario-ai-help"; status.className = "logic-scenario-ai-status"; status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
      actions.append(requestButton, cancelButton); element.append(actions, help, status);
      let phase = "idle"; let request; let details = {}; let disposed = false;
      function render() {
        requestButton.textContent = projectAnalyzerText("scenario-ai-action"); cancelButton.textContent = projectAnalyzerText("scenario-ai-cancel");
        help.textContent = projectAnalyzerText("scenario-ai-help");
        const limited = (tutor.seeds || []).filter((seed) => seed.source === "model").length >= 8;
        requestButton.disabled = phase === "pending" || limited; cancelButton.hidden = phase !== "pending";
        element.setAttribute("aria-busy", phase === "pending" ? "true" : "false");
        status.textContent = projectAnalyzerText("scenario-ai-" + phase, details)
          + (details.rejected ? " · " + projectAnalyzerText("scenario-ai-rejected", { count: details.rejected }) : "")
          + (limited ? " · " + projectAnalyzerText("scenario-ai-limit") : "");
      }
      function cancel() {
        if (!request) return;
        scenarioInputRequests.delete(request.requestId);
        vscode.postMessage({ type: "codeFlow/cancelScenarioInputs", payload: request });
        request = undefined; phase = "cancelled"; details = {}; if (!disposed) render();
      }
      requestButton.addEventListener("click", () => {
        if (request || requestButton.disabled || !state.graph?.version) return;
        request = { graphVersion: state.graph.version, flowId: tutor.functionId, requestId: ++nextScenarioInputRequestId };
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
          details = { count, model: String(payload.modelName || ""), rejected: Number(payload.rejected) || 0 }; render();
          if (restoreFocus) { if (requestButton.disabled) { status.tabIndex = -1; status.focus(); } else requestButton.focus(); }
        } });
        phase = "pending"; details = {}; render();
        vscode.postMessage({ type: "codeFlow/requestScenarioInputs", payload: request });
      });
      cancelButton.addEventListener("click", () => { cancel(); requestButton.focus(); });
      render();
      return { element, refresh: render, dispose() { disposed = true; cancel(); } };
    }
  `;
}
