/**
 * Bounded TypeScript condition decomposition and typed member-path normalization.
 * This module identifies safe atomic predicates without interpreting their values.
 */

import * as ts from "typescript";
import type {
  FunctionTutorConstraint,
  FunctionTutorParameterFact,
  FunctionTutorStaticValue
} from "./types";

const MAX_ATOMIC_CONDITION_STEPS = 32;
const MAX_ATOMIC_CONDITIONS = 16;

/** Returns source-ordered leaves from `&&`/`||` condition trees. */
export function collectFunctionTutorAtomicConditions(expression: ts.Expression): ts.Expression[] {
  const conditions: ts.Expression[] = [];
  const pending: ts.Expression[] = [expression];
  let steps = 0;
  while (pending.length > 0
    && steps < MAX_ATOMIC_CONDITION_STEPS
    && conditions.length < MAX_ATOMIC_CONDITIONS) {
    steps += 1;
    const current = pending.pop()!;
    if (ts.isParenthesizedExpression(current)) {
      pending.push(current.expression);
      continue;
    }
    if (ts.isBinaryExpression(current)
      && (current.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
        || current.operatorToken.kind === ts.SyntaxKind.BarBarToken)) {
      pending.push(current.right, current.left);
      continue;
    }
    conditions.push(current);
  }
  return conditions;
}

/** Converts a typed collection's `.length` predicate into its container path. */
export function normalizeFunctionTutorLengthConstraint(
  parameter: FunctionTutorParameterFact,
  path: string[],
  operator: FunctionTutorConstraint["operator"],
  operand: FunctionTutorStaticValue
): { path: string[]; operator: FunctionTutorConstraint["operator"] } {
  if (path[path.length - 1] !== "length" || operand.kind !== "number") return { path, operator };
  const containerPath = path.slice(0, -1);
  const containerKind = containerPath.length === 0
    ? parameter.typeKind
    : parameter.memberFacts.find((fact) => fact.path.length === containerPath.length
      && fact.path.every((part, index) => part === containerPath[index]))?.typeKind;
  if (containerKind !== "array" && containerKind !== "string" && containerKind !== "tuple") {
    return { path, operator };
  }
  const lengthOperators: Partial<Record<FunctionTutorConstraint["operator"], FunctionTutorConstraint["operator"]>> = {
    eq: "length-eq",
    lt: "length-lt",
    lte: "length-lte",
    gt: "length-gt",
    gte: "length-gte"
  };
  return { path: containerPath, operator: lengthOperators[operator] ?? operator };
}
