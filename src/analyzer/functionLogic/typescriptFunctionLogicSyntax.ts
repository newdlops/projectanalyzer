/**
 * TypeScript/JavaScript syntax interpretation for function logic. It locates
 * the selected callable, classifies source statements, and converts compiler
 * positions into framework-independent evidence ranges.
 */

import * as ts from "typescript";
import { createContentHash } from "../../shared/hash";
import type { SourceRange, SymbolNode } from "../../shared/types";
import {
  findTypeScriptLikeJsxMapCallback,
  findTypeScriptLikeWrappedComponentBinding,
  readTypeScriptLikeJsxComponentReference
} from "../languages/typescriptLike/typescriptLikeJsxSyntax";
import {
  collectTypeScriptEventBindings,
  createTypeScriptEventBindingDetail,
  createTypeScriptEventBindingLabel,
  readTypeScriptEventBinding
} from "./events";
import type {
  FunctionLogicAnalysis,
  FunctionLogicBlock,
  FunctionLogicBlockKind,
  FunctionLogicCallsite,
  FunctionLogicConfidence
} from "./types";
import type {
  FunctionLikeWithBody,
  PendingStatement
} from "./typescriptFunctionLogicInternal";
import { collectTypeScriptValueChanges } from "./valueChanges";

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
  let label = completeSourceText(node.getText(sourceFile), "Statement");
  let detail = "Executes one source statement.";
  let evidenceNode: ts.Node = node;
  const valueChanges = collectTypeScriptValueChanges(sourceFile, node);

  if (ts.isIfStatement(node)) {
    kind = "condition";
    label = `if ${completeSourceText(node.expression.getText(sourceFile), "condition")}`;
    detail = "Chooses the true or false branch from this condition.";
    evidenceNode = node.expression;
  } else if (isLoopStatement(node)) {
    kind = "loop";
    label = createLoopLabel(sourceFile, node);
    detail = "Repeats the body while the loop condition or iterator continues.";
    evidenceNode = getLoopEvidenceNode(node);
  } else if (ts.isSwitchStatement(node)) {
    kind = "switch";
    label = `switch ${completeSourceText(node.expression.getText(sourceFile), "value")}`;
    detail = "Dispatches control to a matching case or the default branch.";
    evidenceNode = node.expression;
  } else if (ts.isTryStatement(node)) {
    kind = "try";
    label = "try / catch / finally";
    detail = "Separates normal, exceptional, and cleanup control paths.";
  } else if (ts.isReturnStatement(node)) {
    kind = "return";
    label = node.expression
      ? `return ${completeSourceText(node.expression.getText(sourceFile), "value")}`
      : "return";
    detail = "Ends this function and returns control to its caller.";
  } else if (ts.isThrowStatement(node)) {
    kind = "throw";
    label = `throw ${completeSourceText(node.expression.getText(sourceFile), "error")}`;
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
    const eventBindings = collectTypeScriptEventBindings(sourceFile, node);
    const calls = collectCallNames(sourceFile, node);
    const firstEventBinding = eventBindings[0];
    if (firstEventBinding) {
      kind = "event";
      label = createTypeScriptEventBindingLabel(firstEventBinding)
        + (eventBindings.length > 1 ? ` + ${eventBindings.length - 1} more` : "");
      detail = createTypeScriptEventBindingDetail(firstEventBinding)
        + (eventBindings.length > 1
          ? ` This statement contains ${eventBindings.length} event registrations.`
          : "");
      confidence = eventBindings.every((binding) => binding.confidence === "exact")
        ? "exact"
        : "inferred";
      evidenceNode = firstEventBinding.node;
    } else if (valueChanges.length > 0) {
      kind = "mutation";
      confidence = valueChanges.some((change) => change.confidence === "exact")
        ? "exact"
        : "inferred";
      detail = confidence === "exact"
        ? "Shows which variable or property receives a new source-level value."
        : "A known in-place method suggests that its receiver may change; verify the callee semantics.";
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
    valueChanges: valueChanges.length > 0 ? valueChanges : undefined,
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
  const candidates: Array<{
    node: FunctionLikeWithBody;
    distance: number;
    exactPosition: boolean;
  }> = [];
  const wantedNames = new Set([
    graphNode.name,
    graphNode.qualifiedName.split(".").at(-1) ?? graphNode.name
  ].filter(Boolean));
  const allowPositionFallback = graphNode.metadata?.cursorResolved === true;

  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) {
      continue;
    }
    if (isFunctionLikeWithBody(node)) {
      const candidateName = getFunctionName(node, sourceFile);
      const positionNode = getFunctionSelectionNode(node);
      const position = sourceFile.getLineAndCharacterOfPosition(positionNode.getStart(sourceFile));
      const exactPosition = position.line === graphNode.selectionRange.startLine
        && position.character === graphNode.selectionRange.startCharacter;
      const nameMatches = Boolean(candidateName && wantedNames.has(candidateName));
      if (nameMatches || (allowPositionFallback && exactPosition)) {
        const lineDistance = Math.abs(position.line - graphNode.selectionRange.startLine);
        const characterDistance = Math.abs(
          position.character - graphNode.selectionRange.startCharacter
        );
        candidates.push({
          node,
          distance: (lineDistance * 10_000) + characterDistance,
          exactPosition
        });
      }
    }
    const children = getImmediateChildren(node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index]);
    }
  }

  candidates.sort((left, right) =>
    Number(right.exactPosition) - Number(left.exactPosition)
    || left.distance - right.distance
  );
  return candidates[0]?.node;
}

