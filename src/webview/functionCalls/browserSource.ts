/** Retained Function Calls mode: explicit lazy expansion, opaque messages, native keyboard controls and separate camera state. */
import { getFunctionCallsGraphSource } from "./graphSource";
import { getFunctionCallsScenarioSource } from "./scenarioSource";

export function getFunctionCallsBrowserSource(): string {
  return /* js */ String.raw`
    ${getFunctionCallsGraphSource()}
    ${getFunctionCallsScenarioSource()}
    /** Owns only call-mode state; switching never reconstructs or edits the statement workspace. */
    function createFunctionCallsMode(options) {
      const container = document.getElementById("function-calls");
      const switches = [document.getElementById("function-mode-statements"), document.getElementById("function-mode-calls")];
      if (!container || switches.some(button => !button)) return { reset() {}, accept() {}, localize() {}, isActive() { return false; } };
      let active = false, root, graphVersion, requestId = 0, pending, timeout;
      let nodes = new Map(), connections = new Map(), loaded = new Set(), failures = new Map();
      let selectedId, selectedGroup, zoom = 1, omitted = 0, limited = false, listOpen = false;
      let viewport, canvas, layout, dragging, needsLocalization = false, centerRoot = false;
      let camera = { left: 0, top: 0 };
      let callView = "order", relationSurface;
      const t = (key, params) => projectAnalyzerText(key, params);
      const el = (tag, className, text) => { const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = text; return element; };
      const button = (text, key, action) => { const item = el("button", "", text); item.type = "button"; item.dataset.callKey = key; item.addEventListener("click", action); return item; };
      const formatGuard = guard => guard.expression + " → " + (["true", "false", "exception", "finally", "nullish", "notNullish"].includes(guard.outcome) ? t("calls-" + guard.outcome) : guard.outcome);
      const guardText = edge => edge.guards.map(formatGuard).join(" ∧ ");
      const conditionText = edge => guardText(edge) || t(edge.limited ? "calls-context-unknown" : "calls-direct");
      const description = edge => [conditionText(edge), ...edge.loops.map(loop => t("calls-loop") + ": " + loop), edge.deferred ? t("calls-deferred") : ""].filter(Boolean).join(" · ");
      const pairKey = edge => edge.from + ">" + edge.to;
      const groupName = group => (nodes.get(group.from)?.name || "?") + " → " + (nodes.get(group.to)?.name || "?");
      const depthOf = id => layout?.positions.get(id)?.depth ?? 0;
      const scenarios = createFunctionCallScenarioView({ el, button, t, load, render,
        openInputs(node) { setMode("statements"); options.openFunction(node, "values"); },
        selectConnection(edge) { if (edge) { selectedGroup = pairKey(edge); callView = "relations"; render(); } },
        openEvidence(evidenceToken) { options.postMessage({ type: "codeFlow/openEvidence", payload: { graphVersion, evidenceToken } }); }
      });

      function setMode(value) {
        if (active && viewport && !relationSurface?.hidden) camera = { left: viewport.scrollLeft, top: viewport.scrollTop };
        active = value === "calls";
        container.hidden = !active;
        document.body.classList.toggle("calls-mode-active", active);
        switches.forEach((item, index) => item.setAttribute("aria-pressed", String(index === (active ? 1 : 0))));
        options.onModeChange?.(active);
        if (active && needsLocalization) { needsLocalization = false; render(); }
        if (active && viewport) { viewport.scrollLeft = camera.left; viewport.scrollTop = camera.top; }
        if (active) revealRoot();
        if (active && root && !loaded.has(root.sourceToken) && !pending && !failures.has(root.sourceToken)) load(root.sourceToken);
        else if (active && !viewport) render();
      }
      switches[0].addEventListener("click", () => setMode("statements"));
      switches[1].addEventListener("click", () => setMode("calls"));

      /** Starts just one authorized direct-neighborhood request; a new session invalidates its reply. */
      function load(id) {
        const node = nodes.get(id);
        if (!node?.sourceToken || pending || loaded.has(id) || depthOf(id) >= 6 || nodes.size >= 32) return;
        const request = { graphVersion, sourceToken: node.sourceToken, requestId: ++requestId };
        pending = request; failures.delete(id); render();
        timeout = setTimeout(() => { if (pending !== request) return; pending = undefined; failures.set(id, "failed"); render(); }, 30000);
        options.postMessage({ type: "functionCalls/load", payload: request });
      }
      function reset(payload) {
        clearTimeout(timeout); root = payload?.root; graphVersion = payload?.graphVersion; pending = undefined;
        nodes = new Map(); connections = new Map(); loaded = new Set(); failures = new Map();
        scenarios.reset(); callView = "order"; relationSurface = undefined;
        selectedId = root?.sourceToken; selectedGroup = undefined; zoom = 1; omitted = 0; limited = false;
        viewport = undefined; layout = undefined; camera = { left: 0, top: 0 }; listOpen = false;
        if (root) nodes.set(root.sourceToken, { id: root.sourceToken, sourceToken: root.sourceToken, name: root.label, qualifiedName: root.label, resolution: "concrete" });
        if (active && root) load(root.sourceToken);
      }
      /** Accepts only the outstanding snapshot/token/sequence, even after a mode switch or root replacement. */
      function accept(payload) {
        if (!pending || !payload || payload.graphVersion !== graphVersion || payload.sourceToken !== pending.sourceToken || payload.requestId !== pending.requestId) return;
        clearTimeout(timeout); const id = pending.sourceToken; pending = undefined;
        if (payload.status !== "ready") { failures.set(id, ["unavailable", "stale"].includes(payload.status) ? payload.status : "failed"); render(); return; }
        if (!Array.isArray(payload.nodes) || payload.nodes.length > 32 || !Array.isArray(payload.connections) || payload.connections.length > 96
          || !payload.nodes.some(node => node.id === id)) { failures.set(id, "failed"); render(); return; }
        if (payload.control && (typeof payload.control.signature !== "string" || !Array.isArray(payload.control.blocks) || payload.control.blocks.length > 512
          || payload.control.blocks.some(block => !block?.id || !Array.isArray(block.calls) || !Array.isArray(block.next)))) { failures.set(id, "failed"); render(); return; }
        for (const node of payload.nodes) if (nodes.has(node.id) || nodes.size < 32) nodes.set(node.id, node); else limited = true;
        for (const edge of payload.connections) {
          if (connections.has(edge.id)) continue;
          if (connections.size >= 128 || !nodes.has(edge.from) || !nodes.has(edge.to)) { omitted += 1; limited = true; continue; }
          connections.set(edge.id, edge);
        }
        if (id === root?.sourceToken && !loaded.has(id)) centerRoot = true;
        scenarios.accept(id, payload.control);
        loaded.add(id); omitted += payload.omittedCount || 0; limited = limited || Boolean(payload.limited); render();
      }
      function selectNode(id) { selectedId = id; selectedGroup = undefined; render(); }
      function selectEdge(key) { selectedGroup = key; render(); }
      function revealRoot() {
        if (!centerRoot || !active || callView !== "relations" || !viewport || !layout) return;
        const position = layout.positions.get(root?.sourceToken);
        if (position) { viewport.scrollLeft = 0; viewport.scrollTop = Math.max(0, (position.y + position.height / 2) * zoom - viewport.clientHeight / 2);
          camera = { left: viewport.scrollLeft, top: viewport.scrollTop }; centerRoot = false; }
      }
      function scale(value) {
        zoom = Math.max(0.35, Math.min(2, value));
        if (canvas && layout) { canvas.style.transform = "scale(" + zoom + ")"; canvas.parentElement.style.width = layout.width * zoom + "px"; canvas.parentElement.style.height = layout.height * zoom + "px"; }
        const indicator = container.querySelector(".calls-zoom"); if (indicator) indicator.textContent = Math.round(zoom * 100) + "%";
      }
      function render() {
        const focusKey = container.contains(document.activeElement) ? document.activeElement?.dataset?.callKey : undefined;
        const orderScroll = ["conditions", "sequence"].map(part => container.querySelector(".calls-order-" + part)?.scrollTop || 0);
        if (active && viewport && !relationSurface?.hidden) camera = { left: viewport.scrollLeft, top: viewport.scrollTop };
        container.replaceChildren();
        const header = el("div", "calls-header"), intro = el("div");
        intro.append(el("h2", "", t("calls-title")), el("p", "", t(callView === "order" ? "calls-order-hint" : "calls-hint")));
        const controls = el("div", "calls-controls");
        controls.hidden = callView !== "relations";
        controls.append(button("−", "zoom-out", () => scale(zoom - .15)), el("span", "calls-zoom", Math.round(zoom * 100) + "%"), button("+", "zoom-in", () => scale(zoom + .15)),
          button(t("fit"), "fit", () => { if (viewport && layout) { scale(Math.min((viewport.clientWidth - 16) / layout.width, (viewport.clientHeight - 16) / layout.height, 1)); viewport.scrollTo(0, 0); } }));
        controls.children[0].setAttribute("aria-label", t("zoom-out")); controls.children[2].setAttribute("aria-label", t("zoom-in"));
        header.append(intro, controls);
        const views = el("div", "calls-view-switch"); views.setAttribute("role", "group"); views.setAttribute("aria-label", t("calls-order-view"));
        for (const view of ["order", "relations"]) {
          const toggle = button(t("calls-view-" + view), "view:" + view, () => { callView = view; render(); }); toggle.setAttribute("aria-pressed", String(callView === view)); views.append(toggle);
        }
        const status = el("p", "calls-status"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
        const summary = t("calls-count", { nodes: nodes.size, edges: connections.size });
        status.textContent = pending ? t("calls-loading", { name: nodes.get(pending.sourceToken)?.name || "" }) : !root ? t("calls-idle")
          : [summary, omitted ? t("calls-omitted", { count: omitted }) : "", limited ? t("calls-partial") : ""].filter(Boolean).join(" · ");
        const workspace = el("div", "calls-workspace"); viewport = el("div", "calls-viewport"); viewport.tabIndex = 0;
        viewport.setAttribute("role", "region"); viewport.setAttribute("aria-label", t("calls-graph"));
        const sizer = el("div", "calls-sizer"); canvas = el("div", "calls-surface");
        layout = layoutFunctionCalls([...nodes.values()], [...connections.values()], root?.sourceToken);
        canvas.style.width = layout.width + "px"; canvas.style.height = layout.height + "px";
        const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
        svg.setAttribute("width", layout.width); svg.setAttribute("height", layout.height); svg.setAttribute("aria-hidden", "true");
        const defs = document.createElementNS(ns, "defs"), marker = document.createElementNS(ns, "marker"), tip = document.createElementNS(ns, "path");
        marker.id = "function-calls-arrow"; marker.setAttribute("viewBox", "0 0 10 10"); marker.setAttribute("refX", "9"); marker.setAttribute("refY", "5"); marker.setAttribute("markerWidth", "6"); marker.setAttribute("markerHeight", "6"); marker.setAttribute("orient", "auto-start-reverse");
        tip.setAttribute("d", "M 0 0 L 10 5 L 0 10 z"); tip.style.fill = "var(--vscode-descriptionForeground)"; marker.append(tip); defs.append(marker); svg.append(defs); canvas.append(svg);
        for (const group of layout.groups) {
          const path = document.createElementNS(ns, "path"); path.setAttribute("d", group.path);
          path.setAttribute("class", "calls-edge-path" + (group.edges.some(edge => ["inferred", "unresolved"].includes(edge.confidence) || edge.deferred) ? " uncertain" : "") + (selectedGroup === group.key ? " selected" : ""));
          path.setAttribute("marker-end", "url(#function-calls-arrow)"); svg.append(path);
          const label = button("", "edge:" + group.key, () => selectEdge(group.key)); label.className = "calls-edge-label";
          label.style.left = group.labelX + "px"; label.style.top = group.labelY + "px"; label.setAttribute("aria-pressed", String(selectedGroup === group.key));
          const first = group.edges[0]; const kinds = [group.cycle ? t("calls-cycle") : "", group.edges.some(edge => edge.loops.length) ? t("calls-loop") : "", group.edges.length > 1 ? t("calls-sites", { count: group.edges.length }) : ""].filter(Boolean);
          label.append(el("span", "", kinds.join(" · ") || t("calls-relation-" + first.relation)),
            el("span", "", group.edges.length > 1 ? t("calls-multiple-conditions") : conditionText(first)));
          label.title = groupName(group) + "\n" + group.edges.map(description).join("\n"); label.setAttribute("aria-label", label.title); canvas.append(label);
        }
        for (const node of nodes.values()) {
          const position = layout.positions.get(node.id); if (!position) continue;
          const item = button("", "node:" + node.id, () => selectNode(node.id));
          item.className = "calls-node" + (node.id === root?.sourceToken ? " root" : "") + (node.resolution === "unresolved" ? " unresolved" : "");
          item.style.left = position.x + "px"; item.style.top = position.y + "px"; item.setAttribute("aria-pressed", String(selectedId === node.id && !selectedGroup));
          item.append(el("strong", "", node.name), el("small", "", node.resolution === "unresolved" ? t("calls-unknown") : node.id === root?.sourceToken ? t("calls-root") : loaded.has(node.id) ? t("calls-loaded") : t("calls-expand")));
          item.title = node.qualifiedName + (node.sourceLocation ? "\n" + node.sourceLocation : ""); canvas.append(item);
        }
        sizer.append(canvas); viewport.append(sizer); scale(zoom);
        viewport.addEventListener("pointerdown", event => { if (event.button !== 0 || event.target.closest("button") || event.pointerType === "touch") return;
          dragging = { x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop }; viewport.setPointerCapture(event.pointerId); viewport.classList.add("dragging"); });
        viewport.addEventListener("pointermove", event => { if (dragging) { viewport.scrollLeft = dragging.left + dragging.x - event.clientX; viewport.scrollTop = dragging.top + dragging.y - event.clientY; } });
        const stop = () => { dragging = undefined; viewport.classList.remove("dragging"); }; viewport.addEventListener("pointerup", stop); viewport.addEventListener("pointercancel", stop);
        const detail = el("aside", "calls-detail"); detail.setAttribute("aria-label", t("reading-details")); renderDetail(detail);
        relationSurface = el("div", "calls-relations"); relationSurface.hidden = callView !== "relations";
        workspace.append(viewport, detail); relationSurface.append(workspace, el("p", "calls-legend", t("calls-legend")));
        container.append(header, views, status);
        if (callView === "order") container.append(scenarios.render({ nodes, connections, rootId: root?.sourceToken, pending, failures, loaded }));
        container.append(relationSurface); renderList(relationSurface); viewport.scrollLeft = camera.left; viewport.scrollTop = camera.top; revealRoot();
        ["conditions", "sequence"].forEach((part, index) => { const pane = container.querySelector(".calls-order-" + part); if (pane) pane.scrollTop = orderScroll[index]; });
        if (focusKey && active) {
          const target = [...container.querySelectorAll("[data-call-key]")].find(item => item.dataset.callKey === focusKey && !item.disabled)
            || [...views.children].find(item => item.getAttribute("aria-pressed") === "true");
          target?.focus({ preventScroll: true });
        }
      }
      function renderDetail(detail) {
        const group = layout.groups.find(item => item.key === selectedGroup);
        if (group) { detail.append(el("h3", "", groupName(group)), el("p", "calls-muted", t("calls-selected-edge")));
          if (group.cycle) detail.append(el("p", "", t("calls-cycle"))); for (const edge of group.edges) detail.append(siteDetail(edge)); return; }
        const node = nodes.get(selectedId); if (!node) return;
        detail.append(el("h3", "", node.qualifiedName), el("p", "calls-muted", node.sourceLocation || t(node.resolution === "unresolved" ? "calls-unknown" : "calls-root")));
        const actions = el("div", "calls-actions");
        const expand = button(t(failures.has(node.id) ? "calls-retry" : loaded.has(node.id) ? "calls-loaded" : "calls-expand"), "expand:" + node.id, () => load(node.id));
        expand.disabled = !node.sourceToken || Boolean(pending) || loaded.has(node.id) || depthOf(node.id) >= 6 || nodes.size >= 32;
        actions.append(expand);
        if (node.sourceToken) actions.append(button(t("calls-view-order"), "order:" + node.id, () => { scenarios.setParent(node.id); callView = "order"; load(node.id); render(); }));
        if (node.sourceToken) actions.append(button(t("calls-open"), "open:" + node.id, () => { setMode("statements"); options.openFunction(node); }));
        detail.append(actions);
        if (failures.has(node.id)) detail.append(el("p", "", t("calls-" + failures.get(node.id))));
        if (depthOf(node.id) >= 6) detail.append(el("p", "", t("calls-depth")));
        if (nodes.size >= 32) detail.append(el("p", "", t("calls-limited")));
        for (const direction of ["incoming", "outgoing"]) {
          const edges = [...connections.values()].filter(edge => (direction === "incoming" ? edge.to : edge.from) === node.id);
          if (!edges.length) { if (direction === "outgoing" && loaded.has(node.id)) detail.append(el("p", "", t("calls-empty"))); continue; }
          detail.append(el("h4", "", t("calls-" + direction))); for (const edge of edges) detail.append(siteDetail(edge));
        }
      }
      function siteDetail(edge) {
        const section = el("section", "calls-site");
        section.append(el("code", "", groupName(edge)), el("p", "calls-muted", t("calls-relation-" + edge.relation) + " · " + t(edge.confidence)));
        const facts = el("ul");
        const guards = edge.guards.map(formatGuard);
        for (const text of [...(guards.length ? guards : [conditionText(edge)]), ...edge.loops.map(loop => t("calls-loop") + ": " + loop), ...(edge.deferred ? [t("calls-deferred")] : [])]) facts.append(el("li", "", text));
        section.append(facts);
        if (edge.limited && guards.length) section.append(el("p", "calls-muted", t("calls-context-unknown")));
        if (edge.sourceLocation) section.append(el("p", "calls-muted", edge.sourceLocation));
        if (edge.evidenceToken) section.append(button(t("calls-site"), "source:" + edge.id, () => options.postMessage({ type: "codeFlow/openEvidence", payload: { graphVersion, evidenceToken: edge.evidenceToken } })));
        return section;
      }
      function renderList(target) {
        const list = el("details", "calls-list"); list.open = listOpen;
        list.addEventListener("toggle", () => { listOpen = list.open; });
        list.append(el("summary", "", t("calls-list") + " · " + connections.size)); const rows = el("div");
        for (const edge of connections.values()) {
          const item = button("", "list:" + edge.id, () => selectEdge(pairKey(edge))); item.setAttribute("aria-pressed", String(selectedGroup === pairKey(edge)));
          item.append(el("strong", "", groupName(edge)), el("small", "", description(edge))); rows.append(item);
        }
        if (!connections.size) rows.append(el("p", "", t("calls-no-connections"))); list.append(rows); target.append(list);
      }
      return { reset, accept, isActive: () => active, localize() { if (active) render(); else needsLocalization = true; } };
    }
  `;
}
