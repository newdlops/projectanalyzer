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
      title.textContent = eventTargetCount > 0
        ? "Go deeper into calls, renders, or event handlers"
        : renderTargetCount > 0
          ? "Go deeper into called or rendered code"
          : "Go deeper into called functions";
      detail.textContent = eventTargetCount > 0
        ? "Event handlers open as dispatch branches and do not return into the registration flow."
        : "Open a statically resolved definition, then use the breadcrumb to return.";
      list.className = "logic-callee-list";
      text.append(title, detail);
      header.append(text, createBadge(
        targets.length + " child target" + plural(targets.length),
        "logic-callee-count"
      ));
      for (const target of targets) list.append(createDrillTargetButton(target));
      if (omittedCount > 0) {
        const omitted = document.createElement("small");
        omitted.className = "logic-callee-omitted";
        omitted.textContent = omittedCount + " additional concrete child target" + plural(omittedCount)
          + " omitted by the display limit.";
        list.append(omitted);
      }
      section.append(header, list);
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
      const targetRole = renderedComponent
        ? "rendered component"
        : eventHandler ? "event handler" : "child function";
      button.type = "button";
      button.className = "logic-callee-button";
      button.classList.toggle("expanded", expandedInline);
      button.title = (expandedInline
        ? "Collapse " + targetRole + " · "
        : expandsInline
          ? "Attach " + targetRole + " · "
          : "Open " + targetRole + " · ")
        + target.qualifiedName;
      name.textContent = target.qualifiedName || target.name;
      meta.textContent = [
        target.sourceLocation,
        target.confidence,
        target.callsiteCount + (renderedComponent
          ? " render site"
          : eventHandler ? " event binding" : " callsite")
          + plural(target.callsiteCount)
      ].filter(Boolean).join(" · ");
      button.append(name, meta);
      button.addEventListener("click", () => {
        if (expandsInline) {
          graphContext.onExpandableTargetClick(block, target);
          return;
        }
        drillIntoFunction(target);
      });
      return button;
    }
  `;
}
