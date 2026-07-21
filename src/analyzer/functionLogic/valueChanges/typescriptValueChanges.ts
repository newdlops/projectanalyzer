/**
 * TypeScript/JavaScript value-change extraction. It reads only the selected
 * statement header/direct expression, uses an explicit stack for nested
 * expressions, and never traverses into an owned control-flow body.
 */

import * as ts from "typescript";
import type { FunctionLogicValueChange } from "./types";
import {
  collectTypeScriptObjectAssignFieldChanges,
  collectTypeScriptObjectLiteralFieldChanges
} from "./objectFields";
import {
  classifyFunctionLogicValueTarget,
  createFunctionLogicValueChange,
  finalizeFunctionLogicValueChanges,
  isPotentialReceiverMutationMethod,
  looksLikeStaticTypeReceiver,
  normalizeValueChangeText
} from "./valueChangeSupport";

/** Extracts writes and receiver mutations owned by one visible statement. */
export function collectTypeScriptValueChanges(
  sourceFile: ts.SourceFile,
  statement: ts.Statement
): FunctionLogicValueChange[] {
  const values: Array<FunctionLogicValueChange | undefined> = [];
  const expressions: ts.Expression[] = [];

  if (ts.isVariableStatement(statement)) {
    collectVariableDeclarationChanges(sourceFile, statement.declarationList, values, expressions);
  } else if (ts.isForStatement(statement)) {
    if (statement.initializer && ts.isVariableDeclarationList(statement.initializer)) {
      collectVariableDeclarationChanges(sourceFile, statement.initializer, values, expressions);
    } else if (statement.initializer) {
      expressions.push(statement.initializer);
    }
    if (statement.condition) expressions.push(statement.condition);
    if (statement.incrementor) expressions.push(statement.incrementor);
  } else if (ts.isForInStatement(statement) || ts.isForOfStatement(statement)) {
    collectIterationBindingChange(sourceFile, statement, values);
    expressions.push(statement.expression);
  } else {
    const expression = readStatementExpression(statement);
    if (expression) expressions.push(expression);
  }

  for (const expression of expressions) {
    values.push(...collectTypeScriptExpressionValueChanges(sourceFile, expression));
  }
  return finalizeFunctionLogicValueChanges(values);
}

/** Extracts value changes from a concise arrow body or another bounded expression. */
export function collectTypeScriptExpressionValueChanges(
  sourceFile: ts.SourceFile,
  root: ts.Expression
): FunctionLogicValueChange[] {
  const values: Array<FunctionLogicValueChange | undefined> = [];
  const pending: ts.Node[] = [root];

  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) {
      continue;
    }
    if (node !== root && isNestedFunction(node)) {
      continue;
    }
    if (ts.isBinaryExpression(node) && isAssignmentOperator(node.operatorToken.kind)) {
      const target = sourceText(sourceFile, node.left);
      const operation = node.operatorToken.kind === ts.SyntaxKind.EqualsToken
        ? "assign"
        : "update";
      values.push(createFunctionLogicValueChange({
        target,
        targetKind: classifyFunctionLogicValueTarget(target),
        operation,
        operator: sourceText(sourceFile, node.operatorToken),
        value: sourceText(sourceFile, node.right),
        confidence: "exact"
      }));
      if (operation === "assign") {
        values.push(...collectTypeScriptObjectLiteralFieldChanges(
          sourceFile,
          target,
          node.right,
          { operation, operator: "=", confidence: "exact" }
        ));
      }
    } else if (isUpdateExpression(node)) {
      values.push(createFunctionLogicValueChange({
        target: sourceText(sourceFile, node.operand),
        targetKind: classifyFunctionLogicValueTarget(sourceText(sourceFile, node.operand)),
        operation: "update",
        operator: ts.tokenToString(node.operator) ?? "update",
        confidence: "exact"
      }));
    } else if (ts.isDeleteExpression(node)) {
      values.push(createFunctionLogicValueChange({
        target: sourceText(sourceFile, node.expression),
        targetKind: classifyFunctionLogicValueTarget(sourceText(sourceFile, node.expression)),
        operation: "delete",
        operator: "delete",
        confidence: "exact"
      }));
    } else if (ts.isCallExpression(node)) {
      values.push(createReceiverCallChange(sourceFile, node));
      values.push(...collectTypeScriptObjectAssignFieldChanges(sourceFile, node));
    }

    const children = getImmediateChildren(node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index]);
    }
  }
  return finalizeFunctionLogicValueChanges(values);
}

