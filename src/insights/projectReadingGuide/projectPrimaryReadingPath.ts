/**
 * Graph-wide primary reading-path selection for the Guided Tour entrypoint.
 *
 * Every mapped flow reuses the bounded Reading Guide path projector and its
 * comparator. The scan retains only one winner and exact diagnostics; it never
 * projects source areas or materializes a repository-sized candidate list.
 */

import type { FunctionArchitectureIndex } from "../architecturalLayers";
import type { SemanticFlow } from "../semanticFlow";
import type {
  GraphEdge,
  FrameworkUnit,
  ProjectGraph,
  SymbolNode
} from "../../shared/types";
import {
  compareProjectReadingPathCandidates,
  createProjectReadingPath,
  type ProjectReadingPathCandidate
} from "./readingPath";
import {
  compareSemanticFlows,
  isMappedSemanticFlow,
  type ProjectReadingScopeIndex
} from "./scopeIndex";
import type {
  ProjectPrimaryReadingFallback,
  ProjectPrimaryReadingPath,
  ProjectPrimaryReadingPathDiagnostics,
  ProjectPrimaryReadingPathResult,
  ProjectPrimaryReadingStep,
  ProjectReadingEvidenceAnchor,
  ProjectReadingStep
} from "./types";

type PrimaryPathCandidate = ProjectReadingPathCandidate & {
  path: ProjectPrimaryReadingPath;
};

type FallbackEvidenceCandidate = {
  flow: SemanticFlow;
  scopeId: string;
  anchor: ProjectReadingEvidenceAnchor;
};

type SourceEvidenceIndex = {
  edgesById: ReadonlyMap<string, GraphEdge>;
  frameworkUnitsById: ReadonlyMap<string, FrameworkUnit>;
  nodesById: ReadonlyMap<string, SymbolNode>;
};

/** Selects zero or one navigable project path over an existing scope index. */
export function createProjectPrimaryReadingPath(
  graph: ProjectGraph,
  scopeIndex: ProjectReadingScopeIndex,
  architectureIndex: FunctionArchitectureIndex
): ProjectPrimaryReadingPathResult {
  const evidenceIndex = createSourceEvidenceIndex(graph);
  let winner: PrimaryPathCandidate | undefined;
  let fallbackEvidence: FallbackEvidenceCandidate | undefined;
  let supportedEntrypointCount = 0;
  let mappedHandlerCount = 0;
  let mappingGapCount = 0;
  let eligiblePathCount = 0;
  let navigableAnchorCount = 0;

  for (const scope of scopeIndex.scopes) {
    for (const flow of scope.flows) {
      supportedEntrypointCount += 1;
      if (hasEntrypointMappingGap(flow)) {
        mappingGapCount += 1;
      }

      const entrypointAnchor = createEntrypointEvidenceAnchor(flow);
      if (entrypointAnchor) {
        const candidate = { flow, scopeId: scope.summary.id, anchor: entrypointAnchor };
        if (!fallbackEvidence || compareFallbackEvidence(candidate, fallbackEvidence) < 0) {
          fallbackEvidence = candidate;
        }
      }

      if (!isMappedSemanticFlow(flow)) {
        continue;
      }

      mappedHandlerCount += 1;
      const path = enrichPrimaryPath(
        createProjectReadingPath(scope.summary.id, flow, architectureIndex),
        evidenceIndex
      );
      const pathAnchorCount = countPathAnchors(path);
      navigableAnchorCount += pathAnchorCount;
      if (pathAnchorCount === 0) {
        continue;
      }

      eligiblePathCount += 1;
      const candidate: PrimaryPathCandidate = { flow, path };
      if (!winner || compareProjectReadingPathCandidates(candidate, winner) < 0) {
        winner = candidate;
      }
    }
  }

  const diagnostics: ProjectPrimaryReadingPathDiagnostics = {
    supportedEntrypointCount,
    mappedHandlerCount,
    mappingGapCount,
    eligiblePathCount,
    navigableAnchorCount,
    fallback: createFallback(
      supportedEntrypointCount,
      mappedHandlerCount,
      fallbackEvidence
    )
  };

  return winner
    ? {
        graphVersion: scopeIndex.graphVersion,
        status: "selected",
        path: winner.path,
        diagnostics
      }
    : {
        graphVersion: scopeIndex.graphVersion,
        status: "unavailable",
        diagnostics
      };
}

/** Builds immutable lookup tables once for definition-adjacent evidence. */
function createSourceEvidenceIndex(graph: ProjectGraph): SourceEvidenceIndex {
  return {
    edgesById: new Map(graph.edges.map((edge) => [edge.id, edge])),
    frameworkUnitsById: new Map(
      (graph.metadata.frameworkUnits ?? []).map((unit) => [unit.id, unit])
    ),
    nodesById: new Map(graph.nodes.map((node) => [node.id, node]))
  };
}

/** Attaches definition, incoming callsite, and framework evidence when exact. */
function enrichPrimaryPath(
  path: ProjectReadingPathCandidate["path"],
  evidenceIndex: SourceEvidenceIndex
): ProjectPrimaryReadingPath {
  return {
    ...path,
    recommendation: {
      ...path.recommendation,
      whyRecommended: [...path.recommendation.whyRecommended],
      unknowns: [...path.recommendation.unknowns]
    },
    steps: path.steps.map((step) => ({
      ...step,
      architecture: {
        ...step.architecture,
        evidence: [...step.architecture.evidence],
        alternatives: [...step.architecture.alternatives]
      },
      readingCues: [...step.readingCues],
      contextInference: step.contextInference
        ? { ...step.contextInference, evidence: [...step.contextInference.evidence] }
        : undefined,
      sourceAnchors: createStepSourceAnchors(step, evidenceIndex)
    }))
  };
}

