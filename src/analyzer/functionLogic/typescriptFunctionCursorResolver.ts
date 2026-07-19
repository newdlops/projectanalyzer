/**
 * Host-independent TypeScript/JavaScript cursor resolver. It iteratively walks
 * the current source AST and returns the innermost callable containing a cursor.
 */

import * as ts from "typescript";
import type {
  FunctionCursorTarget,
  FunctionCursorTargetInput
} from "./types";
import type { FunctionLikeWithBody } from "./typescriptFunctionLogicInternal";
import {
  getFunctionDeclarationNode,
  getFunctionName,
  getFunctionSelectionNode,
  getImmediateChildren,
  getScriptKind,
  isFunctionLikeWithBody,
  toSourceRange
} from "./typescriptFunctionLogicSyntax";

/** AST work item retaining callable depth without recursive traversal. */
type CursorTraversalEntry = {
  node: ts.Node;
  callableDepth: number;
};

/** Candidate score used to prefer the smallest, most deeply nested callable. */
type CursorCandidate = {
  target: FunctionCursorTarget;
  callableDepth: number;
  spanLength: number;
};

const SUPPORTED_LANGUAGE_IDS = new Set([
  "typescript",
  "typescriptreact",
  "javascript",
  "javascriptreact"
]);

/** Finds the innermost supported callable whose declaration contains the cursor. */
export function findFunctionAtPosition(
  input: FunctionCursorTargetInput
): FunctionCursorTarget | undefined {
  if (!SUPPORTED_LANGUAGE_IDS.has(input.languageId)) {
    return undefined;
  }

  const sourceFile = ts.createSourceFile(
    input.filePath,
    input.sourceText,
    ts.ScriptTarget.Latest,
    true,
    getCursorScriptKind(input.filePath, input.languageId)
  );
  const cursorOffset = sourceFile.getPositionOfLineAndCharacter(
    input.position.line,
    input.position.character
  );
  const pending: CursorTraversalEntry[] = [{ node: sourceFile, callableDepth: 0 }];
  const candidates: CursorCandidate[] = [];

  while (pending.length > 0) {
    const entry = pending.pop();
    if (!entry) {
      continue;
    }

    let childCallableDepth = entry.callableDepth;
    if (isFunctionLikeWithBody(entry.node)) {
      const declarationNode = getFunctionDeclarationNode(entry.node);
      const start = declarationNode.getStart(sourceFile);
      const end = declarationNode.getEnd();
      if (start <= cursorOffset && cursorOffset <= end) {
        candidates.push({
          target: createCursorTarget(sourceFile, entry.node, input),
          callableDepth: entry.callableDepth,
          spanLength: end - start
        });
      }
      childCallableDepth += 1;
    }

    const children = getImmediateChildren(entry.node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push({ node: children[index], callableDepth: childCallableDepth });
    }
  }

  candidates.sort((left, right) =>
    right.callableDepth - left.callableDepth
    || left.spanLength - right.spanLength
    || left.target.range.startLine - right.target.range.startLine
    || left.target.range.startCharacter - right.target.range.startCharacter
  );
  return candidates[0]?.target;
}

/** Converts a compiler callable into the stable, framework-independent target. */
function createCursorTarget(
  sourceFile: ts.SourceFile,
  node: FunctionLikeWithBody,
  input: FunctionCursorTargetInput
): FunctionCursorTarget {
  const explicitName = getFunctionName(node, sourceFile);
  const anonymous = explicitName === undefined;
  const selectionNode = getFunctionSelectionNode(node);
  const selectionRange = toSourceRange(sourceFile, selectionNode);
  const name = explicitName ?? "anonymous function";

  return {
    kind: getCallableKind(node),
    name,
    qualifiedName: createQualifiedName(sourceFile, node, name, anonymous, selectionRange),
    filePath: input.filePath,
    language: input.languageId,
    range: toSourceRange(sourceFile, getFunctionDeclarationNode(node)),
    selectionRange,
    anonymous
  };
}

/** Preserves method and constructor roles while treating callbacks as functions. */
function getCallableKind(
  node: FunctionLikeWithBody
): FunctionCursorTarget["kind"] {
  if (ts.isConstructorDeclaration(node)) {
    return "constructor";
  }
  if (
    ts.isMethodDeclaration(node)
    || ts.isGetAccessorDeclaration(node)
    || ts.isSetAccessorDeclaration(node)
  ) {
    return "method";
  }
  return "function";
}

/** Builds a readable lexical label for duplicate methods and nested callbacks. */
function createQualifiedName(
  sourceFile: ts.SourceFile,
  node: FunctionLikeWithBody,
  name: string,
  anonymous: boolean,
  selectionRange: FunctionCursorTarget["selectionRange"]
): string {
  const ownerNames: string[] = [];
  let current: ts.Node | undefined = node.parent;

  while (current) {
    const ownerName = getOwnerName(sourceFile, current);
    if (ownerName) {
      ownerNames.push(ownerName);
    }
    current = current.parent;
  }

  ownerNames.reverse();
  const ownSegment = anonymous
    ? `<anonymous@${selectionRange.startLine + 1}:${selectionRange.startCharacter + 1}>`
    : name;
  return [...ownerNames, ownSegment].join(".");
}

/** Reads lexical owners that materially distinguish one callable from another. */
function getOwnerName(sourceFile: ts.SourceFile, node: ts.Node): string | undefined {
  if (isFunctionLikeWithBody(node)) {
    return getFunctionName(node, sourceFile);
  }
  if (
    (ts.isClassDeclaration(node) || ts.isClassExpression(node) || ts.isModuleDeclaration(node))
    && node.name
  ) {
    return node.name.getText(sourceFile);
  }
  return undefined;
}

/** Uses language mode when virtual or extensionless documents still contain JSX. */
function getCursorScriptKind(filePath: string, languageId: string): ts.ScriptKind {
  if (languageId === "typescriptreact") {
    return ts.ScriptKind.TSX;
  }
  if (languageId === "javascriptreact") {
    return ts.ScriptKind.JSX;
  }
  return getScriptKind(filePath);
}
