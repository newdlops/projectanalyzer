/**
 * Bounded Guided Tour stop projection over one primary Reading Guide path.
 * Entrypoint rows become mission trigger context; concrete functions, explicit
 * boundaries, and evidence gaps become at most five ordered learning stops.
 */

import type {
  ProjectPrimaryReadingPath,
  ProjectPrimaryReadingStep,
  ProjectReadingEvidenceAnchor
} from "../projectReadingGuide";
import { createGuidedTourStopInstructions } from "./stopInstructions";
import type {
  GuidedTourNavigableStop,
  GuidedTourSourceAnchor,
  GuidedTourStop,
  GuidedTourStopKind,
  GuidedTourTransitionEvidence
} from "./types";

/** Maximum stops exposed by one initial Guided Tour mission. */
export const GUIDED_TOUR_STOP_LIMIT = 5;

/** Projects ordered stops without recursive graph access or new classification. */
export function createGuidedTourStops(
  path: ProjectPrimaryReadingPath
): GuidedTourStop[] {
  const stops: GuidedTourStop[] = [];
  const projectedSteps: ProjectPrimaryReadingStep[] = [];
  const visitedStepIdentities = new Set<string>();

  for (const step of path.steps) {
    if (step.kind === "route" || step.kind === "operation") {
      continue;
    }
    const identity = createStepIdentity(step);
    if (visitedStepIdentities.has(identity)) {
      continue;
    }
    visitedStepIdentities.add(identity);

    const kind = getGuidedTourStopKind(step);
    const stopId = `${path.id}:stop:${stops.length + 1}`;
    const anchors = createGuidedTourAnchors(stopId, step);
    const instructions = createGuidedTourStopInstructions(step, kind, anchors);
    const common = {
      id: stopId,
      order: stops.length + 1,
      label: step.qualifiedName ?? step.name,
      functionId: step.functionId,
      whyNow: instructions.whyNow,
      lookFor: instructions.lookFor,
      question: instructions.question,
      moveOnWhen: instructions.moveOnWhen,
      evidence: createStopEvidence(step),
      unknowns: instructions.unknowns.slice(0, 2),
      architecture: cloneArchitecture(step)
    };

    if (anchors.length === 0) {
      stops.push({
        ...common,
        mode: "evidenceOnly",
        kind: "evidenceGap",
        anchors: []
      });
    } else {
      const navigableAnchors = anchors as [
        GuidedTourSourceAnchor,
        ...GuidedTourSourceAnchor[]
      ];
      const primary = navigableAnchors[0];
      stops.push({
        ...common,
        mode: "navigable",
        kind,
        filePath: primary.filePath,
        range: { ...primary.range },
        anchors: navigableAnchors,
        primaryAnchorId: primary.id,
        requiredAnchorIds: navigableAnchors.map((anchor) => anchor.id) as [string, ...string[]]
      });
    }
    projectedSteps.push(step);

    if (stops.length >= GUIDED_TOUR_STOP_LIMIT) {
      break;
    }
  }

  for (let index = 0; index < stops.length - 1; index += 1) {
    const nextStep = projectedSteps[index + 1];
    stops[index].transitionToNext = createTransition(nextStep);
  }

  return stops;
}

/** Chooses a conservative teaching category from existing path evidence only. */
function getGuidedTourStopKind(step: ProjectPrimaryReadingStep): GuidedTourStopKind {
  if (step.kind === "handler") {
    return "handler";
  }
  if (step.resolution === "unresolved" || step.resolution === "external") {
    return "evidenceGap";
  }
  if (
    step.architecture.businessLogic === "domainRuleCandidate"
    || step.architecture.businessLogic === "applicationWorkflowCandidate"
    || step.contextInference?.role === "workflowBridgeCandidate"
  ) {
    return "decisionCandidate";
  }
  if (step.boundaryKind) {
    return "boundary";
  }
  return "collaborator";
}

/** Keeps no more than definition plus the evidence that led into it. */
function createGuidedTourAnchors(
  stopId: string,
  step: ProjectPrimaryReadingStep
): [] | [GuidedTourSourceAnchor, ...GuidedTourSourceAnchor[]] {
  const candidates = step.resolution === "unresolved" || step.resolution === "external"
    ? [step.sourceAnchors.incomingCallsite, step.sourceAnchors.frameworkEvidence]
    : [
        step.sourceAnchors.definition,
        step.sourceAnchors.incomingCallsite,
        step.sourceAnchors.frameworkEvidence
      ];
  const anchors: GuidedTourSourceAnchor[] = [];

  for (const candidate of candidates) {
    if (!candidate || anchors.length >= 2 || hasSameLocation(anchors, candidate)) {
      continue;
    }
    anchors.push({
      id: `${stopId}:anchor:${candidate.locationKind}`,
      locationKind: candidate.locationKind,
      functionId: step.functionId,
      ownerFunctionId: candidate.ownerFunctionId,
      filePath: candidate.filePath,
      range: { ...candidate.range },
      label: candidate.label
    });
  }

  return anchors.length === 0
    ? []
    : anchors as [GuidedTourSourceAnchor, ...GuidedTourSourceAnchor[]];
}

/** Prevents one exact range from becoming two required user actions. */
function hasSameLocation(
  anchors: readonly GuidedTourSourceAnchor[],
  candidate: ProjectReadingEvidenceAnchor
): boolean {
  return anchors.some((anchor) =>
    anchor.filePath === candidate.filePath
      && anchor.range.startLine === candidate.range.startLine
      && anchor.range.startCharacter === candidate.range.startCharacter
      && anchor.range.endLine === candidate.range.endLine
      && anchor.range.endCharacter === candidate.range.endCharacter
  );
}

/** Stable deduplication identity does not depend on mutable presentation copy. */
function createStepIdentity(step: ProjectPrimaryReadingStep): string {
  if (step.resolution === "concrete" && step.functionId) {
    return `function:${step.functionId}`;
  }
  return [
    step.callEdgeId ?? "no-edge",
    step.filePath,
    step.range?.startLine ?? -1,
    step.range?.startCharacter ?? -1
  ].join(":");
}

/** Retains at most two analyzer reasons; labels never become evidence. */
function createStopEvidence(step: ProjectPrimaryReadingStep): string[] {
  const evidence = step.architecture.evidence.slice(0, 2);
  if (evidence.length === 0 && step.contextInference) {
    return step.contextInference.evidence.slice(0, 2);
  }
  return evidence;
}

/** Copies nested arrays so downstream progress state cannot mutate the path. */
function cloneArchitecture(
  step: ProjectPrimaryReadingStep
): GuidedTourNavigableStop["architecture"] {
  return {
    ...step.architecture,
    evidence: [...step.architecture.evidence],
    alternatives: [...step.architecture.alternatives]
  };
}

/** Explains the evidence leading to the next stop without claiming runtime execution. */
function createTransition(
  nextStep: ProjectPrimaryReadingStep
): GuidedTourTransitionEvidence | undefined {
  if (nextStep.kind === "handler") {
    return {
      kind: "frameworkMapping",
      explanation: "Framework evidence maps the entrypoint to the next concrete handler."
    };
  }
  if (nextStep.resolution === "unresolved" || nextStep.resolution === "external") {
    return {
      kind: "analysisGap",
      explanation: "The next callsite is known, but a unique local target is not."
    };
  }
  if (nextStep.boundaryKind) {
    return {
      kind: "boundary",
      explanation: `The selected call chain next reaches the observed ${nextStep.boundaryKind} boundary.`
    };
  }
  return {
    kind: "call",
    explanation: "A selected static call edge connects this stop to the next reading target."
  };
}
