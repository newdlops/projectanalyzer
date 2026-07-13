/**
 * Entrypoint-centered semantic-flow index built from ProjectGraph records.
 *
 * HTTP routes prefer direct callables and may fall back to outgoing `routesTo`
 * targets. GraphQL operations use only their direct resolver semantic. Tied
 * callable identities become coverage gaps instead of arbitrary selections.
 */

import {
  createFunctionFrameworkSemantics,
  type FunctionFrameworkSemantic
} from "../../graph/functionFrameworkSemantics";
import type {
  EdgeConfidence,
  FrameworkUnit,
  FrameworkUnitEdge,
  ProjectGraph,
  SymbolNode
} from "../../shared/types";
import type {
  CreateSemanticFlowIndexOptions,
  SemanticFlow,
  SemanticFlowCoverageGap,
  SemanticFlowEvidence,
  SemanticFlowIndex,
  SemanticFlowStep,
  SemanticFlowStepRole
} from "./types";
import {
  createCallTraversalContext,
  createDownstreamTrace,
  type CallTraversalContext
} from "./downstreamTrace";

type HandlerCandidate = {
  functionId: string;
  targetUnit: FrameworkUnit;
  evidence: SemanticFlowEvidence[];
  confidence: EdgeConfidence;
};

type RouteTarget = {
  unit: FrameworkUnit;
  evidence: SemanticFlowEvidence;
};

const CONFIDENCE_RANK: Record<EdgeConfidence, number> = {
  exact: 0,
  resolved: 1,
  inferred: 2,
  unresolved: 3
};

/**
 * Builds deterministic semantic flows for every HTTP route and GraphQL operation.
 *
 * The function reuses the framework semantic linker as its only callable
 * binding source. Framework metadata payloads and identifier shapes are never
 * interpreted, keeping this domain index independent from analyzer internals.
 */
export function createSemanticFlowIndex(
  graph: ProjectGraph,
  options: CreateSemanticFlowIndexOptions = {}
): SemanticFlowIndex {
  const frameworkUnits = graph.metadata.frameworkUnits ?? [];
  const frameworkUnitEdges = graph.metadata.frameworkUnitEdges ?? [];
  const semantics = createFunctionFrameworkSemantics(graph);
  const unitsById = createFrameworkUnitIndex(frameworkUnits);
  const nodesById = createNodeIndex(graph.nodes);
  const routeTargetsByRouteId = createRouteTargetIndex(frameworkUnitEdges, unitsById);
  const traversalContext = createCallTraversalContext(
    graph,
    nodesById,
    semantics.semanticsByFunctionId,
    options
  );
  const entrypoints = frameworkUnits.filter(isSemanticFlowEntrypoint).sort(compareFrameworkUnits);
  const flows: SemanticFlow[] = [];
  const flowsByEntrypointUnitId = new Map<string, SemanticFlow[]>();
  const flowsByRouteUnitId = new Map<string, SemanticFlow[]>();
  const coverageGaps: SemanticFlowCoverageGap[] = [];
  const coverageGapsByEntrypointUnitId = new Map<string, SemanticFlowCoverageGap[]>();
  const coverageGapsByRouteUnitId = new Map<string, SemanticFlowCoverageGap[]>();

  for (const entrypoint of entrypoints) {
    const directCandidates = createDirectCandidates(
      entrypoint,
      semantics.semanticsByFrameworkUnitId.get(entrypoint.id) ?? []
    );
    const routeTargets = entrypoint.kind === "route"
      ? routeTargetsByRouteId.get(entrypoint.id) ?? []
      : [];
    const candidates = directCandidates.length > 0
      ? directCandidates
      : createTargetCandidates(entrypoint, routeTargets, semantics.semanticsByFrameworkUnitId);
    const flow = createEntrypointFlow(entrypoint, candidates, routeTargets, traversalContext);

    flows.push(flow);
    appendIndexedValue(flowsByEntrypointUnitId, entrypoint.id, flow);

    if (entrypoint.kind === "route") {
      appendIndexedValue(flowsByRouteUnitId, entrypoint.id, flow);
    }

    for (const gap of flow.coverageGaps) {
      coverageGaps.push(gap);
      appendIndexedValue(coverageGapsByEntrypointUnitId, entrypoint.id, gap);

      if (entrypoint.kind === "route") {
        appendIndexedValue(coverageGapsByRouteUnitId, entrypoint.id, gap);
      }
    }
  }

  return {
    graphVersion: graph.version,
    flows,
    flowsByEntrypointUnitId,
    flowsByRouteUnitId,
    coverageGaps,
    coverageGapsByEntrypointUnitId,
    coverageGapsByRouteUnitId,
    summary: createSummary(graph.version, flows)
  };
}

