/**
 * Browser-only Function Logic node selection and detail-panel rendering.
 * Evidence, drill targets, and interactive branch choices share this one
 * selection surface without adding responsibilities to graph construction.
 */

/** Returns CSP-safe selection and detail rendering helpers. */
export function getFunctionLogicSelectionBrowserSource(): string {
  return /* js */ `
    /** Synchronizes graph selection and rebuilds the evidence detail panel. */
    function selectLogicGraphNode(
      blockId,
      nodeButtonsById,
      blocksById,
      outgoingBySourceId,
      connectedEdgeIdsByBlockId,
      edgeElementsById,
      inspector,
      moveFocus,
      graphContext,
      onBranchChoice,
      onConditionCase,
      branchChoices
    ) {
      const selected = blocksById.get(blockId);
      if (!selected) return;
      if (graphContext && graphContext.onSelectionChanged) {
        graphContext.onSelectionChanged(blockId);
      } else {
        state.selectedLogicBlockId = blockId;
      }
      for (const [candidateId, button] of nodeButtonsById) {
        const active = candidateId === blockId;
        button.classList.toggle("selected", active);
        button.setAttribute("aria-pressed", active ? "true" : "false");
      }
      const connectedEdgeIds = new Set(connectedEdgeIdsByBlockId.get(blockId) || []);
      for (const [edgeId, edgeElements] of edgeElementsById) {
        const active = connectedEdgeIds.has(edgeId);
        edgeElements.path.classList.toggle("active", active);
        edgeElements.path.classList.toggle("dimmed", !active);
        edgeElements.label.classList.toggle("active", active);
        edgeElements.label.classList.toggle("dimmed", !active);
      }
      renderLogicSelection(
        selected,
        outgoingBySourceId.get(blockId) || [],
        blocksById,
        inspector.selectionPanel,
        graphContext,
        onBranchChoice,
        onConditionCase,
        branchChoices
      );
      inspector.setSelection(selected);
      if (moveFocus) {
        inspector.open();
        nodeButtonsById.get(blockId)?.focus();
      }
    }

    /** Shows complete source meaning and transfers for the selected graph node. */
    function renderLogicSelection(
      block,
      outgoing,
      blocksById,
      panel,
      graphContext,
      onBranchChoice,
      onConditionCase,
      branchChoices
    ) {
      clearElement(panel);
      const header = document.createElement("div");
      const name = document.createElement("strong");
      const confidence = createBadge(block.confidence, "confidence " + block.confidence);
      const detail = document.createElement("p");
      const meta = document.createElement("div");
      header.className = "logic-selection-header";
      mountCodeSnippet(name, block.label);
      detail.className = "logic-selection-detail";
      detail.textContent = block.detail;
      meta.className = "logic-selection-meta";
      meta.textContent = [block.branchLabel, block.sourceLocation].filter(Boolean).join(" · ");
      header.append(createBadge(formatLogicKind(block.kind), "logic-kind " + block.kind), name, confidence);
      panel.append(header, detail);
      if (meta.textContent) panel.append(meta);
      const choiceSummary = createFunctionLogicBranchChoiceSummary(
        branchChoices,
        () => onBranchChoice(undefined)
      );
      if (choiceSummary) panel.append(choiceSummary);

      if (block.conditionTable) {
        panel.append(createFunctionLogicConditionCaseTable(
          block.conditionTable,
          branchChoices,
          (row) => onConditionCase(row, block.id)
        ));
      }

      if (block.valueChanges && block.valueChanges.length > 0) {
        const changes = document.createElement("div");
        const title = document.createElement("strong");
        changes.className = "logic-selection-value-section";
        title.textContent = "Values changed here";
        changes.append(
          title,
          createLogicValueChangeList(block.valueChanges, "logic-selection-value-changes")
        );
        panel.append(changes);
      }

      if (block.valueAccesses && block.valueAccesses.length > 0) {
        const accesses = document.createElement("div");
        const title = document.createElement("strong");
        accesses.className = "logic-selection-access-section";
        title.textContent = "Parameters, locals, and constants here";
        accesses.append(
          title,
          createFunctionLogicValueAccessList(
            block.valueAccesses,
            "logic-selection-value-accesses"
          )
        );
        panel.append(accesses);
      }

      if (outgoing.length > 0) {
        const transfers = document.createElement("div");
        transfers.className = "logic-selection-transfers";
        for (const edge of outgoing) {
          const target = blocksById.get(edge.targetId);
          transfers.append(isFunctionLogicBranchChoiceEdge(edge)
            ? createFunctionLogicBranchChoiceButton(
                edge,
                target,
                branchChoices,
                onBranchChoice
              )
            : createBadge(
                formatLogicEdge(edge) + (target ? " → " + completeTargetLabel(target) : ""),
                "logic-transfer " + edge.kind
                  + (edge.relation ? " " + edge.relation : "")
                  + (edge.confidence === "inferred" ? " inferred" : "")
              ));
        }
        panel.append(transfers);
      }

      if (block.drillTargets && block.drillTargets.length > 0) {
        const callees = document.createElement("div");
        const title = document.createElement("strong");
        callees.className = "logic-selection-callees";
        title.textContent = block.drillTargets.some((target) => target.relation === "event")
          ? "Inspect separately dispatched event handlers"
          : block.drillTargets.some((target) => target.relation === "render")
            ? "Continue into rendered or called code"
            : "Continue into called code";
        callees.append(title);
        for (const target of block.drillTargets) {
          callees.append(createDrillTargetButton(target, block, graphContext));
        }
        panel.append(callees);
      }

      if (block.evidenceToken) {
        const source = document.createElement("button");
        source.type = "button";
        source.className = "logic-button logic-open-statement";
        source.textContent = "Open statement";
        source.title = "Open statement" + (block.sourceLocation ? " · " + block.sourceLocation : "");
        source.addEventListener("click", () => openLogicEvidence(block.evidenceToken));
        panel.append(source);
      }
    }

    /** Renders a bounded, static short-circuit case table for one root condition. */
    function createFunctionLogicConditionCaseTable(table, choices, onConditionCase) {
      const section = document.createElement("section");
      const heading = document.createElement("strong");
      const expression = document.createElement("code");
      const matrix = document.createElement("div");
      section.className = "logic-condition-cases";
      heading.textContent = "Condition cases";
      expression.className = "logic-condition-expression";
      expression.textContent = table.expression;
      matrix.className = "logic-condition-case-table";
      matrix.style.setProperty("--logic-condition-columns", String(table.columns.length));
      const header = document.createElement("div");
      header.className = "logic-condition-case-row logic-condition-case-header";
      for (const column of table.columns) {
        const cell = document.createElement("span");
        cell.textContent = column.expression;
        cell.title = column.expression;
        header.append(cell);
      }
      header.append(createConditionCaseCell("Result"), createConditionCaseCell("Next"));
      matrix.append(header);
      for (const row of table.rows) {
        const button = document.createElement("button");
        const selected = row.choiceEdgeIds.every((edgeId) =>
          [...choices.values()].includes(edgeId)
        );
        button.type = "button";
        button.className = "logic-condition-case-row" + (selected ? " selected" : "");
        button.title = (selected ? "Clear" : "Apply") + " condition case · " + table.expression;
        button.setAttribute("aria-pressed", selected ? "true" : "false");
        for (const value of row.values) {
          button.append(createConditionCaseCell(value === "skipped" ? "—" : value));
        }
        button.append(createConditionCaseCell(row.result), createConditionCaseCell(row.targetLabel));
        button.addEventListener("click", () => onConditionCase(row));
        matrix.append(button);
      }
      section.append(heading, expression, matrix);
      if (table.omittedCaseCount > 0) {
        const omitted = document.createElement("p");
        omitted.className = "logic-condition-case-omitted";
        omitted.textContent = table.omittedCaseCount + " additional cases are hidden.";
        section.append(omitted);
      }
      return section;
    }

    /** Creates one bounded table cell without interpreting source expressions as HTML. */
    function createConditionCaseCell(text) {
      const cell = document.createElement("span");
      cell.textContent = text;
      return cell;
    }
  `;
}
