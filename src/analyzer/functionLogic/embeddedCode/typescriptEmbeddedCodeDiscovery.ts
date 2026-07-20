/**
 * Static embedded-code discovery for TypeScript and JavaScript. It recognizes
 * parser-known code consumers and strongly code-shaped stored literals while
 * rejecting interpolation, identifiers, and other runtime string assembly.
 */

import * as ts from "typescript";
import type { FunctionLogicConfidence } from "../types";
import {
  getImmediateChildren,
  isFunctionLikeWithBody,
  toSourceRange
} from "../typescriptFunctionLogicSyntax";
import type {
  TypeScriptEmbeddedCodeDiscovery,
  TypeScriptEmbeddedCodeMode,
  TypeScriptEmbeddedCodeRequest
} from "./types";

/** Hard bounds prevent generated strings from turning discovery into a parser sink. */
export const MAX_EMBEDDED_CODE_CHARACTERS = 24_000;
export const MAX_EMBEDDED_CODE_PIECES = 64;

const CODE_NAME_PATTERN = /(?:^|[_$.-])(?:code|script|source|program|expression|handler)(?:$|[_$.-])/iu;
const CODE_TAG_NAMES = new Set(["code", "js", "javascript", "ts", "typescript"]);
const TIMER_NAMES = new Set(["setTimeout", "setInterval"]);
const VM_IMMEDIATE_NAMES = new Set([
  "runInContext",
  "runInNewContext",
  "runInThisContext"
]);

type StaticText = {
  text: string;
  evidenceNode: ts.Expression;
  exactCodeTag: boolean;
};

type DirectValueTarget = {
  expression: ts.Expression;
  nameHint?: string;
};

/** Finds bounded embedded programs owned by one visible host statement/expression. */
export function discoverTypeScriptEmbeddedCode(input: {
  sourceFile: ts.SourceFile;
  scriptKind: ts.ScriptKind;
  anchorBlockId: string;
  root: ts.Node;
}): TypeScriptEmbeddedCodeDiscovery {
  const requests: TypeScriptEmbeddedCodeRequest[] = [];
  const consumedTextRanges = new Set<string>();
  const pending: ts.Node[] = [input.root];
  let dynamicConsumerCount = 0;

  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) continue;
    if (node !== input.root && isFunctionLikeWithBody(node)) continue;

    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const candidate = readKnownCodeConsumer(input.sourceFile, node);
      if (candidate.kind === "static") {
        requests.push(createRequest(
          input.sourceFile,
          input.anchorBlockId,
          candidate.text,
          candidate.consumer,
          candidate.mode,
          "exact",
          candidate.parameterSource
        ));
        consumedTextRanges.add(nodeRangeKey(candidate.text.evidenceNode, input.sourceFile));
      } else if (candidate.kind === "dynamic") {
        dynamicConsumerCount += 1;
      }
    }

    const children = getImmediateChildren(node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index]);
    }
  }

  for (const target of collectDirectValueTargets(input.root, input.sourceFile)) {
    const staticText = readStaticText(input.sourceFile, target.expression);
    if (!staticText
      || consumedTextRanges.has(nodeRangeKey(staticText.evidenceNode, input.sourceFile))) {
      continue;
    }
    const hinted = Boolean(target.nameHint && CODE_NAME_PATTERN.test(target.nameHint));
    if (!staticText.exactCodeTag
      && !isStrongCodeProgram(staticText.text, input.scriptKind, hinted)) {
      continue;
    }
    requests.push(createRequest(
      input.sourceFile,
      input.anchorBlockId,
      staticText,
      staticText.exactCodeTag ? "code-tagged text" : "stored code text",
      "stored",
      staticText.exactCodeTag ? "exact" : "inferred"
    ));
  }

  return {
    requests: deduplicateRequests(requests).sort((left, right) =>
      left.sourceOrder - right.sourceOrder
      || left.range.endLine - right.range.endLine
      || left.range.endCharacter - right.range.endCharacter
    ),
    dynamicConsumerCount
  };
}

/** Converts a decoded static string into one source-backed expansion request. */
function createRequest(
  sourceFile: ts.SourceFile,
  anchorBlockId: string,
  staticText: StaticText,
  consumer: string,
  mode: TypeScriptEmbeddedCodeMode,
  confidence: FunctionLogicConfidence,
  parameterSource?: string
): TypeScriptEmbeddedCodeRequest {
  const range = toSourceRange(sourceFile, staticText.evidenceNode);
  return {
    anchorBlockId,
    code: staticText.text,
    ...(parameterSource ? { parameterSource } : {}),
    consumer,
    mode,
    confidence,
    range,
    sourceOrder: staticText.evidenceNode.getStart(sourceFile)
  };
}

