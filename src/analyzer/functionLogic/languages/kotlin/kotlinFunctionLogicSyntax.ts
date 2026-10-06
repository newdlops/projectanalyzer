/**
 * Kotlin source interpretation for Function Logic. Transparent grammar wrappers
 * are unwrapped iteratively; executable scopes and source writes remain explicit.
 */
import type { SymbolNode } from "../../../../shared/types";
import type { FunctionLogicBlock, FunctionLogicBlockKind, FunctionLogicCallsite, FunctionLogicGap, FunctionLogicValueChange } from "../../types";
import type { StructuredCallableDescriptor, StructuredStatementTask } from "../../core/structuredFunctionLogicAnalyzer";
import { createFunctionLogicBlockId, isPotentialFunctionEffectCall } from "../../core/functionLogicSupport";
import {
  collectKotlinCallables, collectKotlinCalls, getKotlinChildNamed, getKotlinBodyStatements,
  kotlinNodeRange, kotlinOffsetsRange, type KotlinSource, type KotlinSyntaxNode
} from "../../../languages/kotlin";

/** Grammar wrappers may contain punctuation, but never another executable operand. */
const TRANSPARENT_RULES = new Set([
  "statement", "declaration", "loopStatement", "expression", "disjunction", "conjunction",
  "equality", "comparison", "genericCallLikeComparison", "infixOperation", "elvisExpression",
  "infixFunctionCall", "rangeExpression", "additiveExpression", "multiplicativeExpression",
  "asExpression", "prefixUnaryExpression", "postfixUnaryExpression", "primaryExpression",
  "parenthesizedExpression", "controlStructureBody"
]);

/** Finds the exact source declaration before adapting its executable body. */
export function findSelectedKotlinCallable(source: KotlinSource, node: SymbolNode): StructuredCallableDescriptor<KotlinSyntaxNode> | undefined {
  const candidates = collectKotlinCallables(source).filter((callable) => callable.name === node.name)
    .map((callable) => {
      const range = kotlinOffsetsRange(source, callable.selectionFrom, callable.selectionTo);
      return { callable, exact: range.startLine === node.selectionRange.startLine
        && range.startCharacter === node.selectionRange.startCharacter,
      distance: Math.abs(range.startLine - node.selectionRange.startLine) * 10000
        + Math.abs(range.startCharacter - node.selectionRange.startCharacter) };
    }).sort((left, right) => Number(right.exact) - Number(left.exact)
      || Number(right.callable.qualifiedName === node.qualifiedName) - Number(left.callable.qualifiedName === node.qualifiedName)
      || left.distance - right.distance);
  const callable = candidates[0]?.callable;
  if (!callable) return undefined;
  return {
    node: callable.node, body: callable.body,
    signature: normalizeKotlinText(source.text.slice(callable.node.from, callable.body.from)),
    sourceRange: kotlinNodeRange(source, callable.node),
    bodyRange: kotlinNodeRange(source, callable.body), expressionBody: callable.expressionBody,
    lexicalOwnerQualifiedName: callable.lexicalTypeOwner || undefined
  };
}

/** Removes only single-operand grammar layers, retaining operators and scopes. */
export function unwrapKotlinNode(root: KotlinSyntaxNode): KotlinSyntaxNode {
  let node = root;
  const visited = new Set<KotlinSyntaxNode>();
  while (TRANSPARENT_RULES.has(node.name) && !visited.has(node)) {
    visited.add(node);
    const children = node.children.filter((child) => /^[a-z]/u.test(child.name)
      && child.name !== "label" && child.name !== "annotation");
    if (children.length !== 1) break;
    node = children[0];
  }
  return node;
}

/** Reads a block, control body, or expression as direct source-ordered statements. */
export function kotlinBodyStatements(node: KotlinSyntaxNode): KotlinSyntaxNode[] {
  const unwrapped = unwrapKotlinNode(node);
  if (unwrapped.name === "block" || unwrapped.name === "functionBody") return getKotlinBodyStatements(unwrapped);
  return [unwrapped];
}

/** Keeps strings intact in full source; only the display preview collapses whitespace. */
export function normalizeKotlinText(value: string, fallback = "Statement"): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized ? normalized.length > 240 ? `${normalized.slice(0, 239)}…` : normalized : fallback;
}

