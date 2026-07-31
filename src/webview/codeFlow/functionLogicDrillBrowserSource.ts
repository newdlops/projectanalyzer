/**
 * Browser-only Function Logic drill controls. This fragment renders bounded
 * call, JSX render, and detached event-handler targets without owning graph UI.
 */

/** Returns CSP-safe target-list and target-button helpers. */
export function getFunctionLogicDrillBrowserSource(): string {
  return /* js */ `
    /** Lists concrete related functions so readers can expand only when useful. */
    function createLogicCalleeExplorer(targets, omittedCount) {
      if (targets.length === 0 && omittedCount === 0) return undefined;
      const section = document.createElement("section");
      const header = document.createElement("div");
      const text = document.createElement("div");
      const title = document.createElement("strong");
      const detail = document.createElement("p");
      const list = document.createElement("div");
      const renderTargetCount = targets.filter((target) => target.relation === "render").length;
      const eventTargetCount = targets.filter((target) => target.relation === "event").length;
      section.className = "logic-callees";
      header.className = "logic-callees-header";
      const titleKey = eventTargetCount > 0 ? "callee-events-title" : renderTargetCount > 0 ? "callee-render-title" : "callee-call-title";
      const detailKey = eventTargetCount > 0 ? "callee-events-detail" : "callee-detail";
      const count = createBadge(projectAnalyzerText("child-target-count", { count: targets.length }), "logic-callee-count");
      title.textContent = projectAnalyzerText(titleKey);
      detail.textContent = projectAnalyzerText(detailKey);
      list.className = "logic-callee-list";
      text.append(title, detail);
      header.append(text, count);
      const buttons = targets.map((target) => createDrillTargetButton(target));
      for (const button of buttons) list.append(button);
      if (omittedCount > 0) {
        const omitted = document.createElement("small");
        omitted.className = "logic-callee-omitted";
        omitted.textContent = projectAnalyzerText("child-targets-omitted", { count: omittedCount });
        list.append(omitted);
      }
      section.append(header, list);
      section.refreshLanguage = () => {
        title.textContent = projectAnalyzerText(titleKey);
        detail.textContent = projectAnalyzerText(detailKey);
        count.textContent = projectAnalyzerText("child-target-count", { count: targets.length });
        for (const button of buttons) button.refreshLanguage?.();
        const omitted = list.querySelector?.(".logic-callee-omitted");
        if (omitted) omitted.textContent = projectAnalyzerText("child-targets-omitted", { count: omittedCount });
      };
      return section;
    }

    /** Creates one token-only navigation or same-canvas graph-attachment action. */
    function createDrillTargetButton(target, block, graphContext) {
      const button = document.createElement("button");
      const name = document.createElement("strong");
      const meta = document.createElement("span");
      const expandsInline = Boolean(
        block && graphContext && graphContext.onExpandableTargetClick
      );
      const expandedInline = Boolean(
        expandsInline && graphContext.isTargetExpanded
        && graphContext.isTargetExpanded(block.id, target)
      );
      const renderedComponent = target.relation === "render";
      const eventHandler = target.relation === "event";
      const targetRole = projectAnalyzerText(renderedComponent ? "rendered-component" : eventHandler ? "event-handler" : "child-function");
      button.type = "button";
      button.className = "logic-callee-button";
      button.classList.toggle("expanded", expandedInline);
      button.title = projectAnalyzerText(expandedInline ? "collapse-target" : expandsInline ? "attach-target" : "open-target", { role: targetRole, label: target.qualifiedName });
      name.textContent = target.qualifiedName || target.name;
      meta.textContent = [
        target.sourceLocation,
        projectAnalyzerText("logic-confidence-" + (target.confidence || "unknown")),
        projectAnalyzerText(renderedComponent ? "render-sites" : eventHandler ? "event-bindings" : "callsites", { count: target.callsiteCount })
      ].filter(Boolean).join(" · ");
      button.append(name, meta);
      button.addEventListener("click", () => {
        if (expandsInline) {
          graphContext.onExpandableTargetClick(block, target);
          return;
        }
        drillIntoFunction(target);
      });
      button.refreshLanguage = () => {
        const role = projectAnalyzerText(renderedComponent ? "rendered-component" : eventHandler ? "event-handler" : "child-function");
        button.title = projectAnalyzerText(expandedInline ? "collapse-target" : expandsInline ? "attach-target" : "open-target", { role: role, label: target.qualifiedName });
        meta.textContent = [target.sourceLocation, projectAnalyzerText("logic-confidence-" + (target.confidence || "unknown")), projectAnalyzerText(renderedComponent ? "render-sites" : eventHandler ? "event-bindings" : "callsites", { count: target.callsiteCount })].filter(Boolean).join(" · ");
      };
      return button;
    }
  `;
}
