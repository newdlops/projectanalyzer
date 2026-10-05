/** Resumable node-task construction and Host-owned graph binding for model scenario interpretations. */
import type { FunctionNarrativeContext, FunctionNarrativeFlowPath, FunctionNarrativeScenario, FunctionNarrativeNodeDetail } from "../../shared/functionNarratives";

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

/** Reuses primary descriptions only when a narrow citation identifies exactly one source node. */
export function initializeFunctionNarrativeNodes(path: FunctionNarrativeFlowPath, scenario: FunctionNarrativeScenario): void {
  if (!path.graph || !scenario.example) return;
  scenario.graph = path.graph;
  scenario.nodeDetails = [];
  const same = (left: typeof path.steps[number]["source"], right: typeof left) => left.snippetId === right.snippetId
    && left.startLine === right.startLine && left.endLine === right.endLine;
  for (const step of scenario.steps) {
    const matches = path.steps.filter((candidate) => candidate.graphNodeId && same(candidate.source, step.source));
    if (matches.length === 1 && !scenario.nodeDetails.some((detail) => detail.nodeId === matches[0].graphNodeId)) {
      scenario.nodeDetails.push({ ...step, nodeId: matches[0].graphNodeId!, occurrence: matches[0].graphOccurrence });
    }
  }
}

/** At most three outstanding source nodes per inference, with the scenario input set held fixed. */
export function createFunctionNarrativeNodeTask(batch: FunctionNarrativeContext, path: FunctionNarrativeFlowPath,
  scenario: FunctionNarrativeScenario): FunctionNarrativeContext | undefined {
  if (!scenario.example || !path.graph) return undefined;
  const explained = new Set(scenario.nodeDetails?.map((detail) => detail.nodeId + ":" + detail.occurrence));
  const targets = path.steps.filter((step) => step.graphNodeId && step.source.endLine - step.source.startLine <= 20
    && !explained.has(step.graphNodeId + ":" + step.graphOccurrence)).slice(0, 3);
  if (!targets.length) return undefined;
  return { ...batch, sourceFlow: { basis: "source-control-flow", paths: [path], limited: path.status === "partial" },
    nodeTask: { frame: { when: scenario.when, outcome: scenario.outcome }, example: scenario.example, targets } };
}

/** Append only ordered, independently validated task descriptions; model output never supplies node IDs. */
export function appendFunctionNarrativeNodes(task: FunctionNarrativeContext, scenario: FunctionNarrativeScenario,
  interpretation: FunctionNarrativeScenario): void {
  for (let index = 0; index < task.nodeTask!.targets.length; index++) {
    scenario.nodeDetails!.push({ ...interpretation.steps[index], nodeId: task.nodeTask!.targets[index].graphNodeId!, occurrence: task.nodeTask!.targets[index].graphOccurrence });
  }
}

/** Restores source order and uses model purpose/result text for structural entry/exit nodes. */
export function finalizeFunctionNarrativeNodes(batch: FunctionNarrativeContext, path: FunctionNarrativeFlowPath,
  scenario: FunctionNarrativeScenario, summary: string): void {
  if (!scenario.graph || !scenario.example || !scenario.nodeDetails) return;
  const detailById = new Map(scenario.nodeDetails.map((detail) => [detail.nodeId + ":" + detail.occurrence, detail]));
  const source = batch.snippets.find((snippet) => snippet.role === "function")!;
  const entryId = scenario.graph.nodeIds[0];
  if (entryId && !detailById.has(entryId + ":0")) detailById.set(entryId + ":0", { nodeId: entryId, occurrence: 0, text: summary,
    reason: scenario.explanation, effect: scenario.steps[0]?.effect,
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
}
function preview(value: string): string { return value.length > 240 ? value.slice(0, 239) + "…" : value; }
