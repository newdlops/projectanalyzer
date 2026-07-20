/**
 * Syntax/block helpers for embedded TypeScript/JavaScript programs. The
 * planner owns orchestration; this module owns callable boundaries, virtual
 * evidence remapping, and stable block merges shared across every scope.
 */

import * as ts from "typescript";
import type { SourceRange } from "../../../shared/types";
import {
  appendDirectBlock,
  type InternalBlock
} from "../core/structuredControlFlow";
import { createFunctionLogicEdge } from "../core/functionLogicSupport";
import { hasTypeScriptJsxLogic } from "../jsx";
import type {
  FunctionLogicBlock,
  FunctionLogicCallsite,
  FunctionLogicConfidence,
  FunctionLogicEdge,
  FunctionLogicValueBinding,
  FunctionLogicValueFlow
} from "../types";
import type {
  FunctionLikeWithBody,
  PendingStatement
} from "../typescriptFunctionLogicInternal";
import {
  completeSourceText,
  createBlockId,
  createFunctionSignature,
  getFunctionName,
  getFunctionSelectionNode,
  getImmediateChildren,
  isFunctionLikeWithBody,
  toSourceRange
} from "../typescriptFunctionLogicSyntax";
import { collectTypeScriptExpressionValueChanges } from "../valueChanges";

const MAX_EMBEDDED_FUNCTION_COUNT = 99;

/** One root or callable-body scope waiting for iterative planning. */
export type PendingEmbeddedScope = {
  node: FunctionLikeWithBody;
  ownerBlockId: string;
  relationship: "root" | "definition";
  label: string;
};

/** Callable discovered while classifying one embedded statement. */
export type DiscoveredEmbeddedCallable = {
  node: FunctionLikeWithBody;
  ownerBlockId: string;
  label: string;
};

/** Complete result for one independently projected lexical callable scope. */
export type EmbeddedScopeBuildResult = {
  ownerBlock: FunctionLogicBlock;
  newBlocks: FunctionLogicBlock[];
  edges: FunctionLogicEdge[];
  callsites: FunctionLogicCallsite[];
  valueBindings: FunctionLogicValueBinding[];
  valueFlows: FunctionLogicValueFlow[];
  nestedScopes: PendingEmbeddedScope[];
  omittedBlockCount: number;
};

/** Makes one direct declaration/function-valued statement its callable boundary. */
export function specializeEmbeddedCallableBlock(
  sourceFile: ts.SourceFile,
  filePath: string,
  base: FunctionLogicBlock,
  callable: FunctionLikeWithBody
): FunctionLogicBlock {
  const label = `define ${createEmbeddedCallableSignature(sourceFile, callable)}`;
  return {
    ...base,
    id: createBlockId(filePath, "callable", base.range, label),
    kind: "callable",
    label,
    detail: "Defines a callable in embedded code. Its body is analyzed separately and is not entered until invoked.",
    confidence: "exact"
  };
}

/** Adds methods or multiple function-valued declarations beside their owner statement. */
export function createAdditionalEmbeddedCallableBlock(
  sourceFile: ts.SourceFile,
  filePath: string,
  callable: FunctionLikeWithBody,
  owner: InternalBlock,
  task: PendingStatement
): InternalBlock {
  const range = toSourceRange(sourceFile, getFunctionSelectionNode(callable));
  const label = `define ${createEmbeddedCallableSignature(sourceFile, callable)}`;
  return {
    id: createBlockId(filePath, "callable", range, label),
    kind: "callable",
    label,
    detail: "Defines one callable contained by this embedded statement; the body remains a separate non-executed scope.",
    depth: task.depth + 1,
    parentBlockId: owner.id,
    branchLabel: task.branchLabel,
    confidence: "exact",
    filePath,
    range,
    containerId: task.containerId
  };
}

/** Finds function declarations, arrows, methods, and accessors without recursion. */
export function collectEmbeddedStatementCallables(
  statement: ts.Statement,
  sourceFile: ts.SourceFile
): FunctionLikeWithBody[] {
  const result: FunctionLikeWithBody[] = [];
  const pending: ts.Node[] = [statement];
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) continue;
    if (isFunctionLikeWithBody(node)) {
      result.push(node);
      continue;
    }
    const children = getImmediateChildren(node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index]);
    }
  }
  return result.sort((left, right) =>
    left.getStart(sourceFile) - right.getStart(sourceFile)
  );
}

/** Determines when one visible statement can itself represent the callable value. */
export function embeddedCallableOwnsWholeStatement(
  statement: ts.Statement,
  callable: FunctionLikeWithBody
): boolean {
  if (statement === callable) return true;
  if (ts.isVariableStatement(statement)
    && statement.declarationList.declarations.length === 1) {
    const initializer = statement.declarationList.declarations[0]?.initializer;
    return initializer ? unwrapEmbeddedExpression(initializer) === callable : false;
  }
  if (ts.isExpressionStatement(statement)) {
    const expression = unwrapEmbeddedExpression(statement.expression);
    return ts.isBinaryExpression(expression)
      && unwrapEmbeddedExpression(expression.right) === callable;
  }
  return false;
}