/** Nested scopes never contribute their calls, jumps, or local value writes to a parent. */
export function isKotlinDeferredScope(node: KotlinSyntaxNode): boolean {
  return ["functionDeclaration", "anonymousFunction", "lambdaLiteral", "classDeclaration", "objectDeclaration", "objectLiteral"].includes(node.name);
}

/** Walks lexical descendants with an explicit depth/node bound and scope pruning. */
export function findKotlinOwnedNodes(root: KotlinSyntaxNode, accept: (node: KotlinSyntaxNode) => boolean,
  skipControlBodies = false): KotlinSyntaxNode[] {
  const results: KotlinSyntaxNode[] = [];
  const stack = [{ node: root, depth: 0 }];
  const visited = new Set<KotlinSyntaxNode>();
  while (stack.length && visited.size < 50000) {
    const item = stack.pop();
    if (!item || visited.has(item.node) || item.depth > 256) continue;
    visited.add(item.node);
    const node = item.node;
    if (accept(node)) results.push(node);
    if (node !== root && (isKotlinDeferredScope(node)
      || (skipControlBodies && ["block", "controlStructureBody", "whenEntry"].includes(node.name)))) continue;
    for (let index = node.children.length - 1; index >= 0; index -= 1) stack.push({ node: node.children[index], depth: item.depth + 1 });
  }
  return results;
}

/** Source-level assignment shape used by flow expansion and value annotation. */
export type KotlinWrite = { target: string; targetNode: KotlinSyntaxNode; expression: KotlinSyntaxNode;
  operation: "initialize" | "assign"; operator: string; constant?: boolean };

/** Reads direct val/var and assignment syntax without guessing inferred Kotlin types. */
export function readKotlinWrite(source: KotlinSource, statement: KotlinSyntaxNode): KotlinWrite | undefined {
  const node = unwrapKotlinNode(statement);
  const expression = getKotlinChildNamed(node, "expression");
  if (!expression) return undefined;
  if (node.name === "propertyDeclaration") {
    const declaration = getKotlinChildNamed(node, "variableDeclaration");
    const targetNode = declaration && getKotlinChildNamed(declaration, "simpleIdentifier");
    if (!targetNode) return undefined;
    return { target: source.text.slice(targetNode.from, targetNode.to).replace(/^`|`$/gu, ""), targetNode,
      expression, operation: "initialize", operator: "=", constant: node.children.some((child) => child.name === "VAL") };
  }
  if (node.name !== "assignment") return undefined;
  const targetNode = node.children.find((child) => child.name === "directlyAssignableExpression" || child.name === "assignableExpression");
  const operatorNode = node.children.find((child) => child.name === "ASSIGNMENT" || child.name === "assignmentAndOperator");
  if (!targetNode || !operatorNode) return undefined;
  return { target: source.text.slice(targetNode.from, targetNode.to).trim(), targetNode, expression,
    operation: "assign", operator: source.text.slice(operatorNode.from, operatorNode.to) };
}

/** Turns a direct write into an exact variable/property annotation. */
export function createKotlinWriteChange(write: KotlinWrite, value: string): FunctionLogicValueChange {
  return { target: write.target, targetKind: /^[\p{L}_][\p{L}\p{N}_]*$/u.test(write.target) ? "variable" : "property",
    operation: write.operation, operator: write.operator, value, confidence: "exact" };
}

