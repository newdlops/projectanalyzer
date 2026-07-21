/**
 * Java value-change extraction for Lezer-backed Function Logic. Declarations,
 * assignments, and update expressions are exact; common mutating receiver
 * methods are conservative hints and never cross into owned statement bodies.
 */

import type { SyntaxNode } from "@lezer/common";
import {
  getLezerChildren,
  type LezerSource
} from "../../core/lezerSource";
import type { FunctionLogicValueChange } from "./types";
import {
  appendObjectFieldLiteralTarget,
  isStaticObjectFieldKeyLiteral
} from "./objectFields";
import {
  classifyFunctionLogicValueTarget,
  createFunctionLogicValueChange,
  finalizeFunctionLogicValueChanges,
  isPotentialReceiverMutationMethod,
  looksLikeStaticTypeReceiver,
  normalizeValueChangeText
} from "./valueChangeSupport";

/** Extracts writes and receiver changes owned by one Java statement/header. */
export function collectJavaValueChanges(
  source: LezerSource,
  statement: SyntaxNode
): FunctionLogicValueChange[] {
  const values: Array<FunctionLogicValueChange | undefined> = [];
  const ownedBodies = findDirectJavaOwnedBodies(statement);
  const pending: SyntaxNode[] = [statement];

  if (statement.name === "EnhancedForStatement") {
    values.push(createJavaIterationChange(source, statement));
  }

  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) {
      continue;
    }
    if (node !== statement && (ownedBodies.has(node) || isJavaNestedBody(node))) {
      continue;
    }
    if (node.name === "LocalVariableDeclaration") {
      collectJavaDeclarationChanges(source, node, values);
    } else if (node.name === "AssignmentExpression") {
      values.push(createJavaAssignmentChange(source, node));
    } else if (node.name === "UpdateExpression") {
      values.push(createJavaUpdateChange(source, node));
    } else if (node.name === "MethodInvocation") {
      values.push(...createJavaReceiverCallChanges(source, node));
    }

    const children = getLezerChildren(node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index]);
    }
  }
  return finalizeFunctionLogicValueChanges(values);
}

/** Adds every initialized local declarator without treating a type as a target. */
function collectJavaDeclarationChanges(
  source: LezerSource,
  declaration: SyntaxNode,
  values: Array<FunctionLogicValueChange | undefined>
): void {
  for (const declarator of getLezerChildren(declaration).filter((child) =>
    child.name === "VariableDeclarator"
  )) {
    const children = getLezerChildren(declarator);
    const operator = children.find((child) => child.name === "AssignOp");
    const target = children.find((child) => child.name === "Definition");
    if (!operator || !target) {
      continue;
    }
    values.push(createFunctionLogicValueChange({
      target: source.text.slice(target.from, target.to),
      targetKind: "variable",
      operation: "initialize",
      operator: source.text.slice(operator.from, operator.to),
      value: source.text.slice(operator.to, declarator.to),
      confidence: "exact"
    }));
  }
}

/** Reads one exact assignment/update target and its unevaluated right-hand value. */
function createJavaAssignmentChange(
  source: LezerSource,
  expression: SyntaxNode
): FunctionLogicValueChange | undefined {
  const operator = getLezerChildren(expression).find((child) => child.name === "AssignOp");
  if (!operator) {
    return undefined;
  }
  const target = normalizeValueChangeText(source.text.slice(expression.from, operator.from));
  const operatorText = normalizeValueChangeText(source.text.slice(operator.from, operator.to));
  return createFunctionLogicValueChange({
    target,
    targetKind: classifyFunctionLogicValueTarget(target),
    operation: operatorText === "=" ? "assign" : "update",
    operator: operatorText,
    value: source.text.slice(operator.to, expression.to),
    confidence: "exact"
  });
}

/** Supports both prefix and postfix Java update expressions. */
function createJavaUpdateChange(
  source: LezerSource,
  expression: SyntaxNode
): FunctionLogicValueChange | undefined {
  const operator = getLezerChildren(expression).find((child) => child.name === "UpdateOp");
  if (!operator) {
    return undefined;
  }
  const prefix = operator.from === expression.from;
  const target = normalizeValueChangeText(source.text.slice(
    prefix ? operator.to : expression.from,
    prefix ? expression.to : operator.from
  ));
  return createFunctionLogicValueChange({
    target,
    targetKind: classifyFunctionLogicValueTarget(target),
    operation: "update",
    operator: source.text.slice(operator.from, operator.to),
    confidence: "exact"
  });
}

