/**
 * TypeScript JSX value-flow integration. JSX elements can be stored, assigned,
 * passed, or returned as first-class component values; this module plans those
 * anchors and splices bounded render fragments into the surrounding CFG.
 */

import * as ts from "typescript";
import { createFunctionLogicBlockId, createFunctionLogicEdge } from "../core/functionLogicSupport";
import type { FunctionLogicBlock, FunctionLogicEdge } from "../types";
import { analyzeTypeScriptJsxLogic, hasTypeScriptJsxLogic } from "./typescriptJsxLogic";

/** One statement anchor that consumes a JSX component value or collection. */
export type TypeScriptJsxValueFlowRequest = {
  anchorBlockId: string;
  expression: ts.Expression;
  completionLabel: string;
};

/** Planned statement plus an optional JSX value fragment request. */
export type TypeScriptJsxStatementValuePlan = {
  block: FunctionLogicBlock;
  request?: TypeScriptJsxValueFlowRequest;
};

type JsxValueRole = "return" | "throw" | "initialize" | "assign" | "consume";

/** Detects one direct statement value without entering nested callable scopes. */
export function planTypeScriptJsxStatementValueFlow(
  sourceFile: ts.SourceFile,
  filePath: string,
  statement: ts.Statement,
  block: FunctionLogicBlock
): TypeScriptJsxStatementValuePlan {
  const target = readStatementJsxValueTarget(statement);
  if (!target || !hasTypeScriptJsxLogic(target.expression)) {
    return { block };
  }
  const collection = isJsxComponentCollection(target.expression);
  const noun = collection ? "JSX component collection" : "JSX component value";
  const label = createJsxValueAnchorLabel(sourceFile, statement, target.role, noun);
  const specialized = {
    ...block,
    id: createFunctionLogicBlockId(filePath, block.kind, block.range, label),
    label,
    detail: createJsxValueAnchorDetail(target.role, noun)
  };
  return {
    block: specialized,
    request: {
      anchorBlockId: specialized.id,
      expression: target.expression,
      completionLabel: createJsxValueCompletionLabel(target.role, noun)
    }
  };
}

/** Creates a request for an already-specialized concise expression body. */
export function createTypeScriptJsxValueFlowRequest(
  anchorBlockId: string,
  expression: ts.Expression,
  completionLabel = "return JSX value"
): TypeScriptJsxValueFlowRequest {
  return { anchorBlockId, expression, completionLabel };
}

/** Splices every bounded JSX value fragment immediately before its consumer. */
export function expandTypeScriptJsxValueFlows(input: {
  sourceFile: ts.SourceFile;
  filePath: string;
  blocks: FunctionLogicBlock[];
  edges: FunctionLogicEdge[];
  requests: readonly TypeScriptJsxValueFlowRequest[];
  remainingBlockBudget: number;
}): {
  blocks: FunctionLogicBlock[];
  edges: FunctionLogicEdge[];
  omittedBlockCount: number;
} {
  const requestByAnchorId = new Map(input.requests.map((request) => [
    request.anchorBlockId,
    request
  ]));
  const blocks: FunctionLogicBlock[] = [];
  let edges = [...input.edges];
  let remainingBlockBudget = Math.max(0, Math.floor(input.remainingBlockBudget));
  let omittedBlockCount = 0;

  for (const anchor of input.blocks) {
    const request = requestByAnchorId.get(anchor.id);
    if (!request) {
      blocks.push(anchor);
      continue;
    }
    const expansion = analyzeTypeScriptJsxLogic({
      sourceFile: input.sourceFile,
      filePath: input.filePath,
      expression: request.expression,
      baseDepth: anchor.depth,
      maxBlocks: remainingBlockBudget
    });
    omittedBlockCount += expansion.omittedBlockCount;
    remainingBlockBudget = Math.max(0, remainingBlockBudget - expansion.blocks.length);
    if (!expansion.entryBlockId) {
      blocks.push(anchor);
      continue;
    }
    const entryBlockId = expansion.entryBlockId;

    edges = edges.map((edge) => edge.targetId === anchor.id
      ? createFunctionLogicEdge(
          edge.sourceId,
          entryBlockId,
          edge.kind,
          edge.label,
          edge.confidence
        )
      : edge
    );
    edges.push(...expansion.edges);
    for (const exit of expansion.exits) {
      edges.push(createFunctionLogicEdge(
        exit.sourceId,
        anchor.id,
        exit.kind,
        exit.label ?? request.completionLabel,
        exit.confidence
      ));
    }
    blocks.push(...expansion.blocks.map((block) => ({
      ...block,
      parentBlockId: block.parentBlockId ?? anchor.parentBlockId,
      branchLabel: block.branchLabel ?? anchor.branchLabel
    })));
    blocks.push(anchor);
  }

  return { blocks, edges, omittedBlockCount };
}

