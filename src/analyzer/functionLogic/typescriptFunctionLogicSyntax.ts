/**
 * TypeScript/JavaScript syntax interpretation for function logic. It locates
 * the selected callable, classifies source statements, and converts compiler
 * positions into framework-independent evidence ranges.
 */

import * as ts from "typescript";
import { createContentHash } from "../../shared/hash";
import type { SourceRange, SymbolNode } from "../../shared/types";
import type {
  FunctionLogicAnalysis,
  FunctionLogicBlock,
  FunctionLogicBlockKind,
  FunctionLogicConfidence
} from "./types";
import type {
  FunctionLikeWithBody,
  PendingStatement
} from "./typescriptFunctionLogicInternal";

const DEFAULT_MAX_BLOCKS = 120;
const ALLOWED_MAX_BLOCKS = 300;
const DISPLAY_TEXT_LIMIT = 180;

/** Classifies one visible statement and chooses its most useful evidence range. */
export function classifyStatement(
  sourceFile: ts.SourceFile,
  filePath: string,
  task: PendingStatement
): FunctionLogicBlock {
  const node = task.node;
  let kind: FunctionLogicBlockKind = "operation";
  let confidence: FunctionLogicConfidence = "exact";
  let label = safeText(normalizeSourceText(node.getText(sourceFile)), "Statement");
  let detail = "Executes one source statement.";
  let evidenceNode: ts.Node = node;

  if (ts.isIfStatement(node)) {
    kind = "condition";
    label = `if ${safeText(normalizeSourceText(node.expression.getText(sourceFile)), "condition")}`;
    detail = "Chooses the true or false branch from this condition.";
    evidenceNode = node.expression;
  } else if (isLoopStatement(node)) {
    kind = "loop";
    label = createLoopLabel(sourceFile, node);
    detail = "Repeats the body while the loop condition or iterator continues.";
    evidenceNode = getLoopEvidenceNode(node);
  } else if (ts.isSwitchStatement(node)) {
    kind = "switch";
    label = `switch ${safeText(normalizeSourceText(node.expression.getText(sourceFile)), "value")}`;
    detail = "Dispatches control to a matching case or the default branch.";
    evidenceNode = node.expression;
  } else if (ts.isTryStatement(node)) {
    kind = "try";
    label = "try / catch / finally";
    detail = "Separates normal, exceptional, and cleanup control paths.";
  } else if (ts.isReturnStatement(node)) {
    kind = "return";
    label = node.expression
      ? `return ${safeText(normalizeSourceText(node.expression.getText(sourceFile)), "value")}`
      : "return";
    detail = "Ends this function and returns control to its caller.";
  } else if (ts.isThrowStatement(node)) {
    kind = "throw";
    label = `throw ${safeText(normalizeSourceText(node.expression.getText(sourceFile)), "error")}`;
    detail = "Ends the normal path by raising an exception.";
  } else if (ts.isBreakStatement(node)) {
    kind = "break";
    label = "break";
    detail = "Leaves the nearest loop or switch.";
  } else if (ts.isContinueStatement(node)) {
    kind = "continue";
    label = "continue";
    detail = "Starts the next iteration of the nearest loop.";
  } else {
    const calls = collectCallNames(sourceFile, node);
    if (isMutationStatement(node)) {
      kind = "mutation";
      detail = "Assignment or update mutates a local binding or object property.";
    } else if (calls.length > 0) {
      const effectCall = calls.find(isPotentialEffectCall);
      kind = effectCall ? "effect" : "call";
      confidence = effectCall ? "inferred" : "exact";
      detail = effectCall
        ? `Possible state or external effect suggested by ${effectCall}; verify the callee implementation.`
        : `Calls ${calls.slice(0, 3).join(", ")}${calls.length > 3 ? ` and ${calls.length - 3} more` : ""}.`;
    }
  }

  const range = toSourceRange(sourceFile, evidenceNode);
  return {
    id: createBlockId(filePath, kind, range, label),
    kind,
    label,
    detail,
    depth: task.depth,
    branchLabel: task.branchLabel,
    confidence,
    filePath,
    range
  };
}

