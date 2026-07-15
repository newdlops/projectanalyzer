/**
 * Pure Guided Tour mission projection from the public primary-path contract.
 * No graph, semantic-flow, architecture-index, protocol, or VS Code dependency
 * is consulted here, keeping recommendation and layer evidence single-sourced.
 */

import type {
  ProjectPrimaryReadingPath,
  ProjectPrimaryReadingPathDiagnostics,
  ProjectPrimaryReadingPathResult,
  ProjectReadingEvidenceAnchor
} from "../projectReadingGuide";
import { createGuidedTourStops } from "./stopProjector";
import type {
  GuidedTourMission,
  GuidedTourProjection,
  GuidedTourSelectionEvidence,
  GuidedTourSourceAnchor,
  GuidedTourUnavailable
} from "./types";

/** Creates exactly one ready mission or one evidence-backed unavailable state. */
export function createGuidedTourProjection(
  primaryPath: ProjectPrimaryReadingPathResult
): GuidedTourProjection {
  if (primaryPath.status === "unavailable") {
    return {
      graphVersion: primaryPath.graphVersion,
      availability: "unavailable",
      unavailable: createUnavailable(primaryPath.diagnostics)
    };
  }

  const mission = createMission(primaryPath.path);
  if (!mission.stops.some((stop) => stop.mode === "navigable")) {
    return {
      graphVersion: primaryPath.graphVersion,
      availability: "unavailable",
      unavailable: createUnavailable(primaryPath.diagnostics, "noNavigableAnchor")
    };
  }

  return {
    graphVersion: primaryPath.graphVersion,
    availability: "ready",
    mission
  };
}

/** Turns one bounded path into fixed educational framing and ordered stops. */
function createMission(path: ProjectPrimaryReadingPath): GuidedTourMission {
  const stops = createGuidedTourStops(path);
  const selectionEvidence = getSelectionEvidence(path);

  return {
    id: `guided-tour:mission:${encodeURIComponent(path.id)}`,
    scopeId: path.scopeId,
    pathId: path.id,
    title: createMissionTitle(path),
    trigger: path.name,
    objective: createMissionObjective(path),
    selection: {
      evidenceKind: selectionEvidence,
      reasons: path.recommendation.whyRecommended.slice(0, 3),
      unknowns: path.recommendation.unknowns.slice(0, 3)
    },
    stops,
    explainBack: [
      "Explain how the entrypoint reaches the first concrete handler.",
      "Separate the observed decision candidate from delivery and infrastructure concerns.",
      "Name the last evidenced boundary and one fact that remains unknown."
    ],
    exitCriteria: "You can explain the observed path and its evidence gaps without treating it as complete runtime behavior."
  };
}

/** Uses fixed titles so raw analyzer labels cannot become headline markup. */
function createMissionTitle(path: ProjectPrimaryReadingPath): string {
  return path.entrypointKind === "graphqlOperation"
    ? "Trace one GraphQL operation through the code"
    : "Trace one request through the code";
}

/** Scopes the promise to the actual business/effect evidence reached. */
function createMissionObjective(path: ProjectPrimaryReadingPath): string {
  switch (path.recommendation.businessReach) {
    case "domainCandidateReached":
      return "Follow the mapped handler to a domain-rule candidate and the observed boundary beyond it.";
    case "applicationCandidateReached":
      return "Follow the mapped handler to an application-workflow candidate and separate orchestration from boundaries.";
    case "workflowBridgeCandidateReached":
      return "Inspect a possible workflow bridge between the handler and an explicit effect boundary.";
    case "analysisLimited":
      return "Learn the confirmed part of this handler path and identify where static analysis stops.";
    default:
      return "Trace the mapped handler and distinguish confirmed collaborators from unresolved responsibilities.";
  }
}

/** Maps Reading Guide evidence without introducing a second ranking system. */
function getSelectionEvidence(
  path: ProjectPrimaryReadingPath
): GuidedTourSelectionEvidence {
  switch (path.recommendation.businessReach) {
    case "domainCandidateReached":
      return "domainCandidate";
    case "applicationCandidateReached":
      return "applicationCandidate";
    case "workflowBridgeCandidateReached":
      return "workflowBridgeCandidate";
    default:
      return path.steps.some((step) => step.boundaryKind)
        ? "mappedBoundaryPath"
        : "concreteHandlerInvestigation";
  }
}

/** Converts exact primary-path diagnostics into a standalone empty state. */
function createUnavailable(
  diagnostics: ProjectPrimaryReadingPathDiagnostics,
  forcedReason?: GuidedTourUnavailable["reason"]
): GuidedTourUnavailable {
  const reason = forcedReason
    ?? (diagnostics.supportedEntrypointCount === 0
      ? "noSupportedEntrypoint"
      : diagnostics.mappedHandlerCount === 0
        ? "handlerNotMapped"
        : "noNavigableAnchor");

  return {
    reason,
    explanation: createUnavailableExplanation(reason),
    observedEvidence: [
      `${diagnostics.supportedEntrypointCount} supported entrypoint(s) observed.`,
      `${diagnostics.mappedHandlerCount} concrete handler mapping(s) observed.`,
      `${diagnostics.mappingGapCount} entrypoint mapping gap(s) observed.`
    ],
    nextAction: createUnavailableAction(diagnostics.fallback, reason)
  };
}

function createUnavailableExplanation(reason: GuidedTourUnavailable["reason"]): string {
  switch (reason) {
    case "noSupportedEntrypoint":
      return "No supported HTTP route or GraphQL operation was identified for a source-guided mission.";
    case "handlerNotMapped":
      return "Entrypoint evidence exists, but analysis could not map it to one concrete handler.";
    default:
      return "A mapped path exists, but it has no exact source range that the tour can open safely.";
  }
}

/** Offers at most one concrete fallback and never recommends an arbitrary file. */
function createUnavailableAction(
  fallback: ProjectPrimaryReadingPathDiagnostics["fallback"],
  reason: GuidedTourUnavailable["reason"]
): GuidedTourUnavailable["nextAction"] {
  if (fallback.kind === "sourceEvidence") {
    return {
      kind: "openAnchor",
      target: toUnavailableAnchor(fallback.anchor),
      label: "Open the identified entrypoint evidence",
      lookFor: "Check how this route or operation declares or references its handler."
    };
  }
  if (fallback.kind === "prefilteredMappingGaps") {
    return {
      kind: "openPrefilteredExplore",
      destination: "mappingGaps",
      scopeId: fallback.scopeId,
      label: "Inspect entrypoint mapping gaps",
      lookFor: fallback.reason === "handlerNotMapped"
        ? "Find the runtime or framework binding that selects a concrete handler."
        : "Find the dynamic call or missing source fact that blocks resolution."
    };
  }
  return {
    kind: "none",
    explanation: reason === "noSupportedEntrypoint"
      ? "Analyze a supported HTTP or GraphQL execution surface before starting a guided path."
      : "No exact fallback source location is available."
  };
}

/** Gives unavailable anchors the same adapter-ready shape as mission anchors. */
function toUnavailableAnchor(
  anchor: ProjectReadingEvidenceAnchor
): GuidedTourSourceAnchor {
  return {
    id: `guided-tour:unavailable:anchor:${anchor.locationKind}`,
    locationKind: anchor.locationKind,
    functionId: anchor.ownerFunctionId,
    ownerFunctionId: anchor.ownerFunctionId,
    filePath: anchor.filePath,
    range: { ...anchor.range },
    label: anchor.label
  };
}
