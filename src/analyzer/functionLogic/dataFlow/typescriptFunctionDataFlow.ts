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
        if (accesses.length < MAX_VALUE_ACCESSES) {
          accesses.push({
            bindingId: binding.id,
            access,
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
      appendBindingNameCandidates(candidates, node.name, kind, "source", "exact");
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
  confidence: "exact" | "inferred"
): void {
  const pending: ts.BindingName[] = [name];
  while (pending.length > 0 && candidates.length < MAX_BINDING_CANDIDATES) {
    const current = pending.pop();
    if (!current) {
      continue;
    }
    if (ts.isIdentifier(current)) {
      candidates.push({ name: current.text, node: current, kind, definitionPlacement, confidence });
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
    range.startLine,
    range.startCharacter
  ].join("\0");
  return {
    id: `logic-value-binding:${createContentHash(key).slice(0, 32)}`,
    name: candidate.name,
    kind: candidate.kind,
    declarationRange: range,
    definitionPlacement: candidate.definitionPlacement,
    confidence: candidate.confidence
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
