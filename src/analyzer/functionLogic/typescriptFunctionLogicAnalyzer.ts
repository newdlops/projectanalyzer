/**
 * TypeScript/JavaScript function-local logic analyzer orchestration. It keeps
 * source matching, statement classification, and CFG construction behind one
 * framework-independent public analysis function.
 */

import * as ts from "typescript";
import type { SourceRange, SymbolNode } from "../../shared/types";
import type {
  FunctionLogicAnalysis,
  FunctionLogicAnalysisInput,
  FunctionLogicBlock,
  FunctionLogicEdge,
  FunctionLogicGap,
  FunctionLogicSummary
} from "./types";
import {
  appendDirectBlock,
  createStructuredControlEdges
} from "./core/structuredControlFlow";
import { createFunctionLogicEdge } from "./core/functionLogicSupport";
import {
  expandTypeScriptExpressionFlows,
  readTypeScriptExpressionBodyFlowTarget,
  readTypeScriptStatementExpressionFlowTarget,
  type TypeScriptExpressionFlowRequest
} from "./expressions";
import {
  createTypeScriptJsxValueFlowRequest,
  expandTypeScriptJsxValueFlows,
  hasTypeScriptJsxLogic,
  planTypeScriptJsxStatementValueFlow,
  type TypeScriptJsxValueFlowRequest
} from "./jsx";
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
import {
  collectTypeScriptFunctionValueFacts,
  createFunctionLogicDataFlowProjection,
  type FunctionLogicDataFlowProjection
} from "./dataFlow";
import {
  discoverTypeScriptEmbeddedCode,
  expandTypeScriptEmbeddedCode,
  type TypeScriptEmbeddedCodeRequest
} from "./embeddedCode";

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
  const jsxValueRequests: TypeScriptJsxValueFlowRequest[] = [];
  const expressionFlowRequests: TypeScriptExpressionFlowRequest[] = [];
  const embeddedCodeRequests: TypeScriptEmbeddedCodeRequest[] = [];
  let dynamicEmbeddedConsumerCount = 0;
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
      callsites,
      maxBlocks
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

    const statementBlock = classifyStatement(sourceFile, graphNode.filePath, task);
    const jsxValuePlan = planTypeScriptJsxStatementValueFlow(
      sourceFile,
      graphNode.filePath,
      task.node,
      statementBlock
    );
    const block: InternalBlock = {
      ...jsxValuePlan.block,
      parentBlockId: containers.get(task.containerId)?.ownerBlockId,
      containerId: task.containerId
    };
    visibleBlocks.push(block);
    blocksById.set(block.id, block);
    if (jsxValuePlan.request) {
      jsxValueRequests.push(jsxValuePlan.request);
    }
    const embeddedDiscovery = discoverTypeScriptEmbeddedCode({
      sourceFile,
      scriptKind: getScriptKind(graphNode.filePath, graphNode.language),
      anchorBlockId: block.id,
      root: task.node
    });
    embeddedCodeRequests.push(...embeddedDiscovery.requests);
    dynamicEmbeddedConsumerCount += embeddedDiscovery.dynamicConsumerCount;
    const expressionTarget = !jsxValuePlan.request && block.kind !== "event"
      ? readTypeScriptStatementExpressionFlowTarget(task.node)
      : undefined;
    if (expressionTarget && !hasTypeScriptJsxLogic(expressionTarget.expression)) {
      expressionFlowRequests.push({
        anchorBlockId: block.id,
        ...expressionTarget
      });
    }
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
  const baseBlocks = [entryBlock, ...visibleBlocks, exitBlock];
  const expressionExpansion = expandTypeScriptExpressionFlows({
    sourceFile,
    filePath: graphNode.filePath,
    blocks: baseBlocks,
    edges,
    requests: expressionFlowRequests,
    remainingBlockBudget: Math.max(0, maxBlocks - visibleBlocks.length)
  });
  if (expressionExpansion.omittedRegionCount > 0) {
    gaps.push(createExpressionLimitGap(expressionExpansion.omittedRegionCount, maxBlocks));
  }
  const jsxExpansion = expandTypeScriptJsxValueFlows({
    sourceFile,
    filePath: graphNode.filePath,
    blocks: expressionExpansion.blocks,
    edges: expressionExpansion.edges,
    requests: jsxValueRequests,
    remainingBlockBudget: Math.max(
      0,
      maxBlocks - visibleBlocks.length - expressionExpansion.addedBlockCount
    )
  });
  if (jsxExpansion.omittedBlockCount > 0) {
    gaps.push(createJsxLimitGap(jsxExpansion.omittedBlockCount, maxBlocks));
  }
  const embeddedExpansion = expandTypeScriptEmbeddedCode({
    sourceFile,
    scriptKind: getScriptKind(graphNode.filePath, graphNode.language),
    filePath: graphNode.filePath,
    blocks: jsxExpansion.blocks,
    edges: jsxExpansion.edges,
    requests: embeddedCodeRequests,
    dynamicConsumerCount: dynamicEmbeddedConsumerCount,
    remainingBlockBudget: Math.max(
      0,
      maxBlocks - Math.max(0, jsxExpansion.blocks.length - 2)
    )
  });
  gaps.push(...embeddedExpansion.gaps);
  const dataFlow = createTypeScriptDataFlow(
    sourceFile,
    functionNode,
    embeddedExpansion.blocks,
    embeddedExpansion.edges,
    gaps
  );
  const combinedCallsites = [...callsites, ...embeddedExpansion.callsites];

  return {
    functionNode: graphNode,
    language: getSupportedLanguage(graphNode),
    signature: createFunctionSignature(sourceFile, functionNode),
    blocks: dataFlow.blocks,
    edges: embeddedExpansion.edges,
    callsites: combinedCallsites,
    valueBindings: [...dataFlow.valueBindings, ...embeddedExpansion.valueBindings],
    valueFlows: [...dataFlow.valueFlows, ...embeddedExpansion.valueFlows],
    gaps,
    summary: createSummary(dataFlow.blocks, countDirectCallsites(combinedCallsites))
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
  const jsxLogic = hasTypeScriptJsxLogic(expression);
  const valueChanges = collectTypeScriptExpressionValueChanges(sourceFile, expression);
  return {
    id: createBlockId(
      node.filePath,
      "return",
      range,
      jsxLogic ? "return JSX output" : expressionText
    ),
    kind: "return",
    label: jsxLogic
      ? "return JSX output"
      : `return ${completeSourceText(expressionText, "expression")}`,
    detail: jsxLogic
      ? "Returns the JSX output assembled by the preceding render steps."
      : "Concise arrow body implicitly returns this expression.",
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
  callsites: FunctionLogicAnalysis["callsites"],
  maxBlocks: number
): FunctionLogicAnalysis {
  const jsxExpression = !ts.isBlock(functionNode.body)
    && hasTypeScriptJsxLogic(functionNode.body)
    ? functionNode.body
    : undefined;
  const expressionTarget = !ts.isBlock(functionNode.body) && !jsxExpression
    ? readTypeScriptExpressionBodyFlowTarget(functionNode.body)
    : undefined;
  const baseEdges = [
    createFunctionLogicEdge(entry.id, expression.id, "next", undefined, "exact"),
    createFunctionLogicEdge(expression.id, exit.id, "return", "return", "exact")
  ];
  const expressionExpansion = expandTypeScriptExpressionFlows({
    sourceFile,
    filePath: graphNode.filePath,
    blocks: [entry, expression, exit],
    edges: baseEdges,
    requests: expressionTarget
      ? [{ anchorBlockId: expression.id, ...expressionTarget }]
      : [],
    remainingBlockBudget: Math.max(0, maxBlocks - 1)
  });
  if (expressionExpansion.omittedRegionCount > 0) {
    gaps.push(createExpressionLimitGap(expressionExpansion.omittedRegionCount, maxBlocks));
  }
  const expansion = expandTypeScriptJsxValueFlows({
    sourceFile,
    filePath: graphNode.filePath,
    blocks: expressionExpansion.blocks,
    edges: expressionExpansion.edges,
    requests: jsxExpression
      ? [createTypeScriptJsxValueFlowRequest(expression.id, jsxExpression)]
      : [],
    remainingBlockBudget: Math.max(
      0,
      maxBlocks - 1 - expressionExpansion.addedBlockCount
    )
  });
  if (expansion.omittedBlockCount > 0) {
    gaps.push(createJsxLimitGap(expansion.omittedBlockCount, maxBlocks));
  }
  const embeddedDiscovery = discoverTypeScriptEmbeddedCode({
    sourceFile,
    scriptKind: getScriptKind(graphNode.filePath, graphNode.language),
    anchorBlockId: expression.id,
    root: functionNode.body
  });
  const embeddedExpansion = expandTypeScriptEmbeddedCode({
    sourceFile,
    scriptKind: getScriptKind(graphNode.filePath, graphNode.language),
    filePath: graphNode.filePath,
    blocks: expansion.blocks,
    edges: expansion.edges,
    requests: embeddedDiscovery.requests,
    dynamicConsumerCount: embeddedDiscovery.dynamicConsumerCount,
    remainingBlockBudget: Math.max(
      0,
      maxBlocks - Math.max(0, expansion.blocks.length - 2)
    )
  });
  gaps.push(...embeddedExpansion.gaps);
  const dataFlow = createTypeScriptDataFlow(
    sourceFile,
    functionNode,
    embeddedExpansion.blocks,
    embeddedExpansion.edges,
    gaps
  );
  const combinedCallsites = [...callsites, ...embeddedExpansion.callsites];
  return {
    functionNode: graphNode,
    language: getSupportedLanguage(graphNode),
    signature: createFunctionSignature(sourceFile, functionNode),
    blocks: dataFlow.blocks,
    edges: embeddedExpansion.edges,
    callsites: combinedCallsites,
    valueBindings: [...dataFlow.valueBindings, ...embeddedExpansion.valueBindings],
    valueFlows: [...dataFlow.valueFlows, ...embeddedExpansion.valueFlows],
    gaps,
    summary: createSummary(dataFlow.blocks, countDirectCallsites(combinedCallsites))
  };
}

/** Adds lexical binding uses and bounded reaching-definition links to the CFG. */
function createTypeScriptDataFlow(
  sourceFile: ts.SourceFile,
  functionNode: FunctionLikeWithBody,
  blocks: FunctionLogicBlock[],
  edges: FunctionLogicEdge[],
  gaps: FunctionLogicGap[]
): FunctionLogicDataFlowProjection {
  const projection = createFunctionLogicDataFlowProjection(
    blocks,
    edges,
    collectTypeScriptFunctionValueFacts(sourceFile, functionNode)
  );
  const omittedCount = projection.omittedFactCount + projection.omittedFlowCount;
  if (omittedCount > 0) {
    gaps.push({
      code: "parseLimited",
      message: `${omittedCount} additional value-flow fact(s) were omitted after the bounded data-flow limit.`
    });
  }
  return projection;
}

/** Reports shared statement/render truncation without implying an exact total. */
function createJsxLimitGap(omittedBlockCount: number, maxBlocks: number): FunctionLogicGap {
  return {
    code: "parseLimited",
    message: `${omittedBlockCount} additional JSX render region(s) were omitted after the shared ${maxBlocks}-block reading limit.`
  };
}

/** Reports whole omitted expression regions rather than emitting partial branches. */
function createExpressionLimitGap(
  omittedRegionCount: number,
  maxBlocks: number
): FunctionLogicGap {
  return {
    code: "parseLimited",
    message: `${omittedRegionCount} ternary/short-circuit expression region(s) were omitted after the shared ${maxBlocks}-block reading limit.`
  };
}

/** Counts only immediate calls; render and event-handler relations are separate. */
function countDirectCallsites(callsites: FunctionLogicAnalysis["callsites"]): number {
  return callsites.filter((callsite) =>
    callsite.relation === undefined || callsite.relation === "call"
  ).length;
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
      message: "Optional chaining and branch expressions embedded inside a larger call argument or non-branch operation stay inside their containing statement. Ternaries nested beneath a selected outer ternary are expanded."
    },
    {
      code: "dynamicBehavior",
      message: "Exceptions, component scheduling, event dispatch, dynamic calls, runtime-built code text, and runtime data values are not observed. Statically complete code literals are parsed without execution."
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
