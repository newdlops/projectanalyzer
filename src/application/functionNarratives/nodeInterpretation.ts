/** Resumable node-task construction and Host-owned graph binding for model scenario interpretations. */
import { isFunctionNarrativeExample, type FunctionNarrativeContext, type FunctionNarrativeFlowPath, type FunctionNarrativeScenario, type FunctionNarrativeNodeDetail } from "../../shared/functionNarratives";

/** Joins analyzer-order CFG nodes to public graph IDs; edges keep their source transfer kind. */
export function bindFunctionNarrativeGraph(context: FunctionNarrativeContext, nodeIds: readonly string[],
  edges: readonly { id: string; sourceId: string; targetId: string; kind: string }[]): FunctionNarrativeContext {
  if (!context.scenarioGraph || context.scenarioGraph.nodes.length !== nodeIds.length) return context;
  const graph = context.scenarioGraph;
  return { ...context, scenarioGraph: { ...graph, nodes: graph.nodes.map((node, index) => ({ ...node,
    graphNodeId: nodeIds[index], next: node.next.map((edge) => ({ ...edge,
      graphEdgeId: edges.find((candidate) => candidate.sourceId === nodeIds[index]
        && candidate.targetId === nodeIds[edge.target] && candidate.kind === edge.outcome)?.id })) })) } };
}

/** Rich nodes are read in source order; legacy prose can reuse a uniquely cited operation. */
export function initializeFunctionNarrativeNodes(path: FunctionNarrativeFlowPath, scenario: FunctionNarrativeScenario,
  detailLevel?: FunctionNarrativeContext["detailLevel"]): void {
  if (!path.graph || !scenario.example) return;
  scenario.graph = path.graph;
  scenario.nodeDetails = [];
  const same = (left: typeof path.steps[number]["source"], right: typeof left) => left.snippetId === right.snippetId
    && left.startLine === right.startLine && left.endLine === right.endLine;
  if (detailLevel === "rich") {
    // Reuse only a source-ordered prefix with values, never an early terminal
    // guess from a later operation. Old terminal-only pages remain resumable.
    for (let index = 0; index < Math.min(2, scenario.steps.length, path.steps.length); index++) {
      const step = scenario.steps[index], target = path.steps[index];
      if (!target.graphNodeId || !step.values?.length || step.code !== target.code || !same(step.source, target.source)) break;
      if (target.writeTargets?.length === 1 && !step.values.some(value => value.name === target.writeTargets![0])) break;
      // Small models may copy a guard's prose into a later write despite
      // distinct fixed identities. Keep the valid prefix, then let bounded
      // node work explain the remaining operations with the earlier state.
      const previous = scenario.steps[index - 1];
      if (previous && previous.code !== step.code && previous.text === step.text && previous.syntax === step.syntax) break;
      scenario.nodeDetails.push({ ...step, nodeId: target.graphNodeId, occurrence: target.graphOccurrence });
    }
    return;
  }
  for (const step of scenario.steps) {
    const matches = path.steps.filter((candidate) => candidate.graphNodeId && same(candidate.source, step.source)
      && (!step.code || step.code === candidate.code));
    if (matches.length === 1 && !scenario.nodeDetails.some((detail) => detail.nodeId === matches[0].graphNodeId)) {
      scenario.nodeDetails.push({ ...step, code: matches[0].code, nodeId: matches[0].graphNodeId!, occurrence: matches[0].graphOccurrence });
    }
  }
}

/** Rich node tasks reserve budget for syntax/causality and carry bounded prior model state. */
export function createFunctionNarrativeNodeTask(batch: FunctionNarrativeContext, path: FunctionNarrativeFlowPath,
  scenario: FunctionNarrativeScenario): FunctionNarrativeContext | undefined {
  if (!scenario.example || !path.graph) return undefined;
  const explained = new Set(scenario.nodeDetails?.map((detail) => detail.nodeId + ":" + detail.occurrence));
  const targets = path.steps.filter((step) => step.graphNodeId && step.source.endLine - step.source.startLine <= 20
    && !explained.has(step.graphNodeId + ":" + step.graphOccurrence)).slice(0, batch.detailLevel === "rich" ? 2 : 3);
  if (!targets.length) return undefined;
  const priorState = new Map<string, string>();
  const writes = new Map(path.steps.map(step => [step.graphNodeId + ":" + step.graphOccurrence, new Set(step.writeTargets ?? [])]));
  // Only operations preceding the first target can supply carried state. Future
  // primary citations must not masquerade as values observed before this node.
  const firstOccurrence = targets[0].graphOccurrence ?? 0;
  for (const detail of [...(scenario.nodeDetails ?? [])].sort((left, right) => (left.occurrence ?? 0) - (right.occurrence ?? 0))) {
    if ((detail.occurrence ?? 0) >= firstOccurrence) continue;
    for (const value of detail.values ?? []) {
      // These names also occur in real source bindings. Exclude synthetic
      // predicate/return rows while retaining an exact write to such a binding.
      if (["condition", "result"].includes(value.name) && !writes.get(detail.nodeId + ":" + detail.occurrence)?.has(value.name)) continue;
      priorState.delete(value.name); priorState.set(value.name, value.after);
      while (priorState.size > 8) priorState.delete(priorState.keys().next().value!);
    }
  }
  return { ...batch, sourceFlow: { basis: "source-control-flow", paths: [path], limited: path.status === "partial" },
    nodeTask: { frame: { when: scenario.when, outcome: scenario.outcome }, example: scenario.example, targets,
      ...(batch.detailLevel === "rich" ? { reading: { explanation: scenario.explanation || scenario.steps[0].text,
        priorState: [...priorState].map(([name, value]) => ({ name, value })) } } : {}) } };
}