/** Creates direct entrypoint-callable candidates from linker output. */
function createDirectCandidates(
  entrypoint: FrameworkUnit,
  semantics: FunctionFrameworkSemantic[]
): HandlerCandidate[] {
  const candidates: HandlerCandidate[] = [];

  for (const semantic of semantics) {
    const confidence = normalizeConfidence(semantic.confidence);
    const evidence: SemanticFlowEvidence = {
      kind: "directCallable",
      confidence,
      description: `${getEntrypointLabel(entrypoint)} ${entrypoint.name} directly matches callable ${semantic.functionId}`,
      entrypointUnitId: entrypoint.id,
      routeUnitId: entrypoint.kind === "route" ? entrypoint.id : undefined,
      frameworkUnitId: entrypoint.id,
      functionId: semantic.functionId
    };

    candidates.push({
      functionId: semantic.functionId,
      targetUnit: entrypoint,
      evidence: [evidence],
      confidence
    });
  }

  return deduplicateCandidates(candidates);
}

/** Creates fallback candidates from outgoing routesTo targets and their callables. */
function createTargetCandidates(
  route: FrameworkUnit,
  targets: RouteTarget[],
  semanticsByFrameworkUnitId: Map<string, FunctionFrameworkSemantic[]>
): HandlerCandidate[] {
  const candidates: HandlerCandidate[] = [];

  for (const target of targets) {
    const targetSemantics = semanticsByFrameworkUnitId.get(target.unit.id) ?? [];

    for (const semantic of targetSemantics) {
      const callableConfidence = normalizeConfidence(semantic.confidence);
      const callableEvidence: SemanticFlowEvidence = {
        kind: "targetCallable",
        confidence: callableConfidence,
        description: `Target ${target.unit.name} matches callable ${semantic.functionId}`,
        entrypointUnitId: route.id,
        routeUnitId: route.id,
        frameworkUnitId: target.unit.id,
        functionId: semantic.functionId
      };
      const evidence = [target.evidence, callableEvidence];

      candidates.push({
        functionId: semantic.functionId,
        targetUnit: target.unit,
        evidence,
        confidence: getWeakestConfidence(evidence)
      });
    }
  }

  return deduplicateCandidates(candidates);
}

/** Resolves one entrypoint flow without selecting tied callable identities. */
function createEntrypointFlow(
  entrypoint: FrameworkUnit,
  candidates: HandlerCandidate[],
  targets: RouteTarget[],
  traversalContext: CallTraversalContext
): SemanticFlow {
  const entrypointStep = createFrameworkStep(
    entrypoint.kind === "operation" ? "operation" : "route",
    entrypoint
  );
  const bestCandidates = getHighestConfidenceCandidates(candidates);

  if (bestCandidates.length > 1) {
    const candidateFunctionIds = bestCandidates.map((candidate) => candidate.functionId).sort(compareText);
    const targetFrameworkUnitIds = uniqueSortedStrings(
      bestCandidates.map((candidate) => candidate.targetUnit.id)
    );
    const gap = createCoverageGap(
      entrypoint,
      "ambiguous",
      `Multiple equally trusted callables match ${getEntrypointLabel(entrypoint).toLowerCase()} ${entrypoint.name}`,
      candidateFunctionIds,
      targetFrameworkUnitIds,
      []
    );
    const evidence = bestCandidates.flatMap((candidate) => candidate.evidence).sort(compareEvidence);

    return createFlow(entrypoint, [entrypointStep], evidence, [gap]);
  }

  const selected = bestCandidates[0];

  if (selected) {
    const handlerStep = createFrameworkStep(
      "handler",
      selected.targetUnit,
      selected.functionId,
      traversalContext.nodesById.get(selected.functionId)
    );
    const downstream = createDownstreamTrace(entrypoint, selected.functionId, traversalContext);

    return createFlow(
      entrypoint,
      [entrypointStep, handlerStep, ...downstream.steps],
      selected.evidence,
      downstream.coverageGaps
    );
  }

  const targetSteps = targets.map((target) => createFrameworkStep("handler", target.unit));
  const targetEvidence = targets.map((target) => target.evidence).sort(compareEvidence);
  const gap = createCoverageGap(
    entrypoint,
    "handlerNotMapped",
    `No callable handler is mapped for ${getEntrypointLabel(entrypoint).toLowerCase()} ${entrypoint.name}`,
    [],
    uniqueSortedStrings(targets.map((target) => target.unit.id)),
    []
  );

  return createFlow(entrypoint, [entrypointStep, ...targetSteps], targetEvidence, [gap]);
}

