/**
 * Bounded application planning for Function Guide input cases. It samples graph-backed caller
 * tuples, derives small parameter domains, and greedily selects representative
 * scenarios without constructing a Cartesian product.
 */

import { analyzeFunctionTutorCallsite } from "../../../analyzer/functionTutor";
import {
  areFunctionTutorStaticValuesEqual,
  createFunctionTutorUnknown,
  stringifyFunctionTutorStaticValue
} from "../../../analyzer/functionTutor/staticValue";
import type {
  FunctionTutorCallsiteTuple,
  FunctionTutorDeclarationAnalysis,
  FunctionTutorGap,
  FunctionTutorParameterFact,
  FunctionTutorStaticValue
} from "../../../analyzer/functionTutor";
import type { FunctionLogicAnalysis } from "../../../analyzer/functionLogic";
import type { FunctionArchitectureIndex } from "../../../insights/architecturalLayers";
import type { SemanticFlowIndex } from "../../../insights/semanticFlow";
import type { FunctionIndex } from "../../../graph/functionIndex";
import { createContentHash } from "../../../shared/hash";
import type { GraphEdge, ProjectGraph } from "../../../shared/types";
import type {
  FunctionTutorBuildModel,
  FunctionTutorCoverageObjective,
  FunctionTutorInputCandidate,
  FunctionTutorScenarioSeed
} from "./types";
import { collectFunctionTutorCodebaseContext } from "./functionTutorContextCollector";
import { buildFunctionTutorGuide } from "./functionTutorGuidePlanner";

const MAX_INCOMING_CALLSITES = 8;
const MAX_CALLER_FILES = 6;
const MAX_CALLSITE_TUPLES = 4;
const MAX_CANDIDATES = 8;
const MAX_SCENARIOS = 12;

export type FunctionTutorBuildInput = {
  graph: ProjectGraph;
  declaration: FunctionTutorDeclarationAnalysis;
  functionLogic: FunctionLogicAnalysis;
  architectureIndex: FunctionArchitectureIndex;
  semanticFlows: SemanticFlowIndex;
  functionIndex: FunctionIndex;
  readSourceText(filePath: string): Promise<string | undefined>;
};

/** Builds one deterministic, bounded model that is ready for opaque projection. */
export async function buildFunctionTutorModel(input: FunctionTutorBuildInput): Promise<FunctionTutorBuildModel> {
  const callsiteResult = await collectCallsiteTuples(input);
  const candidatesByParameter = createCandidateDomains(input.declaration, callsiteResult.tuples);
  const objectives = createObjectives(input.declaration);
  const seeds = createScenarioSeeds(input.declaration, callsiteResult.tuples, candidatesByParameter, objectives);
  const collectedContext = collectFunctionTutorCodebaseContext({
    graph: input.graph,
    functionLogic: input.functionLogic,
    architectureIndex: input.architectureIndex,
    semanticFlows: input.semanticFlows,
    functionIndex: input.functionIndex
  });
  const context = { ...collectedContext, documentation: input.declaration.documentation };
  const gaps = [...input.declaration.gaps, ...callsiteResult.gaps, ...context.gaps];
  const guide = buildFunctionTutorGuide({
    declaration: input.declaration,
    functionLogic: input.functionLogic,
    context,
    scenarios: seeds,
    gaps
  });
  return {
    declaration: input.declaration,
    functionLogic: input.functionLogic,
    callsites: callsiteResult.tuples,
    candidatesByParameter,
    objectives,
    seeds,
    context,
    guide,
    availability: guide.summary.readyChapterCount > 0
      ? guide.summary.partialChapterCount > 0 || guide.summary.unavailableChapterCount > 0 ? "partial" : "ready"
      : "unavailable",
    gaps,
    summary: {
      exactCallsiteTupleCount: callsiteResult.tuples.filter((tuple) => tuple.certainty === "exact").length,
      plannedCoverageCount: new Set(seeds.flatMap((seed) => seed.objectiveIds)).size,
      totalObjectiveCount: objectives.length,
      limited: gaps.some((gap) => gap.kind.endsWith("budget"))
    }
  };
}