/** Append only ordered, independently validated task descriptions; model output never supplies node IDs. */
export function appendFunctionNarrativeNodes(task: FunctionNarrativeContext, scenario: FunctionNarrativeScenario,
  interpretation: FunctionNarrativeScenario): void {
  for (let index = 0; index < task.nodeTask!.targets.length; index++) {
    scenario.nodeDetails!.push({ ...interpretation.steps[index], nodeId: task.nodeTask!.targets[index].graphNodeId!, occurrence: task.nodeTask!.targets[index].graphOccurrence });
  }
}

/** Final prose reads bounded source operations and completed model values, never the earlier guessed paragraph/result. */
export function createFunctionNarrativeSummaryTask(batch: FunctionNarrativeContext, path: FunctionNarrativeFlowPath,
  scenario: FunctionNarrativeScenario): FunctionNarrativeContext {
  const completed: NonNullable<FunctionNarrativeContext["summaryTask"]>["completed"] = [];
  const byOccurrence = new Map((scenario.nodeDetails ?? []).map(detail => [detail.nodeId + ":" + detail.occurrence, detail]));
  let remaining = 2000, omittedValues = 0;
  for (const step of path.steps) {
    const detail = byOccurrence.get(step.graphNodeId + ":" + step.graphOccurrence);
    const record = { code: step.code, ...(step.branch ? { predicateResult: step.branch.outcome } : {}), values: detail?.values };
    const size = JSON.stringify(record).length;
    if (size > remaining) { omittedValues++; continue; }
    remaining -= size; completed.push(record);
  }
  const last = path.steps.at(-1), terminal = last && byOccurrence.get(last.graphNodeId + ":" + last.graphOccurrence);
  let resultJson: string | undefined = path.status === "partial" ? "null" : undefined;
  if (!resultJson && last?.kind === "return") {
    // This reads an already validated MODEL value, not source evaluation. A
    // complex return expression cannot borrow the unchanged local's value.
    const binding = /^return\s+([\p{L}_$][\p{L}\p{N}_$]*)\s*;?$/u.exec(last.code)?.[1];
    const value = terminal?.values?.find(value => value.name === "result")
      ?? terminal?.values?.find(value => value.name === binding);
    if (value) {
      try {
        const parsed = JSON.parse(value.after);
        const candidate = JSON.stringify(parsed);
        if (isFunctionNarrativeExample({ inputs: [{ name: "result", json: candidate }], result: candidate })) resultJson = candidate;
      } catch { /* Unknown/descriptive model values stay unknown until final synthesis. */ }
    }
  }
  const { nodeTask: _nodeTask, ...context } = batch;
  return { ...context, sourceFlow: { basis: "source-control-flow", paths: [path], limited: path.status === "partial" },
    summaryTask: { inputs: scenario.example!.inputs, steps: scenario.steps, resultJson, completed, omittedValues } };
}

/** Restores source order and uses model purpose/result text for structural entry/exit nodes. */
export function finalizeFunctionNarrativeNodes(batch: FunctionNarrativeContext, path: FunctionNarrativeFlowPath,
  scenario: FunctionNarrativeScenario, summary: string): void {
  if (!scenario.graph || !scenario.example || !scenario.nodeDetails) return;
  const detailById = new Map(scenario.nodeDetails.map((detail) => [detail.nodeId + ":" + detail.occurrence, detail]));
  const source = batch.snippets.find((snippet) => snippet.role === "function")!;
  const entryId = scenario.graph.nodeIds[0];
  if (entryId && !detailById.has(entryId + ":0")) detailById.set(entryId + ":0", { nodeId: entryId, occurrence: 0, text: summary,
    reason: scenario.explanation, ...(batch.detailLevel !== "rich" ? { effect: scenario.steps[0]?.effect } : {}),
    source: { snippetId: source.id, startLine: source.startLine, endLine: source.startLine },
    values: scenario.example.inputs.slice(0, 4).map((input) => ({ name: input.name, before: preview(input.json), after: preview(input.json) })) });
  const lastId = scenario.graph.nodeIds.at(-1);
  const lastOccurrence = scenario.graph.nodeIds.length - 1;
  // A partial frontier is not a function exit: never label missing/unsupported operations with a returned result.
  if (path.status === "source-terminal" && lastId && !detailById.has(lastId + ":" + lastOccurrence)) {
    const last = scenario.nodeDetails.at(-1) || scenario.steps.at(-1)!;
    detailById.set(lastId + ":" + lastOccurrence, { nodeId: lastId, occurrence: lastOccurrence, text: last.effect || last.text, reason: last.reason, effect: last.effect,
      source: path.steps.at(-1)?.source || last.source, values: [{ name: "result", before: preview(scenario.example.result), after: preview(scenario.example.result) }] });
  }
  scenario.nodeDetails = scenario.graph.nodeIds.flatMap((id, index) => detailById.get(id + ":" + index) ?? []) as FunctionNarrativeNodeDetail[];
  // The paragraph's narrow evidence and selected-node reading must share the
  // final source-ordered interpretation, including its latest example values.
  if (batch.detailLevel === "rich") scenario.steps = scenario.steps.map((step) => {
    const matches = scenario.nodeDetails!.filter((detail) => detail.code === step.code
      && detail.source.snippetId === step.source.snippetId && detail.source.startLine === step.source.startLine
      && detail.source.endLine === step.source.endLine);
    if (matches.length !== 1) return step;
    const { nodeId: _nodeId, occurrence: _occurrence, ...reading } = matches[0];
    return reading;
  });
}
function preview(value: string): string { return value.length > 240 ? value.slice(0, 239) + "…" : value; }
