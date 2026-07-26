/**
 * Direct-eval lexical bridge. It maps unshadowed free identifiers in the root
 * parsed eval program to already-known host bindings; nested callable bodies
 * remain definition-only and are intentionally excluded from immediate flow.
 */

import * as ts from "typescript";
import type { FunctionLogicBlock, FunctionLogicValueAccess } from "../types";
import type { FunctionLikeWithBody } from "../typescriptFunctionLogicInternal";
import { getImmediateChildren, toSourceRange } from "../typescriptFunctionLogicSyntax";
import type { TypeScriptEmbeddedHostBinding } from "./types";

/** Result preserves explicit invalid-constant writes instead of inventing a value. */
export type TypeScriptEmbeddedLexicalBridgeResult = {
  blocks: FunctionLogicBlock[];
  hostBindingIds: string[];
  invalidConstantWriteCount: number;
};

/** Adds host binding accesses to the most specific virtual embedded CFG block. */
export function bridgeTypeScriptEmbeddedHostLexicals(input: {
  sourceFile: ts.SourceFile;
  rootFunction: FunctionLikeWithBody;
  blocks: readonly FunctionLogicBlock[];
  hostBindings: readonly TypeScriptEmbeddedHostBinding[];
}): TypeScriptEmbeddedLexicalBridgeResult {
  const hostBindingsByName = new Map(input.hostBindings.map((binding) => [binding.name, binding]));
  const localNames = collectRootDeclaredNames(input.rootFunction);
  const accessesByBlockId = new Map<string, FunctionLogicValueAccess[]>();
  const retainedBindingIds = new Set<string>();
  const pending: ts.Node[] = [input.rootFunction.body];
  let invalidConstantWriteCount = 0;

  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) continue;
    if (node !== input.rootFunction.body && isNestedCallable(node)) continue;
    if (ts.isIdentifier(node) && !isDeclarationIdentifier(node) && isValueIdentifier(node)) {
      const binding = hostBindingsByName.get(node.text);
      if (binding && !localNames.has(node.text)) {
        const access = classifyAccess(node);
        if (binding.kind === "constant" && access !== "read") {
          invalidConstantWriteCount += 1;
        } else {
          const blockId = findContainingBlockId(input.blocks, toSourceRange(input.sourceFile, node));
          if (blockId) {
            const values = accessesByBlockId.get(blockId) ?? [];
            const value: FunctionLogicValueAccess = {
              bindingId: binding.id,
              name: binding.name,
              bindingKind: binding.kind,
              access,
              ...(classifyUsage(node, access) ? { usage: classifyUsage(node, access) } : {}),
              confidence: binding.confidence,
              ...(binding.valueRole ? { valueRole: binding.valueRole } : {})
            };
            if (!values.some((candidate) => accessKey(candidate) === accessKey(value))) {
              values.push(value);
              accessesByBlockId.set(blockId, values);
            }
            retainedBindingIds.add(binding.id);
          }
        }
      }
    }
    const children = getImmediateChildren(node);
    for (let index = children.length - 1; index >= 0; index -= 1) pending.push(children[index]);
  }

  return {
    blocks: input.blocks.map((block) => {
      const incoming = accessesByBlockId.get(block.id);
      return incoming && incoming.length > 0
        ? { ...block, valueAccesses: mergeAccesses(block.valueAccesses, incoming) }
        : block;
    }),
    hostBindingIds: [...retainedBindingIds].sort(),
    invalidConstantWriteCount
  };
}

/** Collects any root-program declaration, conservatively preventing host aliasing. */
function collectRootDeclaredNames(rootFunction: FunctionLikeWithBody): Set<string> {
  const names = new Set<string>();
  const pending: ts.Node[] = [rootFunction.body];
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) continue;
    if (node !== rootFunction.body && isNestedCallable(node)) continue;
    if (ts.isVariableDeclaration(node)) appendBindingNames(names, node.name);
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) names.add(node.name.text);
    const children = getImmediateChildren(node);
    for (let index = children.length - 1; index >= 0; index -= 1) pending.push(children[index]);
  }
  return names;
}

/** Flattens destructuring bindings with a queue rather than recursive descent. */
function appendBindingNames(names: Set<string>, name: ts.BindingName): void {
  const pending: ts.BindingName[] = [name];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    if (ts.isIdentifier(current)) {
      names.add(current.text);
      continue;
    }
    for (let index = current.elements.length - 1; index >= 0; index -= 1) {
      const element = current.elements[index];
      if (ts.isBindingElement(element)) pending.push(element.name);
    }
  }
}