/** Returns immediate AST children while keeping our traversal stack explicit. */
export function getImmediateChildren(node: ts.Node): ts.Node[] {
  const children: ts.Node[] = [];
  ts.forEachChild(node, (child) => {
    children.push(child);
    return undefined;
  });
  return children;
}

/**
 * Collects stable calls, JSX renders, and named event handlers in this
 * callable. Concise JSX `.map` callbacks are the sole inferred nested
 * boundary admitted here.
 */
export function collectFunctionCallsites(
  sourceFile: ts.SourceFile,
  filePath: string,
  functionNode: FunctionLikeWithBody
): FunctionLogicCallsite[] {
  const callsites: FunctionLogicCallsite[] = [];
  const seen = new Set<string>();
  const root = functionNode.body;
  const pending: Array<{
    node: ts.Node;
    confidence: FunctionLogicConfidence;
  }> = [{ node: root, confidence: "exact" }];

  while (pending.length > 0) {
    const task = pending.pop();
    if (!task) {
      continue;
    }
    const node = task.node;
    if (node !== root && isFunctionLikeWithBody(node)) {
      continue;
    }
    const eventBinding = readTypeScriptEventBinding(sourceFile, node);
    if (eventBinding?.handler) {
      appendFunctionCallsite(
        callsites,
        seen,
        filePath,
        toSourceRange(sourceFile, eventBinding.node),
        eventBinding.handler.name,
        eventBinding.handler.text,
        "event",
        eventBinding.confidence === "inferred" ? "inferred" : task.confidence,
        eventBinding.registrationName
      );
    }
    if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && !eventBinding) {
      const callee = readStableCallee(sourceFile, node.expression);
      if (callee) {
        appendFunctionCallsite(
          callsites,
          seen,
          filePath,
          toSourceRange(sourceFile, node),
          callee.name,
          callee.text,
          "call",
          task.confidence
        );
      }
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const component = readTypeScriptLikeJsxComponentReference(sourceFile, node);
      if (component) {
        appendFunctionCallsite(
          callsites,
          seen,
          filePath,
          toSourceRange(sourceFile, component.node),
          component.name,
          component.text,
          "render",
          task.confidence
        );
      }
    }
    const mapCallback = ts.isCallExpression(node)
      ? findTypeScriptLikeJsxMapCallback(node)
      : undefined;
    const children = getImmediateChildren(node).filter((child) =>
      child !== mapCallback
      && !shouldSkipEventHandlerChild(node, child, eventBinding)
    );
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push({ node: children[index], confidence: task.confidence });
    }
    if (mapCallback) {
      pending.push({ node: mapCallback.body, confidence: "inferred" });
    }
  }

  return callsites.sort((left, right) =>
    left.range.startLine - right.range.startLine
    || left.range.startCharacter - right.range.startCharacter
    || left.range.endLine - right.range.endLine
    || left.range.endCharacter - right.range.endCharacter
    || left.calleeText.localeCompare(right.calleeText)
  );
}

