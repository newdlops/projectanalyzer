/**
 * Converts already-parsed TS/JS expressions into bounded Scenario IR.  The
 * caller supplies binding and literal readers so this module stays independent
 * of declaration-analysis orchestration and graph concerns.
 */
import * as ts from "typescript";
import { toSourceRange } from "../../functionLogic/typescriptFunctionLogicSyntax";
import type { FunctionTutorExpression, FunctionTutorStaticValue } from "../types";

export type ScenarioExpressionContext = {
  sourceFile: ts.SourceFile;
  bindingsByName: Map<string, string>;
  readStaticValue(node: ts.Node, sourceFile: ts.SourceFile): FunctionTutorStaticValue;
  readBindingMember(expression: ts.Expression, bindings: Map<string, string>): { bindingId: string; path: string[]; segments?: Array<{ kind: string }> } | undefined;
  readPropertyName(name: ts.PropertyName): string | undefined;
  isSafeObjectKey(key: string): boolean;
};

/** Converts one finite AST expression without reading source text at runtime. */
export function toScenarioExpression(expression: ts.Expression, context: ScenarioExpressionContext, depth = 0): FunctionTutorExpression {
  if (depth >= 12) return { kind: "unsupported", reason: "depth-budget", summary: "Expression nesting exceeds the Tutor limit." };
  const literal = context.readStaticValue(expression, context.sourceFile);
  // A container with unknown children is an expression, not a complete literal.
  // Preserve each field's computation instead of dropping dynamic members.
  // JSON transport would turn a numeric -0 literal into 0. Keep its unary IR
  // so browser evaluation retains the sign and division/comparison semantics.
  if (isCompleteScenarioLiteral(literal) && !(literal.kind === "number" && Object.is(literal.value, -0))
    && !ts.isArrayLiteralExpression(expression) && !ts.isObjectLiteralExpression(expression)) return { kind: "literal", value: literal };
  if (ts.isIdentifier(expression)) { const bindingId = context.bindingsByName.get(expression.text); return bindingId ? { kind: "binding", bindingId } : { kind: "unsupported", reason: "ambiguous-binding", summary: `Untracked binding ${expression.text}.` }; }
  const member = context.readBindingMember(expression, context.bindingsByName);
  if (member) return member.segments?.some((segment) => segment.kind !== "static")
    ? { kind: "unsupported", reason: "unsupported-expression", summary: "A dynamic member read needs a resolved index." }
    : { kind: "member", object: { kind: "binding", bindingId: member.bindingId }, path: member.path, optional: false };
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression)) return toScenarioExpression(expression.expression, context, depth + 1);
  if (ts.isAwaitExpression(expression)) return { kind: "await", operand: toScenarioExpression(expression.expression, context, depth + 1) };
  if (ts.isPrefixUnaryExpression(expression)) { const operator = expression.operator === ts.SyntaxKind.ExclamationToken ? "not" : expression.operator === ts.SyntaxKind.PlusToken ? "plus" : expression.operator === ts.SyntaxKind.MinusToken ? "minus" : undefined; return operator ? { kind: "unary", operator, operand: toScenarioExpression(expression.operand, context, depth + 1) } : { kind: "unsupported", reason: "unsupported-expression", summary: "Unsupported unary expression." }; }
  if (ts.isTypeOfExpression(expression)) return { kind: "unary", operator: "typeof", operand: toScenarioExpression(expression.expression, context, depth + 1) };
  if (ts.isBinaryExpression(expression)) { const logical = expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ? "and" : expression.operatorToken.kind === ts.SyntaxKind.BarBarToken ? "or" : expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ? "nullish" : undefined; if (logical) return { kind: "logical", operator: logical, members: [toScenarioExpression(expression.left, context, depth + 1), toScenarioExpression(expression.right, context, depth + 1)] }; const operator = binaryOperator(expression.operatorToken.kind); return operator ? { kind: "binary", operator, left: toScenarioExpression(expression.left, context, depth + 1), right: toScenarioExpression(expression.right, context, depth + 1) } : { kind: "unsupported", reason: "unsupported-expression", summary: "Unsupported binary expression." }; }
  if (ts.isConditionalExpression(expression)) return { kind: "conditional", condition: toScenarioExpression(expression.condition, context, depth + 1), whenTrue: toScenarioExpression(expression.whenTrue, context, depth + 1), whenFalse: toScenarioExpression(expression.whenFalse, context, depth + 1) };
  if (ts.isArrayLiteralExpression(expression)) {
    if (expression.elements.length > 64 || expression.elements.some((item) => ts.isSpreadElement(item) || ts.isOmittedExpression(item))) return { kind: "unsupported", reason: "unsupported-expression", summary: "Array spread, sparse elements or size exceeds the supported data shape." };
    return { kind: "array", items: expression.elements.map((item) => toScenarioExpression(item, context, depth + 1)) };
  }
  if (ts.isObjectLiteralExpression(expression)) {
    const entries: Array<{ key: string; value: FunctionTutorExpression }> = [];
    if (expression.properties.length > 64) return { kind: "unsupported", reason: "unsupported-expression", summary: "Object size exceeds the supported data shape." };
    for (const property of expression.properties) {
      if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) return { kind: "unsupported", reason: "unsupported-expression", summary: "Object spread or accessor needs unsupported semantics." };
      const key = context.readPropertyName(property.name);
      if (!key || !context.isSafeObjectKey(key)) return { kind: "unsupported", reason: "unsupported-expression", summary: "Object key cannot be resolved safely." };
      entries.push({ key, value: toScenarioExpression(ts.isPropertyAssignment(property) ? property.initializer : property.name, context, depth + 1) });
    }
    return { kind: "object", entries };
  }
  if (ts.isCallExpression(expression)) return callExpression(expression, context, depth);
  if (ts.isNewExpression(expression) && ts.isIdentifier(expression.expression) && !expression.typeArguments) return { kind: "construct", className: expression.expression.text, arguments: (expression.arguments || []).map((argument) => toScenarioExpression(argument, context, depth + 1)), callRange: toSourceRange(context.sourceFile, expression), certainty: "exact" };
  return { kind: "unsupported", reason: ts.isNewExpression(expression) ? "dynamic-call" : "unsupported-expression", summary: ts.isNewExpression(expression) ? "The constructor target is not statically stable." : "Unsupported source expression." };
}

