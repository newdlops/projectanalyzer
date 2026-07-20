/**
 * Browser-only Function Logic value-flow selector, access rows, and SVG
 * overlay. One binding is shown at a time so definition-to-use arrows remain
 * readable beside the independently rendered control-flow edges.
 */

/** Returns CSP-safe value-flow browser helpers. */
export function getFunctionLogicDataFlowBrowserSource(): string {
  return /* js */ `
    const MAX_LOGIC_VALUE_ACCESS_ROWS = 8;
    let functionLogicValueFlowSessionKey = "";
    let functionLogicSelectedValueBindingId = "";

    /** Keeps one selected binding while the same root graph is relaid out. */
    function readFunctionLogicValueFlowSelection(sessionKey, bindings, flows) {
      const bindingIds = new Set(bindings.map((binding) => binding.id));
      if (functionLogicValueFlowSessionKey !== sessionKey) {
        functionLogicValueFlowSessionKey = sessionKey;
        functionLogicSelectedValueBindingId = firstFlowBindingId(bindings, flows);
      } else if (!bindingIds.has(functionLogicSelectedValueBindingId)) {
        functionLogicSelectedValueBindingId = firstFlowBindingId(bindings, flows);
      }
      return functionLogicSelectedValueBindingId;
    }

    /** Prefers a binding with a real definition-to-use relation. */
    function firstFlowBindingId(bindings, flows) {
      const flowBindingIds = new Set(flows.map((flow) => flow.bindingId));
      return bindings.find((binding) => flowBindingIds.has(binding.id))?.id
        || bindings[0]?.id
        || "";
    }

    /** Builds the selector and hidden-per-binding SVG paths behind graph nodes. */
    function createFunctionLogicValueFlowRendering(
      logic,
      nodeLayoutsByBlockId,
      nodeButtonsById,
      sessionKey
    ) {
      const bindings = logic.valueBindings || [];
      const flows = logic.valueFlows || [];
      if (bindings.length === 0) return undefined;
      const bindingById = new Map(bindings.map((binding) => [binding.id, binding]));
      const blockById = new Map(logic.blocks.map((block) => [block.id, block]));
      const svg = createLogicSvgElement("svg");
      const toolbar = document.createElement("section");
      const header = document.createElement("div");
      const title = document.createElement("strong");
      const hint = document.createElement("span");
      const buttons = document.createElement("div");
      const paths = [];
      const buttonByBindingId = new Map();
      let selectedBindingId = readFunctionLogicValueFlowSelection(
        sessionKey,
        bindings,
        flows
      );

      svg.setAttribute("class", "logic-data-flow-layer");
      svg.setAttribute("width", String(logic.layout.width));
      svg.setAttribute("height", String(logic.layout.height));
      svg.setAttribute("viewBox", "0 0 " + logic.layout.width + " " + logic.layout.height);
      svg.setAttribute("aria-hidden", "true");
      svg.append(createFunctionLogicValueFlowArrowMarker());
      for (let index = 0; index < flows.length; index += 1) {
        const flow = flows[index];
        const source = nodeLayoutsByBlockId.get(flow.sourceBlockId);
        const target = nodeLayoutsByBlockId.get(flow.targetBlockId);
        if (!source || !target || !bindingById.has(flow.bindingId)) continue;
        const path = createLogicSvgElement("path");
        path.setAttribute(
          "class",
          "logic-data-flow-edge" + (flow.confidence === "inferred" ? " inferred" : "")
        );
        path.setAttribute("d", createFunctionLogicValueFlowPath(source, target, index));
        path.setAttribute("marker-end", "url(#logic-data-flow-arrow)");
        svg.append(path);
        paths.push({ flow, path });
      }

      toolbar.className = "logic-data-flow-toolbar";
      toolbar.setAttribute("aria-label", "Function parameter, local, and constant flows");
      header.className = "logic-data-flow-header";
      title.textContent = "Values in this function";
      hint.textContent = "Choose one binding to trace possible definition → use flow.";
      buttons.className = "logic-data-flow-bindings";
      header.append(title, hint);
      for (const binding of bindings) {
        const button = document.createElement("button");
        const accessCount = logic.blocks.reduce((count, block) =>
          count + (block.valueAccesses || []).filter((access) =>
            access.bindingId === binding.id && access.access !== "define"
          ).length, 0);
        button.type = "button";
        button.className = "logic-data-binding " + binding.kind
          + (binding.confidence === "inferred" ? " inferred" : "");
        button.textContent = formatFunctionLogicBindingKind(binding.kind)
          + " " + binding.name + " · " + accessCount
          + " access" + (accessCount === 1 ? "" : "es");
        button.title = "Trace " + binding.kind + " " + binding.name;
        button.setAttribute("aria-pressed", binding.id === selectedBindingId ? "true" : "false");
        button.addEventListener("click", () => {
          selectedBindingId = selectedBindingId === binding.id ? "" : binding.id;
          functionLogicValueFlowSessionKey = sessionKey;
          functionLogicSelectedValueBindingId = selectedBindingId;
          refresh();
        });
        buttons.append(button);
        buttonByBindingId.set(binding.id, button);
      }
      toolbar.append(header, buttons);

      /** Synchronizes selected binding, branch reachability, and node emphasis. */
      function refresh() {
        for (const [bindingId, button] of buttonByBindingId) {
          const selected = bindingId === selectedBindingId;
          button.classList.toggle("selected", selected);
          button.setAttribute("aria-pressed", selected ? "true" : "false");
        }
        for (const [blockId, node] of nodeButtonsById) {
          const block = blockById.get(blockId);
          const related = Boolean(selectedBindingId && (block?.valueAccesses || []).some(
            (access) => access.bindingId === selectedBindingId
          ));
          node.classList.toggle("data-flow-related", related);
          node.classList.toggle(
            "data-flow-definition",
            related && bindingById.get(selectedBindingId)?.definitionBlockId === blockId
          );
        }
        for (const record of paths) {
          const selected = record.flow.bindingId === selectedBindingId;
          const sourceDimmed = nodeButtonsById.get(record.flow.sourceBlockId)
            ?.classList.contains("choice-dimmed");
          const targetDimmed = nodeButtonsById.get(record.flow.targetBlockId)
            ?.classList.contains("choice-dimmed");
          record.path.classList.toggle("selected", selected);
          record.path.classList.toggle(
            "choice-dimmed",
            selected && Boolean(sourceDimmed || targetDimmed)
          );
        }
      }

      return { svg, toolbar, refresh };
    }

    /** Creates a distinct arrowhead for the optional value-flow overlay. */
    function createFunctionLogicValueFlowArrowMarker() {
      const defs = createLogicSvgElement("defs");
      const marker = createLogicSvgElement("marker");
      const arrow = createLogicSvgElement("path");
      marker.setAttribute("id", "logic-data-flow-arrow");
      marker.setAttribute("viewBox", "0 0 10 10");
      marker.setAttribute("refX", "9");
      marker.setAttribute("refY", "5");
      marker.setAttribute("markerWidth", "7");
      marker.setAttribute("markerHeight", "7");
      marker.setAttribute("orient", "auto-start-reverse");
      arrow.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
      arrow.setAttribute("class", "logic-data-flow-arrow-head");
      marker.append(arrow);
      defs.append(marker);
      return defs;
    }

    /** Routes forward values vertically and loop/branch-back values around the right side. */
    function createFunctionLogicValueFlowPath(source, target, index) {
      const sourceCenterX = source.x + source.width / 2;
      const targetCenterX = target.x + target.width / 2;
      if (source.blockId === target.blockId) {
        const right = source.x + source.width;
        const channel = right + 22 + (index % 4) * 7;
        const top = source.y + source.height * 0.35;
        const bottom = source.y + source.height * 0.7;
        return "M " + right + " " + top
          + " C " + channel + " " + top + ", " + channel + " " + bottom
          + ", " + right + " " + bottom;
      }
      if (target.y >= source.y + source.height) {
        const sourceY = source.y + source.height;
        const targetY = target.y;
        const middleY = (sourceY + targetY) / 2;
        return "M " + sourceCenterX + " " + sourceY
          + " C " + sourceCenterX + " " + middleY + ", "
          + targetCenterX + " " + middleY + ", "
          + targetCenterX + " " + targetY;
      }
      const sourceX = source.x + source.width;
      const targetX = target.x + target.width;
      const sourceY = source.y + source.height / 2;
      const targetY = target.y + target.height / 2;
      const channelX = Math.max(sourceX, targetX) + 24 + (index % 5) * 7;
      return "M " + sourceX + " " + sourceY
        + " C " + channelX + " " + sourceY + ", "
        + channelX + " " + targetY + ", "
        + targetX + " " + targetY;
    }

    /** Renders compact value-use rows shared by graph nodes and detail panels. */
    function createFunctionLogicValueAccessList(accesses, className) {
      const list = document.createElement("span");
      list.className = className;
      for (const access of accesses.slice(0, MAX_LOGIC_VALUE_ACCESS_ROWS)) {
        const row = document.createElement("span");
        const role = document.createElement("span");
        const name = document.createElement("code");
        row.className = "logic-value-access " + access.bindingKind
          + (access.confidence === "inferred" ? " inferred" : "");
        row.title = access.confidence === "inferred"
          ? "Static naming convention; verify this binding in source"
          : "Source syntax proves this lexical binding access";
        role.className = "logic-value-access-role";
        role.textContent = formatFunctionLogicBindingKind(access.bindingKind)
          + " · " + formatFunctionLogicValueAccess(access.access);
        name.textContent = access.name;
        row.append(role, name);
        list.append(row);
      }
      if (accesses.length > MAX_LOGIC_VALUE_ACCESS_ROWS) {
        const omitted = document.createElement("span");
        omitted.className = "logic-value-access omitted";
        omitted.textContent = "+" + (accesses.length - MAX_LOGIC_VALUE_ACCESS_ROWS)
          + " more bindings; use the value selector above";
        list.append(omitted);
      }
      return list;
    }

    /** Produces concise non-color binding kind labels. */
    function formatFunctionLogicBindingKind(kind) {
      if (kind === "parameter") return "PARAM";
      if (kind === "constant") return "CONST";
      return "LOCAL";
    }

    /** Produces concise non-color access labels. */
    function formatFunctionLogicValueAccess(access) {
      if (access === "readwrite") return "READ/WRITE";
      return String(access || "read").toUpperCase();
    }
  `;
}
