/** Connects Function Guide actions to shared comprehension, viewport, source, and Values controllers. */

export function getFunctionTutorIntegrationBrowserSource(): string {
  return /* js */ `
    function createFunctionTutorIntegration(logic, comprehension, valueFlowRendering, viewportController, inspector, scenarioWorkspace, identity) {
      const visibleBlockId = (id) => identity?.resolveScenarioBlockId?.(id) || id;
      const visibleEdgeId = (id) => identity?.resolveScenarioEdgeId?.(id) || id;
      function applyGuideFocus(chapter) {
        comprehension.setGuideFocus({
          primaryBlockId: chapter?.primaryBlockId && visibleBlockId(chapter.primaryBlockId),
          blockIds: (chapter?.attentionBlockIds || []).map(visibleBlockId),
          edgeIds: (chapter?.attentionEdgeIds || []).map(visibleEdgeId)
        });
      }
      const panel = createFunctionTutorPanel(logic, {
        scenarioWorkspace,
        readNarrativeNode() { const id=comprehension.getState().selectedBlockId; return id && (identity?.resolveSourceScenarioBlockId?.(id) || id); },
        subscribeNarrativeNode(listener) { return comprehension.subscribe(listener); },
        onNarrativeScenario(scenario, options) {
          if (scenario.graph) applyGuideFocus({ primaryBlockId: scenario.graph.nodeIds[0], attentionBlockIds: scenario.graph.nodeIds, attentionEdgeIds: scenario.graph.edgeIds });
          if (scenario.example && options.apply !== "none") {
            valueFlowRendering?.loadKnownInputs(new Map(scenario.example.inputs.map((input) => [input.name, input.json])), { onlyEmpty: options.apply === "empty" });
            valueFlowRendering?.refresh();
          }
        },
        onOpenNarrativeValues(example) {
          inspector?.openInspect("values");
          valueFlowRendering?.focusKnownInputs(example.inputs.map((input) => input.name), { key: "narrative-example-loaded" });
        },
        onGuideFocus(chapter) { applyGuideFocus(chapter); },
        onShowGraph(chapter) {
          if (!chapter) return;
          // "Show on Graph" is the sole Guide action allowed to change selection.
          // It deliberately keeps keyboard focus in the Guide, so reading is not interrupted.
          if (chapter.primaryBlockId) comprehension.activateBlock(visibleBlockId(chapter.primaryBlockId), false);
          applyGuideFocus(chapter);
          viewportController?.revealBlocks((chapter.attentionBlockIds?.length ? chapter.attentionBlockIds : chapter.primaryBlockId ? [chapter.primaryBlockId] : []).map(visibleBlockId), { announce: false });
        },
        onScenarioPreview(path) {
          applyGuideFocus({ primaryBlockId: path?.blockIds?.[0], attentionBlockIds: path?.blockIds || [], attentionEdgeIds: path?.edgeIds || [] });
        },
        onLoadInputs(seed) {
          const loadedNames = [];
          const loadedValuesByName = new Map();
          for (const input of seed.inputs) {
            if (input.value.kind === "unknown") continue;
            const parameter = logic.tutor?.parameters.find((candidate) => candidate.id === input.parameterId);
            const valueText = functionTutorScenarioInputText(input.value);
            if (!parameter || valueText === undefined) continue;
            functionLogicManualScenarioValueByName.set(parameter.name, valueText);
            loadedValuesByName.set(parameter.name, valueText);
            loadedNames.push(parameter.name);
          }
          valueFlowRendering?.loadKnownInputs(loadedValuesByName);
          valueFlowRendering?.refresh();
          // Preserve Guide state while
          // placing the editable destination and its confirmation in view.
          inspector?.openInspect("values");
          valueFlowRendering?.focusKnownInputs(
            loadedNames,
            { key: "loaded-static-inputs", params: { count: loadedNames.length } }
          );
        },
        onOpenEvidence(token) { if (token) openLogicEvidence(token); },
        onRefreshFunction(token) { if (token) refreshFunctionNarrativeContext(token); },
        onClearGuideFocus() { comprehension.clearGuideFocus(); },
        onClearScenarioPreview() { comprehension.clearGuideFocus(); }
      });
      valueFlowRendering?.setNarrativeGenerator(() => { inspector?.openGuide(); panel?.generateNarratives(); });
      return panel;
    }
  `;
}
