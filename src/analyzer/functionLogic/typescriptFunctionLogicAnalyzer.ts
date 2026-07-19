/**
 * TypeScript/JavaScript function-local logic analyzer orchestration. It keeps
 * source matching, statement classification, and CFG construction behind one
 * framework-independent public analysis function.
 */

import * as ts from "typescript";
import { createContentHash } from "../../shared/hash";
import type { SourceRange, SymbolNode } from "../../shared/types";
import type {
  FunctionLogicAnalysis,
  FunctionLogicAnalysisInput,
  FunctionLogicBlock,
  FunctionLogicGap,
  FunctionLogicSummary
} from "./types";
import {
  appendDirectBlock,
  createStructuredControlEdges
} from "./core/structuredControlFlow";
import {
  scheduleControlChildren
} from "./typescriptFunctionLogicControlFlow";
import type {
  ControlRecord,
  InternalBlock,
  LogicContainer
} from "./core/structuredControlFlow";
import type {
  FunctionLikeWithBody,
  PendingStatement
} from "./typescriptFunctionLogicInternal";
import {
  classifyStatement,
  collectFunctionCallsites,
  completeSourceText,
  createBlockId,
  createFunctionSignature,
  findSelectedFunction,
  getScriptKind,
  getSupportedLanguage,
  normalizeMaxBlocks,
  toSourceRange
} from "./typescriptFunctionLogicSyntax";
import { collectTypeScriptExpressionValueChanges } from "./valueChanges";

/** Analyzes one selected callable against its current source snapshot. */
export function analyzeFunctionLogic(input: FunctionLogicAnalysisInput): FunctionLogicAnalysis {
  const language = getSupportedLanguage(input.functionNode);
  if (language === "unsupported") {
    return createUnavailableAnalysis(
      input.functionNode,
      "languageUnsupported",
      `Function-internal control flow is not yet available for ${input.functionNode.language || "this language"}.`
    );
  }
  if (input.sourceText === undefined) {
    return createUnavailableAnalysis(
      input.functionNode,
      "sourceUnavailable",
      "The selected function source could not be read from the current workspace."
    );
  }

  const sourceFile = ts.createSourceFile(
    input.functionNode.filePath,
    input.sourceText,
    ts.ScriptTarget.Latest,
    true,
    getScriptKind(input.functionNode.filePath, input.functionNode.language)
  );
  const functionNode = findSelectedFunction(sourceFile, input.functionNode);
  if (!functionNode) {
    return createUnavailableAnalysis(
      input.functionNode,
      "functionNotFound",
      "The analyzed symbol could not be matched to a function body in the current source. Reanalyze after source changes."
    );
  }

  return buildFunctionLogic(
    sourceFile,
    functionNode,
    input.functionNode,
    normalizeMaxBlocks(input.maxBlocks)
  );
}

/** Builds the structured blocks and conservative control transfers. */
function buildFunctionLogic(
  sourceFile: ts.SourceFile,
  functionNode: FunctionLikeWithBody,
  graphNode: SymbolNode,
  maxBlocks: number
): FunctionLogicAnalysis {
  const rootContainerId = "logic-container:root";
  const containers = new Map<string, LogicContainer>([[rootContainerId, {
    id: rootContainerId,
    role: "root"
  }]]);
  const directBlockIdsByContainer = new Map<string, string[]>();
  const blocksById = new Map<string, InternalBlock>();
  const controlsByBlockId = new Map<string, ControlRecord>();
  const visibleBlocks: InternalBlock[] = [];
  const gaps = createDefaultGaps();
  const callsites = collectFunctionCallsites(sourceFile, graphNode.filePath, functionNode);
  const bodyRange = toSourceRange(sourceFile, functionNode.body);
  const entryBlock = createSyntheticBlock(
    graphNode,
    "entry",
    `Enter ${graphNode.name || "function"}`,
    "Function arguments and captured values are available here.",
    graphNode.selectionRange
  );
  const exitBlock = createSyntheticBlock(
    graphNode,
    "exit",
    `Exit ${graphNode.name || "function"}`,
    "All non-throwing paths that do not return earlier finish here.",
    createEndRange(bodyRange)
  );

  if (!ts.isBlock(functionNode.body)) {
    const expressionBlock = createExpressionBodyBlock(sourceFile, graphNode, functionNode.body);
    return finalizeSimpleExpressionAnalysis(
      graphNode,
      sourceFile,
      functionNode,
      entryBlock,
      expressionBlock,
      exitBlock,
      gaps,
      callsites
    );
  }

  const pending: PendingStatement[] = [];
  pushStatements(pending, functionNode.body.statements, rootContainerId, 1);
  let omittedBlockCount = 0;

  while (pending.length > 0) {
    const task = pending.pop();
    if (!task) {
      continue;
    }
    if (visibleBlocks.length >= maxBlocks) {
      omittedBlockCount += 1;
      continue;
    }
    if (ts.isBlock(task.node)) {
      pushStatements(pending, task.node.statements, task.containerId, task.depth, task.branchLabel);
      continue;
    }

    const classified = classifyStatement(sourceFile, graphNode.filePath, task);
    const block: InternalBlock = {
      ...classified,
      parentBlockId: containers.get(task.containerId)?.ownerBlockId,
      containerId: task.containerId
    };
    visibleBlocks.push(block);
    blocksById.set(block.id, block);
    appendDirectBlock(directBlockIdsByContainer, task.containerId, block.id);
    scheduleControlChildren(
      sourceFile,
      task,
      block,
      pending,
      containers,
      controlsByBlockId
    );
  }

  if (omittedBlockCount > 0) {
    gaps.push({
      code: "parseLimited",
      message: `${omittedBlockCount} additional statement(s) were omitted after the ${maxBlocks}-block reading limit.`
    });
  }
  if ([...controlsByBlockId.values()].some((control) =>
    control.kind === "try" && control.finallyContainerId !== undefined
  )) {
    gaps.push({
      code: "parseLimited",
      message: "Abrupt return, throw, break, and continue paths through finally are conservatively simplified."
    });
  }

  const edges = createStructuredControlEdges({
    entryBlock,
    exitBlock,
    visibleBlocks,
    blocksById,
    containers,
    controlsByBlockId,
    directBlockIdsByContainer,
    rootContainerId
  });
  const blocks = [entryBlock, ...visibleBlocks, exitBlock];

  return {
    functionNode: graphNode,
    language: getSupportedLanguage(graphNode),
    signature: createFunctionSignature(sourceFile, functionNode),
    blocks,
    edges,
    callsites,
    gaps,
    summary: createSummary(blocks, callsites.length)
  };
}

