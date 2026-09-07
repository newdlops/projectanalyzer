/** Host-private, range-backed Scenario dispatch catalog contracts. */
import type { SourceRange } from "../../../shared/types";
import type { FunctionTutorDeclarationAnalysis } from "../types";
import type { FunctionTutorExpression } from "../types";

export type FunctionTutorScenarioInvocationRole = "function" | "method" | "constructor" | "object-method" | "static-method";

export type FunctionTutorScenarioCatalogProgram = {
  id: string;
  ownerId?: string;
  thisBindingId?: string;
  invocationRole: FunctionTutorScenarioInvocationRole;
  declaration: FunctionTutorDeclarationAnalysis;
  fieldInitializers: Array<{ key: string; range: SourceRange; value: FunctionTutorExpression }>;
};

export type FunctionTutorScenarioCatalogResolution = {
  callerId: string;
  range: SourceRange;
  targetId: string;
  ownerId?: string;
  invocationRole: FunctionTutorScenarioInvocationRole;
  requiresAwait: boolean;
  optionalDisposition?: "present" | "absent" | "unknown";
};

export type FunctionTutorScenarioCatalog = {
  programs: FunctionTutorScenarioCatalogProgram[];
  resolutions: FunctionTutorScenarioCatalogResolution[];
};