/** Reads only incoming call edges already present in the active graph snapshot. */
async function collectCallsiteTuples(input: FunctionTutorBuildInput): Promise<{
  tuples: FunctionTutorCallsiteTuple[];
  gaps: FunctionTutorGap[];
}> {
  const edges = input.graph.edges.filter((edge) => edge.kind === "calls" && edge.targetId === input.declaration.functionNode.id)
    .sort(compareIncomingCallEdges)
    .slice(0, MAX_INCOMING_CALLSITES);
  const uniqueFiles = [...new Set(edges.map((edge) => edge.filePath))].slice(0, MAX_CALLER_FILES);
  const sourceByFile = new Map<string, string | undefined>();
  // A single unreadable caller must become an explicit gap, never make the
  // whole Guide disappear after Function Logic has already been produced.
  const reads = await Promise.all(uniqueFiles.map(async (filePath) => [
    filePath,
    await input.readSourceText(filePath).catch(() => undefined)
  ] as const));
  for (const [filePath, source] of reads) sourceByFile.set(filePath, source);
  const tuples: FunctionTutorCallsiteTuple[] = [];
  const gaps: FunctionTutorGap[] = [];
  const seen = new Set<string>();
  for (const edge of edges) {
    const source = sourceByFile.get(edge.filePath);
    if (!source) {
      gaps.push({ kind: "missing-source", summary: "A caller source file could not be read for Tutor input inference." });
      continue;
    }
    const tuple = analyzeFunctionTutorCallsite({
      targetFunction: input.declaration.functionNode,
      callerFilePath: edge.filePath,
      callerSourceText: source,
      callEdge: edge,
      parameters: input.declaration.parameters
    });
    if (!tuple) {
      gaps.push({ kind: "unresolved-callsite", summary: "A graph caller could not be matched to a safe static call expression." });
      continue;
    }
    const key = tuple.arguments.map((argument) => `${argument.parameterId}=${stringifyFunctionTutorStaticValue(argument.value)}`).join("\0");
    if (seen.has(key)) continue;
    seen.add(key);
    tuples.push(tuple);
    if (tuples.length >= MAX_CALLSITE_TUPLES) break;
  }
  if (edges.length >= MAX_INCOMING_CALLSITES) {
    gaps.push({ kind: "scenario-budget", summary: `Tutor sampled at most ${MAX_INCOMING_CALLSITES} incoming callsites.` });
  }
  return { tuples, gaps };
}

/** Ranks syntax-proven caller relationships ahead of inference without hiding either. */
function compareIncomingCallEdges(left: GraphEdge, right: GraphEdge): number {
  const confidenceRank: Record<GraphEdge["confidence"], number> = {
    exact: 0,
    resolved: 1,
    inferred: 2,
    unresolved: 3
  };
  return confidenceRank[left.confidence] - confidenceRank[right.confidence]
    || left.filePath.localeCompare(right.filePath)
    || rangeKey(left).localeCompare(rangeKey(right))
    || left.id.localeCompare(right.id);
}

function rangeKey(edge: GraphEdge): string {
  const range = edge.range;
  return range ? `${range.startLine}:${range.startCharacter}:${range.endLine}:${range.endCharacter}` : "";
}

