/**
 * TypeScript/JavaScript lexical value-flow fact collector. It discovers
 * parameters, local declarations, `const` bindings, and direct identifier
 * reads/writes with an explicit AST stack while pruning nested callables.
 */

import * as ts from "typescript";
import { createContentHash } from "../../../shared/hash";
import type { SourceRange } from "../../../shared/types";
import type { FunctionLikeWithBody } from "../typescriptFunctionLogicInternal";
import type {
  FunctionLogicValueAccessFact,
  FunctionLogicValueBindingFact,
  FunctionLogicValueBindingKind,
  FunctionLogicValueFacts
} from "./types";

const MAX_BINDING_CANDIDATES = 160;
const MAX_VALUE_BINDINGS = 80;
const MAX_VALUE_ACCESSES = 700;

type TypeScriptBindingCandidate = {
  name: string;
  node: ts.Identifier;
  kind: FunctionLogicValueBindingKind;
  definitionPlacement: "entry" | "source";
  confidence: "exact" | "inferred";
  valueRole?: "component";
  initializer?: ts.Expression;
};

/** Collects bounded source facts without resolving values or runtime aliases. */
export function collectTypeScriptFunctionValueFacts(
  sourceFile: ts.SourceFile,
  functionNode: FunctionLikeWithBody
): FunctionLogicValueFacts {
  const candidates = deduplicateBindingCandidates(collectBindingCandidates(functionNode));
  const candidatesByName = groupCandidatesByName(candidates);
  const uniqueCandidates = candidates.filter((candidate) =>
    candidatesByName.get(candidate.name)?.length === 1
  );
  propagateComponentValueRoles(uniqueCandidates);
  const retainedCandidates = uniqueCandidates.slice(0, MAX_VALUE_BINDINGS);
  const omittedBindingCount = Math.max(0, uniqueCandidates.length - retainedCandidates.length)
    + Math.max(0, candidates.length - MAX_BINDING_CANDIDATES);
  const bindings = retainedCandidates.map((candidate) => createBindingFact(
    sourceFile,
    candidate
  ));
  const bindingByName = new Map(bindings.map((binding) => [binding.name, binding]));
  const declarationKeys = new Set(candidates.map((candidate) => nodeKey(candidate.node)));
  const accesses: FunctionLogicValueAccessFact[] = [];
  let omittedAccessCount = 0;
  const root = functionNode.body;
  const pending: ts.Node[] = [root];

  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) {
      continue;
    }
    if (node !== root && isNestedCallable(node) && !isTrackedJsxMapCallback(node)) {
      continue;
    }
    if (ts.isTypeNode(node)) {
      continue;
    }
    if (ts.isIdentifier(node)) {
      const binding = bindingByName.get(node.text);
      if (binding && !declarationKeys.has(nodeKey(node)) && isValueIdentifier(node)) {
        const access = classifyIdentifierAccess(node);
        const usage = classifyIdentifierUsage(node, access);
        if (accesses.length < MAX_VALUE_ACCESSES) {
          accesses.push({
            bindingId: binding.id,
            access,
            ...(usage ? { usage } : {}),
            range: toSourceRange(sourceFile, node),
            confidence: "exact"
          });
        } else {
          omittedAccessCount += 1;
        }
      }
    }
    const children = getImmediateChildren(node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index]);
    }
  }

  return { bindings, accesses, omittedBindingCount, omittedAccessCount };
}

/** Finds parameters and local binding names while respecting callable scope. */
function collectBindingCandidates(
  functionNode: FunctionLikeWithBody
): TypeScriptBindingCandidate[] {
  const candidates: TypeScriptBindingCandidate[] = [];
  for (const parameter of functionNode.parameters) {
    appendBindingNameCandidates(candidates, parameter.name, "parameter", "entry", "exact");
  }
  const root = functionNode.body;
  const pending: ts.Node[] = [root];
  while (pending.length > 0 && candidates.length < MAX_BINDING_CANDIDATES) {
    const node = pending.pop();
    if (!node) {
      continue;
    }
    if (node !== root && isNestedCallable(node) && !isTrackedJsxMapCallback(node)) {
      continue;
    }
    if (node !== root && isTrackedJsxMapCallback(node)) {
      for (const parameter of node.parameters) {
        appendBindingNameCandidates(
          candidates,
          parameter.name,
          "parameter",
          "source",
          "inferred"
        );
      }
    }
    if (ts.isVariableDeclaration(node)) {
      const declarationList = findVariableDeclarationList(node);
      const kind: FunctionLogicValueBindingKind = declarationList
        && (declarationList.flags & ts.NodeFlags.Const) !== 0
        ? "constant"
        : "local";
      appendBindingNameCandidates(
        candidates,
        node.name,
        kind,
        "source",
        "exact",
        node.initializer && containsJsxSyntax(node.initializer) ? "component" : undefined,
        node.initializer
      );
    }
    const children = getImmediateChildren(node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index]);
    }
  }
  return candidates.slice(0, MAX_BINDING_CANDIDATES);
}

