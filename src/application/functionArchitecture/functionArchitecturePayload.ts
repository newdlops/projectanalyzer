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

/** Formats a compact label reused by function lists and flow tree rows. */
export function formatFunctionArchitectureSummary(
  architecture: FunctionArchitecturePayload | undefined
): string {
  if (!architecture) {
    return "Unclassified · purity unverified";
  }

  const layer = formatArchitectureLayer(architecture.layer);
  const alternatives = architecture.conflicted && architecture.alternatives.length > 0
    ? ` (possible ${architecture.alternatives.map(formatArchitectureLayer).join(" / ")})`
    : "";
  const candidate = architecture.businessLogic === "domainRuleCandidate"
    ? "domain-rule candidate"
    : architecture.businessLogic === "applicationWorkflowCandidate"
      ? "workflow candidate"
      : undefined;
  return `${layer}${alternatives}${candidate ? ` · ${candidate}` : ""} · purity unverified`;
}

/** Human-readable structural layer name without claiming runtime importance. */
export function formatArchitectureLayer(layer: FunctionArchitecturePayload["layer"]): string {
  switch (layer) {
    case "entrypoint": return "Entry";
    case "interface": return "Interface";
    case "application": return "Application";
    case "domain": return "Domain";
    case "dataAccess": return "Data access";
    case "infrastructure": return "Infrastructure";
    case "crossCutting": return "Cross-cutting";
    case "test": return "Test";
    default: return "Unclassified";
  }
}
