/**
 * Architecture and recommendation helpers for bounded source-reading paths.
 * Callable layers come from the graph-stable architecture index. Flow position
 * affects only reading cues and never reclassifies a function's layer.
 */

import {
  assessFunctionArchitecture,
  type FunctionArchitectureAssessment,
  type FunctionArchitectureIndex
} from "../architecturalLayers";
import type { SemanticFlowStep } from "../semanticFlow";
import type { EdgeConfidence } from "../../shared/types";
import type {
  ProjectReadingArchitecture,
  ProjectReadingBoundaryKind,
  ProjectReadingBusinessReach,
  ProjectReadingRecommendation,
  ProjectReadingStep,
  ProjectReadingTraceStatus
} from "./types";

/** Returns a graph-stable assessment or a conservative step-local fallback. */
export function getReadingStepArchitecture(
  step: SemanticFlowStep,
  architectureIndex: FunctionArchitectureIndex
): ProjectReadingArchitecture {
  if (step.kind === "route" || step.kind === "operation") {
    return {
      layer: "entrypoint",
      confidence: "medium",
      businessLogic: "notBusinessLogic",
      purity: "unknown",
      evidence: ["Framework route or operation is the request entrypoint."],
      alternatives: [],
      conflicted: false
    };
  }

  if (step.resolution === "unresolved") {
    return {
      layer: "unclassified",
      confidence: "unknown",
      businessLogic: "unknown",
      purity: "unknown",
      evidence: ["Call target is unresolved, so its structural layer is unknown."],
      alternatives: [],
      conflicted: false
    };
  }

  if (step.role === "sideEffect") {
    return {
      layer: "infrastructure",
      confidence: "medium",
      businessLogic: "notBusinessLogic",
      purity: "unknown",
      evidence: ["Trace identifies a side-effect boundary."],
      alternatives: [],
      conflicted: false
    };
  }

  if (step.resolution === "external" || step.role === "external") {
    return {
      layer: "unclassified",
      confidence: "unknown",
      businessLogic: "unknown",
      purity: "unknown",
      evidence: ["Trace reaches a non-local call boundary; its architectural layer is unknown."],
      alternatives: [],
      conflicted: false
    };
  }

  const indexed = step.functionId
    ? architectureIndex.assessmentsByFunctionId.get(step.functionId)
    : undefined;
  if (indexed) {
    return toReadingArchitecture(indexed);
  }

  // This fallback supports incomplete/fixture graphs using the same intrinsic
  // classifier. Missing graph identities cannot safely use an absolute source
  // path, because checkout ancestors are outside the analyzed project.
  const fallback = assessFunctionArchitecture({
    functionId: step.functionId ?? step.frameworkUnitId ?? "unmapped-step",
    projectRelativePath: undefined,
    semantics: step.unitKind ? [{ unitKind: step.unitKind, bindingConfidence: step.confidence }] : []
  });
  return toReadingArchitecture(fallback);
}

/** Creates a bounded explanation and target after visible steps are finalized. */
export function createReadingRecommendation(
  steps: ProjectReadingStep[],
  depthLimitReached: boolean,
  stepLimitReached: boolean,
  unresolvedCallCount: number,
  omittedStepCount: number
): ProjectReadingRecommendation {
  const domainIndex = steps.findIndex((step) =>
    step.architecture.businessLogic === "domainRuleCandidate"
  );
  const applicationIndex = steps.findIndex((step) =>
    step.architecture.businessLogic === "applicationWorkflowCandidate"
  );
  const contextualIndex = steps.findIndex((step) =>
    step.contextInference?.role === "workflowBridgeCandidate"
  );
  const handlerIndex = steps.findIndex((step) => step.kind === "handler");
  const targetStepIndex = domainIndex >= 0
    ? domainIndex
    : applicationIndex >= 0
      ? applicationIndex
      : contextualIndex >= 0
        ? contextualIndex
      : handlerIndex >= 0 ? handlerIndex : undefined;
  const limited = depthLimitReached || stepLimitReached;
  const businessReach: ProjectReadingBusinessReach = domainIndex >= 0
    ? "domainCandidateReached"
    : applicationIndex >= 0
      ? "applicationCandidateReached"
      : contextualIndex >= 0
        ? "workflowBridgeCandidateReached"
      : limited ? "analysisLimited" : "noCandidateObserved";

  if (targetStepIndex !== undefined) {
    appendCue(steps[targetStepIndex], "startHere");
  }
  for (const step of steps) {
    if (
      step.architecture.businessLogic === "domainRuleCandidate"
      || step.architecture.businessLogic === "applicationWorkflowCandidate"
    ) {
      appendCue(step, "businessLogicCandidate");
    }
    if (step.contextInference?.role === "workflowBridgeCandidate") {
      appendCue(step, "workflowBridgeCandidate");
    }
    if (step.boundaryKind) {
      appendCue(step, "boundary");
    }
    if (step.resolution === "unresolved" || step.architecture.conflicted) {
      appendCue(step, "evidenceGap");
    }
  }

  const boundary = steps.find((step) => step.boundaryKind);
  const whyRecommended = createWhyRecommended(steps, businessReach, boundary?.boundaryKind);
  const unknowns = createUnknowns(
    businessReach,
    depthLimitReached,
    stepLimitReached,
    unresolvedCallCount,
    omittedStepCount
  );

  return {
    businessReach,
    targetStepIndex,
    explanation: createRecommendationExplanation(businessReach),
    whyRecommended,
    unknowns
  };
}