/** Removes grammar paths that expose the same declaration node more than once. */
function deduplicateBindingCandidates(
  candidates: readonly TypeScriptBindingCandidate[]
): TypeScriptBindingCandidate[] {
  const result: TypeScriptBindingCandidate[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const key = nodeKey(candidate.node);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(candidate);
    }
  }
  return result;
}

/** Flattens destructuring names without recursive binding-pattern traversal. */
function appendBindingNameCandidates(
  candidates: TypeScriptBindingCandidate[],
  name: ts.BindingName,
  kind: FunctionLogicValueBindingKind,
  definitionPlacement: "entry" | "source",
  confidence: "exact" | "inferred",
  valueRole?: "component",
  initializer?: ts.Expression
): void {
  const pending: ts.BindingName[] = [name];
  while (pending.length > 0 && candidates.length < MAX_BINDING_CANDIDATES) {
    const current = pending.pop();
    if (!current) {
      continue;
    }
    if (ts.isIdentifier(current)) {
      candidates.push({
        name: current.text,
        node: current,
        kind,
        definitionPlacement,
        confidence,
        ...(valueRole ? { valueRole } : {}),
        ...(initializer ? { initializer } : {})
      });
      continue;
    }
    for (let index = current.elements.length - 1; index >= 0; index -= 1) {
      const element = current.elements[index];
      if (ts.isBindingElement(element)) {
        pending.push(element.name);
      }
    }
  }
}

/**
 * Propagates the component role through direct first-class value transport such
 * as `const selected = views[index]`; calls and property reads remain unknown.
 */
function propagateComponentValueRoles(
  candidates: TypeScriptBindingCandidate[]
): void {
  const componentNames = new Set(candidates
    .filter((candidate) => candidate.valueRole === "component")
    .map((candidate) => candidate.name));
  let remainingPasses = candidates.length;
  let changed = true;

  while (changed && remainingPasses > 0) {
    remainingPasses -= 1;
    changed = false;
    for (const candidate of candidates) {
      if (candidate.valueRole || !candidate.initializer) continue;
      if (!readsTransportedComponentValue(candidate.initializer, componentNames)) continue;
      candidate.valueRole = "component";
      componentNames.add(candidate.name);
      changed = true;
    }
  }
}

/** Recognizes only transparent containers and indexed component-value reads. */
function readsTransportedComponentValue(
  expression: ts.Expression,
  componentNames: ReadonlySet<string>
): boolean {
  const pending: ts.Expression[] = [expression];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    if (ts.isIdentifier(current)) {
      if (componentNames.has(current.text)) return true;
      continue;
    }
    if (ts.isParenthesizedExpression(current)
      || ts.isAsExpression(current)
      || ts.isTypeAssertionExpression(current)
      || ts.isNonNullExpression(current)
      || ts.isSatisfiesExpression(current)) {
      pending.push(current.expression);
      continue;
    }
    if (ts.isElementAccessExpression(current)) {
      pending.push(current.expression);
      continue;
    }
    if (ts.isConditionalExpression(current)) {
      pending.push(current.whenFalse, current.whenTrue);
      continue;
    }
    if (ts.isArrayLiteralExpression(current)) {
      for (let index = current.elements.length - 1; index >= 0; index -= 1) {
        const element = current.elements[index];
        if (ts.isExpression(element)) pending.push(element);
      }
    }
  }
  return false;
}

/** Uses one stable source identity per lexical binding. */
function createBindingFact(
  sourceFile: ts.SourceFile,
  candidate: TypeScriptBindingCandidate
): FunctionLogicValueBindingFact {
  const range = toSourceRange(sourceFile, candidate.node);
  const key = [
    sourceFile.fileName,
    candidate.kind,
    candidate.name,
    candidate.valueRole ?? "value",
    range.startLine,
    range.startCharacter
  ].join("\0");
  return {
    id: `logic-value-binding:${createContentHash(key).slice(0, 32)}`,
    name: candidate.name,
    kind: candidate.kind,
    declarationRange: range,
    definitionPlacement: candidate.definitionPlacement,
    confidence: candidate.confidence,
    ...(candidate.valueRole ? { valueRole: candidate.valueRole } : {})
  };
}

