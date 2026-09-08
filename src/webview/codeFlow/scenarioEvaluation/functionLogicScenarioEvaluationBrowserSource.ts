/**
 * Shared browser-only bridge from Tutor seed payloads to the bounded opaque
 * program-bundle machine. It exposes root-only stories to Workspace while the
 * evaluator retains child calls solely as return-value computation.
 */
export function getFunctionLogicScenarioEvaluationBrowserSource(): string {
  return /* js */ `
    /** Runs a Tutor seed through the same iterative opaque bundle machine as Values. */
    function functionTutorRunProgramBundleScenario(tutor, seed) {
      if (!tutor?.programBundle?.programs?.length) return undefined;
      const root = tutor.programBundle.programs.find((program) => program.id === tutor.programBundle.rootProgramId);
      if (!root) return undefined;
      const bindingByParameter = new Map((root.bindings || []).filter((binding) => binding.parameterId).map((binding) => [binding.parameterId, binding.bindingId]));
      const suppliedInputs = new Map();
      for (const input of seed?.inputs || []) {
        const bindingId = bindingByParameter.get(input.parameterId);
        if (bindingId) suppliedInputs.set(bindingId, functionTutorScenarioStaticState(input.value));
      }
      const logic = { valueBindings: (root.bindings || []).filter((binding) => binding.parameterId).map((binding) => ({ id: binding.bindingId, name: binding.name, kind: "parameter", confidence: binding.certainty })), tutor };
      return calculateFunctionLogicScenarioProgramBundle(logic, new Map(), new Map(), suppliedInputs).scenarioPaths || [];
    }

    /** Converts protocol static values without evaluating source text or display names. */
    function functionTutorScenarioStaticState(value) {
      return functionLogicScenarioProgramLiteral(value);
    }
  `;
}