/** Creates one immutable-shaped flow record and derives confidence from evidence. */
function createFlow(
  entrypoint: FrameworkUnit,
  steps: SemanticFlowStep[],
  evidence: SemanticFlowEvidence[],
  coverageGaps: SemanticFlowCoverageGap[]
): SemanticFlow {
  return {
    id: entrypoint.id,
    entrypointKind: entrypoint.kind === "operation" ? "graphqlOperation" : "httpRoute",
    entrypointUnitId: entrypoint.id,
    routeUnitId: entrypoint.kind === "route" ? entrypoint.id : undefined,
    framework: entrypoint.framework,
    rootPath: entrypoint.rootPath,
    name: entrypoint.name,
    steps,
    evidence,
    confidence: evidence.length > 0 ? getWeakestConfidence(evidence) : undefined,
    coverageGaps
  };
}

/** Creates a source-backed step without reading analyzer-specific metadata. */
function createFrameworkStep(
  kind: SemanticFlowStep["kind"],
  unit: FrameworkUnit,
  functionId?: string,
  functionNode?: SymbolNode
): SemanticFlowStep {
  return {
    kind,
    depth: kind === "route" || kind === "operation" ? 0 : 1,
    role: kind === "route" ? "routeHandler" : mapFrameworkUnitToStepRole(unit),
    resolution: functionId && functionNode ? "concrete" : "unresolved",
    frameworkUnitId: unit.id,
    functionId,
    framework: unit.framework,
    unitKind: unit.kind,
    name: unit.name,
    qualifiedName: unit.qualifiedName,
    functionName: functionNode?.name,
    functionQualifiedName: functionNode?.qualifiedName,
    filePath: unit.filePath,
    range: unit.range
  };
}

/** Creates one coverage-gap record with already deterministic identifiers. */
function createCoverageGap(
  entrypoint: FrameworkUnit,
  reason: SemanticFlowCoverageGap["reason"],
  message: string,
  candidateFunctionIds: string[],
  targetFrameworkUnitIds: string[],
  omittedFunctionIds: string[],
  sourceFunctionId?: string,
  limit?: number
): SemanticFlowCoverageGap {
  return {
    entrypointUnitId: entrypoint.id,
    routeUnitId: entrypoint.kind === "route" ? entrypoint.id : undefined,
    reason,
    message,
    candidateFunctionIds,
    targetFrameworkUnitIds,
    sourceFunctionId,
    omittedFunctionIds,
    limit
  };
}

/** Maps a route-selected framework target into the same semantic role vocabulary. */
function mapFrameworkUnitToStepRole(unit: FrameworkUnit): SemanticFlowStepRole {
  switch (unit.kind) {
    case "operation":
      return "resolver";
    case "route":
    case "view":
      return "routeHandler";
    case "controller":
      return "controller";
    case "service":
      return "service";
    case "repository":
      return "repository";
    case "model":
    case "entity":
      return "model";
    default:
      return "unknown";
  }
}

/** Narrows framework units to entrypoint kinds understood by this index. */
function isSemanticFlowEntrypoint(unit: FrameworkUnit): boolean {
  return unit.kind === "route" || unit.kind === "operation";
}

/** Returns a concise term without conflating schema and HTTP dispatch. */
function getEntrypointLabel(entrypoint: FrameworkUnit): "Route" | "Operation" {
  return entrypoint.kind === "operation" ? "Operation" : "Route";
}

/** Groups framework units by their declared identity without interpreting it. */
function createFrameworkUnitIndex(units: FrameworkUnit[]): Map<string, FrameworkUnit[]> {
  const unitsById = new Map<string, FrameworkUnit[]>();

  for (const unit of units) {
    appendIndexedValue(unitsById, unit.id, unit);
  }

  for (const indexedUnits of unitsById.values()) {
    indexedUnits.sort(compareFrameworkUnits);
  }

  return unitsById;
}

