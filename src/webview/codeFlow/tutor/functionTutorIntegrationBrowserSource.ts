/** Connects Function Guide actions to shared comprehension, viewport, source, and Values controllers. */

export function getFunctionTutorIntegrationBrowserSource(): string {
  return /* js */ `
    function createFunctionTutorIntegration(logic, comprehension, valueFlowRendering, viewportController, inspector) {
      function applyGuideFocus(chapter) {
        comprehension.setGuideFocus({
          primaryBlockId: chapter?.primaryBlockId,
          blockIds: chapter?.attentionBlockIds || [],
          edgeIds: chapter?.attentionEdgeIds || []
        });
      }
      return createFunctionTutorPanel(logic, {
        onGuideFocus(chapter) { applyGuideFocus(chapter); },
        onShowGraph(chapter) {
          if (!chapter) return;
          comprehension.setLens(chapter.preferredLens || "flow");
          // "Show on Graph" is the sole Guide action allowed to change selection.
          // It deliberately keeps keyboard focus in the Guide, so reading is not interrupted.
          if (chapter.primaryBlockId) comprehension.activateBlock(chapter.primaryBlockId, false);
          applyGuideFocus(chapter);
          viewportController?.revealBlocks(chapter.attentionBlockIds?.length ? chapter.attentionBlockIds : chapter.primaryBlockId ? [chapter.primaryBlockId] : [], { announce: false });
        },
        onScenarioPreview(path) {
          comprehension.setGuideFocus({ primaryBlockId: path?.blockIds?.[0], blockIds: path?.blockIds || [], edgeIds: path?.edgeIds || [] });
        },
        onLoadInputs(seed) {
          const loadedNames = [];
          for (const input of seed.inputs) {
            if (input.value.kind === "unknown") continue;
            const parameter = logic.tutor?.parameters.find((candidate) => candidate.id === input.parameterId);
            const valueText = functionTutorScenarioInputText(input.value);
            if (!parameter || valueText === undefined) continue;
            functionLogicManualScenarioValueByName.set(parameter.name, valueText);
            loadedNames.push(parameter.name);
          }
          comprehension.setLens("values");
          valueFlowRendering?.refresh();
          // Values is an explicit handoff: preserve the Guide state while
          // placing the editable destination and its confirmation in view.
          inspector?.openInspect();
          valueFlowRendering?.focusKnownInputs(
            loadedNames,
            "Loaded " + loadedNames.length + " known input" + (loadedNames.length === 1 ? "" : "s") + " from Static Input Cases."
          );
        },
        onOpenEvidence(token) { if (token) openLogicEvidence(token); },
        onClearGuideFocus() { comprehension.clearGuideFocus(); },
        onClearScenarioPreview() { comprehension.clearGuideFocus(); }
      });
    }
  `;
}
