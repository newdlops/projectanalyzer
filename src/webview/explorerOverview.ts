/**
 * Browser-injected renderer for the collapsed Analysis Details disclosure.
 * It owns the bounded Project Brief and Analysis Signal DOM without coupling
 * those presentation helpers to file, framework, or function tree navigation.
 */

/** Returns overview helper declarations injected into the sidebar script. */
export function getOverviewBrowserSource(): string {
  return /* js */ `
    /** Renders three facts and at most three evidence-backed analysis signals. */
    function renderProjectOverview() {
      elements.projectBrief.replaceChildren();
      elements.analysisSignals.replaceChildren();

      if (!state.projectOverview) {
        const message = state.graph ? "Building evidence summary..." : "Analyze a workspace to build the brief";
        appendOverviewEmpty(elements.projectBrief, message);
        appendOverviewEmpty(elements.analysisSignals, "No analysis signals");
        return;
      }

      for (const fact of state.projectOverview.facts.slice(0, 3)) {
        appendOverviewFact(elements.projectBrief, fact);
      }

      if (state.projectOverview.signals.length === 0) {
        appendOverviewEmpty(elements.analysisSignals, "No recorded evidence-backed gaps");
      } else {
        for (const signal of state.projectOverview.signals.slice(0, 3)) {
          appendOverviewSignal(elements.analysisSignals, signal);
        }
      }

      if (state.projectOverview.omittedSignalCount > 0) {
        appendOverviewEmpty(
          elements.analysisSignals,
          "+" + String(state.projectOverview.omittedSignalCount) + " more signals in detailed flows"
        );
      }
    }

    function appendOverviewEmpty(parent, message) {
      const empty = document.createElement("div");
      empty.className = "overview-empty";
      empty.textContent = message;
      parent.append(empty);
    }

    function appendOverviewFact(parent, fact) {
      const item = document.createElement("div");
      const label = document.createElement("span");
      const value = document.createElement("span");
      const detail = document.createElement("span");

      item.className = "overview-fact";
      label.className = "overview-label";
      value.className = "overview-value";
      detail.className = "overview-detail";
      label.textContent = fact.label;
      value.textContent = fact.value;
      detail.textContent = fact.detail;
      item.title = fact.label + ": " + fact.value + " - " + fact.detail;
      item.append(label, value, detail);
      parent.append(item);
    }

    function appendOverviewSignal(parent, signal) {
      const item = document.createElement(signal.functionId ? "button" : "div");
      const label = document.createElement("span");
      const count = document.createElement("span");
      const detail = document.createElement("span");

      item.className = "overview-signal " + signal.kind + "-signal";
      if (signal.functionId) {
        item.type = "button";
        item.classList.add("actionable-signal");
        item.addEventListener("click", () => {
          postRequest(
            "node/openSource",
            { nodeId: signal.functionId },
            "Opening signal evidence"
          );
        });
      }
      label.className = "overview-value";
      count.className = "overview-count";
      detail.className = "overview-detail";
      label.textContent = signal.label;
      count.textContent = String(signal.evidenceCount);
      detail.textContent = signal.detail;
      item.title = signal.label + " - " + signal.detail
        + (signal.functionId ? " - Open source evidence" : "");
      item.append(label, count, detail);
      parent.append(item);
    }
  `;
}