/** Duplicate lexical names are omitted because source-only name resolution is ambiguous. */
function groupCandidatesByName(
  candidates: readonly TypeScriptBindingCandidate[]
): Map<string, TypeScriptBindingCandidate[]> {
  const result = new Map<string, TypeScriptBindingCandidate[]>();
  for (const candidate of candidates) {
    const values = result.get(candidate.name) ?? [];
    values.push(candidate);
    result.set(candidate.name, values);
  }
  return result;
}

/** Excludes property/type/label syntax whose identifier is not a value read. */
function isValueIdentifier(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (!parent) return false;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isQualifiedName(parent)) return false;
  if ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent)
      || ts.isPropertyDeclaration(parent) || ts.isPropertySignature(parent))
    && parent.name === node && !ts.isComputedPropertyName(parent.name)) return false;
  if (ts.isBindingElement(parent) && parent.propertyName === node) return false;
  if (ts.isLabeledStatement(parent) || ts.isBreakStatement(parent)
    || ts.isContinueStatement(parent)) return false;
  if (ts.isJsxAttribute(parent) && parent.name === node) return false;
  if ((ts.isJsxOpeningElement(parent) || ts.isJsxSelfClosingElement(parent)
      || ts.isJsxClosingElement(parent))
    && parent.tagName === node && /^[a-z]/u.test(node.text)) return false;
  return true;
}

/** Distinguishes direct writes from reads and compound read/write operations. */
function classifyIdentifierAccess(
  node: ts.Identifier
): FunctionLogicValueAccessFact["access"] {
  const write = findContainingWrite(node);
  if (!write) {
    return "read";
  }
  if (write.kind === "update") {
    return "readwrite";
  }
  return write.operator === ts.SyntaxKind.EqualsToken ? "write" : "readwrite";
}

/**
 * Distinguishes internal computation from syntax that lets a read escape the
 * tracked lexical binding flow. The iterative parent walk stops at the first
 * statement/callable boundary and never claims that the sink actually ran.
 */
function classifyIdentifierUsage(
  node: ts.Identifier,
  access: FunctionLogicValueAccessFact["access"]
): FunctionLogicValueAccessFact["usage"] {
  if (access === "write") return undefined;
  let current: ts.Node = node;
  while (current.parent) {
    const parent = current.parent;
    if (ts.isReturnStatement(parent) || ts.isThrowStatement(parent)
      || ts.isYieldExpression(parent)) {
      return "sink";
    }
    if (ts.isCallExpression(parent) || ts.isNewExpression(parent)) {
      if (parent.arguments?.includes(current as ts.Expression)) return "sink";
      // A callee/receiver is consumed to dispatch the call; only arguments
      // cross the explicit call boundary represented by this collector.
      return "consume";
    }
    if (ts.isTaggedTemplateExpression(parent)) {
      return parent.template === current ? "sink" : "consume";
    }
    if (isJsxValueBoundary(parent)) {
      return "sink";
    }
    if (isAggregateStorageBoundary(parent, current)
      || isExternalAssignmentBoundary(parent, current)) {
      return "sink";
    }
    if (ts.isStatement(parent) || isNestedCallable(parent)) {
      break;
    }
    current = parent;
  }
  return "consume";
}

/** JSX props, children, spreads, and component tags pass values to render output. */
function isJsxValueBoundary(node: ts.Node): boolean {
  return ts.isJsxExpression(node)
    || ts.isJsxElement(node)
    || ts.isJsxSelfClosingElement(node)
    || ts.isJsxOpeningElement(node)
    || ts.isJsxAttribute(node)
    || ts.isJsxSpreadAttribute(node)
    || ts.isJsxFragment(node);
}

/** Object/array fields end direct lexical tracking even when the container stays local. */
function isAggregateStorageBoundary(parent: ts.Node, child: ts.Node): boolean {
  return (ts.isArrayLiteralExpression(parent)
      && parent.elements.includes(child as ts.Expression))
    || (ts.isPropertyAssignment(parent) && parent.initializer === child)
    || (ts.isShorthandPropertyAssignment(parent) && parent.name === child)
    || (ts.isSpreadAssignment(parent) && parent.expression === child)
    || (ts.isSpreadElement(parent) && parent.expression === child);
}

/** RHS values assigned into an untracked property/element are explicit sinks. */
function isExternalAssignmentBoundary(parent: ts.Node, child: ts.Node): boolean {
  return ts.isBinaryExpression(parent)
    && parent.right === child
    && isAssignmentOperator(parent.operatorToken.kind)
    && (ts.isPropertyAccessExpression(parent.left)
      || ts.isElementAccessExpression(parent.left));
}

