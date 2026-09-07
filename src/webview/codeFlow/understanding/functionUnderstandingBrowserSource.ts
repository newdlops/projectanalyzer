/** Theme-native reading overview and source-linked framework behavior disclosure. */
import { getFunctionUnderstandingModelBrowserSource } from "./functionUnderstandingModel";

/** Declares a presentation adapter; graph selection and source opening use existing actions. */
export function getFunctionUnderstandingBrowserSource(): string {
  return /* js */ `
    ${getFunctionUnderstandingModelBrowserSource()}
    const functionUnderstandingSessions = new Map();
    let functionUnderstandingSequence = 0;

    /** Retains disclosure and focus while locale changes update only owned copy. */
    function createFunctionUnderstandingOverview(logic, sessionKey, controller, viewportController, inspector, graphContext) {
      const model = createFunctionUnderstandingModel(logic, graphContext.resolveScenarioBlockId);
      const local = functionUnderstandingSessions.get(sessionKey) || { open: false, expanded: new Set() };
      functionUnderstandingSessions.set(sessionKey, local);
      while (functionUnderstandingSessions.size > 16) functionUnderstandingSessions.delete(functionUnderstandingSessions.keys().next().value);
      const section = document.createElement("section");
      const heading = document.createElement("h2");
      const hint = document.createElement("p");
      const actions = document.createElement("div");
      const updates = [];
      let disposed = false;
      let revealFrame;
      section.className = "logic-understanding";
      heading.id = "function-understanding-" + (++functionUnderstandingSequence);
      section.setAttribute("aria-labelledby", heading.id);
      hint.className = "logic-understanding-hint";
      actions.className = "logic-understanding-actions";
      section.append(heading, hint);
      const documentation = logic.tutor?.context?.documentation;
      if (documentation?.summary) {
        const doc = document.createElement("p");
        doc.className = "logic-understanding-documentation";
        doc.textContent = documentation.summary;
        doc.setAttribute("translate", "no");
        updates.push(() => doc.setAttribute("aria-label", projectAnalyzerText("understanding-documentation") + ": " + documentation.summary));
        section.append(doc);
      }
      const outcomeId = model.returnIds[0] || model.throwIds[0] || model.effectIds[0];
      addAction("inputs", "input", model.entryId, () => model.inputs.length
        ? model.inputs.slice(0, 3).join(", ") + (model.inputs.length > 3 ? projectAnalyzerText("understanding-more", { count: model.inputs.length - 3 }) : "")
        : projectAnalyzerText("understanding-no-inputs"));
      addAction("decisions", "decision", model.decisionIds[0], () => projectAnalyzerText(model.decisionIds.length ? "understanding-decision-count" : "understanding-no-decisions", { count: model.decisionIds.length }));
      addAction("outcomes", "outcome", outcomeId, () => {
        const parts = [["returns", model.returnIds.length], ["errors", model.throwIds.length], ["effects", model.effectIds.length]];
        return parts.filter((part) => part[1] > 0).map(([kind, count]) => projectAnalyzerText("understanding-outcome-" + kind, { count })).join(" · ")
          || projectAnalyzerText("understanding-no-outcomes");
      });
      section.append(actions);

      /** Explicit navigation selects one mapped node without changing source editors. */
      function activate(blockId) {
        controller.activateBlock(blockId, true);
        inspector.openInspect("code");
        if (revealFrame !== undefined) cancelAnimationFrame(revealFrame);
        revealFrame = requestAnimationFrame(() => {
          if (!disposed) {
            viewportController.revealBlocks([blockId], { announce: false });
            inspector.workspace.scrollIntoView?.({ block: "nearest", behavior: "auto" });
          }
        });
      }

      function addAction(kind, actionKey, blockId, describe) {
        const button = document.createElement("button");
        const title = document.createElement("strong");
        const value = document.createElement("span");
        const action = document.createElement("span");
        button.type = "button";
        button.className = "logic-understanding-action";
        button.dataset.understanding = kind;
        value.className = "logic-understanding-value";
        if (kind === "inputs") value.classList.add("source-names");
        action.className = "logic-understanding-link";
        button.disabled = !blockId;
        action.hidden = !blockId;
        button.addEventListener("click", () => { if (blockId) activate(blockId); });
        updates.push(() => {
          title.textContent = projectAnalyzerText("understanding-" + kind);
          value.textContent = describe();
          action.textContent = projectAnalyzerText("understanding-" + actionKey + "-action") + " →";
        });
        button.append(title, value, action);
        actions.append(button);
      }

      const behavior = logic.tutor?.frameworkBehavior;
      if (behavior?.facts.length) {
        const disclosure = document.createElement("details");
        const summary = document.createElement("summary");
        const title = document.createElement("strong");
        const role = document.createElement("span");
        const note = document.createElement("p");
        const list = document.createElement("ul");
        const limit = document.createElement("p");
        disclosure.className = "logic-framework";
        disclosure.open = local.open;
        disclosure.addEventListener("toggle", () => { local.open = disclosure.open; });
        role.className = "logic-framework-role";
        note.className = "logic-framework-note";
        list.className = "logic-framework-facts";
        limit.className = "logic-framework-note";
        limit.hidden = !behavior.limited;
        updates.push(() => {
          title.textContent = projectAnalyzerText("understanding-framework", { framework: behavior.framework === "react" ? "React" : "Django" });
          role.textContent = projectAnalyzerText("understanding-role-" + behavior.role) + " · " + behavior.facts.length;
          note.textContent = projectAnalyzerText("understanding-framework-note");
          list.setAttribute("aria-label", title.textContent);
          limit.textContent = projectAnalyzerText(behavior.omittedCount ? "understanding-framework-more" : "understanding-framework-limited", { count: behavior.omittedCount });
        });
        for (const fact of behavior.facts) {
          const item = document.createElement("li");
          const row = document.createElement("details");
          const trigger = document.createElement("summary");
          const phase = document.createElement("span");
          const label = document.createElement("strong");
          const body = document.createElement("div");
          const detail = document.createElement("p");
          const evidence = document.createElement("code");
          const footer = document.createElement("div");
          const confidence = document.createElement("span");
          const onGraph = document.createElement("button");
          const source = document.createElement("button");
          const unavailable = document.createElement("span");
          const mappedId = fact.blockId && graphContext.resolveScenarioBlockId(fact.blockId);
          row.className = "logic-framework-fact";
          row.dataset.factKind = fact.kind;
          row.open = local.expanded.has(fact.id);
          row.addEventListener("toggle", () => { if (row.open) local.expanded.add(fact.id); else local.expanded.delete(fact.id); });
          phase.className = "logic-framework-phase";
          body.className = "logic-framework-body";
          evidence.textContent = fact.subject;
          evidence.setAttribute("translate", "no");
          footer.className = "logic-framework-evidence";
          confidence.className = "logic-framework-confidence";
          onGraph.type = source.type = "button";
          onGraph.className = source.className = "logic-button";
          onGraph.hidden = !mappedId;
          source.disabled = !fact.evidenceToken;
          unavailable.hidden = Boolean(fact.evidenceToken);
          unavailable.className = "logic-framework-confidence";
          onGraph.addEventListener("click", () => { if (mappedId) activate(mappedId); });
          source.addEventListener("click", () => { if (fact.evidenceToken) openLogicEvidence(fact.evidenceToken); });
          updates.push(() => {
            phase.textContent = projectAnalyzerText("understanding-phase-" + fact.phase);
            label.textContent = projectAnalyzerText("framework-" + fact.kind);
            detail.textContent = projectAnalyzerText("framework-" + fact.kind + "-detail");
            confidence.textContent = projectAnalyzerText("logic-confidence-" + fact.confidence);
            onGraph.textContent = projectAnalyzerText("understanding-graph");
            onGraph.setAttribute("aria-label", projectAnalyzerText("understanding-graph") + ": " + label.textContent);
            source.textContent = projectAnalyzerText("understanding-source");
            source.setAttribute("aria-label", projectAnalyzerText("understanding-source") + ": " + label.textContent);
            source.title = !fact.evidenceToken ? projectAnalyzerText("understanding-evidence-missing") : fact.subject;
            unavailable.textContent = projectAnalyzerText("understanding-evidence-missing");
          });
          trigger.append(phase, label);
          footer.append(confidence, onGraph, source, unavailable);
          body.append(detail, evidence, footer);
          row.append(trigger, body); item.append(row); list.append(item);
        }
        summary.append(title, role);
        disclosure.append(summary, note, list, limit);
        section.append(disclosure);
      }
      function refreshLanguage() {
        heading.textContent = projectAnalyzerText("understanding-title");
        hint.textContent = projectAnalyzerText("understanding-hint");
        for (const update of updates) update();
      }
      refreshLanguage();
      return { element: section, refreshLanguage, dispose() { disposed = true; if (revealFrame !== undefined) cancelAnimationFrame(revealFrame); } };
    }

    /** Explains syntax roles in plain language without inventing business intent. */
    function createFunctionStepExplanation(block) {
      if (!["entry", "condition", "loop", "switch", "return", "throw", "mutation", "call", "effect", "render", "event", "try", "exit"].includes(block.kind)) return undefined;
      const explanation = document.createElement("div");
      const title = document.createElement("strong");
      const text = document.createElement("p");
      explanation.className = "logic-step-explanation";
      title.textContent = projectAnalyzerText("understanding-step-heading");
      text.textContent = projectAnalyzerText("understanding-step-" + block.kind);
      explanation.append(title, text);
      return explanation;
    }
  `;
}