/** Rejects partial literal trees with an iterative, bounded visited-set check. */
function isCompleteScenarioLiteral(root: FunctionTutorStaticValue): boolean {
  const pending = [root]; const visited = new Set<FunctionTutorStaticValue>();
  while (pending.length && visited.size < 512) {
    const value = pending.pop()!;
    if (visited.has(value)) continue;
    visited.add(value);
    if (value.kind === "unknown" || (value.kind === "array" || value.kind === "object") && value.truncated) return false;
    if (value.kind === "array") pending.push(...value.items);
    if (value.kind === "object") pending.push(...value.entries.map((entry) => entry.value));
  }
  return pending.length === 0;
}

function callExpression(expression: ts.CallExpression, context: ScenarioExpressionContext, depth: number): FunctionTutorExpression {
  if (ts.isIdentifier(expression.expression) && !expression.typeArguments) return { kind: "direct-call", calleeName: expression.expression.text, arguments: expression.arguments.map((argument) => toScenarioExpression(argument, context, depth + 1)), callRange: toSourceRange(context.sourceFile, expression), certainty: "exact", invocationKind: expression.questionDotToken ? "optional-direct" : "direct", optionalDisposition: expression.questionDotToken ? "unknown" : undefined };
  if (!ts.isPropertyAccessExpression(expression.expression) || expression.typeArguments) return { kind: "unsupported", reason: "dynamic-call", summary: "The call receiver or dispatch is not statically stable." };
  const receiver = ts.isIdentifier(expression.expression.expression) && !context.bindingsByName.has(expression.expression.expression.text) ? { kind: "owner-reference" as const, ownerId: `source-owner:${expression.expression.expression.pos}:${expression.expression.expression.end}` } : toScenarioExpression(expression.expression.expression, context, depth + 1);
  const optional = Boolean(expression.questionDotToken || expression.expression.questionDotToken);
  return { kind: "direct-call", calleeName: expression.expression.name.text, arguments: expression.arguments.map((argument) => toScenarioExpression(argument, context, depth + 1)), callRange: toSourceRange(context.sourceFile, expression), certainty: "exact", invocationKind: expression.expression.name.text === "next" ? "iterator-next" : optional ? "optional-method" : "method", receiver, optionalDisposition: optional ? receiver.kind === "literal" && (receiver.value.kind === "null" || receiver.value.kind === "undefined") ? "absent" : receiver.kind === "owner-reference" ? "present" : "unknown" : undefined };
}

function binaryOperator(kind: ts.SyntaxKind): Extract<FunctionTutorExpression, { kind: "binary" }>['operator'] | undefined { return new Map<ts.SyntaxKind, Extract<FunctionTutorExpression, { kind: "binary" }>['operator']>([[ts.SyntaxKind.EqualsEqualsToken, "eq"], [ts.SyntaxKind.EqualsEqualsEqualsToken, "strict-eq"], [ts.SyntaxKind.ExclamationEqualsToken, "neq"], [ts.SyntaxKind.ExclamationEqualsEqualsToken, "strict-neq"], [ts.SyntaxKind.LessThanToken, "lt"], [ts.SyntaxKind.LessThanEqualsToken, "lte"], [ts.SyntaxKind.GreaterThanToken, "gt"], [ts.SyntaxKind.GreaterThanEqualsToken, "gte"], [ts.SyntaxKind.PlusToken, "add"], [ts.SyntaxKind.MinusToken, "subtract"], [ts.SyntaxKind.AsteriskToken, "multiply"], [ts.SyntaxKind.SlashToken, "divide"], [ts.SyntaxKind.PercentToken, "modulo"], [ts.SyntaxKind.InKeyword, "in"]]).get(kind); }