/** Reads the best source name while preserving anonymous definitions explicitly. */
export function embeddedCallableDisplayName(
  callable: FunctionLikeWithBody,
  sourceFile: ts.SourceFile
): string {
  return getFunctionName(callable, sourceFile) || "anonymous callable";
}

/** Restores a variable/property binding name omitted by an arrow/function-expression header. */
function createEmbeddedCallableSignature(
  sourceFile: ts.SourceFile,
  callable: FunctionLikeWithBody
): string {
  const signature = createFunctionSignature(sourceFile, callable);
  const name = getFunctionName(callable, sourceFile);
  if (!name || signature.includes(name)) return signature;
  return signature.startsWith("(") ? `${name}${signature}` : `${name} · ${signature}`;
}

/** Creates an isolated end marker for one root or nested embedded scope. */
export function createEmbeddedScopeExitBlock(
  sourceFile: ts.SourceFile,
  filePath: string,
  scope: PendingEmbeddedScope,
  owner: FunctionLogicBlock
): FunctionLogicBlock {
  const bodyRange = toSourceRange(sourceFile, scope.node.body);
  const range: SourceRange = {
    startLine: bodyRange.endLine,
    startCharacter: bodyRange.endCharacter,
    endLine: bodyRange.endLine,
    endCharacter: bodyRange.endCharacter
  };
  const label = scope.relationship === "root"
    ? "End embedded program"
    : `End ${scope.label} body`;
  return {
    id: createBlockId(filePath, "exit", range, `${label}:${owner.id}`),
    kind: "exit",
    label,
    detail: scope.relationship === "root"
      ? "Completes this parsed embedded program scope."
      : "Completes the callable body without returning into the host flow unless a real call occurs.",
    depth: owner.depth + 1,
    parentBlockId: owner.id,
    confidence: "exact",
    filePath,
    range
  };
}

/** Creates a concise arrow's implicit return block. */
export function createEmbeddedExpressionReturnBlock(
  sourceFile: ts.SourceFile,
  filePath: string,
  expression: ts.Expression,
  owner: FunctionLogicBlock
): FunctionLogicBlock {
  const range = toSourceRange(sourceFile, expression);
  const label = hasTypeScriptJsxLogic(expression)
    ? "return JSX output"
    : `return ${completeSourceText(expression.getText(sourceFile), "expression")}`;
  const valueChanges = collectTypeScriptExpressionValueChanges(sourceFile, expression);
  return {
    id: createBlockId(filePath, "return", range, label),
    kind: "return",
    label,
    detail: "Concise embedded callable body implicitly returns this expression.",
    depth: owner.depth + 1,
    parentBlockId: owner.id,
    confidence: "exact",
    valueChanges: valueChanges.length > 0 ? valueChanges : undefined,
    filePath,
    range
  };
}

/** Marks nested body entry as structural definition rather than host execution. */
export function specializeEmbeddedScopeEntryEdge(
  edges: readonly FunctionLogicEdge[],
  scope: PendingEmbeddedScope,
  ownerBlockId: string
): FunctionLogicEdge[] {
  if (scope.relationship === "root") return [...edges];
  return edges.map((edge) => edge.sourceId === ownerBlockId
    ? createFunctionLogicEdge(
        edge.sourceId,
        edge.targetId,
        "defines",
        "callable body · not invoked",
        edge.confidence
      )
    : edge);
}

/** Appends one internal block to every structured-flow index. */
export function appendEmbeddedVisibleBlock(
  visibleBlocks: InternalBlock[],
  blocksById: Map<string, InternalBlock>,
  directBlockIdsByContainer: Map<string, string[]>,
  block: InternalBlock
): void {
  visibleBlocks.push(block);
  blocksById.set(block.id, block);
  appendDirectBlock(directBlockIdsByContainer, block.containerId, block.id);
}

/** Schedules statements in source order on the explicit LIFO worklist. */
export function pushEmbeddedStatements(
  pending: PendingStatement[],
  statements: readonly ts.Statement[],
  containerId: string,
  depth: number,
  branchLabel?: string
): void {
  for (let index = statements.length - 1; index >= 0; index -= 1) {
    pending.push({ node: statements[index], containerId, depth, branchLabel });
  }
}

