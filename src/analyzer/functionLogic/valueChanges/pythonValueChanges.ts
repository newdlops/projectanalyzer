/**
 * Python value-change extraction for Lezer-backed Function Logic. Direct
 * assignments/deletes are exact, for-loop bindings are explicit iterations,
 * and known mutating receiver calls remain visibly inferred.
 */

import type { SyntaxNode } from "@lezer/common";
import {
  getLezerChildren,
  type LezerSource
} from "../../core/lezerSource";
import type { FunctionLogicValueChange } from "./types";
import { collectPythonDictionaryFieldChanges } from "./objectFields";
import {
  classifyFunctionLogicValueTarget,
  createFunctionLogicValueChange,
  finalizeFunctionLogicValueChanges,
  isPotentialReceiverMutationMethod,
  looksLikeStaticTypeReceiver,
  normalizeValueChangeText
} from "./valueChangeSupport";

/** Extracts complete changes owned by one visible Python statement/header. */
export function collectPythonValueChanges(
  source: LezerSource,
  statement: SyntaxNode
): FunctionLogicValueChange[] {
  const values: Array<FunctionLogicValueChange | undefined> = [];

  if (statement.name === "AssignStatement" || statement.name === "UpdateStatement") {
    collectPythonAssignmentChanges(source, statement, values);
  } else if (statement.name === "DeleteStatement") {
    collectPythonDeleteChanges(source, statement, values);
  } else if (statement.name === "ForStatement") {
    values.push(createPythonIterationChange(source, statement));
  }

  values.push(...collectPythonReceiverChanges(source, statement));
  return finalizeFunctionLogicValueChanges(values);
}

/** Reads simple, chained, tuple, and augmented assignments from direct children. */
function collectPythonAssignmentChanges(
  source: LezerSource,
  statement: SyntaxNode,
  values: Array<FunctionLogicValueChange | undefined>
): void {
  const operators = getLezerChildren(statement).filter((child) =>
    child.name === "AssignOp" || child.name === "UpdateOp"
  );
  const lastOperator = operators.at(-1);
  if (!lastOperator) {
    return;
  }
  const assignedValue = normalizeValueChangeText(
    source.text.slice(lastOperator.to, statement.to)
  );
  const dictionary = getLezerChildren(statement).find((child) =>
    child.name === "DictionaryExpression" && child.from >= lastOperator.to
  );
  let targetStart = statement.from;
  for (const operator of operators) {
    const target = normalizeValueChangeText(source.text.slice(targetStart, operator.from));
    values.push(createFunctionLogicValueChange({
      target,
      targetKind: classifyPythonTarget(target),
      operation: operator.name === "AssignOp" ? "assign" : "update",
      operator: normalizeValueChangeText(source.text.slice(operator.from, operator.to)),
      value: assignedValue,
      confidence: "exact"
    }));
    if (operator.name === "AssignOp" && dictionary) {
      values.push(...collectPythonDictionaryFieldChanges(
        source,
        target,
        dictionary,
        { operation: "assign", operator: "=", confidence: "exact" }
      ));
    }
    targetStart = operator.to;
  }
}

/** Emits one exact deletion annotation for every direct delete target. */
function collectPythonDeleteChanges(
  source: LezerSource,
  statement: SyntaxNode,
  values: Array<FunctionLogicValueChange | undefined>
): void {
  for (const child of getLezerChildren(statement)) {
    if (child.name === "del" || child.name === ",") {
      continue;
    }
    const target = normalizeValueChangeText(source.text.slice(child.from, child.to));
    values.push(createFunctionLogicValueChange({
      target,
      targetKind: classifyFunctionLogicValueTarget(target),
      operation: "delete",
      operator: "delete",
      confidence: "exact"
    }));
  }
}

/** Models `for target in iterable` as an exact per-iteration binding change. */
function createPythonIterationChange(
  source: LezerSource,
  statement: SyntaxNode
): FunctionLogicValueChange | undefined {
  const children = getLezerChildren(statement);
  const forKeyword = children.find((child) => child.name === "for");
  const inKeyword = children.find((child) => child.name === "in");
  const body = children.find((child) => child.name === "Body");
  if (!forKeyword || !inKeyword) {
    return undefined;
  }
  return createFunctionLogicValueChange({
    target: source.text.slice(forKeyword.to, inKeyword.from),
    targetKind: "variable",
    operation: "iterate",
    operator: "← each",
    value: source.text.slice(inKeyword.to, body?.from ?? statement.to),
    confidence: "exact"
  });
}

/** Finds receiver calls in a statement header/direct expression without entering bodies. */
function collectPythonReceiverChanges(
  source: LezerSource,
  statement: SyntaxNode
): FunctionLogicValueChange[] {
  const values: Array<FunctionLogicValueChange | undefined> = [];
  const pending: SyntaxNode[] = [statement];

  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) {
      continue;
    }
    if (node !== statement && isPythonOwnedBody(node)) {
      continue;
    }
    if (node.name === "CallExpression") {
      values.push(...createPythonReceiverCallChanges(source, node));
    }
    const children = getLezerChildren(node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index]);
    }
  }
  return finalizeFunctionLogicValueChanges(values);
}

/** Converts one receiver call into a root hint plus literal-key field hints. */
function createPythonReceiverCallChanges(
  source: LezerSource,
  call: SyntaxNode
): Array<FunctionLogicValueChange | undefined> {
  const children = getLezerChildren(call);
  const member = children.find((child) => child.name === "MemberExpression");
  const argumentsNode = children.find((child) => child.name === "ArgList");
  if (!member) {
    return [];
  }
  const memberChildren = getLezerChildren(member);
  const receiverNode = memberChildren[0];
  const methodNode = [...memberChildren].reverse().find((child) =>
    child.name === "PropertyName"
  );
  if (!receiverNode || !methodNode) {
    return [];
  }
  const methodName = source.text.slice(methodNode.from, methodNode.to);
  if (!isPotentialReceiverMutationMethod(methodName)) {
    return [];
  }
  const receiver = normalizeValueChangeText(
    source.text.slice(receiverNode.from, receiverNode.to)
  );
  if (looksLikeStaticTypeReceiver(receiver)) {
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
  if (methodName === "update" && argumentsNode) {
    const dictionary = getLezerChildren(argumentsNode).find((child) =>
      child.name === "DictionaryExpression"
    );
    if (dictionary) {
      values.push(...collectPythonDictionaryFieldChanges(
        source,
        receiver,
        dictionary,
        { operation: "mutate", operator: "update()", confidence: "inferred" }
      ));
    }
  }
  return values;
}

/** Keeps control-suite and nested-scope statements out of their owner's annotation. */
function isPythonOwnedBody(node: SyntaxNode): boolean {
  return node.name === "Body"
    || node.name === "MatchBody"
    || node.name === "FunctionDefinition"
    || node.name === "ClassDefinition"
    || node.name === "LambdaExpression";
}

/** Classifies tuple bindings as variables unless member/index syntax is visible. */
function classifyPythonTarget(target: string): "variable" | "property" {
  return /[.\[]/u.test(target)
    ? "property"
    : "variable";
}

/** Removes only one pair of parser-proven argument delimiters. */
function readDelimitedValue(source: LezerSource, node: SyntaxNode): string | undefined {
  const raw = source.text.slice(node.from, node.to).trim();
  const value = raw.startsWith("(") && raw.endsWith(")")
    ? raw.slice(1, -1)
    : raw;
  return normalizeValueChangeText(value) || undefined;
}
