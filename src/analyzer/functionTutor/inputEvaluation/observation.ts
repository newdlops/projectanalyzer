/** Comparison labels for local learning. Distances are never branch-coverage evidence. */
import type { FunctionTutorExpression as Expression, FunctionTutorStaticValue as Value } from "../types";
import { evaluateInputExpression } from "./expression";
import type { FunctionTutorDecisionObservation } from "./types";

/** Keeps actual operands alongside a numeric learning distance so UI explanations never show a surrogate as a value. */
export function observeInputDecision(blockId: string, expression: Expression, bindings: ReadonlyMap<string, Value>, outcome: boolean): FunctionTutorDecisionObservation | undefined {
  if (expression.kind === "binary" && ["lt", "lte", "gt", "gte", "eq", "neq", "strict-eq", "strict-neq"].includes(expression.operator)) {
    const left = evaluateInputExpression(expression.left, bindings); const right = evaluateInputExpression(expression.right, bindings);
    if (left.kind === "number" && right.kind === "number" && Number.isFinite(left.value - right.value)) return { blockId, operator: expression.operator, left: left.value, right: right.value, outcome };
    if (left.kind === "string" && right.kind === "string" && left.value.length <= 512 && right.value.length <= 512) {
      let distance = Math.abs(left.value.length - right.value.length);
      for (let index = 0; index < Math.min(left.value.length, right.value.length); index += 1) if (left.value[index] !== right.value[index]) distance += 1;
      return { blockId, operator: expression.operator, left: distance, right: 0, outcome, metric: "string-distance", leftValue: left, rightValue: right };
    }
  }
  const value = evaluateInputExpression(expression, bindings);
  if (value.kind === "string") return { blockId, operator: "truthy", left: value.value.length, right: 0, outcome, metric: "truthiness", leftValue: value };
  if (value.kind === "boolean") return { blockId, operator: "truthy", left: value.value ? 1 : -1, right: 0, outcome, metric: "truthiness", leftValue: value };
  return undefined;
}