/** Creates type/default/callsite/constraint candidates in fixed precedence order. */
function createCandidateDomains(
  declaration: FunctionTutorDeclarationAnalysis,
  callsites: FunctionTutorCallsiteTuple[]
): Map<string, FunctionTutorInputCandidate[]> {
  const result = new Map<string, FunctionTutorInputCandidate[]>();
  for (const parameter of declaration.parameters) {
    const candidates: FunctionTutorInputCandidate[] = [];
    for (const tuple of callsites) {
      const argument = tuple.arguments.find((candidate) => candidate.parameterId === parameter.id);
      if (!argument) continue;
      appendCandidate(candidates, {
        id: createCandidateId(parameter.id, argument.value, "callsite"),
        parameterId: parameter.id,
        value: argument.value,
        certainty: argument.certainty,
        source: "callsite",
        evidence: argument.evidence
      });
    }
    if (parameter.defaultValue) appendCandidate(candidates, {
      id: createCandidateId(parameter.id, parameter.defaultValue, "default"),
      parameterId: parameter.id,
      value: parameter.defaultValue,
      certainty: "exact",
      source: "default",
      evidence: parameter.declarationEvidence.filter((evidence) => evidence.kind === "parameter-default")
    });
    for (const value of parameter.literalValues) appendCandidate(candidates, {
      id: createCandidateId(parameter.id, value, "literal-type"),
      parameterId: parameter.id,
      value,
      certainty: "exact",
      source: "literal-type",
      evidence: parameter.declarationEvidence.filter((evidence) => evidence.kind === "parameter-type")
    });
    for (const constraint of declaration.constraints.filter((candidate) => candidate.parameterId === parameter.id)) {
      for (const value of createConstraintValues(parameter, constraint.operator, constraint.operand)) {
        appendCandidate(candidates, {
          id: createCandidateId(parameter.id, value, "constraint-boundary"),
          parameterId: parameter.id,
          value,
          certainty: "inferred",
          source: "constraint-boundary",
          evidence: constraint.evidence
        });
      }
    }
    for (const value of createTypeRepresentatives(parameter)) appendCandidate(candidates, {
      id: createCandidateId(parameter.id, value, "type-representative"),
      parameterId: parameter.id,
      value,
      certainty: "inferred",
      source: "type-representative",
      evidence: parameter.declarationEvidence
    });
    if (candidates.length === 0) appendCandidate(candidates, {
      id: createCandidateId(parameter.id, createFunctionTutorUnknown("not-inferred"), "unknown"),
      parameterId: parameter.id,
      value: createFunctionTutorUnknown("not-inferred", "No safe static input example is available."),
      certainty: "unknown",
      source: "unknown",
      evidence: parameter.declarationEvidence
    });
    result.set(parameter.id, candidates.slice(0, MAX_CANDIDATES));
  }
  return result;
}

/** Preserves first-source precedence while removing structurally identical values. */
function appendCandidate(candidates: FunctionTutorInputCandidate[], candidate: FunctionTutorInputCandidate): void {
  if (candidates.some((existing) => areFunctionTutorStaticValuesEqual(existing.value, candidate.value))) return;
  if (candidates.length < MAX_CANDIDATES) candidates.push(candidate);
}

/** Produces only boundary neighbours that can distinguish the direct predicate. */
function createConstraintValues(
  parameter: FunctionTutorParameterFact,
  operator: string,
  operand: FunctionTutorStaticValue | undefined
): FunctionTutorStaticValue[] {
  if (operator === "truthy" || operator === "falsy") return [{ kind: "boolean", value: false }, { kind: "boolean", value: true }];
  if (!operand) return [];
  if (operand.kind === "number") {
    const value = operand.value;
    if (operator === "eq" || operator === "neq") return [{ kind: "number", value }, { kind: "number", value: value + 1 }];
    return [{ kind: "number", value: value - 1 }, { kind: "number", value }, { kind: "number", value: value + 1 }];
  }
  if (operand.kind === "string" || operand.kind === "boolean" || operand.kind === "null" || operand.kind === "undefined") {
    const opposite = operand.kind === "boolean" ? { kind: "boolean" as const, value: !operand.value }
      : operand.kind === "string" ? { kind: "string" as const, value: operand.value === "" ? "sample" : "" }
        : createFunctionTutorUnknown("not-inferred", "Opposite literal is not safely known.");
    return [operand, opposite];
  }
  return parameter.typeKind === "array" ? [{ kind: "array", items: [], truncated: false }] : [];
}