/** Reads only direct statement-owned values whose evaluation order is stable. */
function readStatementJsxValueTarget(
  statement: ts.Statement
): { expression: ts.Expression; role: JsxValueRole } | undefined {
  if (ts.isReturnStatement(statement) && statement.expression) {
    return { expression: statement.expression, role: "return" };
  }
  if (ts.isThrowStatement(statement) && statement.expression) {
    return { expression: statement.expression, role: "throw" };
  }
  if (ts.isVariableStatement(statement)
    && statement.declarationList.declarations.length === 1) {
    const initializer = statement.declarationList.declarations[0]?.initializer;
    return initializer ? { expression: initializer, role: "initialize" } : undefined;
  }
  if (!ts.isExpressionStatement(statement)) {
    return undefined;
  }
  const expression = unwrapTransparentExpression(statement.expression);
  if (ts.isBinaryExpression(expression)
    && expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    return { expression: expression.right, role: "assign" };
  }
  return { expression, role: "consume" };
}

/** Distinguishes an array of component values from one JSX value. */
function isJsxComponentCollection(expression: ts.Expression): boolean {
  return ts.isArrayLiteralExpression(unwrapTransparentExpression(expression));
}

/** Creates a complete source-oriented consumer label without truncation. */
function createJsxValueAnchorLabel(
  sourceFile: ts.SourceFile,
  statement: ts.Statement,
  role: JsxValueRole,
  noun: string
): string {
  if (role === "return") return noun === "JSX component collection"
    ? `return ${noun}`
    : "return JSX output";
  if (role === "throw") return `throw ${noun}`;
  if (role === "initialize" && ts.isVariableStatement(statement)) {
    const name = statement.declarationList.declarations[0]?.name.getText(sourceFile) || "value";
    return `store ${noun} in ${name}`;
  }
  if (role === "assign" && ts.isExpressionStatement(statement)
    && ts.isBinaryExpression(unwrapTransparentExpression(statement.expression))) {
    const assignment = unwrapTransparentExpression(statement.expression) as ts.BinaryExpression;
    return `assign ${noun} to ${normalizeText(assignment.left.getText(sourceFile)) || "target"}`;
  }
  return `consume ${noun}`;
}

/** Explains static value construction without claiming component execution. */
function createJsxValueAnchorDetail(role: JsxValueRole, noun: string): string {
  const action = role === "return" ? "Returns"
    : role === "throw" ? "Throws"
      : role === "initialize" ? "Stores"
        : role === "assign" ? "Assigns"
          : "Passes or consumes";
  return `${action} a first-class ${noun.toLowerCase()} assembled by the preceding JSX steps. `
    + "Component implementation execution remains framework-controlled.";
}

/** Labels the edge from component construction into its lexical consumer. */
function createJsxValueCompletionLabel(role: JsxValueRole, noun: string): string {
  if (role === "return") return `return ${noun}`;
  if (role === "initialize") return `store ${noun}`;
  if (role === "assign") return `assign ${noun}`;
  if (role === "throw") return `throw ${noun}`;
  return `use ${noun}`;
}

/** Removes transparent TypeScript wrappers with an explicit bounded loop. */
function unwrapTransparentExpression(expression: ts.Expression): ts.Expression {
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

/** Normalizes source text while preserving its complete semantic content. */
function normalizeText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}