/** Classifies raw source statements or language-owned selected expression arms. */
export function classifyKotlinStatement(source: KotlinSource, filePath: string,
  task: StructuredStatementTask<KotlinSyntaxNode>): FunctionLogicBlock {
  const node = unwrapKotlinNode(task.node);
  const rawText = source.text.slice(node.from, node.to);
  let kind: FunctionLogicBlockKind = "operation";
  let detail = "Reads one Kotlin source statement without computing runtime values.";
  let label = normalizeKotlinText(rawText);
  let confidence: FunctionLogicBlock["confidence"] = "exact";
  const write = readKotlinWrite(source, node);
  let valueChanges = write ? [createKotlinWriteChange(write, source.text.slice(write.expression.from, write.expression.to))] : [];
  if (isKotlinDeferredScope(node)) {
    kind = "callable";
    label = normalizeKotlinText(rawText.slice(0, Math.max(0, (getKotlinChildNamed(node, "functionBody")?.from ?? node.to) - node.from)));
    detail = "Defines a separate callable or type scope; its body is excluded from this execution path.";
  } else if (node.name === "jumpExpression") {
    const token = node.children.find((child) => /^(RETURN|THROW|BREAK|CONTINUE)/u.test(child.name));
    kind = token?.name.startsWith("RETURN") ? "return" : token?.name.startsWith("THROW") ? "throw"
      : token?.name.startsWith("BREAK") ? "break" : token?.name.startsWith("CONTINUE") ? "continue" : "unknown";
    confidence = token?.name.endsWith("_AT") ? "inferred" : "exact";
    detail = confidence === "inferred" ? "A labeled jump needs lexical target verification; source evidence is retained."
      : "Transfers control according to this source-level Kotlin jump.";
  } else if (task.implicitReturn) {
    kind = "return"; label = `return ${label}`;
    detail = "The expression-bodied Kotlin function returns this source expression; its value is not computed.";
  } else if (write) {
    kind = "mutation";
    detail = write.constant ? "Initializes a val reference; object-wide immutability is not implied." : "Writes the value of a Kotlin source variable or property.";
  } else {
    const update = findKotlinOwnedNodes(node, (candidate) => candidate.name === "postfixUnaryExpression"
      || candidate.name === "prefixUnaryExpression", true).find((candidate) => /(?:\+\+|--)\s*$|^\s*(?:\+\+|--)/u.test(source.text.slice(candidate.from, candidate.to)));
    if (update) {
      const updateText = source.text.slice(update.from, update.to).trim();
      const target = updateText.replace(/^\+\+|^--|\+\+$|--$/gu, "").trim();
      kind = "mutation";
      valueChanges = [{ target, targetKind: "variable", operation: "update", operator: updateText.includes("++") ? "++" : "--", confidence: "exact" }];
    } else {
      const calls = collectKotlinCalls(source, node, true);
      if (calls.length) {
        const effect = calls.some((call) => isPotentialFunctionEffectCall(call.calleeName));
        kind = effect ? "effect" : "call"; confidence = effect ? "inferred" : "exact";
        detail = effect ? "The call name suggests a possible effect; its implementation and result are unobserved."
          : "Invokes the source-visible callee; receiver and overload resolution remain conservative.";
      }
    }
  }
  const range = kotlinNodeRange(source, node);
  return { id: createFunctionLogicBlockId(filePath, kind, range, label), kind, label, detail,
    presentation: { labelKey: `logic-block-label-${kind}`, labelParams: { source: label }, detailKey: `logic-block-detail-${kind}` },
    depth: task.depth, branchLabel: task.branchLabel, branchPresentation: task.branchPresentation,
    confidence, filePath, range, valueChanges: valueChanges.length ? valueChanges : undefined };
}

/** Prunes nested scopes while retaining lexical direct calls in all root-owned branches. */
export function collectKotlinFunctionCallsites(source: KotlinSource, filePath: string,
  callable: StructuredCallableDescriptor<KotlinSyntaxNode>): FunctionLogicCallsite[] {
  return collectKotlinCalls(source, callable.body).map((call) => ({ filePath,
    range: kotlinNodeRange(source, call.node), calleeName: call.calleeName, calleeText: call.calleeText,
    confidence: /(?:\.|\?\.)/u.test(call.calleeText) ? "inferred" : "exact" }));
}

/** Explicit Kotlin execution gaps apply even when every visible statement parsed. */
export function createKotlinFunctionLogicGaps(): FunctionLogicGap[] {
  return [
    { code: "dynamicBehavior", message: "Kotlin paths are symbolic-only. Arithmetic, overloads, virtual/extension dispatch, external effects, and runtime values are not computed." },
    { code: "parseLimited", message: "Nested callable/lambda bodies, scope functions, inline/non-local returns, and coroutine scheduling are separate or deferred scopes. Complex argument expressions remain source-backed without expression-level path expansion." }
  ];
}

/** Supplies unexpanded body statements; language flow seeds carry their return/write context. */
export function getKotlinRootNodes(_source: KotlinSource, callable: StructuredCallableDescriptor<KotlinSyntaxNode>): KotlinSyntaxNode[] {
  return getKotlinBodyStatements(callable.body);
}
