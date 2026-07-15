/**
 * JSON-only architecture assessment shared by Reading Plan and Function Explorer.
 * The payload intentionally states that purity is unknown instead of converting
 * a structural layer hint into a claim about side effects.
 */

export type ArchitecturalLayerPayload =
  | "entrypoint"
  | "interface"
  | "application"
  | "domain"
  | "dataAccess"
  | "infrastructure"
  | "crossCutting"
  | "test"
  | "unclassified";

export type ArchitecturalLayerConfidencePayload = "high" | "medium" | "low" | "unknown";

export type BusinessLogicClassificationPayload =
  | "domainRuleCandidate"
  | "applicationWorkflowCandidate"
  | "notBusinessLogic"
  | "unknown";

/** Bounded, display-safe layer evidence for one callable or entrypoint. */
export type FunctionArchitecturePayload = {
  layer: ArchitecturalLayerPayload;
  confidence: ArchitecturalLayerConfidencePayload;
  businessLogic: BusinessLogicClassificationPayload;
  purity: "unknown";
  evidence: string[];
  alternatives: ArchitecturalLayerPayload[];
  conflicted: boolean;
};
