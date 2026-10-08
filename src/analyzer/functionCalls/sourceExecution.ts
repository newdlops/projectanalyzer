/** Declaration-owned execution contracts for symbolic readings; never grants evaluator or scheduling authority. */
import type { FunctionTutorDeclarationAnalysis } from "../functionTutor";

/** Promise fulfillment and suspend resumption are source contracts, never observed results. */
export type FunctionCallSourceExecution = "sync" | "promise" | "suspend";

/** Recognizes only plain functions/methods; constructors, accessors, generators and Kotlin execution modifiers fail closed. */
export function readFunctionCallSourceExecution(declaration: FunctionTutorDeclarationAnalysis, signature: string): FunctionCallSourceExecution | undefined {
  if (!["function", "method"].includes(declaration.functionNode.kind)
    || /(?:^|\s)(?:get|set)\s+[\p{L}_$][\p{L}\p{N}_$]*\s*\(/u.test(signature)) return;
  if (["typescript", "javascript"].includes(declaration.language)) {
    return declaration.executionKind === "async" ? "promise" : declaration.executionKind === "sync" ? "sync" : undefined;
  }
  if (declaration.language !== "kotlin" || declaration.executionKind !== "sync") return;
  const header = signature.split(/\bfun\b/u)[0];
  if (/\b(?:inline|operator|external|expect)\b/u.test(header)) return;
  return /\bsuspend\b/u.test(header) ? "suspend" : "sync";
}
