/** Optional data-only operation roles from the complete original route. No example certification, decision value, substituted expression or prose answer is generated. */
import type { NativeInputJson } from "../input/types";
import type { NativeRootSourceContext } from "./types";

/** Match the original un-certified source-role vocabulary and whole-route admission; absent enrichment never removes source or a schema field. */
export function rootSourceRoles(context: NativeRootSourceContext): NativeInputJson | undefined {
  if (!["kotlin", "typescript", "javascript"].includes(context.language)) return undefined;
  const route = context.sourceFlow.paths[0];
  if (!["exact", "inferred", "unresolved"].includes(route.confidence) || route.status !== "source-terminal" || !route.steps.length || route.steps.length > 32) return undefined;
  const seen = new Set<string>(), operations: Array<Record<string, unknown>> = [];
  for (const [index, step] of route.steps.entries()) {
    const identity = JSON.stringify([step.graphNodeId, step.graphOccurrence]);
    if (seen.has(identity) || !["mutation", "condition", "loop", "return", "call", "effect"].includes(step.kind)) return undefined; seen.add(identity);
    if (step.confidence !== "exact") { operations.push({ ordinal: index + 1, kind: step.kind, confidence: step.confidence, role: "unverified-source-operation", effectSemanticsCertified: false }); continue; }
    const declaration = step.kind === "mutation" ? /^(val|var|let|const)\s+([\p{L}_$][\p{L}\p{N}_$]*)(?=\s|:|=|$)/u.exec(step.code.trim()) : undefined;
    if (declaration && (step.writeTargets?.length !== 1 || step.writeTargets[0] !== declaration[2])) return undefined;
    const reading: Record<string, unknown> = { ordinal: index + 1, kind: step.kind, confidence: step.confidence, role: declaration ? "binding-declaration" : step.kind === "mutation" ? "write" : step.kind === "return" ? "return" : step.kind === "call" ? "call" : step.kind === "effect" ? "effect-syntax" : "branch-decision" };
    if (declaration) reading.binding = { name: declaration[2], keyword: declaration[1], reassignmentAllowed: ["var", "let"].includes(declaration[1]), objectMutationCertified: false };
    if (step.writeTargets?.length) reading.explicitWriteTargets = [...step.writeTargets];
    if (step.kind === "call") reading.internalBehaviorCertified = false; if (step.kind === "effect") reading.effectSemanticsCertified = false;
    operations.push(reading);
  }
  return { basis: "source-syntax-roles", routeConfidence: route.confidence, staticExampleCertified: false, operationOrderMatchesOriginalRoute: true, operations,
    ...(context.language === "kotlin" ? { divisionRules: { bothOperandsInt: "truncate-toward-zero", eitherOperandDouble: "retain-fraction" } } : {}) };
}