/** Locates the graph symbol's AST body by exact name and declaration position. */
export function findSelectedFunction(
  sourceFile: ts.SourceFile,
  graphNode: SymbolNode
): FunctionLikeWithBody | undefined {
  const pending: ts.Node[] = [sourceFile];
  const candidates: Array<{ node: FunctionLikeWithBody; distance: number }> = [];
  const wantedNames = new Set([
    graphNode.name,
    graphNode.qualifiedName.split(".").at(-1) ?? graphNode.name
  ].filter(Boolean));

  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) {
      continue;
    }
    if (isFunctionLikeWithBody(node)) {
      const candidateName = getFunctionName(node, sourceFile);
      if (candidateName && wantedNames.has(candidateName)) {
        const positionNode = node.name ?? node;
        const line = sourceFile.getLineAndCharacterOfPosition(positionNode.getStart(sourceFile)).line;
        candidates.push({ node, distance: Math.abs(line - graphNode.selectionRange.startLine) });
      }
    }
    const children = getImmediateChildren(node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index]);
    }
  }

  candidates.sort((left, right) => left.distance - right.distance);
  return candidates[0]?.node;
}

/** Returns immediate AST children while keeping our traversal stack explicit. */
function getImmediateChildren(node: ts.Node): ts.Node[] {
  const children: ts.Node[] = [];
  ts.forEachChild(node, (child) => {
    children.push(child);
    return undefined;
  });
  return children;
}

/** Collects direct and nested call names but stops at nested function scopes. */
function collectCallNames(sourceFile: ts.SourceFile, root: ts.Node): string[] {
  const names: string[] = [];
  const pending = [root];

  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) {
      continue;
    }
    if (node !== root && isFunctionLikeWithBody(node)) {
      continue;
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      names.push(safeText(normalizeSourceText(node.expression.getText(sourceFile)), "call"));
    }
    const children = getImmediateChildren(node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index]);
    }
  }
  return [...new Set(names)];
}

/** Returns whether syntax proves an assignment or increment/decrement. */
function isMutationStatement(node: ts.Statement): boolean {
  if (!ts.isExpressionStatement(node)) {
    return false;
  }
  const expression = node.expression;
  if (ts.isPrefixUnaryExpression(expression) || ts.isPostfixUnaryExpression(expression)) {
    return expression.operator === ts.SyntaxKind.PlusPlusToken
      || expression.operator === ts.SyntaxKind.MinusMinusToken;
  }
  return ts.isBinaryExpression(expression) && isAssignmentOperator(expression.operatorToken.kind);
}

/** Enumerates assignment operators without interpreting the assigned value. */
function isAssignmentOperator(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

/** Conservative name-only effect hint; it never upgrades to exact evidence. */
function isPotentialEffectCall(name: string): boolean {
  return /(?:^|\.)(?:save|create|insert|update|delete|remove|write|send|publish|emit|dispatch|commit|query|execute|request|fetch|post|put|patch)$/iu.test(name);
}

/** Creates a compact loop header from the syntax kind. */
function createLoopLabel(sourceFile: ts.SourceFile, node: LoopStatement): string {
  if (ts.isWhileStatement(node) || ts.isDoStatement(node)) {
    return `${ts.isDoStatement(node) ? "do while" : "while"} ${safeText(normalizeSourceText(node.expression.getText(sourceFile)), "condition")}`;
  }
  if (ts.isForInStatement(node) || ts.isForOfStatement(node)) {
    return `${ts.isForOfStatement(node) ? "for of" : "for in"} ${safeText(normalizeSourceText(node.expression.getText(sourceFile)), "iterable")}`;
  }
  const condition = node.condition?.getText(sourceFile) ?? "condition";
  return `for ${safeText(normalizeSourceText(condition), "condition")}`;
}

/** Loop statements with one structurally repeatable body. */
export type LoopStatement =
  | ts.ForStatement
  | ts.ForInStatement
  | ts.ForOfStatement
  | ts.WhileStatement
  | ts.DoStatement;

/** Narrows statements that own a repeatable body. */
export function isLoopStatement(node: ts.Node): node is LoopStatement {
  return ts.isForStatement(node)
    || ts.isForInStatement(node)
    || ts.isForOfStatement(node)
    || ts.isWhileStatement(node)
    || ts.isDoStatement(node);
}

/** Chooses the expression that proves a loop decision. */
function getLoopEvidenceNode(node: LoopStatement): ts.Node {
  if (ts.isForStatement(node)) {
    return node.condition ?? node;
  }
  return node.expression;
}

/** Narrows supported callable declarations with executable bodies. */
function isFunctionLikeWithBody(node: ts.Node): node is FunctionLikeWithBody {
  return (
    ts.isFunctionDeclaration(node)
    || ts.isFunctionExpression(node)
    || ts.isMethodDeclaration(node)
    || ts.isConstructorDeclaration(node)
    || ts.isGetAccessorDeclaration(node)
    || ts.isSetAccessorDeclaration(node)
    || ts.isArrowFunction(node)
  ) && node.body !== undefined;
}

/** Reads a declaration name, including variable-bound arrow functions. */
function getFunctionName(node: FunctionLikeWithBody, sourceFile: ts.SourceFile): string | undefined {
  if (ts.isConstructorDeclaration(node)) {
    return "constructor";
  }
  if (node.name) {
    return safeText(normalizeSourceText(node.name.getText(sourceFile)), "");
  }
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) || ts.isPropertyDeclaration(parent) || ts.isPropertyAssignment(parent)) {
    return safeText(normalizeSourceText(parent.name.getText(sourceFile)), "");
  }
  if (ts.isBinaryExpression(parent)) {
    return safeText(normalizeSourceText(parent.left.getText(sourceFile)), "").split(".").at(-1);
  }
  return undefined;
}