/** Schedules statements in source order on a LIFO work stack. */
function pushStatements(
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

/** Creates entry/exit blocks using already validated graph source ranges. */
function createSyntheticBlock(
  node: SymbolNode,
  kind: "entry" | "exit",
  label: string,
  detail: string,
  range: SourceRange
): FunctionLogicBlock {
  return {
    id: createBlockId(node.filePath, kind, range, label),
    kind,
    label,
    detail,
    depth: 0,
    confidence: "exact",
    filePath: node.filePath,
    range
  };
}

/** Handles concise arrow bodies as an implicit return path. */
function createExpressionBodyBlock(
  sourceFile: ts.SourceFile,
  node: SymbolNode,
  expression: ts.Expression
): FunctionLogicBlock {
  const range = toSourceRange(sourceFile, expression);
  const expressionText = expression.getText(sourceFile);
  const valueChanges = collectTypeScriptExpressionValueChanges(sourceFile, expression);
  return {
    id: createBlockId(node.filePath, "return", range, expressionText),
    kind: "return",
    label: `return ${completeSourceText(expressionText, "expression")}`,
    detail: "Concise arrow body implicitly returns this expression.",
    depth: 1,
    confidence: "exact",
    valueChanges: valueChanges.length > 0 ? valueChanges : undefined,
    filePath: node.filePath,
    range
  };
}

/** Completes the small CFG for an expression-bodied arrow function. */
function finalizeSimpleExpressionAnalysis(
  graphNode: SymbolNode,
  sourceFile: ts.SourceFile,
  functionNode: FunctionLikeWithBody,
  entry: FunctionLogicBlock,
  expression: FunctionLogicBlock,
  exit: FunctionLogicBlock,
  gaps: FunctionLogicGap[],
  callsites: FunctionLogicAnalysis["callsites"]
): FunctionLogicAnalysis {
  const firstKey = `${entry.id}\0${expression.id}\0next`;
  const secondKey = `${expression.id}\0${exit.id}\0return`;
  return {
    functionNode: graphNode,
    language: getSupportedLanguage(graphNode),
    signature: createFunctionSignature(sourceFile, functionNode),
    blocks: [entry, expression, exit],
    edges: [
      {
        id: `logic-edge:${createContentHash(firstKey).slice(0, 32)}`,
        sourceId: entry.id,
        targetId: expression.id,
        kind: "next",
        confidence: "exact"
      },
      {
        id: `logic-edge:${createContentHash(secondKey).slice(0, 32)}`,
        sourceId: expression.id,
        targetId: exit.id,
        kind: "return",
        label: "return",
        confidence: "exact"
      }
    ],
    callsites,
    gaps,
    summary: createSummary([entry, expression, exit], callsites.length)
  };
}

/** Creates a truthful unavailable result instead of falling back to call edges. */
function createUnavailableAnalysis(
  functionNode: SymbolNode,
  code: FunctionLogicGap["code"],
  message: string
): FunctionLogicAnalysis {
  return {
    functionNode,
    language: getSupportedLanguage(functionNode),
    signature: functionNode.qualifiedName || functionNode.name,
    blocks: [],
    edges: [],
    callsites: [],
    gaps: [{ code, message }],
    summary: createSummary([])
  };
}

/** Known limitations remain visible on every ready AST projection. */
function createDefaultGaps(): FunctionLogicGap[] {
  return [
    {
      code: "parseLimited",
      message: "Short-circuit expressions, optional chaining, and expression-level ternaries stay inside their containing statement."
    },
    {
      code: "dynamicBehavior",
      message: "Exceptions thrown by callees, callback scheduling, dynamic dispatch, and runtime data values are not observed."
    }
  ];
}

/** Derives visible counts without implying omitted runtime behavior. */
function createSummary(
  blocks: FunctionLogicBlock[],
  callsiteCount?: number
): FunctionLogicSummary {
  return {
    blockCount: blocks.length,
    branchCount: blocks.filter((block) => block.kind === "condition" || block.kind === "switch").length,
    loopCount: blocks.filter((block) => block.kind === "loop").length,
    callCount: callsiteCount
      ?? blocks.filter((block) => block.kind === "call" || block.kind === "effect").length,
    effectCount: blocks.filter((block) => block.kind === "effect").length,
    mutationCount: blocks.filter((block) => block.kind === "mutation").length,
    valueChangeCount: blocks.reduce(
      (count, block) => count + (block.valueChanges?.length ?? 0),
      0
    ),
    exitCount: blocks.filter((block) => block.kind === "return" || block.kind === "throw").length
  };
}

/** Creates a zero-width closing location for the synthetic exit block. */
function createEndRange(range: SourceRange): SourceRange {
  return {
    startLine: range.endLine,
    startCharacter: range.endCharacter,
    endLine: range.endLine,
    endCharacter: range.endCharacter
  };
}