/** Adds initialized declarations and scans only their initializer expressions. */
function collectVariableDeclarationChanges(
  sourceFile: ts.SourceFile,
  declarations: ts.VariableDeclarationList,
  values: Array<FunctionLogicValueChange | undefined>,
  expressions: ts.Expression[]
): void {
  for (const declaration of declarations.declarations) {
    if (!declaration.initializer) {
      continue;
    }
    const target = sourceText(sourceFile, declaration.name);
    values.push(createFunctionLogicValueChange({
      target,
      targetKind: "variable",
      operation: "initialize",
      operator: "=",
      value: sourceText(sourceFile, declaration.initializer),
      confidence: "exact"
    }));
    if (ts.isIdentifier(declaration.name)) {
      values.push(...collectTypeScriptObjectLiteralFieldChanges(
        sourceFile,
        target,
        declaration.initializer,
        { operation: "initialize", operator: "=", confidence: "exact" }
      ));
    }
    expressions.push(declaration.initializer);
  }
}

/** Models a for-in/of binding as receiving one value on every iteration. */
function collectIterationBindingChange(
  sourceFile: ts.SourceFile,
  statement: ts.ForInStatement | ts.ForOfStatement,
  values: Array<FunctionLogicValueChange | undefined>
): void {
  const initializer = statement.initializer;
  if (ts.isVariableDeclarationList(initializer)) {
    for (const declaration of initializer.declarations) {
      values.push(createFunctionLogicValueChange({
        target: sourceText(sourceFile, declaration.name),
        targetKind: "variable",
        operation: "iterate",
        operator: "← each",
        value: sourceText(sourceFile, statement.expression),
        confidence: "exact"
      }));
    }
    return;
  }
  values.push(createFunctionLogicValueChange({
    target: sourceText(sourceFile, initializer),
    targetKind: classifyFunctionLogicValueTarget(sourceText(sourceFile, initializer)),
    operation: "iterate",
    operator: "← each",
    value: sourceText(sourceFile, statement.expression),
    confidence: "exact"
  }));
}

/** Returns the one direct expression owned by a non-for statement. */
function readStatementExpression(statement: ts.Statement): ts.Expression | undefined {
  if (ts.isExpressionStatement(statement)) return statement.expression;
  if (ts.isIfStatement(statement)) return statement.expression;
  if (ts.isWhileStatement(statement) || ts.isDoStatement(statement)) return statement.expression;
  if (ts.isSwitchStatement(statement)) return statement.expression;
  if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement)) {
    return statement.expression;
  }
  if (ts.isWithStatement(statement)) return statement.expression;
  return undefined;
}

/** Creates an inferred receiver annotation for a known in-place method name. */
function createReceiverCallChange(
  sourceFile: ts.SourceFile,
  call: ts.CallExpression
): FunctionLogicValueChange | undefined {
  const member = unwrapExpression(call.expression);
  let receiver: ts.Expression | undefined;
  let methodName: string | undefined;
  if (ts.isPropertyAccessExpression(member)) {
    receiver = member.expression;
    methodName = member.name.text;
  } else if (ts.isElementAccessExpression(member)) {
    const argument = member.argumentExpression;
    if (argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))) {
      receiver = member.expression;
      methodName = argument.text;
    }
  }
  if (!receiver || !methodName || !isPotentialReceiverMutationMethod(methodName)) {
    return undefined;
  }
  const receiverText = sourceText(sourceFile, receiver);
  if (looksLikeStaticTypeReceiver(receiverText)) {
    return undefined;
  }
  return createFunctionLogicValueChange({
    target: receiverText,
    targetKind: "receiver",
    operation: "mutate",
    operator: `${methodName}()`,
    value: call.arguments.length > 0
      ? call.arguments.map((argument) => sourceText(sourceFile, argument)).join(", ")
      : undefined,
    confidence: "inferred"
  });
}

/** Removes syntax wrappers that do not change a callee's receiver identity. */
function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current)) {
    current = current.expression;
  }
  return current;
}

/** Narrows prefix/postfix ++ and -- expressions. */
function isUpdateExpression(
  node: ts.Node
): node is ts.PrefixUnaryExpression | ts.PostfixUnaryExpression {
  return (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
    && (node.operator === ts.SyntaxKind.PlusPlusToken
      || node.operator === ts.SyntaxKind.MinusMinusToken);
}

/** Enumerates assignment operators without evaluating the assigned expression. */
function isAssignmentOperator(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

/** Stops receiver/write discovery at nested callable boundaries. */
function isNestedFunction(node: ts.Node): boolean {
  return ts.isFunctionDeclaration(node)
    || ts.isFunctionExpression(node)
    || ts.isArrowFunction(node)
    || ts.isMethodDeclaration(node)
    || ts.isConstructorDeclaration(node)
    || ts.isGetAccessorDeclaration(node)
    || ts.isSetAccessorDeclaration(node);
}

/** Returns immediate compiler children for iterative expression traversal. */
function getImmediateChildren(node: ts.Node): ts.Node[] {
  const children: ts.Node[] = [];
  ts.forEachChild(node, (child) => {
    children.push(child);
    return undefined;
  });
  return children;
}

/** Reads complete source expression text without changing its static meaning. */
function sourceText(sourceFile: ts.SourceFile, node: ts.Node): string {
  return normalizeValueChangeText(node.getText(sourceFile));
}
