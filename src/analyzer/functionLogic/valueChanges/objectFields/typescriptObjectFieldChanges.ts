/**
 * TypeScript/JavaScript object-field expansion. Explicit object-literal keys
 * become exact nested changes; spreads and Object.assign stay inferred because
 * their runtime key set or callable identity is not statically guaranteed.
 */

import * as ts from "typescript";
import type {
  FunctionLogicValueChange,
  FunctionLogicValueChangeOperation
} from "../types";
import {
  createFunctionLogicValueChange,
  normalizeValueChangeText
} from "../valueChangeSupport";
import {
  appendObjectFieldTarget,
  isStableObjectFieldOwner
} from "./objectFieldTarget";

type ObjectLiteralExpansion = {
  operation: FunctionLogicValueChangeOperation;
  operator: string;
  confidence: FunctionLogicValueChange["confidence"];
};

type ObjectLiteralTask = {
  owner: string;
  property: ts.ObjectLiteralElementLike;
  expansion: ObjectLiteralExpansion;
};

/** Expands every explicit field and nested object field in source order. */
export function collectTypeScriptObjectLiteralFieldChanges(
  sourceFile: ts.SourceFile,
  owner: string,
  expression: ts.Expression,
  expansion: ObjectLiteralExpansion
): FunctionLogicValueChange[] {
  const literal = readObjectLiteral(expression);
  if (!literal || !isStableObjectFieldOwner(owner)) {
    return [];
  }
  const values: FunctionLogicValueChange[] = [];
  const pending: ObjectLiteralTask[] = [];
  pushObjectLiteralTasks(pending, owner, literal, expansion);

  while (pending.length > 0) {
    const task = pending.pop();
    if (!task) continue;
    const property = task.property;
    if (ts.isSpreadAssignment(property)) {
      const spread = createFunctionLogicValueChange({
        target: task.owner,
        targetKind: "receiver",
        operation: "mutate",
        operator: "... spread",
        value: sourceText(sourceFile, property.expression),
        confidence: "inferred"
      });
      if (spread) values.push(spread);
      continue;
    }
    const field = readObjectLiteralField(sourceFile, property);
    if (!field) continue;
    const target = appendObjectFieldTarget(task.owner, field.key);
    const change = createFunctionLogicValueChange({
      target,
      targetKind: "property",
      operation: task.expansion.operation,
      operator: task.expansion.operator,
      value: sourceText(sourceFile, field.value),
      confidence: task.expansion.confidence
    });
    if (change) values.push(change);
    const nested = readObjectLiteral(field.value);
    if (nested) {
      pushObjectLiteralTasks(pending, target, nested, task.expansion);
    }
  }
  return values;
}

/** Projects explicit Object.assign source keys as conservative field hints. */
export function collectTypeScriptObjectAssignFieldChanges(
  sourceFile: ts.SourceFile,
  call: ts.CallExpression
): FunctionLogicValueChange[] {
  if (!isObjectAssignCall(call) || call.arguments.length < 2) {
    return [];
  }
  const owner = sourceText(sourceFile, call.arguments[0]);
  if (!isStableObjectFieldOwner(owner)) {
    return [];
  }
  const values: FunctionLogicValueChange[] = [];
  for (const source of call.arguments.slice(1)) {
    const fields = collectTypeScriptObjectLiteralFieldChanges(
      sourceFile,
      owner,
      source,
      { operation: "assign", operator: "Object.assign()", confidence: "inferred" }
    );
    if (fields.length > 0) {
      values.push(...fields);
      continue;
    }
    const unknownKeys = createFunctionLogicValueChange({
      target: owner,
      targetKind: "receiver",
      operation: "mutate",
      operator: "Object.assign()",
      value: sourceText(sourceFile, source),
      confidence: "inferred"
    });
    if (unknownKeys) values.push(unknownKeys);
  }
  return values;
}

/** Pushes child properties in reverse so the explicit stack emits source order. */
function pushObjectLiteralTasks(
  pending: ObjectLiteralTask[],
  owner: string,
  literal: ts.ObjectLiteralExpression,
  expansion: ObjectLiteralExpansion
): void {
  for (let index = literal.properties.length - 1; index >= 0; index -= 1) {
    pending.push({ owner, property: literal.properties[index], expansion });
  }
}

/** Reads data-like property forms without treating methods/accessors as JSON fields. */
function readObjectLiteralField(
  sourceFile: ts.SourceFile,
  property: ts.ObjectLiteralElementLike
): { key: string | number; value: ts.Expression } | undefined {
  if (ts.isPropertyAssignment(property)) {
    const key = readStaticPropertyName(property.name);
    return key === undefined ? undefined : { key, value: property.initializer };
  }
  if (ts.isShorthandPropertyAssignment(property)) {
    return { key: property.name.text, value: property.name };
  }
  // Source text is intentionally referenced here to keep this parser helper's
  // contract tied to the same SourceFile even when TypeScript adds node forms.
  void sourceFile;
  return undefined;
}

/** Decodes only parser-proven property names; dynamic computed keys stay unknown. */
function readStaticPropertyName(name: ts.PropertyName): string | number | undefined {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
  if (ts.isNumericLiteral(name)) return Number(name.text);
  if (!ts.isComputedPropertyName(name)) return undefined;
  const expression = unwrapExpression(name.expression);
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return expression.text;
  }
  return ts.isNumericLiteral(expression) ? Number(expression.text) : undefined;
}

/** Recognizes the uncomputed built-in spelling without resolving shadowing. */
function isObjectAssignCall(call: ts.CallExpression): boolean {
  const callee = unwrapExpression(call.expression);
  return ts.isPropertyAccessExpression(callee)
    && ts.isIdentifier(callee.expression)
    && callee.expression.text === "Object"
    && callee.name.text === "assign";
}

/** Removes only syntax wrappers that preserve the literal/callee identity. */
function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current)
    || ts.isSatisfiesExpression(current)) {
    current = current.expression;
  }
  return current;
}

/** Returns an object literal after safe wrapper removal. */
function readObjectLiteral(expression: ts.Expression): ts.ObjectLiteralExpression | undefined {
  const unwrapped = unwrapExpression(expression);
  return ts.isObjectLiteralExpression(unwrapped) ? unwrapped : undefined;
}

/** Preserves complete field values for graph evidence and Scenario evaluation. */
function sourceText(sourceFile: ts.SourceFile, node: ts.Node): string {
  return normalizeValueChangeText(node.getText(sourceFile));
}
