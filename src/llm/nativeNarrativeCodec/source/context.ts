/** Complete root source DTO ownership and Host occurrence binding. No graph discovery, source parsing/evaluation or answer/prose port is invoked. */
import { inputOptions, requireInput } from "../input/data";
import { numberNativeSourceLines } from "../input/numbering";
import { copyRootSource } from "./data";
import type { NativeRootSourceContext, NativeRootSourceBindings } from "./types";
import { requireNativeRootCallPriors } from "./priors";

type RecordValue = Record<string, any>;
const required = ["functionName", "language", "limited", "snippets", "detailLevel", "parameters", "sourceFlow"];
const optional = ["sourceEvidence", "groundingLimited", "returnTypeText", "valueNames", "valueFacts", "scenarioBatch", "nodePreparation", "callPriors"];
const forbidden = new Set(["sourceWorksheet", "sourceExampleFacts", "sourceVerifiedAnalysis", "sourceCallReadings", "sourceProseReader", "checkedExamples", "nodeTask", "summaryTask"]);

/** Check every declared record key after safe materialization; fields with computational capabilities cannot hide in nested evidence. */
function requireSourceOnly(value: unknown): void {
  const stack = [value], visited = new Set<object>();
  while (stack.length) { const node = stack.pop(); if (!node || typeof node !== "object") continue; requireInput(!visited.has(node) && visited.size < 100000); visited.add(node);
    for (const [key, child] of Object.entries(node)) { requireInput(!forbidden.has(key), "native-root-source-port"); stack.push(child); }
  }
}
function strings(value: unknown): asserts value is string[] { requireInput(Array.isArray(value) && value.every(item => typeof item === "string")); }
function integer(value: unknown, minimum = 0): asserts value is number { requireInput(Number.isSafeInteger(value) && (value as number) >= minimum); }

/** Validate exact supplied source locations, without claiming the supplied record itself proves an actual capture or AST identity. */
function sourceLocation(value: unknown, snippets: Map<string, RecordValue>): void {
  const point = inputOptions(value, ["snippetId", "startLine", "endLine"]), snippet = snippets.get(point.snippetId);
  integer(point.startLine, 1); integer(point.endLine, point.startLine);
  requireInput(snippet && point.startLine >= snippet.startLine && point.endLine <= snippet.endLine, "native-root-source-range");
}

