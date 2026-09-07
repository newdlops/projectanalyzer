/** Resolves Scenario parameter inputs through existing opaque binding adapters. */

/** Returns browser-only input handoff helpers shared by Guide and scenario playback. */
export function getFunctionLogicScenarioInputsBrowserSource(): string {
  return /* js */ `
    /** Resolves Tutor parameter identities through declared opaque binding IDs only. */
    function readFunctionLogicScenarioSeedInputs(seed, tutor, bindingsById, identity) {
      const bindingByParameterId = new Map((tutor?.parameters || []).filter((parameter) => parameter.bindingId).map((parameter) => [parameter.id, parameter.bindingId]));
      for (const binding of tutor?.program?.bindings || []) if (binding.parameterId && binding.bindingId && !bindingByParameterId.has(binding.parameterId)) bindingByParameterId.set(binding.parameterId, binding.bindingId);
      const values = new Map();
      for (const input of seed?.inputs || []) {
        const bindingId = bindingByParameterId.get(input.parameterId); const value = functionTutorScenarioInputText(input.value);
        const visibleBindingId = identity?.resolveScenarioBindingId?.(bindingId) || (bindingsById.has(bindingId) ? bindingId : undefined);
        if (visibleBindingId && value !== undefined && bindingsById.has(visibleBindingId)) values.set(visibleBindingId, value);
      }
      return values;
    }
  `;
}