/** Finds a direct or destructuring assignment target without treating receivers as writes. */
function findContainingWrite(
  node: ts.Identifier
): { kind: "assignment"; operator: ts.SyntaxKind } | { kind: "update" } | undefined {
  let current: ts.Node = node;
  while (current.parent) {
    const parent = current.parent;
    if ((ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent))
      && parent.operand === current
      && (parent.operator === ts.SyntaxKind.PlusPlusToken
        || parent.operator === ts.SyntaxKind.MinusMinusToken)) {
      return { kind: "update" };
    }
    if (ts.isBinaryExpression(parent) && parent.left === current
      && isAssignmentOperator(parent.operatorToken.kind)) {
      return { kind: "assignment", operator: parent.operatorToken.kind };
    }
    if ((ts.isForInStatement(parent) || ts.isForOfStatement(parent))
      && parent.initializer === current) {
      return { kind: "assignment", operator: ts.SyntaxKind.EqualsToken };
    }
    if (!isAssignmentPatternWrapper(parent, current)) {
      return undefined;
    }
    current = parent;
  }
  return undefined;
}

/** Allows climbing only through syntax that can form a destructuring target. */
function isAssignmentPatternWrapper(parent: ts.Node, child: ts.Node): boolean {
  return (ts.isParenthesizedExpression(parent) && parent.expression === child)
    || (ts.isArrayLiteralExpression(parent) && parent.elements.includes(child as ts.Expression))
    || (ts.isObjectLiteralExpression(parent) && parent.properties.includes(child as ts.ObjectLiteralElementLike))
    || (ts.isPropertyAssignment(parent) && parent.initializer === child)
    || (ts.isShorthandPropertyAssignment(parent) && parent.name === child)
    || (ts.isSpreadAssignment(parent) && parent.expression === child);
}

/** Finds the declaration-list flags that distinguish `const` from mutable locals. */
function findVariableDeclarationList(
  declaration: ts.VariableDeclaration
): ts.VariableDeclarationList | undefined {
  let current: ts.Node | undefined = declaration.parent;
  while (current) {
    if (ts.isVariableDeclarationList(current)) return current;
    if (ts.isStatement(current)) return undefined;
    current = current.parent;
  }
  return undefined;
}

/** Stops all access and binding discovery at a child callable boundary. */
function isNestedCallable(node: ts.Node): boolean {
  return ts.isFunctionDeclaration(node)
    || ts.isFunctionExpression(node)
    || ts.isArrowFunction(node)
    || ts.isMethodDeclaration(node)
    || ts.isConstructorDeclaration(node)
    || ts.isGetAccessorDeclaration(node)
    || ts.isSetAccessorDeclaration(node);
}

/** Includes only concise `.map` callbacks already expanded into JSX Function Logic. */
function isTrackedJsxMapCallback(
  node: ts.Node
): node is ts.ArrowFunction | ts.FunctionExpression {
  if ((!ts.isArrowFunction(node) && !ts.isFunctionExpression(node))
    || ts.isBlock(node.body)) {
    return false;
  }
  const call = node.parent;
  if (!ts.isCallExpression(call) || !call.arguments.includes(node)) {
    return false;
  }
  const callee = call.expression;
  const mapCall = (ts.isPropertyAccessExpression(callee) && callee.name.text === "map")
    || (ts.isElementAccessExpression(callee)
      && callee.argumentExpression
      && ts.isStringLiteralLike(callee.argumentExpression)
      && callee.argumentExpression.text === "map");
  return mapCall && containsJsxSyntax(node.body);
}

/** Detects JSX beneath one concise callback without entering another callable. */
function containsJsxSyntax(root: ts.Node): boolean {
  const pending = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) continue;
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)
      || ts.isJsxFragment(node)) return true;
    if (node !== root && isNestedCallable(node)) continue;
    const children = getImmediateChildren(node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index]);
    }
  }
  return false;
}

/** Enumerates assignment operators without evaluating expressions. */
function isAssignmentOperator(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

/** Returns immediate children for the explicit traversal stack. */
function getImmediateChildren(node: ts.Node): ts.Node[] {
  const children: ts.Node[] = [];
  ts.forEachChild(node, (child) => {
    children.push(child);
    return undefined;
  });
  return children;
}

/** Converts one AST node to the shared zero-based source contract. */
function toSourceRange(sourceFile: ts.SourceFile, node: ts.Node): SourceRange {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
  return {
    startLine: start.line,
    startCharacter: start.character,
    endLine: end.line,
    endCharacter: end.character
  };
}

/** Stable node identity used only to exclude declaration occurrences. */
function nodeKey(node: ts.Node): string {
  return `${node.pos}:${node.end}`;
}