/** Preserves only anchors backed by a concrete source range. */
function createStepSourceAnchors(
  step: ProjectReadingStep,
  evidenceIndex: SourceEvidenceIndex
): ProjectPrimaryReadingStep["sourceAnchors"] {
  const functionNode = step.functionId
    ? evidenceIndex.nodesById.get(step.functionId)
    : undefined;
  const definition = step.resolution === "concrete"
      && step.kind !== "route"
      && step.kind !== "operation"
      && functionNode
    ? createAnchor(
      "definition",
      functionNode.filePath,
      functionNode.range,
      `Definition of ${functionNode.name}`,
      step.functionId
    )
    : undefined;
  const edge = step.callEdgeId ? evidenceIndex.edgesById.get(step.callEdgeId) : undefined;
  const incomingCallsite = step.kind === "call"
    ? edge?.range && edge.filePath
      ? createAnchor("callsite", edge.filePath, edge.range, `Call to ${step.name}`, step.ownerFunctionId)
      : step.resolution !== "concrete" && step.range
        ? createAnchor("callsite", step.filePath, step.range, `Call to ${step.name}`, step.ownerFunctionId)
        : undefined
    : undefined;
  const frameworkUnit = step.frameworkUnitId
    ? evidenceIndex.frameworkUnitsById.get(step.frameworkUnitId)
    : undefined;
  const frameworkEvidence = frameworkUnit?.range && frameworkUnit.filePath
    ? createAnchor(
      "frameworkEvidence",
      frameworkUnit.filePath,
      frameworkUnit.range,
      `${step.name} framework mapping`,
      step.functionId
    )
    : (step.kind === "route" || step.kind === "operation") && step.range
      ? createAnchor(
        "frameworkEvidence",
        step.filePath,
        step.range,
        `${step.name} entrypoint evidence`,
        step.functionId
      )
      : undefined;

  return { definition, incomingCallsite, frameworkEvidence };
}

/** Converts one exact location into the common host-only anchor contract. */
function createAnchor(
  locationKind: ProjectReadingEvidenceAnchor["locationKind"],
  filePath: string,
  range: ProjectReadingEvidenceAnchor["range"],
  label: string,
  ownerFunctionId?: string
): ProjectReadingEvidenceAnchor {
  return { locationKind, ownerFunctionId, filePath, range: { ...range }, label };
}

/** Counts retained anchors without treating repeated locations as new facts. */
function countPathAnchors(path: ProjectPrimaryReadingPath): number {
  const locations = new Set<string>();
  for (const step of path.steps) {
    // Entrypoint evidence explains the trigger but is not itself a learning stop.
    if (step.kind === "route" || step.kind === "operation") {
      continue;
    }
    for (const anchor of [
      step.sourceAnchors.definition,
      step.sourceAnchors.incomingCallsite,
      step.sourceAnchors.frameworkEvidence
    ]) {
      if (anchor) {
        locations.add(createAnchorLocationKey(anchor));
      }
    }
  }
  return locations.size;
}

/** Matches the Guided Tour's exact-location deduplication contract. */
function createAnchorLocationKey(anchor: ProjectReadingEvidenceAnchor): string {
  return [
    anchor.filePath,
    anchor.range.startLine,
    anchor.range.startCharacter,
    anchor.range.endLine,
    anchor.range.endCharacter
  ].join("\0");
}

/** Retains a route/operation location as an honest unavailable fallback. */
function createEntrypointEvidenceAnchor(
  flow: SemanticFlow
): ProjectReadingEvidenceAnchor | undefined {
  const step = flow.steps.find((candidate) =>
    (candidate.kind === "route" || candidate.kind === "operation")
      && candidate.range !== undefined
      && candidate.filePath.length > 0
  );
  return step?.range
    ? createAnchor(
      "frameworkEvidence",
      step.filePath,
      step.range,
      `${step.name} entrypoint evidence`,
      step.functionId
    )
    : undefined;
}

/** Provides one actionable fallback without inventing a random source file. */
function createFallback(
  supportedEntrypointCount: number,
  mappedHandlerCount: number,
  sourceEvidence: FallbackEvidenceCandidate | undefined
): ProjectPrimaryReadingFallback {
  if (sourceEvidence) {
    return { kind: "sourceEvidence", anchor: sourceEvidence.anchor };
  }
  if (supportedEntrypointCount > 0) {
    return {
      kind: "prefilteredMappingGaps",
      reason: mappedHandlerCount === 0 ? "handlerNotMapped" : "resolutionGap"
    };
  }
  return { kind: "none" };
}

/** Counts one entrypoint once even when analysis emitted duplicate diagnostics. */
function hasEntrypointMappingGap(flow: SemanticFlow): boolean {
  return flow.coverageGaps.some((gap) =>
    gap.reason === "ambiguous" || gap.reason === "handlerNotMapped"
  );
}

/** Orders fallback evidence by the same stable flow identity, then scope. */
function compareFallbackEvidence(
  left: FallbackEvidenceCandidate,
  right: FallbackEvidenceCandidate
): number {
  return compareSemanticFlows(left.flow, right.flow)
    || compareText(left.scopeId, right.scopeId);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