/** Indexes concrete graph nodes by their exact symbol identity. */
function createNodeIndex(nodes: SymbolNode[]): Map<string, SymbolNode> {
  const nodesById = new Map<string, SymbolNode>();

  for (const node of nodes) {
    if (!nodesById.has(node.id)) {
      nodesById.set(node.id, node);
    }
  }

  return nodesById;
}

/** Builds deduplicated route targets from declared routesTo edges. */
function createRouteTargetIndex(
  edges: FrameworkUnitEdge[],
  unitsById: Map<string, FrameworkUnit[]>
): Map<string, RouteTarget[]> {
  const bestTargetsByRouteId = new Map<string, Map<string, RouteTarget>>();

  for (const edge of edges) {
    if (edge.kind !== "routesTo") {
      continue;
    }

    const targetUnits = unitsById.get(edge.targetId) ?? [];
    const confidence = normalizeConfidence(edge.confidence);

    for (const targetUnit of targetUnits) {
      const target: RouteTarget = {
        unit: targetUnit,
        evidence: {
          kind: "routesTo",
          confidence,
          description: `Route ${edge.sourceId} routes to framework unit ${targetUnit.name}`,
          entrypointUnitId: edge.sourceId,
          routeUnitId: edge.sourceId,
          frameworkUnitId: targetUnit.id,
          sourceFrameworkUnitId: edge.sourceId,
          targetFrameworkUnitId: targetUnit.id
        }
      };
      const targetsByUnitId = bestTargetsByRouteId.get(edge.sourceId) ?? new Map<string, RouteTarget>();
      const current = targetsByUnitId.get(targetUnit.id);

      if (!current || compareConfidence(target.evidence.confidence, current.evidence.confidence) < 0) {
        targetsByUnitId.set(targetUnit.id, target);
      }

      bestTargetsByRouteId.set(edge.sourceId, targetsByUnitId);
    }
  }

  const targetsByRouteId = new Map<string, RouteTarget[]>();

  for (const [routeId, targetsByUnitId] of bestTargetsByRouteId) {
    const targets = [...targetsByUnitId.values()].sort((left, right) =>
      compareFrameworkUnits(left.unit, right.unit)
    );
    targetsByRouteId.set(routeId, targets);
  }

  return targetsByRouteId;
}

/** Retains the strongest deterministic path for each distinct callable. */
function deduplicateCandidates(candidates: HandlerCandidate[]): HandlerCandidate[] {
  const candidatesByFunctionId = new Map<string, HandlerCandidate>();

  for (const candidate of candidates) {
    const current = candidatesByFunctionId.get(candidate.functionId);

    if (!current || compareCandidates(candidate, current) < 0) {
      candidatesByFunctionId.set(candidate.functionId, candidate);
    }
  }

  return [...candidatesByFunctionId.values()].sort(compareCandidates);
}

/** Returns every callable tied at the strongest available confidence. */
function getHighestConfidenceCandidates(candidates: HandlerCandidate[]): HandlerCandidate[] {
  if (candidates.length === 0) {
    return [];
  }

  // An iterative minimum avoids spreading large route candidate sets onto the
  // JavaScript call stack when an analyzer emits unusually broad matches.
  let bestRank = CONFIDENCE_RANK.unresolved;

  for (const candidate of candidates) {
    bestRank = Math.min(bestRank, CONFIDENCE_RANK[candidate.confidence]);
  }

  return candidates
    .filter((candidate) => CONFIDENCE_RANK[candidate.confidence] === bestRank)
    .sort(compareCandidates);
}

/** Returns the least certain confidence among all evidence in one path. */
function getWeakestConfidence(evidence: SemanticFlowEvidence[]): EdgeConfidence {
  let weakest: EdgeConfidence = "exact";

  for (const item of evidence) {
    if (CONFIDENCE_RANK[item.confidence] > CONFIDENCE_RANK[weakest]) {
      weakest = item.confidence;
    }
  }

  return weakest;
}

/** Treats omitted legacy confidence as unresolved rather than overstating it. */
function normalizeConfidence(confidence: EdgeConfidence | undefined): EdgeConfidence {
  return confidence ?? "unresolved";
}

