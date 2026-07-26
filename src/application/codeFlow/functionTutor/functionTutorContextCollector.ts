/**
 * Collects bounded codebase context for one Function Guide.
 *
 * It reuses snapshot-local indexes and the already-built Function Logic result.
 * Traversal is iterative, source-backed, and never infers business purpose from
 * symbol names or rendered Webview text.
 */

import { createContentHash } from "../../../shared/hash";
import type { ProjectGraph, SourceRange, SymbolNode } from "../../../shared/types";
import type { FunctionLogicAnalysis } from "../../../analyzer/functionLogic";
import type { FunctionTutorCertainty, FunctionTutorEvidence, FunctionTutorGap } from "../../../analyzer/functionTutor";
import type { FunctionArchitectureIndex } from "../../../insights/architecturalLayers";
import type { SemanticFlow, SemanticFlowIndex, SemanticFlowStep } from "../../../insights/semanticFlow";
import type { FunctionIndex, FunctionIndexRelation } from "../../../graph/functionIndex";
import type {
  FunctionTutorArchitectureFact,
  FunctionTutorCalleeFact,
  FunctionTutorCallerFact,
  FunctionTutorCodebaseContext,
  FunctionTutorEntrypointChainFact,
  FunctionTutorOwnerFact
} from "./types";

const MAX_OWNERS = 4;
const MAX_ENTRYPOINTS = 4;
const MAX_ENTRYPOINT_STEPS = 6;
const MAX_CALLERS = 6;
const MAX_CALLEES = 8;
const MAX_ARCHITECTURE_EVIDENCE = 3;

export type CollectFunctionTutorContextInput = {
  graph: ProjectGraph;
  functionLogic: FunctionLogicAnalysis;
  architectureIndex: FunctionArchitectureIndex;
  semanticFlows: SemanticFlowIndex;
  functionIndex: FunctionIndex;
};

/** Returns direct codebase evidence for a selected callable without additional graph traversal. */
export function collectFunctionTutorCodebaseContext(
  input: CollectFunctionTutorContextInput
): FunctionTutorCodebaseContext {
  const selected = input.functionLogic.functionNode;
  const nodesById = new Map(input.graph.nodes.map((node) => [node.id, node]));
  const gaps: FunctionTutorGap[] = [];
  const owners = collectOwners(selected, nodesById, gaps);
  const architecture = collectArchitecture(selected, input);
  const entrypointResult = collectEntrypoints(selected.id, input.semanticFlows, gaps);
  const callerResult = collectCallers(selected.id, input.graph, nodesById, input.functionIndex, gaps);
  const calleeResult = collectCallees(selected.id, input.graph, input.functionLogic, input.functionIndex, gaps);
  return {
    documentation: undefined,
    owners,
    architecture,
    entrypoints: entrypointResult.items,
    callers: callerResult.items,
    callees: calleeResult.items,
    counts: {
      totalEntrypointCount: entrypointResult.total,
      omittedEntrypointCount: Math.max(0, entrypointResult.total - entrypointResult.items.length),
      totalCallerCount: callerResult.total,
      omittedCallerCount: Math.max(0, callerResult.total - callerResult.items.length),
      totalLocalCalleeCount: calleeResult.totalLocal,
      totalExternalCalleeCount: calleeResult.totalExternal,
      totalUnresolvedCalleeCount: calleeResult.totalUnresolved,
      omittedCalleeCount: Math.max(0, calleeResult.total - calleeResult.items.length)
    },
    gaps
  };
}

