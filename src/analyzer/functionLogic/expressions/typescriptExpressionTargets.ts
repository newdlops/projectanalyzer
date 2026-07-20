/**
 * Safe TypeScript/JavaScript expression-flow target selection. Only outer,
 * evaluation-driving expressions are selected so surrounding calls are never
 * reordered around a nested argument expression.
 */

import * as ts from "typescript";
import type {
  TypeScriptExpressionFlowMode,
  TypeScriptExpressionFlowRequest
} from "./types";

export type TypeScriptExpressionFlowTarget = Omit<
  TypeScriptExpressionFlowRequest,
  "anchorBlockId"
>;

/** Selects the expression owned by one direct statement, when it is expandable. */
export function readTypeScriptStatementExpressionFlowTarget(
  statement: ts.Statement
): TypeScriptExpressionFlowTarget | undefined {
  if (ts.isIfStatement(statement)
    || ts.isWhileStatement(statement)
    || ts.isDoStatement(statement)) {
    return createTarget(statement.expression, "boolean");
  }
  if (ts.isForStatement(statement) && statement.condition) {
    return createTarget(statement.condition, "boolean");
  }
  if (ts.isSwitchStatement(statement)) {
    return createTarget(statement.expression, "value");
  }
  if ((ts.isReturnStatement(statement) || ts.isThrowStatement(statement))
    && statement.expression) {
    return createTarget(statement.expression, "value");
  }
  if (ts.isVariableStatement(statement)
    && statement.declarationList.declarations.length === 1) {
    const initializer = statement.declarationList.declarations[0]?.initializer;
    return initializer ? createTarget(initializer, "value") : undefined;
  }
  if (ts.isExpressionStatement(statement)) {
    const value = readAssignmentValue(statement.expression) ?? statement.expression;
    return createTarget(value, "value");
  }
  return undefined;
}

/** Selects an expandable root from a concise arrow expression body. */
export function readTypeScriptExpressionBodyFlowTarget(
  expression: ts.Expression
): TypeScriptExpressionFlowTarget | undefined {
  return createTarget(expression, "value");
}

/** True when an outer ternary/logical expression has meaningful branch flow. */
export function hasTypeScriptExpressionFlowRoot(expression: ts.Expression): boolean {
  let current = unwrapEvaluationTransparentExpression(expression);
  while (ts.isPrefixUnaryExpression(current)
    && current.operator === ts.SyntaxKind.ExclamationToken) {
    current = unwrapEvaluationTransparentExpression(current.operand);
  }
  return ts.isConditionalExpression(current) || isShortCircuitBinary(current);
}

/** Creates a request only when its root can be decomposed without reordering. */
function createTarget(
  expression: ts.Expression,
  mode: TypeScriptExpressionFlowMode
): TypeScriptExpressionFlowTarget | undefined {
  const root = unwrapEvaluationTransparentExpression(expression);
  return hasTypeScriptExpressionFlowRoot(root) ? { expression: root, mode } : undefined;
}

/** Reads the RHS of direct assignment syntax; compound assignments remain atomic. */
function readAssignmentValue(expression: ts.Expression): ts.Expression | undefined {
  const current = unwrapEvaluationTransparentExpression(expression);
  if (!ts.isBinaryExpression(current)
    || current.operatorToken.kind !== ts.SyntaxKind.EqualsToken) {
    return undefined;
  }
  return current.right;
}

/** Removes syntax that does not alter when the wrapped value is evaluated. */
export function unwrapEvaluationTransparentExpression(
  expression: ts.Expression
): ts.Expression {
  let current = expression;
  while (true) {
    if (ts.isParenthesizedExpression(current)
      || ts.isAsExpression(current)
      || ts.isTypeAssertionExpression(current)
      || ts.isNonNullExpression(current)
      || ts.isSatisfiesExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isAwaitExpression(current)) {
      current = current.expression;
      continue;
    }
    return current;
  }
}

/** Restricts branch expansion to JavaScript's three short-circuit operators. */
export function isShortCircuitBinary(
  expression: ts.Expression
): expression is ts.BinaryExpression {
  return ts.isBinaryExpression(expression) && (
    expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
    || expression.operatorToken.kind === ts.SyntaxKind.BarBarToken
    || expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
  );
}

