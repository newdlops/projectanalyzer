/**
 * Protocol adapter for graph-stable callable architecture assessments.
 * Internal rule IDs and function identities stay host-side; only bounded,
 * fixed-description evidence crosses into Webviews.
 */

import type { FunctionArchitectureAssessment } from "../../insights/architecturalLayers";
import type { FunctionArchitecturePayload } from "../../protocol/functionArchitecture";

/** Maximum evidence sentences transferred with one visible callable. */
const ARCHITECTURE_PAYLOAD_EVIDENCE_LIMIT = 2;

/** Converts one domain assessment into its bounded JSON representation. */
export function createFunctionArchitecturePayload(
  assessment: FunctionArchitectureAssessment
): FunctionArchitecturePayload {
  return {
    layer: assessment.layer,
    confidence: assessment.confidence,
    businessLogic: assessment.businessLogic,
    purity: assessment.purity,
    evidence: assessment.evidence
      .slice(0, ARCHITECTURE_PAYLOAD_EVIDENCE_LIMIT)
      .map((item) => item.description),
    alternatives: [...assessment.alternatives],
    conflicted: assessment.conflicted
  };
}

/** Creates the fixed architecture record for a framework entrypoint row. */
export function createEntrypointArchitecturePayload(): FunctionArchitecturePayload {
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