/** Walks the explicit parent chain, with a cycle guard for malformed graph input. */
function collectOwners(
  selected: SymbolNode,
  nodesById: ReadonlyMap<string, SymbolNode>,
  gaps: FunctionTutorGap[]
): FunctionTutorOwnerFact[] {
  const owners: FunctionTutorOwnerFact[] = [];
  const visited = new Set<string>([selected.id]);
  let parentId = selected.parentId;
  while (parentId && owners.length < MAX_OWNERS) {
    if (visited.has(parentId)) {
      gaps.push({ kind: "context-budget", summary: "A cyclic owner relationship was omitted from Function Guide." });
      break;
    }
    visited.add(parentId);
    const parent = nodesById.get(parentId);
    if (!parent) break;
    if (parent.kind === "file" || parent.kind === "module" || parent.kind === "namespace" || parent.kind === "class") {
      owners.push({
        nodeId: parent.id,
        kind: parent.kind,
        name: parent.qualifiedName || parent.name,
        certainty: "exact",
        evidence: [{ kind: "source-owner", certainty: "exact", filePath: parent.filePath, range: parent.range, summary: "Lexical owner of the selected function." }]
      });
    }
    parentId = parent.parentId;
  }
  return owners;
}

/** Adapts the existing intrinsic architecture assessment without adding name-based rules. */
function collectArchitecture(
  selected: SymbolNode,
  input: CollectFunctionTutorContextInput
): FunctionTutorArchitectureFact | undefined {
  const assessment = input.architectureIndex.assessmentsByFunctionId.get(selected.id);
  if (!assessment) return undefined;
  const semanticStep = findSemanticStepForFunction(selected.id, input.semanticFlows);
  const evidence = assessment.evidence.slice(0, MAX_ARCHITECTURE_EVIDENCE).map((item) => {
    const range = item.kind === "sourceStructure" ? selected.range : semanticStep?.range;
    return {
      summary: item.description,
      certainty: architectureCertainty(item.confidence),
      evidence: range ? [{
        kind: "architecture-layer" as const,
        certainty: architectureCertainty(item.confidence),
        filePath: item.kind === "sourceStructure" ? selected.filePath : semanticStep?.filePath ?? selected.filePath,
        range,
        summary: item.description
      }] : []
    };
  });
  return {
    layer: assessment.layer,
    confidence: assessment.confidence,
    businessLogic: assessment.businessLogic,
    conflicted: assessment.conflicted,
    alternatives: assessment.alternatives.slice(0, 3),
    evidence
  };
}