/** Recognizes only APIs whose documented argument is executable JavaScript text. */
function readKnownCodeConsumer(
  sourceFile: ts.SourceFile,
  node: ts.CallExpression | ts.NewExpression
):
  | {
      kind: "static";
      text: StaticText;
      consumer: string;
      mode: TypeScriptEmbeddedCodeMode;
      parameterSource?: string;
    }
  | { kind: "dynamic" }
  | { kind: "none" } {
  const callee = readCallee(sourceFile, node.expression);
  const args = node.arguments ?? [];
  if (!callee) return { kind: "none" };

  if (isGlobalCallee(callee.text, "eval")) {
    return readSingleCodeArgument(sourceFile, args[0], callee.text, "immediate");
  }
  if (TIMER_NAMES.has(callee.name) && isGlobalLikeCallee(callee.text, callee.name)) {
    return readSingleCodeArgument(sourceFile, args[0], callee.text, "deferred");
  }
  if (VM_IMMEDIATE_NAMES.has(callee.name) && callee.text.includes(".")) {
    return readSingleCodeArgument(sourceFile, args[0], callee.text, "immediate");
  }
  if (callee.name === "compileFunction" && callee.text.includes(".")) {
    return readSingleCodeArgument(sourceFile, args[0], callee.text, "callable");
  }
  if (isGlobalCallee(callee.text, "Function")) {
    if (args.length === 0) return { kind: "none" };
    const decoded = args.map((argument) => readStaticText(sourceFile, argument));
    if (decoded.some((value) => !value)) return { kind: "dynamic" };
    const staticValues = decoded as StaticText[];
    const body = staticValues.at(-1);
    if (!body) return { kind: "none" };
    return {
      kind: "static",
      text: body,
      consumer: callee.text,
      mode: "callable",
      ...(staticValues.length > 1
        ? { parameterSource: staticValues.slice(0, -1).map((value) => value.text).join(",") }
        : {})
    };
  }
  return { kind: "none" };
}

/** Reads one required code argument and distinguishes dynamic from absent text. */
function readSingleCodeArgument(
  sourceFile: ts.SourceFile,
  argument: ts.Expression | undefined,
  consumer: string,
  mode: TypeScriptEmbeddedCodeMode
): ReturnType<typeof readKnownCodeConsumer> {
  if (!argument) return { kind: "none" };
  const text = readStaticText(sourceFile, argument);
  return text
    ? { kind: "static", text, consumer, mode }
    : { kind: "dynamic" };
}

/** Reads stable identifier/property callees without resolving runtime aliases. */
function readCallee(
  sourceFile: ts.SourceFile,
  expression: ts.LeftHandSideExpression
): { name: string; text: string } | undefined {
  let current: ts.Expression = expression;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  if (ts.isIdentifier(current)) {
    return { name: current.text, text: current.text };
  }
  if (ts.isPropertyAccessExpression(current)) {
    return {
      name: current.name.text,
      text: normalizeText(current.getText(sourceFile))
    };
  }
  if (ts.isElementAccessExpression(current)) {
    const argument = current.argumentExpression;
    if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) {
      return { name: argument.text, text: normalizeText(current.getText(sourceFile)) };
    }
  }
  return undefined;
}

/** Restricts global constructors/eval to unqualified or explicit global receivers. */
function isGlobalCallee(text: string, name: string): boolean {
  return text === name || text === `globalThis.${name}` || text === `window.${name}`;
}

/** Timer strings may use the browser/global receiver but not arbitrary methods. */
function isGlobalLikeCallee(text: string, name: string): boolean {
  return isGlobalCallee(text, name) || text === `self.${name}`;
}

/** Decodes literals, code tags, and bounded literal-only `+` concatenation. */
function readStaticText(
  sourceFile: ts.SourceFile,
  expression: ts.Expression
): StaticText | undefined {
  const root = unwrapExpression(expression);
  if (ts.isTaggedTemplateExpression(root)) {
    const tag = normalizeText(root.tag.getText(sourceFile));
    if (!isCodeTag(tag) || !ts.isNoSubstitutionTemplateLiteral(root.template)) {
      return undefined;
    }
    const rawText = (root.template as ts.NoSubstitutionTemplateLiteral & { rawText?: string }).rawText;
    const text = tag === "String.raw" ? rawText ?? root.template.text : root.template.text;
    return withinTextLimit(text)
      ? { text, evidenceNode: root, exactCodeTag: tag !== "String.raw" }
      : undefined;
  }

  const pieces: string[] = [];
  const pending: ts.Expression[] = [root];
  while (pending.length > 0) {
    if (pieces.length >= MAX_EMBEDDED_CODE_PIECES) return undefined;
    const current = unwrapExpression(pending.pop() as ts.Expression);
    if (ts.isBinaryExpression(current)
      && current.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      pending.push(current.right, current.left);
      continue;
    }
    if (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current)) {
      pieces.push(current.text);
      if (!withinTextLimit(pieces.join(""))) return undefined;
      continue;
    }
    return undefined;
  }
  const text = pieces.join("");
  return withinTextLimit(text)
    ? { text, evidenceNode: root, exactCodeTag: false }
    : undefined;
}

/** Removes syntax-only wrappers without evaluating assertions or conversions. */
function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current)
    || ts.isSatisfiesExpression(current)) {
    current = current.expression;
  }
  return current;
}