/** Remaps virtual syntax to one host literal while retaining virtual line detail. */
export function decorateEmbeddedBlock(
  block: FunctionLogicBlock,
  boundaryBlockId: string,
  hostFilePath: string,
  hostRange: SourceRange,
  confidence: FunctionLogicConfidence
): FunctionLogicBlock {
  if (block.id === boundaryBlockId) return block;
  const embeddedLine = Math.max(1, block.range.startLine);
  return {
    ...block,
    detail: `${block.detail} Embedded text line ${embeddedLine}.`,
    confidence: combineEmbeddedConfidence(block.confidence, confidence),
    valueChanges: block.valueChanges?.map((change) => ({
      ...change,
      confidence: combineEmbeddedConfidence(change.confidence, confidence)
    })),
    valueAccesses: block.valueAccesses?.map((access) => ({
      ...access,
      confidence: combineEmbeddedConfidence(access.confidence, confidence)
    })),
    filePath: hostFilePath,
    range: hostRange
  };
}

/** Adds owner-scope parameter accesses without erasing parent-scope definition rows. */
export function mergeEmbeddedValueAccesses(
  original: FunctionLogicBlock,
  projected: FunctionLogicBlock
): FunctionLogicBlock {
  const values = [...(original.valueAccesses ?? [])];
  const seen = new Set(values.map(valueAccessKey));
  for (const access of projected.valueAccesses ?? []) {
    const key = valueAccessKey(access);
    if (!seen.has(key)) {
      seen.add(key);
      values.push(access);
    }
  }
  return {
    ...projected,
    valueAccesses: values.length > 0 ? values : undefined
  };
}

/** Merges scope updates into one stable block identity. */
export function mergeEmbeddedBlock(
  blocksById: Map<string, FunctionLogicBlock>,
  incoming: FunctionLogicBlock
): void {
  const existing = blocksById.get(incoming.id);
  blocksById.set(
    incoming.id,
    existing ? mergeEmbeddedValueAccesses(existing, incoming) : incoming
  );
}

/** Maps a virtual callsite to the most specific syntax-backed block. */
export function findEmbeddedCallsiteBlockId(
  blocks: readonly FunctionLogicBlock[],
  range: SourceRange
): string | undefined {
  let selected: FunctionLogicBlock | undefined;
  for (const block of blocks) {
    if (block.kind === "exit" || !containsRange(block.range, range)) continue;
    if (!selected
      || rangeSpan(block.range) < rangeSpan(selected.range)
      || (rangeSpan(block.range) === rangeSpan(selected.range)
        && block.depth > selected.depth)) {
      selected = block;
    }
  }
  return selected?.id;
}

/** Counts every nested definition with an explicit bounded AST stack. */
export function countEmbeddedFunctionDefinitions(root: ts.Node): number {
  const pending = getImmediateChildren(root);
  let count = 0;
  while (pending.length > 0 && count < MAX_EMBEDDED_FUNCTION_COUNT) {
    const node = pending.pop();
    if (!node) continue;
    if (isFunctionLikeWithBody(node)) count += 1;
    const children = getImmediateChildren(node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index]);
    }
  }
  return count;
}

/** Returns an empty bounded scope result when even entry/exit cannot fit. */
export function createEmptyEmbeddedScopeBuild(
  ownerBlock: FunctionLogicBlock,
  omittedBlockCount: number
): EmbeddedScopeBuildResult {
  return {
    ownerBlock,
    newBlocks: [],
    edges: [],
    callsites: [],
    valueBindings: [],
    valueFlows: [],
    nestedScopes: [],
    omittedBlockCount
  };
}

/** Transparent wrappers do not create another callable ownership boundary. */
export function unwrapEmbeddedExpression(expression: ts.Expression): ts.Expression {
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

/** A heuristic boundary downgrades every derived embedded fact. */
export function combineEmbeddedConfidence(
  left: FunctionLogicConfidence,
  right: FunctionLogicConfidence
): FunctionLogicConfidence {
  return left === "inferred" || right === "inferred" ? "inferred" : "exact";
}

/** Stable key for merging definition/read/write rows from adjacent scopes. */
function valueAccessKey(
  access: NonNullable<FunctionLogicBlock["valueAccesses"]>[number]
): string {
  return [
    access.bindingId,
    access.access,
    access.usage ?? "",
    access.confidence
  ].join("\0");
}

/** Source-range containment stays lexicographic and allocation-free. */
function containsRange(container: SourceRange, candidate: SourceRange): boolean {
  return comparePosition(
    container.startLine,
    container.startCharacter,
    candidate.startLine,
    candidate.startCharacter
  ) <= 0 && comparePosition(
    container.endLine,
    container.endCharacter,
    candidate.endLine,
    candidate.endCharacter
  ) >= 0;
}

/** Provides a stable approximate range span for block specificity. */
function rangeSpan(range: SourceRange): number {
  return Math.max(
    0,
    (range.endLine - range.startLine) * 1_000_000
      + range.endCharacter - range.startCharacter
  );
}

/** Compares zero-based editor positions. */
function comparePosition(
  leftLine: number,
  leftCharacter: number,
  rightLine: number,
  rightCharacter: number
): number {
  return leftLine - rightLine || leftCharacter - rightCharacter;
}