/** Creates aggregate counters without inferring facts outside the built flows. */
function createSummary(graphVersion: string, flows: SemanticFlow[]): SemanticFlowIndex["summary"] {
  let mappedHandlerCount = 0;
  let ambiguousEntrypointCount = 0;
  let ambiguousRouteCount = 0;
  let ambiguousOperationCount = 0;
  let handlerNotMappedCount = 0;

  for (const flow of flows) {
    if (flow.steps.some((step) => step.kind === "handler" && step.functionId !== undefined)) {
      mappedHandlerCount += 1;
    }

    for (const gap of flow.coverageGaps) {
      if (gap.reason === "ambiguous") {
        ambiguousEntrypointCount += 1;

        if (flow.entrypointKind === "httpRoute") {
          ambiguousRouteCount += 1;
        } else {
          ambiguousOperationCount += 1;
        }
      } else if (gap.reason === "handlerNotMapped") {
        handlerNotMappedCount += 1;
      }
    }
  }

  return {
    graphVersion,
    entrypointCount: flows.length,
    routeCount: flows.filter((flow) => flow.entrypointKind === "httpRoute").length,
    operationCount: flows.filter((flow) => flow.entrypointKind === "graphqlOperation").length,
    mappedHandlerCount,
    ambiguousEntrypointCount,
    ambiguousRouteCount,
    ambiguousOperationCount,
    handlerNotMappedCount
  };
}

/** Adds one value to a multi-value identity index. */
function appendIndexedValue<T>(index: Map<string, T[]>, key: string, value: T): void {
  const values = index.get(key) ?? [];
  values.push(value);
  index.set(key, values);
}

/** Orders candidates by confidence, target identity, then callable identity. */
function compareCandidates(left: HandlerCandidate, right: HandlerCandidate): number {
  return compareConfidence(left.confidence, right.confidence)
    || compareFrameworkUnits(left.targetUnit, right.targetUnit)
    || compareText(left.functionId, right.functionId)
    || compareEvidenceLists(left.evidence, right.evidence);
}

/** Orders evidence so shuffled input produces byte-stable arrays. */
function compareEvidence(left: SemanticFlowEvidence, right: SemanticFlowEvidence): number {
  return compareText(left.kind, right.kind)
    || compareConfidence(left.confidence, right.confidence)
    || compareText(left.frameworkUnitId, right.frameworkUnitId)
    || compareText(left.functionId ?? "", right.functionId ?? "")
    || compareText(left.sourceFrameworkUnitId ?? "", right.sourceFrameworkUnitId ?? "")
    || compareText(left.targetFrameworkUnitId ?? "", right.targetFrameworkUnitId ?? "");
}

/** Lexicographically compares complete evidence paths. */
function compareEvidenceLists(left: SemanticFlowEvidence[], right: SemanticFlowEvidence[]): number {
  const limit = Math.min(left.length, right.length);

  for (let index = 0; index < limit; index += 1) {
    const comparison = compareEvidence(left[index], right[index]);

    if (comparison !== 0) {
      return comparison;
    }
  }

  return left.length - right.length;
}

/** Orders route and target units using only declared domain fields. */
function compareFrameworkUnits(left: FrameworkUnit, right: FrameworkUnit): number {
  return compareText(left.framework, right.framework)
    || compareText(left.rootPath, right.rootPath)
    || compareText(left.filePath, right.filePath)
    || compareRanges(left, right)
    || compareText(left.qualifiedName ?? "", right.qualifiedName ?? "")
    || compareText(left.name, right.name)
    || compareText(left.id, right.id);
}

/** Orders optional source ranges by their four source coordinates. */
function compareRanges(left: FrameworkUnit, right: FrameworkUnit): number {
  const leftRange = left.range;
  const rightRange = right.range;

  if (!leftRange && !rightRange) {
    return 0;
  }

  if (!leftRange) {
    return 1;
  }

  if (!rightRange) {
    return -1;
  }

  return leftRange.startLine - rightRange.startLine
    || leftRange.startCharacter - rightRange.startCharacter
    || leftRange.endLine - rightRange.endLine
    || leftRange.endCharacter - rightRange.endCharacter;
}

/** Orders confidence from strongest to weakest. */
function compareConfidence(left: EdgeConfidence, right: EdgeConfidence): number {
  return CONFIDENCE_RANK[left] - CONFIDENCE_RANK[right];
}

/** Creates a sorted distinct string array for stable public records. */
function uniqueSortedStrings(values: string[]): string[] {
  return [...new Set(values)].sort(compareText);
}

/** Locale-independent string ordering used for deterministic domain output. */
function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}