/** Recognizes explicit tags that declare their template payload to be source. */
function isCodeTag(tag: string): boolean {
  return tag === "String.raw" || CODE_TAG_NAMES.has(tag.split(".").at(-1) ?? tag);
}

/** Keeps decoded source non-empty and below the shared parser input ceiling. */
function withinTextLimit(text: string): boolean {
  return text.trim().length > 0 && text.length <= MAX_EMBEDDED_CODE_CHARACTERS;
}

/** Reads only values directly owned by the visible statement/expression. */
function collectDirectValueTargets(
  root: ts.Node,
  sourceFile: ts.SourceFile
): DirectValueTarget[] {
  if (ts.isVariableStatement(root)) {
    return root.declarationList.declarations.flatMap((declaration) => declaration.initializer
      ? [{
          expression: declaration.initializer,
          nameHint: normalizeText(declaration.name.getText(sourceFile))
        }]
      : []);
  }
  if ((ts.isReturnStatement(root) || ts.isThrowStatement(root)) && root.expression) {
    return [{ expression: root.expression }];
  }
  if (ts.isExpressionStatement(root)) {
    const expression = unwrapExpression(root.expression);
    if (ts.isBinaryExpression(expression)
      && isAssignmentOperator(expression.operatorToken.kind)) {
      return [{
        expression: expression.right,
        nameHint: normalizeText(expression.left.getText(sourceFile))
      }];
    }
    return [{ expression }];
  }
  return ts.isExpression(root) ? [{ expression: root }] : [];
}

/** Assignment detection remains syntax-only and does not compute operator results. */
function isAssignmentOperator(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

/**
 * Requires parser-clean function/control/multi-statement structure before an
 * untagged stored string is treated as code. A suggestive variable name alone
 * cannot turn plain prose into an embedded program.
 */
function isStrongCodeProgram(
  text: string,
  scriptKind: ts.ScriptKind,
  hintedByName: boolean
): boolean {
  const sourceFile = ts.createSourceFile(
    "embedded-code-shape.ts",
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKind
  );
  if (readParseDiagnosticCount(sourceFile) > 0) return false;
  const pending: ts.Node[] = [...sourceFile.statements];
  let functionCount = 0;
  let controlCount = 0;
  let semanticStatementCount = 0;
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) continue;
    if (isFunctionLikeWithBody(node)) {
      functionCount += 1;
      continue;
    }
    if (ts.isIfStatement(node) || ts.isSwitchStatement(node)
      || ts.isTryStatement(node) || isLoopNode(node)) {
      controlCount += 1;
    }
    if (ts.isVariableStatement(node)
      || (ts.isExpressionStatement(node) && isCodeExpression(node.expression))
      || ts.isReturnStatement(node) || ts.isThrowStatement(node)
      || ts.isIfStatement(node) || ts.isSwitchStatement(node)
      || ts.isTryStatement(node) || isLoopNode(node)) {
      semanticStatementCount += 1;
    }
    const children = getImmediateChildren(node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index]);
    }
  }
  return functionCount > 0
    || (controlCount > 0 && semanticStatementCount >= 2)
    || (sourceFile.statements.length >= 2 && semanticStatementCount >= 2)
    || (hintedByName && semanticStatementCount > 0);
}

/** Rejects plain identifier/prose-like strings even when their variable is named `code`. */
function isCodeExpression(expression: ts.Expression): boolean {
  const current = unwrapExpression(expression);
  return ts.isCallExpression(current) || ts.isNewExpression(current)
    || ts.isBinaryExpression(current) || ts.isConditionalExpression(current)
    || ts.isArrowFunction(current) || ts.isAwaitExpression(current)
    || ts.isYieldExpression(current) || ts.isPrefixUnaryExpression(current)
    || ts.isPostfixUnaryExpression(current) || ts.isDeleteExpression(current);
}

/** TypeScript has no common loop predicate, so discovery keeps one local guard. */
function isLoopNode(node: ts.Node): boolean {
  return ts.isForStatement(node) || ts.isForInStatement(node)
    || ts.isForOfStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node);
}

/** Reads parser diagnostics through the stable SourceFile parser result shape. */
function readParseDiagnosticCount(sourceFile: ts.SourceFile): number {
  return (sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] })
    .parseDiagnostics?.length ?? 0;
}

/** Removes duplicate consumers when an AST wrapper exposes one argument twice. */
function deduplicateRequests(
  requests: readonly TypeScriptEmbeddedCodeRequest[]
): TypeScriptEmbeddedCodeRequest[] {
  const seen = new Set<string>();
  return requests.filter((request) => {
    const key = [
      request.anchorBlockId,
      request.mode,
      request.range.startLine,
      request.range.startCharacter,
      request.range.endLine,
      request.range.endCharacter
    ].join("\0");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Creates a compact source-offset key for known/generic candidate suppression. */
function nodeRangeKey(node: ts.Node, sourceFile: ts.SourceFile): string {
  return `${node.getStart(sourceFile)}:${node.getEnd()}`;
}

/** Normalizes callee and contextual names without discarding their identity. */
function normalizeText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}