/** Adds one source relation without duplicating a previously seen syntax node. */
function appendFunctionCallsite(
  callsites: FunctionLogicCallsite[],
  seen: Set<string>,
  filePath: string,
  range: SourceRange,
  calleeName: string,
  calleeText: string,
  relation: "call" | "render" | "event",
  confidence: FunctionLogicConfidence,
  eventRegistrationName?: string
): void {
  const key = `${filePath}\0${range.startLine}\0${range.startCharacter}`
    + `\0${range.endLine}\0${range.endCharacter}\0${calleeName}\0${relation}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  callsites.push({
    filePath,
    range,
    calleeName,
    calleeText,
    relation,
    ...(eventRegistrationName ? { eventRegistrationName } : {}),
    ...(confidence === "inferred" ? { confidence } : {})
  });
}

/** Keeps separately dispatched handler bodies and `.bind` wrappers off the caller walk. */
function shouldSkipEventHandlerChild(
  node: ts.Node,
  child: ts.Node,
  binding: ReturnType<typeof readTypeScriptEventBinding>
): boolean {
  if (!binding || binding.handlerKind === "factory") {
    return false;
  }
  if (ts.isJsxAttribute(node)) {
    return true;
  }
  return child === binding.handlerNode;
}

/** Reads only identifier, property, or literal-element callees suitable for matching. */
function readStableCallee(
  sourceFile: ts.SourceFile,
  expression: ts.LeftHandSideExpression
): { name: string; text: string } | undefined {
  let current: ts.Expression = expression;
  while (ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }
  if (ts.isIdentifier(current)) {
    return { name: current.text, text: current.text };
  }
  if (ts.isPropertyAccessExpression(current)) {
    return {
      name: current.name.text,
      text: safeText(normalizeSourceText(current.getText(sourceFile)), current.name.text)
    };
  }
  if (ts.isElementAccessExpression(current)) {
    const argument = current.argumentExpression;
    if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) {
      return {
        name: argument.text,
        text: safeText(normalizeSourceText(current.getText(sourceFile)), argument.text)
      };
    }
  }
  return undefined;
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

/** Conservative name-only effect hint; it never upgrades to exact evidence. */
function isPotentialEffectCall(name: string): boolean {
  return /(?:^|\.)(?:save|create|insert|update|delete|remove|write|send|publish|emit|dispatch|commit|query|execute|request|fetch|post|put|patch)$/iu.test(name);
}

/** Creates a complete, whitespace-normalized loop header from the syntax kind. */
function createLoopLabel(sourceFile: ts.SourceFile, node: LoopStatement): string {
  if (ts.isWhileStatement(node) || ts.isDoStatement(node)) {
    return `${ts.isDoStatement(node) ? "do while" : "while"} ${completeSourceText(node.expression.getText(sourceFile), "condition")}`;
  }
  if (ts.isForInStatement(node) || ts.isForOfStatement(node)) {
    return `${ts.isForOfStatement(node) ? "for of" : "for in"} ${completeSourceText(node.expression.getText(sourceFile), "iterable")}`;
  }
  const condition = node.condition?.getText(sourceFile) ?? "condition";
  return `for ${completeSourceText(condition, "condition")}`;
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
export function isFunctionLikeWithBody(node: ts.Node): node is FunctionLikeWithBody {
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
export function getFunctionName(
  node: FunctionLikeWithBody,
  sourceFile: ts.SourceFile
): string | undefined {
  if (ts.isConstructorDeclaration(node)) {
    return "constructor";
  }
  const wrappedBinding = getWrappedComponentBinding(node);
  if (wrappedBinding) {
    return safeText(normalizeSourceText(wrappedBinding.name.getText(sourceFile)), "");
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

/** Selects the identifier or syntax start that represents this callable. */
export function getFunctionSelectionNode(node: FunctionLikeWithBody): ts.Node {
  const wrappedBinding = getWrappedComponentBinding(node);
  if (wrappedBinding) {
    return wrappedBinding.name;
  }
  if (node.name) {
    return node.name;
  }
  const parent = node.parent;
  if (
    ts.isVariableDeclaration(parent)
    || ts.isPropertyDeclaration(parent)
    || ts.isPropertyAssignment(parent)
  ) {
    return parent.name;
  }
  if (ts.isBinaryExpression(parent) && parent.right === node) {
    return parent.left;
  }
  return node;
}

/** Includes a function-valued binding so its name area counts as inside. */
export function getFunctionDeclarationNode(node: FunctionLikeWithBody): ts.Node {
  const wrappedBinding = getWrappedComponentBinding(node);
  if (wrappedBinding) {
    return wrappedBinding;
  }
  const parent = node.parent;
  if (
    (ts.isVariableDeclaration(parent) || ts.isPropertyDeclaration(parent))
    && parent.initializer === node
  ) {
    return parent;
  }
  if (ts.isPropertyAssignment(parent) && parent.initializer === node) {
    return parent;
  }
  if (ts.isBinaryExpression(parent) && parent.right === node) {
    return parent;
  }
  return node;
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
  const language = node.language.toLowerCase();
  if (
    language === "typescript"
    || language === "typescriptreact"
    || extension === "ts"
    || extension === "tsx"
  ) {
    return "typescript";
  }
  if (
    language === "javascript"
    || language === "javascriptreact"
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
export function getScriptKind(filePath: string, languageId?: string): ts.ScriptKind {
  const language = languageId?.toLowerCase();
  if (language === "typescriptreact") return ts.ScriptKind.TSX;
  if (language === "javascriptreact") return ts.ScriptKind.JSX;
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (lower.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

/** Reads a wrapper-owned binding only for callable expression node kinds. */
function getWrappedComponentBinding(
  node: FunctionLikeWithBody
): ts.VariableDeclaration | undefined {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node)
    ? findTypeScriptLikeWrappedComponentBinding(node)
    : undefined;
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

/** Preserves complete graph-box source text and its physical line structure. */
export function completeSourceText(value: string, fallback: string): string {
  return value.replace(/\r\n?/gu, "\n").trim() || fallback;
}

/** Bounds analyzer-owned text that is not rendered as graph-box source. */
export function safeText(value: string, fallback: string): string {
  const normalized = value.trim() || fallback;
  return normalized.length <= DISPLAY_TEXT_LIMIT
    ? normalized
    : `${normalized.slice(0, DISPLAY_TEXT_LIMIT - 1)}…`;
}