/** Numeric tuple used only to rank educational evidence, never runtime importance. */
export function getReadingRecommendationRank(
  recommendation: ProjectReadingRecommendation,
  steps: readonly ProjectReadingStep[],
  unresolvedCallCount: number,
  traceStatus: ProjectReadingTraceStatus,
  mappingConfidence: EdgeConfidence | undefined
): readonly number[] {
  const reachRank = recommendation.businessReach === "domainCandidateReached"
    ? 4
    : recommendation.businessReach === "applicationCandidateReached"
      ? 3
      : recommendation.businessReach === "workflowBridgeCandidateReached"
        ? 2
      : recommendation.businessReach === "noCandidateObserved" ? 1 : 0;
  const target = recommendation.targetStepIndex === undefined
    ? undefined
    : steps[recommendation.targetStepIndex];
  const confidenceRank = target?.architecture.confidence === "high"
    ? 3
    : target?.architecture.confidence === "medium"
      ? 2
      : target?.architecture.confidence === "low" ? 1 : 0;
  const boundaryRank = steps.some((step) =>
    step.architecture.layer === "dataAccess" || step.architecture.layer === "infrastructure"
  ) ? 1 : 0;
  const traceRank = traceStatus === "mapped" ? 2 : traceStatus === "unresolved" ? 1 : 0;
  const completionRank = traceStatus === "mapped" && boundaryRank > 0
    ? 3
    : traceStatus === "mapped" ? 2 : boundaryRank > 0 ? 1 : 0;
  const mappingRank = mappingConfidence === "exact"
    ? 4
    : mappingConfidence === "resolved"
      ? 3
      : mappingConfidence === "inferred"
        ? 2
        : mappingConfidence === "unresolved" ? 1 : 0;
  const targetDepth = target?.depth ?? Number.MAX_SAFE_INTEGER;
  return [
    completionRank,
    mappingRank,
    reachRank,
    confidenceRank,
    traceRank,
    boundaryRank,
    -unresolvedCallCount,
    -targetDepth
  ];
}

function toReadingArchitecture(
  assessment: FunctionArchitectureAssessment
): ProjectReadingArchitecture {
  return {
    layer: assessment.layer,
    confidence: assessment.confidence,
    businessLogic: assessment.businessLogic,
    purity: assessment.purity,
    evidence: assessment.evidence.slice(0, 2).map((item) => item.description),
    alternatives: [...assessment.alternatives],
    conflicted: assessment.conflicted
  };
}

function createWhyRecommended(
  steps: readonly ProjectReadingStep[],
  reach: ProjectReadingBusinessReach,
  boundaryKind: ProjectReadingBoundaryKind | undefined
): string[] {
  const reasons = ["Entrypoint has a uniquely mapped concrete handler."];
  if (reach === "domainCandidateReached") {
    reasons.push("Path reaches a source-backed domain-rule candidate.");
  } else if (reach === "applicationCandidateReached") {
    reasons.push("Path reaches an application-workflow candidate.");
  } else if (reach === "workflowBridgeCandidateReached") {
    reasons.push("A local function bridges the mapped handler to an explicit effect boundary.");
  }
  if (boundaryKind) {
    reasons.push(`Path exposes a ${formatBoundaryKind(boundaryKind)} boundary.`);
  } else if (steps.some((step) => step.architecture.layer === "infrastructure")) {
    reasons.push("Path reaches an infrastructure boundary.");
  }
  return reasons.slice(0, 3);
}

function createUnknowns(
  reach: ProjectReadingBusinessReach,
  depthLimitReached: boolean,
  stepLimitReached: boolean,
  unresolvedCallCount: number,
  omittedStepCount: number
): string[] {
  const unknowns = ["Purity and runtime importance are not verified by static analysis."];
  if (reach === "noCandidateObserved") {
    unknowns.push("No domain or application candidate was identified in the observed trace.");
  } else if (reach === "analysisLimited") {
    unknowns.push("Traversal limits prevent a conclusion about deeper business logic.");
  } else if (reach === "workflowBridgeCandidateReached") {
    unknowns.push("The bridge topology does not prove its layer or business ownership.");
  }
  if (unresolvedCallCount > 0) {
    unknowns.push(`${unresolvedCallCount} unresolved call${unresolvedCallCount === 1 ? "" : "s"} remain.`);
  } else if (depthLimitReached || stepLimitReached || omittedStepCount > 0) {
    unknowns.push("Some analyzed steps are outside the visible path budget.");
  }
  return unknowns.slice(0, 3);
}

function createRecommendationExplanation(
  reach: ProjectReadingBusinessReach
): string {
  if (reach === "domainCandidateReached") {
    return "Start with the highlighted domain candidate; verify the rule and its side effects.";
  }
  if (reach === "applicationCandidateReached") {
    return "Start with the highlighted application candidate; it may orchestrate business behavior, but purity is unknown.";
  }
  if (reach === "workflowBridgeCandidateReached") {
    return "Start with the highlighted workflow bridge, then verify its decisions before the explicit effect boundary.";
  }
  if (reach === "analysisLimited") {
    return "Start with the highlighted handler; deeper business ownership is not observable within current limits.";
  }
  return "Start with the highlighted handler; no separate business layer was identified in this trace.";
}

function formatBoundaryKind(boundaryKind: ProjectReadingBoundaryKind): string {
  switch (boundaryKind) {
    case "repository": return "repository/data-access";
    case "model": return "model/data-access";
    case "externalCall": return "external-call";
    case "sideEffect": return "side-effect";
    case "unresolvedCall": return "unresolved-call";
    default: return "terminal";
  }
}

function appendCue(step: ProjectReadingStep, cue: ProjectReadingStep["readingCues"][number]): void {
  if (!step.readingCues.includes(cue)) {
    step.readingCues.push(cue);
  }
}