/** Adds non-semantic, clearly-inferred representatives only when no stronger fact exists. */
function createTypeRepresentatives(parameter: FunctionTutorParameterFact): FunctionTutorStaticValue[] {
  switch (parameter.typeKind) {
    case "boolean": return [{ kind: "boolean", value: false }, { kind: "boolean", value: true }];
    case "number": return [{ kind: "number", value: 0 }, { kind: "number", value: 1 }, { kind: "number", value: -1 }];
    case "string": return [{ kind: "string", value: "" }, { kind: "string", value: "sample" }];
    case "array": case "tuple": return [{ kind: "array", items: [], truncated: false }];
    case "object": return [{ kind: "object", entries: [], truncated: false }];
    default: return parameter.optional ? [{ kind: "undefined" }] : [];
  }
}

/** Defines a bounded list of target outcomes, not every possible input combination. */
function createObjectives(declaration: FunctionTutorDeclarationAnalysis): FunctionTutorCoverageObjective[] {
  const objectives: FunctionTutorCoverageObjective[] = [];
  for (const parameter of declaration.parameters) {
    if (parameter.defaultValue) objectives.push({
      id: `tutor-objective:default:${parameter.id}`,
      kind: "default-input",
      parameterId: parameter.id,
      weight: 30
    });
    objectives.push({ id: `tutor-objective:type:${parameter.id}`, kind: "type-baseline", parameterId: parameter.id, weight: 10 });
  }
  for (const constraint of declaration.constraints) {
    objectives.push({ id: `tutor-objective:true:${constraint.id}`, kind: "condition-true", parameterId: constraint.parameterId, blockId: constraint.blockId, weight: 40 });
    objectives.push({ id: `tutor-objective:false:${constraint.id}`, kind: "condition-false", parameterId: constraint.parameterId, blockId: constraint.blockId, weight: 40 });
  }
  return objectives.slice(0, 48);
}

/** Selects exact caller tuples first, then one baseline and minimal branch variants. */
function createScenarioSeeds(
  declaration: FunctionTutorDeclarationAnalysis,
  callsites: FunctionTutorCallsiteTuple[],
  candidatesByParameter: Map<string, FunctionTutorInputCandidate[]>,
  objectives: FunctionTutorCoverageObjective[]
): FunctionTutorScenarioSeed[] {
  const seeds: FunctionTutorScenarioSeed[] = [];
  const seen = new Set<string>();
  for (const tuple of callsites) {
    const seed = createSeedFromCallsite(tuple, seeds.length + 1);
    appendSeed(seeds, seen, seed);
  }
  const baseline = createBaselineSeed(declaration, candidatesByParameter, seeds.length + 1);
  appendSeed(seeds, seen, baseline);
  for (const constraint of declaration.constraints) {
    const values = createConstraintValues(
      declaration.parameters.find((parameter) => parameter.id === constraint.parameterId) ?? declaration.parameters[0],
      constraint.operator,
      constraint.operand
    );
    for (let index = 0; index < Math.min(2, values.length); index += 1) {
      const variant = cloneSeedWithInput(baseline, constraint.parameterId, values[index], `tutor-objective:${index === 0 ? "true" : "false"}:${constraint.id}`);
      appendSeed(seeds, seen, variant);
    }
  }
  const scored = seeds.map((seed) => ({
    seed,
    score: seed.objectiveIds.reduce((total, id) => total + (objectives.find((objective) => objective.id === id)?.weight ?? 0), 0)
      + (seed.certainty === "exact" ? 20 : seed.certainty === "inferred" ? 5 : -15)
  })).sort((left, right) => right.score - left.score || left.seed.id.localeCompare(right.seed.id));
  return scored.slice(0, MAX_SCENARIOS).map(({ seed }, index) => ({ ...seed, ordinal: index + 1 }));
}

