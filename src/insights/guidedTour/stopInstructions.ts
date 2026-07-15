/**
 * Deterministic instruction templates for Guided Tour stops.
 *
 * Templates ask the reader to verify responsibilities in source; they do not
 * turn names, call position, or unresolved targets into behavioral claims.
 */

import type { ProjectPrimaryReadingStep } from "../projectReadingGuide";
import type {
  GuidedTourLookFor,
  GuidedTourSourceAnchor,
  GuidedTourStopKind
} from "./types";

/** Educational copy generated for one selected reading step. */
export type GuidedTourStopInstructions = {
  whyNow: string;
  lookFor: GuidedTourLookFor[];
  question: string;
  moveOnWhen: string;
  unknowns: string[];
};

/** Creates source-bound prompts capped by the already bounded anchor list. */
export function createGuidedTourStopInstructions(
  step: ProjectPrimaryReadingStep,
  kind: GuidedTourStopKind,
  anchors: readonly GuidedTourSourceAnchor[]
): GuidedTourStopInstructions {
  const lookFor = anchors.slice(0, 2).map((anchor) => ({
    instruction: createAnchorInstruction(kind, anchor.locationKind),
    anchorId: anchor.id,
    evidenceRuleId: createEvidenceRuleId(kind, anchor.locationKind)
  }));

  switch (kind) {
    case "handler":
      return {
        whyNow: "This is the first concrete source function mapped from the project entrypoint.",
        lookFor,
        question: "Which request inputs are translated here, and which collaborator receives control next?",
        moveOnWhen: "You can point to the input mapping and the next source-backed delegation.",
        unknowns: ["Static mapping does not prove which branches execute at runtime."]
      };
    case "decisionCandidate":
      return createDecisionInstructions(step, lookFor);
    case "boundary":
      return {
        whyNow: "The selected path reaches an explicit data or effect boundary here.",
        lookFor,
        question: "What state or external effect crosses this boundary, and how are failures represented?",
        moveOnWhen: "You can identify the boundary input, output, and visible failure contract.",
        unknowns: ["Runtime side effects and reliability behavior require source or test confirmation."]
      };
    case "evidenceGap":
      return {
        whyNow: "Analysis can follow the path to this callsite but cannot fully resolve the target.",
        lookFor,
        question: "What runtime binding or dynamic dispatch prevents a unique static target?",
        moveOnWhen: "You can explain the unresolved binding without assigning it an unsupported layer.",
        unknowns: ["The target layer and runtime implementation remain unknown."]
      };
    default:
      return {
        whyNow: "This concrete collaborator connects the current function to the next evidenced stage.",
        lookFor,
        question: "What data is transformed here, and which condition decides the next call?",
        moveOnWhen: "You can summarize this function's input, output, and next delegation from source.",
        unknowns: ["Call position alone does not establish business ownership or purity."]
      };
  }
}

/** Distinguishes intrinsic layer evidence from a reading-only bridge hint. */
function createDecisionInstructions(
  step: ProjectPrimaryReadingStep,
  lookFor: GuidedTourLookFor[]
): GuidedTourStopInstructions {
  if (step.contextInference?.role === "workflowBridgeCandidate") {
    return {
      whyNow: "This function sits between the mapped handler and an explicit boundary, so it is a workflow-reading candidate.",
      lookFor,
      question: "Does this function coordinate a use case, or does it only pass data to another layer?",
      moveOnWhen: "You can cite source that supports or rejects workflow ownership.",
      unknowns: ["Topology suggests a reading target but does not classify its architectural layer."]
    };
  }
  if (step.architecture.businessLogic === "domainRuleCandidate") {
    return {
      whyNow: "Intrinsic source structure identifies this as a domain-rule candidate on the selected path.",
      lookFor,
      question: "Which invariant or decision belongs to the business domain rather than delivery or storage?",
      moveOnWhen: "You can state the candidate rule and cite the branch or validation that enforces it.",
      unknowns: ["The analyzer does not prove functional purity."]
    };
  }
  return {
    whyNow: "Intrinsic evidence identifies this as an application-workflow candidate on the selected path.",
    lookFor,
    question: "Which use-case steps are coordinated here, and where are domain decisions delegated?",
    moveOnWhen: "You can separate orchestration from any delegated domain rule.",
    unknowns: ["Application-layer placement does not prove that every statement is business logic."]
  };
}

/** Makes every prompt point at the exact kind of evidence being opened. */
function createAnchorInstruction(
  kind: GuidedTourStopKind,
  locationKind: GuidedTourSourceAnchor["locationKind"]
): string {
  if (locationKind === "callsite") {
    return "Inspect the call arguments and the handling of the returned value or error.";
  }
  if (locationKind === "frameworkEvidence") {
    return "Inspect the framework mapping that connects the entrypoint to concrete source.";
  }
  if (kind === "boundary") {
    return "Inspect the boundary contract, data shape, and visible failure path.";
  }
  if (kind === "decisionCandidate") {
    return "Inspect branches, validation, and state transitions that may express a decision.";
  }
  return "Inspect the function inputs, outputs, and source-backed delegation.";
}

function createEvidenceRuleId(
  kind: GuidedTourStopKind,
  locationKind: GuidedTourSourceAnchor["locationKind"]
): string {
  return `guided-tour:${kind}:${locationKind}`;
}