/** Finds the deepest narrow virtual block containing one parsed identifier. */
function findContainingBlockId(blocks: readonly FunctionLogicBlock[], range: ReturnType<typeof toSourceRange>): string | undefined {
  let selected: FunctionLogicBlock | undefined;
  for (const block of blocks) {
    if (block.kind === "entry" || block.kind === "exit" || block.kind === "embedded") continue;
    if (!containsRange(block.range, range)) continue;
    if (!selected || span(block.range) < span(selected.range)
      || (span(block.range) === span(selected.range) && block.depth > selected.depth)) {
      selected = block;
    }
  }
  return selected?.id;
}

/** Excludes grammar names that are not lexical value reads. */
function isValueIdentifier(node: ts.Identifier): boolean {
  const parent = node.parent;
  return !(!parent
    || (ts.isPropertyAccessExpression(parent) && parent.name === node)
    || ts.isQualifiedName(parent)
    || (ts.isPropertyAssignment(parent) && parent.name === node)
    || (ts.isMethodDeclaration(parent) && parent.name === node)
    || (ts.isPropertyDeclaration(parent) && parent.name === node)
    || (ts.isLabeledStatement(parent) || ts.isBreakStatement(parent) || ts.isContinueStatement(parent)));
}

/** Identifiers contained by binding grammar never represent a read/write access. */
function isDeclarationIdentifier(node: ts.Identifier): boolean {
  let current: ts.Node = node;
  while (current.parent) {
    const parent = current.parent;
    if (ts.isVariableDeclaration(parent) || ts.isParameter(parent)
      || ts.isFunctionDeclaration(parent) || ts.isClassDeclaration(parent)) return true;
    if (!ts.isBindingElement(parent) && !ts.isArrayBindingPattern(parent)
      && !ts.isObjectBindingPattern(parent)) return false;
    current = parent;
  }
  return false;
}

/** Classifies direct assignments and updates without evaluating an expression. */
function classifyAccess(node: ts.Identifier): FunctionLogicValueAccess["access"] {
  const parent = node.parent;
  if ((ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent))
    && parent.operand === node
    && (parent.operator === ts.SyntaxKind.PlusPlusToken || parent.operator === ts.SyntaxKind.MinusMinusToken)) {
    return "readwrite";
  }
  if (ts.isBinaryExpression(parent) && parent.left === node
    && parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
    && parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
    return parent.operatorToken.kind === ts.SyntaxKind.EqualsToken ? "write" : "readwrite";
  }
  return "read";
}

/** Marks explicit external delivery as a sink and ordinary computation as consume. */
function classifyUsage(node: ts.Identifier, access: FunctionLogicValueAccess["access"]): "consume" | "sink" | undefined {
  if (access === "write") return undefined;
  let current: ts.Node = node;
  while (current.parent) {
    const parent = current.parent;
    if (ts.isReturnStatement(parent) || ts.isThrowStatement(parent) || ts.isYieldExpression(parent)) return "sink";
    if (ts.isCallExpression(parent) || ts.isNewExpression(parent)) {
      return parent.arguments?.includes(current as ts.Expression) ? "sink" : "consume";
    }
    if (ts.isStatement(parent) || isNestedCallable(parent)) break;
    current = parent;
  }
  return "consume";
}

/** Merges bridge accesses with facts already projected by the embedded planner. */
function mergeAccesses(existing: readonly FunctionLogicValueAccess[] | undefined, incoming: readonly FunctionLogicValueAccess[]): FunctionLogicValueAccess[] {
  const values = [...(existing ?? [])];
  const seen = new Set(values.map(accessKey));
  for (const value of incoming) {
    if (seen.has(accessKey(value))) continue;
    seen.add(accessKey(value));
    values.push(value);
  }
  return values;
}

function accessKey(access: FunctionLogicValueAccess): string {
  return [access.bindingId, access.access, access.usage ?? "", access.confidence].join("\0");
}

function isNestedCallable(node: ts.Node): boolean {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)
    || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node)
    || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node);
}

function containsRange(container: ReturnType<typeof toSourceRange>, candidate: ReturnType<typeof toSourceRange>): boolean {
  return compare(container.startLine, container.startCharacter, candidate.startLine, candidate.startCharacter) <= 0
    && compare(container.endLine, container.endCharacter, candidate.endLine, candidate.endCharacter) >= 0;
}

function span(range: ReturnType<typeof toSourceRange>): number {
  return Math.max(0, (range.endLine - range.startLine) * 1_000_000 + range.endCharacter - range.startCharacter);
}

function compare(leftLine: number, leftCharacter: number, rightLine: number, rightCharacter: number): number {
  return leftLine - rightLine || leftCharacter - rightCharacter;
}
