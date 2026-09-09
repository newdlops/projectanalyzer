/** Browser bridge for the same bounded Python machine used by neural teachers and Host quality checks. */
import { createPythonRegexRuntime, createPythonScenarioRuntime } from "../../../shared/pythonScenario";

export function getPythonScenarioBrowserSource(): string {
  return /* js */ `
    const pythonScenarioRuntime = (${createPythonScenarioRuntime.toString()})((${createPythonRegexRuntime.toString()})());
    /** Replays only parser-owned instructions and maps concrete writes into the existing Values/story UI. */
    function calculatePythonScenario(logic, suppliedInputs, scenarioIdentity) {
      const program = logic?.tutor?.program?.python;
      if (!program) return undefined;
      const rootInput = new Map(); const values = new Map();
      for (const binding of program.bindings.filter((binding) => binding.parameterId)) {
        const visibleId = scenarioIdentity?.resolveScenarioBindingId?.(binding.bindingId) || binding.bindingId;
        const value = suppliedInputs?.get(binding.bindingId) || parseFunctionLogicScenarioInput(readFunctionLogicValuePreview(visibleId), visibleId);
        rootInput.set(binding.bindingId, value);
        if (value?.kind === "known") values.set(binding.name, value.value);
      }
      const result = pythonScenarioRuntime.evaluate(program, values);
      const recordsByBlockId = new Map(); const environment = new Map(rootInput); const transitions = [];
      const occurrences = result.blockIds.map((blockId, index) => {
        const before = new Map(environment);
        const changes = result.transitions.filter((change) => change.occurrence === index).map((change) => {
          const after = createFunctionLogicScenarioKnown(change.after, [change.bindingId]);
          const previous = change.before === undefined ? createFunctionLogicScenarioUnset(createFunctionLogicScenarioReason("scenario-reason-value-unassigned"), []) : createFunctionLogicScenarioKnown(change.before, [change.bindingId]);
          environment.set(change.bindingId, after);
          return { blockId, kind: "calculation", targetBindingId: change.bindingId,
            targetName: program.bindings.find((binding) => binding.bindingId === change.bindingId)?.name || "value",
            sourceLabel: logic.tutor.program.blocks.find((block) => block.blockId === blockId)?.label || "",
            operator: "=", expression: "", before: previous, after, dependencyBindingIds: [], certainty: "exact" };
        });
        transitions.push(...changes);
        const selectedEdgeId = program.edges.find((edge) => edge.sourceBlockId === blockId && edge.targetBlockId === result.blockIds[index + 1])?.edgeId;
        const occurrence = { blockId, before, after: new Map(environment), transitions: changes, selectedEdgeId };
        recordsByBlockId.set(blockId, occurrence); return occurrence;
      });
      const terminal = result.terminal ? { kind: "return", value: functionLogicScenarioTutorReturnValue(createFunctionLogicScenarioKnown(result.terminal.value, [])) }
        : { kind: "truncated", reason: result.reason };
      return { recordsByBlockId, inputStateByBindingId: rootInput, truncated: result.status !== "verified", processed: result.blockIds.length,
        scenarioPaths: [{ blockIds: result.blockIds, edgeIds: result.edgeIds, transitions, occurrences, terminal,
          scenario: { concrete: true, decisions: result.decisions.map((decision) => ({ ...decision,
            label: logic.tutor.program.blocks.find((block) => block.blockId === decision.blockId)?.label || "", outcomeLabel: decision.outcome })), effects: [] },
          certainty: result.status === "verified" ? "exact" : "unknown", limited: result.status !== "verified" }] };
    }
  `;
}