/** Creates the header shown above the internal control-flow blocks. */
export function createFunctionSignature(sourceFile: ts.SourceFile, node: FunctionLikeWithBody): string {
  const start = node.getStart(sourceFile);
  const bodyStart = node.body.getStart(sourceFile);
  return safeText(normalizeSourceText(sourceFile.text.slice(start, bodyStart)), "Function body");
}

/** Converts compiler offsets into VS Code-compatible zero-based ranges. */
export function toSourceRange(sourceFile: ts.SourceFile, node: ts.Node): SourceRange {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
  return {
    startLine: start.line,
    startCharacter: start.character,
    endLine: end.line,
    endCharacter: end.character
  };
}

/** Hashes host identities so domain block IDs remain deterministic but local. */
export function createBlockId(
  filePath: string,
  kind: FunctionLogicBlockKind,
  range: SourceRange,
  label: string
): string {
  return `logic-block:${createContentHash([
    filePath,
    kind,
    range.startLine,
    range.startCharacter,
    range.endLine,
    range.endCharacter,
    label
  ].join("\0")).slice(0, 32)}`;
}

/** Maps source extension and analyzer language into the supported parser. */
export function getSupportedLanguage(node: SymbolNode): FunctionLogicAnalysis["language"] {
  const extension = node.filePath.toLowerCase().split(".").at(-1);
  if (node.language === "typescript" || extension === "ts" || extension === "tsx") {
    return "typescript";
  }
  if (
    node.language === "javascript"
    || extension === "js"
    || extension === "jsx"
    || extension === "mjs"
    || extension === "cjs"
  ) {
    return "javascript";
  }
  return "unsupported";
}

/** Selects JSX-aware parser modes from the source filename. */
export function getScriptKind(filePath: string): ts.ScriptKind {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (lower.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

/** Applies the public block budget with a safe hard ceiling. */
export function normalizeMaxBlocks(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value)
    ? DEFAULT_MAX_BLOCKS
    : Math.min(ALLOWED_MAX_BLOCKS, Math.max(1, Math.floor(value)));
}

/** Collapses source whitespace so cards stay scannable in a narrow sidebar. */
function normalizeSourceText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

/** Bounds analyzer-owned labels before they reach downstream projections. */
export function safeText(value: string, fallback: string): string {
  const normalized = value.trim() || fallback;
  return normalized.length <= DISPLAY_TEXT_LIMIT
    ? normalized
    : `${normalized.slice(0, DISPLAY_TEXT_LIMIT - 1)}…`;
}
