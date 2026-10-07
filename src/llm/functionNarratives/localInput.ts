/** Model-only route worksheets distinguish reaching a statement from the Boolean decision it makes. */
import type { FunctionNarrativeContext, FunctionNarrativeFlowStep } from "../../shared/functionNarratives";
import { getFunctionNarrativeExampleConstraints, getPrimitiveWorksheetAnalysis, numberFunctionNarrativeContext } from "../../application/functionNarratives";

/** Host context and validators retain the complete route; the model gets bounded current-operation evidence. */
export function buildLocalNarrativeInput(context: FunctionNarrativeContext, language: "ko" | "en" = "en"): Record<string, unknown> {
  const numbered = numberFunctionNarrativeContext(context) as Record<string, any>;
  const paths = context.sourceFlow?.paths ?? [];
  if (context.summaryTask) numbered.summaryTask = { inputs: context.summaryTask.inputs.map(input => ({ name: input.name, value: JSON.parse(input.json) })),
    ...(context.summaryTask.knownFunctionSummary ? { knownFunctionSummary: context.summaryTask.knownFunctionSummary } : {}),
    ...(context.summaryTask.resultJson !== undefined ? { resultValue: JSON.parse(context.summaryTask.resultJson) } : {}),
    completed: context.summaryTask.completed, omittedValues: context.summaryTask.omittedValues,
    // The wire omits fixed output fields. Keep their independently matched source
    // facts visible as task data so free prose can use the same concrete trace.
    sourceVerifiedAnalysis: getPrimitiveWorksheetAnalysis(context, language) };
  const clean = (step: FunctionNarrativeFlowStep, index: number) => ({ ordinal: index + 1, kind: step.kind, code: step.code,
    reachedOnSelectedSourceRoute: true, ...(step.loweredPredicate ? { loweredPredicate: step.loweredPredicate } : {}),
    ...(step.writeTargets?.length ? { writeTargets: step.writeTargets } : {}),
    ...(step.branch ? { predicateResult: ["true", "false"].includes(step.branch.outcome) ? step.branch.outcome === "true" : step.branch.outcome, confidence: step.branch.confidence,
      ...(step.branch.inputCondition ? { requiredInput: step.branch.inputCondition } : {}) } : {}) });
  if (context.nodeTask) {
    const path = paths[0];
    const targets = context.nodeTask.targets;
    const first = path?.steps.findIndex(step => step.graphNodeId === targets[0]?.graphNodeId && step.graphOccurrence === targets[0]?.graphOccurrence) ?? -1;
    const end = first < 0 ? 0 : first + targets.length;
    // A speculative primary paragraph/result must not seed later node facts.
    // Preserve them in the Host contract while sending only inputs and earlier
    // model values to this focused interpretation request.
    numbered.nodeTask = { frame: context.nodeTask.frame, example: { inputs: context.nodeTask.example.inputs },
      reading: { priorState: context.nodeTask.reading?.priorState ?? [] } };
    numbered.valueFacts = context.valueFacts?.filter(fact => targets.some(target => target.source.snippetId === fact.source.snippetId
      && target.source.startLine <= fact.source.endLine && target.source.endLine >= fact.source.startLine));
    // Earlier guards are route selections. A false guard can lead to a reached
    // write; it does not mean that every later statement is skipped.
    numbered.selectedRoute = { status: path?.status, confidence: path?.confidence,
      precedingDecisions: (path?.steps.slice(0, Math.max(0, first)) ?? []).flatMap((step, index) => step.branch ? [clean(step, index)] : []),
      targets: targets.map((step, index) => ({ ...clean(step, Math.max(0, first) + index),
        nextReachedOperation: path?.steps[Math.max(0, first) + index + 1]?.code ?? null })),
      remainingOperations: Math.max(0, (path?.steps.length ?? 0) - end) };
    // The complete function excerpts still describe syntax. Future route steps
    // must not masquerade as state that exists before this node task.
    delete numbered.sourceFlow;
  } else {
    numbered.selectedRoutes = paths.map(path => ({ status: path.status, confidence: path.confidence,
      operations: path.steps.map((step, index) => ({ ...clean(step, index), nextReachedOperation: path.steps[index + 1]?.code ?? null })) }));
    delete numbered.sourceFlow;
    if (context.parameters) numbered.exampleSlots = paths.map((_path, index) => {
      const constraints = getFunctionNarrativeExampleConstraints(context, index);
      return context.parameters!.map(parameter => {
        const boolean = constraints.booleans.find(input => input.name === parameter.name);
        return { name: parameter.name, type: parameter.type,
          ...(boolean ? { fixedValue: boolean.json === "true" } : constraints.nullInputs.includes(parameter.name) ? { fixedValue: null } : {}),
          ...(constraints.nonNullInputs.includes(parameter.name) ? { nonNull: true } : {}) };
      });
    });
  }
  return numbered;
}
