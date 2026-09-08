/**
 * Bounded application planning for Function Guide input cases. It samples graph-backed caller
 * tuples, derives small parameter domains, and greedily selects representative
 * scenarios without constructing a Cartesian product.
 */

import { resolve } from "node:path";
import { analyzeFunctionTutorCallsite } from "../../../analyzer/functionTutor";
import {
  stringifyFunctionTutorStaticValue
} from "../../../analyzer/functionTutor/staticValue";
import type {
  FunctionTutorCallsiteTuple,
  FunctionTutorDeclarationAnalysis,
  FunctionTutorGap
} from "../../../analyzer/functionTutor";
import type { FunctionLogicAnalysis } from "../../../analyzer/functionLogic";
import type { FunctionArchitectureIndex } from "../../../insights/architecturalLayers";
import type { SemanticFlowIndex } from "../../../insights/semanticFlow";
import type { FunctionIndex } from "../../../graph/functionIndex";
import type { GraphEdge, ProjectGraph } from "../../../shared/types";
import type {
  FunctionTutorBuildModel
} from "./types";
import { collectFunctionTutorCodebaseContext } from "./functionTutorContextCollector";
import { buildFunctionTutorGuide } from "./functionTutorGuidePlanner";
import { createCandidateDomains, createObjectives, createScenarioSeeds } from "./functionTutorInputPlanner";
import { buildScenarioProgramBundle } from "./scenarioProgramBundle";
import { analyzeFunctionFrameworkBehavior } from "../../../analyzer/frameworkBehavior";

const MAX_INCOMING_CALLSITES = 8;
const MAX_CALLER_FILES = 6;
const MAX_CALLSITE_TUPLES = 4;

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
  const frameworkBehavior = analyzeFunctionFrameworkBehavior({
    functionNode: input.declaration.functionNode,
    sourceText: await input.readSourceText(input.declaration.functionNode.filePath).catch(() => undefined),
    // The engine emits workspace-relative package roots; syntax adapters compare absolute source ownership.
    frameworks: input.graph.metadata.frameworks?.map((framework) => ({ ...framework, rootPath: resolve(input.graph.workspaceRoot, framework.rootPath || ".") })),
    units: input.graph.metadata.frameworkUnits
  });
  const scenarioBundle = input.declaration.language === "typescript" || input.declaration.language === "javascript"
    ? await buildScenarioProgramBundle(input.graph, input.declaration, input.readSourceText)
    : undefined;
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
    scenarioBundle,
    frameworkBehavior,
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