/** Models an enhanced-for definition as receiving one value from its iterable. */
function createJavaIterationChange(
  source: LezerSource,
  statement: SyntaxNode
): FunctionLogicValueChange | undefined {
  const forSpec = getLezerChildren(statement).find((child) => child.name === "ForSpec");
  if (!forSpec) {
    return undefined;
  }
  const children = getLezerChildren(forSpec);
  const target = children.find((child) => child.name === "Definition");
  const colon = children.find((child) => child.name === ":");
  const close = [...children].reverse().find((child) => child.name === ")");
  if (!target || !colon) {
    return undefined;
  }
  return createFunctionLogicValueChange({
    target: source.text.slice(target.from, target.to),
    targetKind: "variable",
    operation: "iterate",
    operator: "← each",
    value: source.text.slice(colon.to, close?.from ?? forSpec.to),
    confidence: "exact"
  });
}

/** Converts one dotted invocation into receiver and literal-key field hints. */
function createJavaReceiverCallChanges(
  source: LezerSource,
  invocation: SyntaxNode
): Array<FunctionLogicValueChange | undefined> {
  const children = getLezerChildren(invocation);
  const method = children.find((child) => child.name === "MethodName");
  const dot = method
    ? [...children].reverse().find((child) => child.name === "." && child.from < method.from)
    : undefined;
  const argumentsNode = children.find((child) => child.name === "ArgumentList");
  if (!method || !dot) {
    return [];
  }
  const methodName = normalizeValueChangeText(source.text.slice(method.from, method.to));
  if (!isPotentialReceiverMutationMethod(methodName)) {
    return [];
  }
  const receiver = normalizeValueChangeText(source.text.slice(invocation.from, dot.from));
  if (!receiver || looksLikeStaticTypeReceiver(receiver)) {
    return [];
  }
  const values: Array<FunctionLogicValueChange | undefined> = [createFunctionLogicValueChange({
    target: receiver,
    targetKind: "receiver",
    operation: "mutate",
    operator: `${methodName}()`,
    value: argumentsNode ? readDelimitedValue(source, argumentsNode) : undefined,
    confidence: "inferred"
  })];
  const field = argumentsNode
    ? createJavaKeyedReceiverFieldChange(source, receiver, methodName, argumentsNode)
    : undefined;
  if (field) values.push(field);
  return values;
}

/** Adds an inferred map/list key when a mutator's first argument is literal. */
function createJavaKeyedReceiverFieldChange(
  source: LezerSource,
  receiver: string,
  methodName: string,
  argumentsNode: SyntaxNode
): FunctionLogicValueChange | undefined {
  if (!JAVA_KEYED_MUTATION_METHODS.has(methodName.toLowerCase())) {
    return undefined;
  }
  const argumentsList = getLezerChildren(argumentsNode).filter((child) =>
    child.name !== "(" && child.name !== ")" && child.name !== ","
  );
  const key = argumentsList[0]
    ? normalizeValueChangeText(source.text.slice(argumentsList[0].from, argumentsList[0].to))
    : "";
  if (!isStaticObjectFieldKeyLiteral(key)) {
    return undefined;
  }
  return createFunctionLogicValueChange({
    target: appendObjectFieldLiteralTarget(receiver, key),
    targetKind: "property",
    operation: "mutate",
    operator: `${methodName}()`,
    value: argumentsList[1]
      ? source.text.slice(argumentsList[1].from, argumentsList[1].to)
      : undefined,
    confidence: "inferred"
  });
}

/** Finds unbraced direct control bodies so their changes stay on child blocks. */
function findDirectJavaOwnedBodies(statement: SyntaxNode): Set<SyntaxNode> {
  if (!JAVA_CONTROL_STATEMENTS.has(statement.name)) {
    return new Set();
  }
  return new Set(getLezerChildren(statement).filter((child) =>
    child.name === "Block"
      || child.name === "SwitchBlock"
      || child.name.endsWith("Statement")
  ));
}

/** Prunes nested blocks and callable/type scopes during iterative traversal. */
function isJavaNestedBody(node: SyntaxNode): boolean {
  return node.name === "Block"
    || node.name === "SwitchBlock"
    || node.name === "ClassBody"
    || node.name === "LambdaExpression";
}

/** Removes only the parser-proven argument-list delimiters. */
function readDelimitedValue(source: LezerSource, node: SyntaxNode): string | undefined {
  const raw = source.text.slice(node.from, node.to).trim();
  const value = raw.startsWith("(") && raw.endsWith(")")
    ? raw.slice(1, -1)
    : raw;
  return normalizeValueChangeText(value) || undefined;
}

/** Statements whose direct child statements are separately visible CFG blocks. */
const JAVA_CONTROL_STATEMENTS = new Set([
  "DoStatement",
  "EnhancedForStatement",
  "ForStatement",
  "IfStatement",
  "SwitchStatement",
  "SynchronizedStatement",
  "WhileStatement"
]);

/** Receiver methods whose first literal argument denotes a key or index. */
const JAVA_KEYED_MUTATION_METHODS = new Set([
  "compute",
  "computeifabsent",
  "computeifpresent",
  "merge",
  "put",
  "remove",
  "replace",
  "set"
]);
