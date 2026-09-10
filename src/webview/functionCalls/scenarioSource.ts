/** Parent-oriented call scenarios: retained assumptions, ordered traces and portable text drafts. */
import { getFunctionCallsControlSource } from "./controlSource";

export function getFunctionCallsScenarioSource(): string {
  return /* js */ String.raw`
    ${getFunctionCallsControlSource()}
    /** Owns drafts per parent; graph/camera and statement input state belong to their existing controllers. */
    function createFunctionCallScenarioView(options) {
      const plans = new Map(), drafts = new Map(); let parentId;
      const { el, button, t, visuals } = options;
      const labelOption = option => option.kind === "iterations" ? t("calls-order-iterations", { count: option.value })
        : ["true", "false", "nullish", "notNullish", "exception", "finally"].includes(option.kind) ? t("calls-" + option.kind) : option.label || t("calls-order-" + option.kind);
      function draftFor(id, plan, connections) {
        let draft = drafts.get(id);
        if (!draft) {
          const examples = exampleFunctionCallScenarios(plan, connections);
          draft = { examples, selection: new Map(examples[0]?.selection || []), example: examples.length ? "0" : "custom", name: "", expanded: false, copyStatus: "" };
          drafts.set(id, draft);
        }
        return draft;
      }
      function render(state) {
        if (!state.nodes.has(parentId)) parentId = state.rootId;
        const section = el("section", "calls-order"); section.setAttribute("aria-label", t("calls-order-title"));
        const parent = state.nodes.get(parentId), plan = plans.get(parentId);
        const toolbar = el("div", "calls-order-toolbar");
        const label = el("label", "calls-order-parent", t("calls-order-parent"));
        const select = el("select"); select.dataset.callKey = "scenario-parent"; select.name = "scenario-parent";
        for (const node of state.nodes.values()) {
          const option = el("option", "", node.name + (node.id === state.rootId ? " · " + t("calls-root") : "")); option.value = node.id; select.append(option);
        }
        select.value = parentId || ""; select.disabled = !parent || Boolean(state.pending);
        select.addEventListener("change", () => { parentId = select.value; options.load(parentId); options.render(); });
        label.append(select); toolbar.append(label);
        if (parent) {
          const inputs = button(t("calls-order-inputs"), "scenario-inputs", () => options.openInputs(parent)); inputs.disabled = Boolean(state.pending); toolbar.append(inputs);
        }
        section.append(toolbar);
        if (plan?.signature) section.append(el("pre", "calls-order-signature", plan.signature));
        if (!plan) {
          const loading = state.pending?.sourceToken === parentId;
          const feedback = el("p", "calls-order-feedback"); feedback.dataset.callTone = loading ? "call" : state.failures.get(parentId) === "failed" ? "exception" : "pending";
          feedback.setAttribute("role", "status"); feedback.append(visuals.glyph(feedback.dataset.callTone), el("span", "", t(loading ? "calls-order-loading" : state.failures.has(parentId) ? "calls-" + state.failures.get(parentId) : "calls-order-unavailable"))); section.append(feedback);
          if (parent && !loading) { const retry = button(t("calls-retry"), "scenario-retry", () => options.load(parentId)); retry.disabled = Boolean(state.pending) || state.loaded.has(parentId); section.append(retry); }
          return section;
        }
        const draft = draftFor(parentId, plan, state.connections);
        const trace = traceFunctionCalls(plan, state.connections, draft.selection);
        const presets = el("div", "calls-order-presets");
        const presetLabel = el("label", "", t("calls-order-example")), preset = el("select"); preset.dataset.callKey = "scenario-example"; preset.name = "scenario-example";
        draft.examples.forEach((example, index) => {
          const option = el("option", "", t("calls-order-example-name", { number: index + 1, count: example.trace.callIds.length }) + " · " + t("calls-order-end-" + (example.trace.terminal?.kind || "exit"))); option.value = String(index); preset.append(option);
        });
        const custom = el("option", "", t("calls-order-custom")); custom.value = "custom"; preset.append(custom); preset.value = draft.example;
        preset.addEventListener("change", () => { draft.example = preset.value; draft.selection = new Map(draft.examples[Number(preset.value)]?.selection || []); draft.copyStatus = ""; options.render(); });
        presetLabel.append(preset); presets.append(presetLabel, button(t("calls-order-new"), "scenario-new", () => { draft.selection.clear(); draft.example = "custom"; draft.copyStatus = ""; options.render(); }));
        section.append(presets, el("p", "calls-order-note", t("calls-order-assumed")), visuals.legend(["condition", "loop", "call", "return"]));
        const decisionIndices = new Map(trace.decisions.map((decision, index) => [decision.key, index + 1]));
        const decisionText = decision => decision?.value ? labelOption(decision.options.find(option => option.value === decision.value)) : t("calls-order-choose");
        const workspace = el("div", "calls-order-workspace"), conditions = el("div", "calls-order-conditions"), sequence = el("div", "calls-order-sequence");
        const conditionsHeading = el("h3", "", t("calls-order-conditions")); conditionsHeading.tabIndex = -1;
        const traceHeading = el("h3", "", t("calls-order-sequence", { count: trace.callIds.length })); traceHeading.tabIndex = -1;
        const jumpCalls = button(t("calls-order-jump-calls"), "scenario-jump-calls", () => traceHeading.focus()); jumpCalls.className = "calls-order-jump";
        const jumpConditions = button(t("calls-order-jump-conditions"), "scenario-jump-conditions", () => conditionsHeading.focus()); jumpConditions.className = "calls-order-jump";
        conditions.append(conditionsHeading, jumpCalls);
        for (const decision of trace.decisions) {
          const field = el("label", "calls-order-choice");
          field.dataset.callTone = !decision.value ? "pending" : decision.kind === "loop" ? "loop" : "condition";
          const location = plan.blocks.find(block => block.id === decision.blockId)?.sourceLocation;
          field.append(visuals.cue(field.dataset.callTone, t("calls-order-condition-number", { count: decisionIndices.get(decision.key) }) + " · " + t(decision.kind === "loop" ? "calls-order-loop-choice" : "calls-order-choice")),
            el("span", "calls-order-choice-caption", [decision.visit > 1 ? t("calls-order-visit", { count: decision.visit }) : "", location].filter(Boolean).join(" · ")), el("code", "", decision.label));
          const input = el("select"); input.dataset.callKey = "scenario-choice:" + decision.key; input.name = "scenario-choice:" + decision.key;
          const empty = el("option", "", t("calls-order-choose")); empty.value = ""; input.append(empty);
          for (const option of decision.options) { const item = el("option", "", labelOption(option)); item.value = option.value; input.append(item); }
          input.value = decision.value || ""; input.setAttribute("aria-label", decision.label + (decision.visit > 1 ? " · " + t("calls-order-visit", { count: decision.visit }) : ""));
          input.addEventListener("change", () => { if (input.value) draft.selection.set(decision.key, input.value); else draft.selection.delete(decision.key); draft.example = "custom"; draft.copyStatus = ""; options.render(); });
          field.append(input); conditions.append(field);
        }
        if (!trace.decisions.length) conditions.append(el("p", "calls-muted", t("calls-order-no-conditions")));
        sequence.append(traceHeading, jumpConditions);
        const list = el("ol", "calls-order-steps");
        for (const row of trace.rows) {
          const item = el("li", "calls-order-step calls-order-step-" + row.kind);
          item.dataset.callTone = row.kind === "call" ? "call" : row.kind === "decision" ? row.value ? "condition" : "pending"
            : ["loop", "loopEnd", "continue", "break"].includes(row.kind) ? "loop" : row.kind === "deferred" ? "deferred" : "pending";
          if (row.kind === "call") {
            const connection = state.connections.get(row.connectionId);
            const number = el("span", "calls-order-number", String(row.ordinal)); number.setAttribute("aria-hidden", "true");
            const content = el("div", "calls-order-call"); const action = button("", "scenario-call:" + row.ordinal, () => options.selectConnection(connection));
            action.append(el("code", "", row.expression)); action.setAttribute("aria-label", t("calls-order-call-action", { count: row.ordinal, call: row.expression }));
            content.append(action);
            if (connection?.guards?.length) {
              const guards = el("div", "calls-order-guard-cues");
              for (const guard of connection.guards) guards.append(visuals.cue("condition", guard.expression + " → " + (["true", "false", "nullish", "notNullish"].includes(guard.outcome) ? t("calls-" + guard.outcome) : guard.outcome)));
              content.append(guards);
            }
            if (row.loops.length) content.append(visuals.cue("loop", row.loops.map(loop => loop.label + " · " + t("calls-order-iteration", { count: loop.iteration })).join(" / ")));
            if (connection?.sourceLocation) content.append(el("small", "", connection.sourceLocation));
            item.append(number, content);
            if (connection?.evidenceToken) item.append(button(t("calls-order-source"), "scenario-source:" + row.ordinal, () => options.openEvidence(connection.evidenceToken)));
          } else {
            const marker = el("span", "calls-order-marker"); marker.append(visuals.glyph(item.dataset.callTone));
            const beat = el("div", "calls-order-beat");
            if (row.kind === "decision") {
              const decision = trace.decisions.find(candidate => candidate.key === row.decisionKey);
              const edit = button(t("calls-order-condition-number", { count: decisionIndices.get(row.decisionKey) }) + " · " + decisionText(decision), "scenario-edit:" + row.decisionKey, () => {
                const input = [...section.querySelectorAll("select[data-call-key]")].find(input => input.dataset.callKey === "scenario-choice:" + row.decisionKey);
                input?.focus(); input?.scrollIntoView({ block: "nearest", inline: "nearest" });
              });
              edit.className = "calls-order-decision-action"; edit.setAttribute("aria-label", t("calls-order-edit-condition", { condition: row.label, outcome: decisionText(decision) }));
              edit.append(el("span", "calls-order-decision-edit", t("calls-order-change")));
              beat.append(edit, el("code", "", row.label));
            } else if (row.kind === "loop" || row.kind === "loopEnd") {
              beat.append(el("strong", "", t(row.kind === "loop" ? "calls-order-loop-start" : "calls-order-loop-end", { count: row.iteration ?? row.count, total: row.count })), el("code", "", row.label));
            } else beat.append(el("strong", "", t("calls-order-" + row.kind)), el("code", "", row.expression || row.label));
            item.append(marker, beat);
          }
          list.append(item);
        }
        sequence.append(list);
        const status = el("p", "calls-order-result"); status.setAttribute("role", "status");
        const statusText = trace.pending ? t("calls-order-awaiting") : trace.status === "complete" ? t("calls-order-end-" + (trace.terminal?.kind || "exit")) : t("calls-order-limited");
        status.dataset.callTone = trace.pending || trace.status !== "complete" ? "pending" : trace.terminal?.kind === "throw" ? "exception" : "return";
        status.append(visuals.glyph(status.dataset.callTone), el("span", "", statusText));
        sequence.append(status);
        if (!trace.pending && trace.terminal?.kind !== "exit" && trace.terminal?.label) sequence.append(el("code", "calls-order-terminal", trace.terminal.label));
        if (!trace.callIds.length && !trace.pending) sequence.append(el("p", "calls-order-empty", t("calls-empty")));
        if (trace.limited || plan.unorderedCallIds?.length) sequence.append(el("p", "calls-order-note", t("calls-order-partial")));
        workspace.append(conditions, sequence); section.append(workspace);
        const draftBox = el("details", "calls-order-draft"); draftBox.open = draft.expanded; draftBox.addEventListener("toggle", () => { draft.expanded = draftBox.open; });
        draftBox.append(el("summary", "", t("calls-order-draft")));
        const nameLabel = el("label", "", t("calls-order-name")), name = el("input"); name.type = "text"; name.maxLength = 160; name.value = draft.name; name.dataset.callKey = "scenario-name"; name.name = "scenario-name"; name.autocomplete = "off";
        nameLabel.append(name);
        const textLabel = el("label", "", t("calls-order-draft-text")), text = el("textarea"); text.readOnly = true; text.rows = 10; text.dataset.callKey = "scenario-text"; text.name = "scenario-text"; text.spellcheck = false;
        const draftText = () => ["# " + (draft.name || parent.name), "", plan.signature, "", t("calls-order-assumed"), "", t("calls-order-conditions") + ":",
          ...trace.decisions.map(decision => "- " + decision.label + (decision.visit > 1 ? " [" + t("calls-order-visit", { count: decision.visit }) + "]" : "") + " → " + (decision.value ? labelOption(decision.options.find(option => option.value === decision.value)) : t("calls-order-choose"))), "",
          t("calls-order-sequence", { count: trace.callIds.length }) + ":", ...trace.rows.map(row => row.kind === "call" ? row.ordinal + ". " + row.expression : row.kind === "decision" ? "[" + t("calls-order-condition-number", { count: decisionIndices.get(row.decisionKey) }) + "] " + row.label + " → " + decisionText(trace.decisions.find(decision => decision.key === row.decisionKey)) : row.kind === "loop" ? "[" + row.label + " · " + t("calls-order-iteration", { count: row.iteration }) + "]" : row.kind === "loopEnd" ? "[" + t("calls-order-loop-end", { count: row.count }) + "]" : "[" + t("calls-order-" + row.kind) + "] " + (row.expression || row.label)), "", statusText,
          !trace.pending ? trace.terminal?.label || "" : "", trace.limited || plan.unorderedCallIds?.length ? t("calls-order-partial") : ""].filter(value => value !== undefined).join("\n");
        text.value = draftText(); textLabel.append(text); name.addEventListener("input", () => { draft.name = name.value; draft.copyStatus = ""; copyStatus.textContent = ""; text.value = draftText(); });
        const copyStatus = el("p", "calls-order-note", draft.copyStatus); copyStatus.setAttribute("role", "status");
        const copy = button(t("calls-order-copy"), "scenario-copy", async () => {
          try { await navigator.clipboard.writeText(text.value); draft.copyStatus = t("calls-order-copied"); }
          catch { text.focus(); text.select(); draft.copyStatus = t("calls-order-copy-fallback"); }
          copyStatus.textContent = draft.copyStatus;
        });
        draftBox.append(nameLabel, textLabel, copy, copyStatus); section.append(draftBox);
        return section;
      }
      return { render, accept(id, plan) { if (plan) plans.set(id, plan); }, setParent(id) { parentId = id; }, reset() { parentId = undefined; plans.clear(); drafts.clear(); } };
    }
  `;
}