/** Own every complete source byte and route occurrence; producer aliases become independent values, never borrowed mutable references. */
export function ownNativeRootContext(input: NativeRootSourceContext): { context: NativeRootSourceContext; bindings: NativeRootSourceBindings } {
  const context = inputOptions(copyRootSource(input), required, optional);
  requireInput(typeof context.functionName === "string" && typeof context.language === "string" && typeof context.limited === "boolean" && context.detailLevel === "rich");
  for (const field of ["groundingLimited", "nodePreparation"]) if (Object.hasOwn(context, field)) requireInput(typeof context[field] === "boolean");
  if (Object.hasOwn(context, "returnTypeText")) requireInput(typeof context.returnTypeText === "string");
  if (Object.hasOwn(context, "valueNames")) { strings(context.valueNames); requireInput(new Set(context.valueNames).size === context.valueNames.length); }
  if (Object.hasOwn(context, "scenarioBatch")) integer(inputOptions(context.scenarioBatch, ["offset"]).offset);
  requireInput(Array.isArray(context.parameters)); const parameterNames = new Set<string>();
  for (const parameter of context.parameters) { const row = inputOptions(parameter, ["name"], ["type"]); requireInput(typeof row.name === "string" && !parameterNames.has(row.name)); parameterNames.add(row.name); if (Object.hasOwn(row, "type")) requireInput(typeof row.type === "string"); }
  requireInput(Array.isArray(context.snippets) && context.snippets.length > 0); const snippets = new Map<string, RecordValue>();
  for (const snippet of context.snippets) {
    const row = inputOptions(snippet, ["id", "role", "startLine", "endLine", "text", "truncated"]);
    requireInput(typeof row.id === "string" && !snippets.has(row.id) && ["function", "nearby", "helper", "caller"].includes(row.role));
    integer(row.startLine, 1); integer(row.endLine, row.startLine); requireInput(row.truncated === false && typeof row.text === "string" && row.text.length > 0, "native-root-complete-source"); snippets.set(row.id, row);
  }
  const parent = context.snippets.find((snippet: RecordValue) => snippet.role === "function"); requireInput(parent, "native-root-parent-source");
  if (Object.hasOwn(context, "callPriors")) requireNativeRootCallPriors(context.callPriors, new Set(snippets.keys()));
  const flow = inputOptions(context.sourceFlow, ["basis", "paths", "limited"]); requireInput(flow.basis === "source-control-flow" && typeof flow.limited === "boolean" && Array.isArray(flow.paths) && flow.paths.length === 1, "native-root-whole-route");
  const route = inputOptions(flow.paths[0], ["status", "confidence", "steps", "graph"], ["reason"]);
  requireInput(["source-terminal", "partial"].includes(route.status) && ["exact", "inferred", "unresolved"].includes(route.confidence) && Array.isArray(route.steps) && route.steps.length > 0 && route.steps.length <= 900);
  if (Object.hasOwn(route, "reason")) requireInput(["cycle", "depth-limit", "missing-source", "missing-block", "control-gap"].includes(route.reason));
  const graph = inputOptions(route.graph, ["nodeIds", "edgeIds"]); strings(graph.nodeIds); strings(graph.edgeIds);
  const seen = new Set<string>(), occurrences: NativeRootSourceBindings["occurrences"] = [];
  for (const [index, step] of route.steps.entries()) {
    const row = inputOptions(step, ["kind", "code", "source", "confidence", "graphNodeId", "graphOccurrence"], ["loweredPredicate", "writeTargets", "branch"]);
    requireInput(typeof row.kind === "string" && typeof row.code === "string" && row.code.length > 0 && ["exact", "inferred", "unresolved"].includes(row.confidence));
    requireInput(typeof row.graphNodeId === "string"); integer(row.graphOccurrence); requireInput(graph.nodeIds[row.graphOccurrence] === row.graphNodeId, "native-root-source-occurrence");
    const identity = JSON.stringify([row.graphNodeId, row.graphOccurrence]); requireInput(!seen.has(identity), "native-root-source-occurrence"); seen.add(identity); sourceLocation(row.source, snippets);
    if (Object.hasOwn(row, "loweredPredicate")) requireInput(typeof row.loweredPredicate === "string");
    if (Object.hasOwn(row, "writeTargets")) strings(row.writeTargets);
    if (Object.hasOwn(row, "branch")) { const branch = inputOptions(row.branch, ["outcome", "confidence"], ["inputCondition"]); requireInput(typeof branch.outcome === "string" && ["exact", "inferred", "unresolved"].includes(branch.confidence)); if (Object.hasOwn(branch, "inputCondition")) requireInput(typeof branch.inputCondition === "string"); }
    occurrences.push({ ordinal: index + 1, nodeId: row.graphNodeId, occurrence: row.graphOccurrence, kind: row.kind, code: row.code, source: row.source });
  }
  if (Object.hasOwn(context, "valueFacts")) { requireInput(Array.isArray(context.valueFacts)); for (const fact of context.valueFacts) { const row = inputOptions(fact, ["target", "operation", "operands", "source"]); requireInput(typeof row.target === "string" && ["conditional", "add", "subtract", "multiply", "divide", "modulo"].includes(row.operation)); strings(row.operands); sourceLocation(row.source, snippets); } }
  requireSourceOnly(context);
  return { context: context as NativeRootSourceContext, bindings: copyRootSource({ parentSnippetId: parent.id, route: graph, occurrences }) as NativeRootSourceBindings };
}

/** Keep the canonical complete source projection; graph identities stay in Host bindings and original source citations stay in the source-owned schema. */
export function rootSourceData(context: NativeRootSourceContext, constraints: { booleans: Map<string, boolean>; nullInputs: Set<string>; nonNullInputs: Set<string> }): RecordValue {
  const { nodePreparation: _preparation, sourceFlow: _flow, ...rest } = context;
  const source: RecordValue = { ...rest, snippets: context.snippets.map(snippet => ({ ...snippet, text: numberNativeSourceLines(snippet.text, snippet.startLine) })) };
  source.selectedRoutes = context.sourceFlow.paths.map(path => ({ status: path.status, confidence: path.confidence, operations: path.steps.map((step, index) => ({
    ordinal: index + 1, kind: step.kind, code: step.code, reachedOnSelectedSourceRoute: true,
    ...(step.loweredPredicate ? { loweredPredicate: step.loweredPredicate } : {}), ...(step.writeTargets?.length ? { writeTargets: step.writeTargets } : {}),
    ...(step.branch ? { predicateResult: ["true", "false"].includes(step.branch.outcome) ? step.branch.outcome === "true" : step.branch.outcome, confidence: step.branch.confidence, ...(step.branch.inputCondition ? { requiredInput: step.branch.inputCondition } : {}) } : {}),
    nextReachedOperation: path.steps[index + 1]?.code ?? null
  })) }));
  source.exampleSlots = [context.parameters.map(parameter => ({ name: parameter.name, ...(parameter.type !== undefined ? { type: parameter.type } : {}),
    ...(constraints.booleans.has(parameter.name) ? { fixedValue: constraints.booleans.get(parameter.name) } : constraints.nullInputs.has(parameter.name) ? { fixedValue: null } : {}),
    ...(constraints.nonNullInputs.has(parameter.name) ? { nonNull: true } : {}) }))];
  return copyRootSource(source);
}