function createSeedFromCallsite(
  tuple: FunctionTutorCallsiteTuple,
  ordinal: number
): FunctionTutorScenarioSeed {
  return {
    id: `tutor-seed:${createContentHash(tuple.id).slice(0, 24)}`,
    ordinal,
    title: `Callsite Example ${ordinal}`,
    source: "callsite",
    certainty: tuple.certainty,
    inputs: tuple.arguments.map((argument) => ({ ...argument })),
    objectiveIds: [],
    evidence: tuple.evidence,
    gaps: []
  };
}

function createBaselineSeed(
  declaration: FunctionTutorDeclarationAnalysis,
  candidatesByParameter: Map<string, FunctionTutorInputCandidate[]>,
  ordinal: number
): FunctionTutorScenarioSeed {
  const inputs = declaration.parameters.map((parameter) => {
    const candidate = candidatesByParameter.get(parameter.id)?.[0];
    return {
      parameterId: parameter.id,
      value: candidate?.value ?? createFunctionTutorUnknown("not-inferred"),
      omitted: false,
      certainty: candidate?.certainty ?? "unknown",
      evidence: candidate?.evidence ?? parameter.declarationEvidence
    };
  });
  const source = inputs.some((input) => input.certainty === "unknown") ? "mixed" : declaration.parameters.some((parameter) => parameter.defaultValue) ? "default" : "type";
  return {
    id: `tutor-seed:${createContentHash(inputs.map((input) => `${input.parameterId}=${stringifyFunctionTutorStaticValue(input.value)}`).join("\0")).slice(0, 24)}`,
    ordinal,
    title: source === "default" ? "Declared Defaults" : source === "type" ? "Type Baseline" : "Partial Type Baseline",
    source,
    certainty: inputs.some((input) => input.certainty === "unknown") ? "unknown" : inputs.some((input) => input.certainty === "inferred") ? "inferred" : "exact",
    inputs,
    objectiveIds: declaration.parameters.flatMap((parameter) => [
      `tutor-objective:type:${parameter.id}`,
      ...(parameter.defaultValue ? [`tutor-objective:default:${parameter.id}`] : [])
    ]),
    evidence: inputs.flatMap((input) => input.evidence),
    gaps: []
  };
}

function cloneSeedWithInput(
  baseline: FunctionTutorScenarioSeed,
  parameterId: string,
  value: FunctionTutorStaticValue,
  objectiveId: string
): FunctionTutorScenarioSeed {
  const inputs = baseline.inputs.map((input) => input.parameterId === parameterId
    ? { ...input, value, certainty: value.kind === "unknown" ? "unknown" as const : "inferred" as const }
    : { ...input });
  return {
    ...baseline,
    id: `tutor-seed:${createContentHash(`${baseline.id}\0${parameterId}\0${stringifyFunctionTutorStaticValue(value)}\0${objectiveId}`).slice(0, 24)}`,
    title: "Branch Boundary",
    source: "branch",
    certainty: inputs.some((input) => input.certainty === "unknown") ? "unknown" : "inferred",
    inputs,
    objectiveIds: [objectiveId]
  };
}

function appendSeed(seeds: FunctionTutorScenarioSeed[], seen: Set<string>, seed: FunctionTutorScenarioSeed): void {
  const key = seed.inputs.map((input) => `${input.parameterId}=${stringifyFunctionTutorStaticValue(input.value)}`).join("\0");
  if (seen.has(key) || seeds.length >= MAX_SCENARIOS) return;
  seen.add(key);
  seeds.push(seed);
}

function createCandidateId(parameterId: string, value: FunctionTutorStaticValue, source: string): string {
  return `tutor-candidate:${createContentHash(`${parameterId}\0${stringifyFunctionTutorStaticValue(value)}\0${source}`).slice(0, 24)}`;
}