/** Retains at most four entrypoint chains, ranked by certainty and shortest path. */
function collectEntrypoints(
  selectedId: string,
  semanticFlows: SemanticFlowIndex,
  gaps: FunctionTutorGap[]
): { items: FunctionTutorEntrypointChainFact[]; total: number } {
  const all = semanticFlows.flows.flatMap((flow) => createEntrypointChain(flow, selectedId) ?? []);
  all.sort((left, right) => certaintyRank(left.certainty) - certaintyRank(right.certainty)
    || left.steps.length - right.steps.length || left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
  if (all.length > MAX_ENTRYPOINTS) {
    gaps.push({ kind: "context-budget", summary: `Function Guide retained ${MAX_ENTRYPOINTS} of ${all.length} mapped entrypoint chains.` });
  }
  return { items: all.slice(0, MAX_ENTRYPOINTS), total: all.length };
}

/** Creates one entrypoint chain ending at the first selected-function step. */
function createEntrypointChain(flow: SemanticFlow, selectedId: string): FunctionTutorEntrypointChainFact | undefined {
  const selectedIndex = flow.steps.findIndex((step) => step.functionId === selectedId);
  if (selectedIndex < 0) return undefined;
  const sourceSteps = flow.steps.slice(0, selectedIndex + 1);
  const retained = sourceSteps.length <= MAX_ENTRYPOINT_STEPS
    ? sourceSteps
    : [sourceSteps[0], ...sourceSteps.slice(-5)];
  const steps = retained.map((step) => ({
    functionId: step.functionId,
    name: step.qualifiedName ?? step.functionQualifiedName ?? step.name,
    role: step.role,
    resolution: step.resolution,
    certainty: edgeCertainty(step.confidence),
    evidence: createStepEvidence(step)
  }));
  const evidence = steps.flatMap((step) => step.evidence);
  return {
    id: `function-tutor-entrypoint:${createContentHash(`${flow.id}\0${selectedId}`).slice(0, 24)}`,
    kind: flow.entrypointKind,
    label: flow.name || flow.rootPath,
    framework: flow.framework,
    certainty: weakestCertainty(steps.map((step) => step.certainty)),
    steps,
    evidence
  };
}

/** Uses FunctionIndex direct relations and concrete call edge ranges for inbound facts. */
function collectCallers(
  selectedId: string,
  graph: ProjectGraph,
  nodesById: ReadonlyMap<string, SymbolNode>,
  functionIndex: FunctionIndex,
  gaps: FunctionTutorGap[]
): { items: FunctionTutorCallerFact[]; total: number } {
  const relations = functionIndex.callersByNodeId.get(selectedId) ?? [];
  const items = relations
    .filter((relation) => relation.kind === "function" || relation.kind === "method" || relation.kind === "constructor")
    .map((relation) => createCallerFact(relation, graph, nodesById))
    .filter((fact): fact is FunctionTutorCallerFact => Boolean(fact))
    .sort(compareRelationFacts);
  if (items.length > MAX_CALLERS) gaps.push({ kind: "context-budget", summary: `Function Guide retained ${MAX_CALLERS} of ${items.length} direct callers.` });
  return { items: items.slice(0, MAX_CALLERS), total: items.length };
}

/** Keeps outbound local, external, and unresolved relations distinct. */
function collectCallees(
  selectedId: string,
  graph: ProjectGraph,
  functionLogic: FunctionLogicAnalysis,
  functionIndex: FunctionIndex,
  gaps: FunctionTutorGap[]
): {
  items: FunctionTutorCalleeFact[];
  total: number;
  totalLocal: number;
  totalExternal: number;
  totalUnresolved: number;
} {
  const relations = functionIndex.calleesByNodeId.get(selectedId) ?? [];
  const facts = relations.map((relation) => createCalleeFact(relation, graph, functionLogic)).sort(compareRelationFacts);
  const totalLocal = facts.filter((fact) => fact.kind === "local").length;
  const totalExternal = facts.filter((fact) => fact.kind === "external").length;
  const totalUnresolved = facts.filter((fact) => fact.kind === "unresolved").length;
  if (facts.length > MAX_CALLEES) gaps.push({ kind: "context-budget", summary: `Function Guide retained ${MAX_CALLEES} of ${facts.length} outgoing call relations.` });
  return { items: facts.slice(0, MAX_CALLEES), total: facts.length, totalLocal, totalExternal, totalUnresolved };
}

function createCallerFact(
  relation: FunctionIndexRelation,
  graph: ProjectGraph,
  nodesById: ReadonlyMap<string, SymbolNode>
): FunctionTutorCallerFact | undefined {
  const node = nodesById.get(relation.nodeId);
  if (!node || (node.kind !== "function" && node.kind !== "method" && node.kind !== "constructor")) return undefined;
  const evidence = relationEvidence(relation, graph, "direct-caller", "Direct callsite into the selected function.");
  return {
    nodeId: relation.nodeId,
    name: relation.name,
    qualifiedName: relation.name,
    kind: node.kind,
    callCount: relation.callCount,
    certainty: weakestCertainty(relation.confidences.map(edgeCertainty)),
    evidence
  };
}

function createCalleeFact(
  relation: FunctionIndexRelation,
  graph: ProjectGraph,
  functionLogic: FunctionLogicAnalysis
): FunctionTutorCalleeFact {
  const kind = relation.kind === "external" ? "external" : relation.kind === "unresolved" ? "unresolved" : "local";
  const callsite = findMatchedCallsite(relation, graph, functionLogic);
  const relationKind = callsite?.relation ?? "call";
  return {
    nodeId: relation.nodeId,
    name: relation.name,
    kind,
    relation: relationKind,
    callCount: relation.callCount,
    certainty: weakestCertainty(relation.confidences.map(edgeCertainty)),
    sourceBlockId: callsite?.blockId,
    evidence: relationEvidence(relation, graph, "direct-callee", "Direct outgoing callsite from the selected function.")
  };
}

function relationEvidence(
  relation: FunctionIndexRelation,
  graph: ProjectGraph,
  kind: FunctionTutorEvidence["kind"],
  summary: string
): FunctionTutorEvidence[] {
  const edgeById = new Map(graph.edges.map((edge) => [edge.id, edge]));
  return relation.edgeIds.flatMap((edgeId) => {
    const edge = edgeById.get(edgeId);
    return edge?.range ? [{ kind, certainty: edgeCertainty(edge.confidence), filePath: edge.filePath, range: edge.range, summary }] : [];
  }).sort(compareEvidence).slice(0, 3);
}

function findMatchedCallsite(
  relation: FunctionIndexRelation,
  graph: ProjectGraph,
  functionLogic: FunctionLogicAnalysis
) {
  const edges = relation.edgeIds.map((id) => graph.edges.find((edge) => edge.id === id)).filter((edge): edge is NonNullable<typeof edge> => Boolean(edge?.range));
  return functionLogic.callsites.find((callsite) => edges.some((edge) => edge.range && rangesOverlap(callsite.range, edge.range)));
}

function findSemanticStepForFunction(functionId: string, semanticFlows: SemanticFlowIndex): SemanticFlowStep | undefined {
  for (const flow of semanticFlows.flows) {
    const step = flow.steps.find((candidate) => candidate.functionId === functionId && candidate.range);
    if (step) return step;
  }
  return undefined;
}

function createStepEvidence(step: SemanticFlowStep): FunctionTutorEvidence[] {
  return step.range ? [{ kind: "semantic-entrypoint", certainty: edgeCertainty(step.confidence), filePath: step.filePath, range: step.range, summary: "Bounded semantic-flow step." }] : [];
}

function architectureCertainty(value: "high" | "medium" | "low"): FunctionTutorCertainty {
  return value === "high" ? "exact" : "inferred";
}

function edgeCertainty(value: "exact" | "resolved" | "inferred" | "unresolved" | undefined): FunctionTutorCertainty {
  return value === "exact" || value === "resolved" ? "exact" : value === "inferred" ? "inferred" : "unknown";
}

function weakestCertainty(values: FunctionTutorCertainty[]): FunctionTutorCertainty {
  return values.includes("unknown") ? "unknown" : values.includes("inferred") ? "inferred" : "exact";
}

function certaintyRank(value: FunctionTutorCertainty): number {
  return value === "exact" ? 0 : value === "inferred" ? 1 : 2;
}

function compareRelationFacts(left: { certainty: FunctionTutorCertainty; callCount: number; name: string; nodeId: string }, right: typeof left): number {
  return certaintyRank(left.certainty) - certaintyRank(right.certainty)
    || right.callCount - left.callCount || left.name.localeCompare(right.name) || left.nodeId.localeCompare(right.nodeId);
}

function compareEvidence(left: FunctionTutorEvidence, right: FunctionTutorEvidence): number {
  return certaintyRank(left.certainty) - certaintyRank(right.certainty)
    || left.range.startLine - right.range.startLine || left.range.startCharacter - right.range.startCharacter;
}

function rangesOverlap(left: SourceRange, right: SourceRange): boolean {
  const leftStart = left.startLine * 1_000_000 + left.startCharacter;
  const leftEnd = left.endLine * 1_000_000 + left.endCharacter;
  const rightStart = right.startLine * 1_000_000 + right.startCharacter;
  const rightEnd = right.endLine * 1_000_000 + right.endCharacter;
  return leftStart <= rightEnd && rightStart <= leftEnd;
}
