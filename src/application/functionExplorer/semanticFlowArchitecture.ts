/**
 * Architecture payload adapter for Function Explorer semantic-flow steps.
 * Concrete callables reuse graph-stable assessments; unresolved and non-local
 * targets remain boundary records instead of pretending to be local functions.
 */

import type { FunctionArchitectureIndex } from "../../insights/architecturalLayers";
import type { SemanticFlowStep } from "../../insights/semanticFlow";
import type { FunctionArchitecturePayload } from "../../protocol/functionArchitecture";
import { createFunctionArchitecturePayload } from "../functionArchitecture";

/** Projects graph-stable callable layers plus honest non-local placeholders. */
export function createFlowStepArchitecturePayload(
  step: SemanticFlowStep,
  architectureIndex: FunctionArchitectureIndex | undefined
): FunctionArchitecturePayload {
  const assessment = step.resolution === "concrete" && step.functionId
    ? architectureIndex?.assessmentsByFunctionId.get(step.functionId)
    : undefined;
  if (assessment) {
    return createFunctionArchitecturePayload(assessment);
  }
  if (step.resolution === "unresolved") {
    return {
      layer: "unclassified",
      confidence: "unknown",
      businessLogic: "unknown",
      purity: "unknown",
      evidence: ["Call target is unresolved, so its layer is unknown."],
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
  return {
    layer: "unclassified",
    confidence: "unknown",
    businessLogic: "unknown",
    purity: "unknown",
    evidence: ["No graph-stable layer evidence was identified."],
    alternatives: [],
    conflicted: false
  };
}
