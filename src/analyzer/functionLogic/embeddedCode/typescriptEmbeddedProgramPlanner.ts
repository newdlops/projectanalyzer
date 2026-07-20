/**
 * Bounded TypeScript/JavaScript program planner for static code text. It parses
 * a synthetic callable scope, builds root and nested callable CFGs iteratively,
 * and remaps every evidence location back to the owning host literal.
 */

import * as ts from "typescript";
import { createContentHash } from "../../../shared/hash";
import {
  createStructuredControlEdges,
  type ControlRecord,
  type InternalBlock,
  type LogicContainer
} from "../core/structuredControlFlow";
import { createFunctionLogicEdge } from "../core/functionLogicSupport";
import {
  collectTypeScriptFunctionValueFacts,
  createFunctionLogicDataFlowProjection
} from "../dataFlow";
import {
  expandTypeScriptExpressionFlows,
  readTypeScriptExpressionBodyFlowTarget,
  readTypeScriptStatementExpressionFlowTarget,
  type TypeScriptExpressionFlowRequest
} from "../expressions";
import {
  createTypeScriptJsxValueFlowRequest,
  expandTypeScriptJsxValueFlows,
  hasTypeScriptJsxLogic,
  planTypeScriptJsxStatementValueFlow,
  type TypeScriptJsxValueFlowRequest
} from "../jsx";
import type {
  FunctionLogicBlock,
  FunctionLogicCallsite,
  FunctionLogicEdge,
  FunctionLogicValueBinding,
  FunctionLogicValueFlow
} from "../types";
import { scheduleControlChildren } from "../typescriptFunctionLogicControlFlow";
import type { PendingStatement } from "../typescriptFunctionLogicInternal";
import {
  classifyStatement,
  collectFunctionCallsites
} from "../typescriptFunctionLogicSyntax";
import type { TypeScriptEmbeddedCodeRequest } from "./types";
import {
  appendEmbeddedVisibleBlock,
  collectEmbeddedStatementCallables,
  combineEmbeddedConfidence,
  countEmbeddedFunctionDefinitions,
  createAdditionalEmbeddedCallableBlock,
  createEmbeddedExpressionReturnBlock,
  createEmbeddedScopeExitBlock,
  createEmptyEmbeddedScopeBuild,
  decorateEmbeddedBlock,
  embeddedCallableDisplayName,
  embeddedCallableOwnsWholeStatement,
  findEmbeddedCallsiteBlockId,
  mergeEmbeddedBlock,
  mergeEmbeddedValueAccesses,
  pushEmbeddedStatements,
  specializeEmbeddedCallableBlock,
  specializeEmbeddedScopeEntryEdge,
  type DiscoveredEmbeddedCallable,
  type EmbeddedScopeBuildResult,
  type PendingEmbeddedScope
} from "./typescriptEmbeddedProgramSupport";

/** Internal planned region returned to the host CFG expansion module. */
export type TypeScriptEmbeddedProgramPlan = {
  blocks: FunctionLogicBlock[];
  edges: FunctionLogicEdge[];
  callsites: FunctionLogicCallsite[];
  valueBindings: FunctionLogicValueBinding[];
  valueFlows: FunctionLogicValueFlow[];
  functionCount: number;
  parseDiagnosticCount: number;
  omittedBlockCount: number;
};

/** Parses and plans one request without evaluating, importing, or type-checking it. */
export function planTypeScriptEmbeddedProgram(input: {
  hostFilePath: string;
  scriptKind: ts.ScriptKind;
  request: TypeScriptEmbeddedCodeRequest;
  boundaryBlock: FunctionLogicBlock;
  maxBlocks: number;
}): TypeScriptEmbeddedProgramPlan {
  const syntheticPath = createSyntheticPath(input.hostFilePath, input.request, input.scriptKind);
  const wrapperName = `__project_analyzer_embedded_${createContentHash(syntheticPath).slice(0, 12)}`;
  const prefix = `async function ${wrapperName}(${input.request.parameterSource ?? ""}) {\n`;
  const sourceFile = ts.createSourceFile(
    syntheticPath,
    `${prefix}${input.request.code}\n}`,
    ts.ScriptTarget.Latest,
    true,
    input.scriptKind
  );
  const parseDiagnosticCount = readParseDiagnosticCount(sourceFile);
  const rootFunction = sourceFile.statements.find((statement): statement is ts.FunctionDeclaration & {
    body: ts.Block;
  } => ts.isFunctionDeclaration(statement)
    && statement.name?.text === wrapperName
    && statement.body !== undefined);
  const functionCount = rootFunction
    ? countEmbeddedFunctionDefinitions(rootFunction.body)
    : 0;
  if (!rootFunction) {
    return {
      blocks: [input.boundaryBlock],
      edges: [],
      callsites: [],
      valueBindings: [],
      valueFlows: [],
      functionCount,
      parseDiagnosticCount: Math.max(1, parseDiagnosticCount),
      omittedBlockCount: 0
    };
  }

  const blocksById = new Map<string, FunctionLogicBlock>([[
    input.boundaryBlock.id,
    input.boundaryBlock
  ]]);
  const blockOrder = [input.boundaryBlock.id];
  const edges: FunctionLogicEdge[] = [];
  const callsites: FunctionLogicCallsite[] = [];
  const valueBindings: FunctionLogicValueBinding[] = [];
  const valueFlows: FunctionLogicValueFlow[] = [];
  const pendingScopes: PendingEmbeddedScope[] = [{
    node: rootFunction,
    ownerBlockId: input.boundaryBlock.id,
    relationship: "root",
    label: "embedded program"
  }];
  let remainingBlocks = Math.max(0, Math.floor(input.maxBlocks) - 1);
  let omittedBlockCount = 0;
  let scopeCursor = 0;

  while (scopeCursor < pendingScopes.length) {
    const scope = pendingScopes[scopeCursor];
    scopeCursor += 1;
    const ownerBlock = blocksById.get(scope.ownerBlockId);
    if (!ownerBlock || remainingBlocks <= 0) {
      omittedBlockCount += 1;
      continue;
    }
    const built = buildEmbeddedScope({
      sourceFile,
      syntheticPath,
      scope,
      ownerBlock,
      maxNewBlocks: remainingBlocks
    });
    mergeEmbeddedBlock(blocksById, built.ownerBlock);
    for (const block of built.newBlocks) {
      if (!blocksById.has(block.id)) blockOrder.push(block.id);
      mergeEmbeddedBlock(blocksById, block);
    }
    edges.push(...built.edges);
    callsites.push(...built.callsites);
    valueBindings.push(...built.valueBindings);
    valueFlows.push(...built.valueFlows);
    pendingScopes.push(...built.nestedScopes);
    remainingBlocks = Math.max(0, remainingBlocks - built.newBlocks.length);
    omittedBlockCount += built.omittedBlockCount;
  }

  const confidence = input.request.confidence;
  const decoratedBlocks = blockOrder.flatMap((blockId) => {
    const block = blocksById.get(blockId);
    return block ? [decorateEmbeddedBlock(
      block,
      input.boundaryBlock.id,
      input.hostFilePath,
      input.request.range,
      confidence
    )] : [];
  });
  return {
    blocks: decoratedBlocks,
    edges: deduplicateEdges(edges.map((edge) => createFunctionLogicEdge(
      edge.sourceId,
      edge.targetId,
      edge.kind,
      edge.label,
      combineEmbeddedConfidence(edge.confidence, confidence)
    ))),
    callsites: callsites.map((callsite) => ({
      ...callsite,
      filePath: input.hostFilePath,
      range: input.request.range,
      confidence: combineEmbeddedConfidence(callsite.confidence ?? "exact", confidence)
    })),
    valueBindings: deduplicateBindings(valueBindings).map((binding) => ({
      ...binding,
      confidence: combineEmbeddedConfidence(binding.confidence, confidence)
    })),
    valueFlows: deduplicateValueFlows(valueFlows).map((flow) => ({
      ...flow,
      confidence: combineEmbeddedConfidence(flow.confidence, confidence)
    })),
    functionCount,
    parseDiagnosticCount,
    omittedBlockCount
  };
}

/** Builds one program/function scope and queues its nested callable bodies. */
function buildEmbeddedScope(input: {
  sourceFile: ts.SourceFile;
  syntheticPath: string;
  scope: PendingEmbeddedScope;
  ownerBlock: FunctionLogicBlock;
  maxNewBlocks: number;
}): EmbeddedScopeBuildResult {
  if (!ts.isBlock(input.scope.node.body)) {
    return buildEmbeddedExpressionScope(input);
  }
  const rootContainerId = `${input.ownerBlock.id}:embedded-scope:${input.scope.node.pos}`;
  const containers = new Map<string, LogicContainer>([[rootContainerId, {
    id: rootContainerId,
    role: "root",
    ownerBlockId: input.ownerBlock.id
  }]]);
  const directBlockIdsByContainer = new Map<string, string[]>();
  const blocksById = new Map<string, InternalBlock>();
  const controlsByBlockId = new Map<string, ControlRecord>();
  const visibleBlocks: InternalBlock[] = [];
  const expressionRequests: TypeScriptExpressionFlowRequest[] = [];
  const jsxRequests: TypeScriptJsxValueFlowRequest[] = [];
  const discoveredCallables: DiscoveredEmbeddedCallable[] = [];
  const pending: PendingStatement[] = [];
  pushEmbeddedStatements(
    pending,
    input.scope.node.body.statements,
    rootContainerId,
    input.ownerBlock.depth + 1
  );
  const statementBudget = Math.max(0, input.maxNewBlocks - 1);
  let omittedBlockCount = 0;

  while (pending.length > 0) {
    const task = pending.pop();
    if (!task) continue;
    if (visibleBlocks.length >= statementBudget) {
      omittedBlockCount += 1;
      continue;
    }
    if (ts.isBlock(task.node)) {
      pushEmbeddedStatements(
        pending,
        task.node.statements,
        task.containerId,
        task.depth,
        task.branchLabel
      );
      continue;
    }

    const classified = classifyStatement(input.sourceFile, input.syntheticPath, task);
    const definitions = collectEmbeddedStatementCallables(task.node, input.sourceFile);
    const primary = definitions.find((definition) =>
      embeddedCallableOwnsWholeStatement(task.node, definition)
    );
    const jsxPlan = primary
      ? {
          block: specializeEmbeddedCallableBlock(
            input.sourceFile,
            input.syntheticPath,
            classified,
            primary
          )
        }
      : planTypeScriptJsxStatementValueFlow(
          input.sourceFile,
          input.syntheticPath,
          task.node,
          classified
        );
    const block: InternalBlock = {
      ...jsxPlan.block,
      parentBlockId: containers.get(task.containerId)?.ownerBlockId,
      containerId: task.containerId
    };
    appendEmbeddedVisibleBlock(
      visibleBlocks,
      blocksById,
      directBlockIdsByContainer,
      block
    );
    if (primary) {
      discoveredCallables.push({
        node: primary,
        ownerBlockId: block.id,
        label: embeddedCallableDisplayName(primary, input.sourceFile)
      });
    } else {
      if (jsxPlan.request) jsxRequests.push(jsxPlan.request);
      const expressionTarget = !jsxPlan.request && block.kind !== "event"
        ? readTypeScriptStatementExpressionFlowTarget(task.node)
        : undefined;
      if (expressionTarget && !hasTypeScriptJsxLogic(expressionTarget.expression)) {
        expressionRequests.push({ anchorBlockId: block.id, ...expressionTarget });
      }
    }
    scheduleControlChildren(
      input.sourceFile,
      task,
      block,
      pending,
      containers,
      controlsByBlockId
    );

    for (const definition of definitions) {
      if (definition === primary) continue;
      if (visibleBlocks.length >= statementBudget) {
        omittedBlockCount += 1;
        continue;
      }
      const callable = createAdditionalEmbeddedCallableBlock(
        input.sourceFile,
        input.syntheticPath,
        definition,
        block,
        task
      );
      appendEmbeddedVisibleBlock(
        visibleBlocks,
        blocksById,
        directBlockIdsByContainer,
        callable
      );
      discoveredCallables.push({
        node: definition,
        ownerBlockId: callable.id,
        label: embeddedCallableDisplayName(definition, input.sourceFile)
      });
    }
  }

  const exitBlock = createEmbeddedScopeExitBlock(
    input.sourceFile,
    input.syntheticPath,
    input.scope,
    input.ownerBlock
  );
  let edges = createStructuredControlEdges({
    entryBlock: input.ownerBlock,
    exitBlock,
    visibleBlocks,
    blocksById,
    containers,
    controlsByBlockId,
    directBlockIdsByContainer,
    rootContainerId
  });
  edges = specializeEmbeddedScopeEntryEdge(edges, input.scope, input.ownerBlock.id);
  const expressionExpansion = expandTypeScriptExpressionFlows({
    sourceFile: input.sourceFile,
    filePath: input.syntheticPath,
    blocks: [input.ownerBlock, ...visibleBlocks, exitBlock],
    edges,
    requests: expressionRequests,
    remainingBlockBudget: Math.max(
      0,
      input.maxNewBlocks - 1 - visibleBlocks.length
    )
  });
  omittedBlockCount += expressionExpansion.omittedRegionCount;
  const jsxExpansion = expandTypeScriptJsxValueFlows({
    sourceFile: input.sourceFile,
    filePath: input.syntheticPath,
    blocks: expressionExpansion.blocks,
    edges: expressionExpansion.edges,
    requests: jsxRequests,
    remainingBlockBudget: Math.max(
      0,
      input.maxNewBlocks - 1 - visibleBlocks.length
        - expressionExpansion.addedBlockCount
    )
  });
  omittedBlockCount += jsxExpansion.omittedBlockCount;
  return finalizeScopeBuild(
    input,
    jsxExpansion.blocks,
    jsxExpansion.edges,
    discoveredCallables,
    omittedBlockCount
  );
}

/** Handles a concise arrow body as one return scope with optional expression flow. */
function buildEmbeddedExpressionScope(input: {
  sourceFile: ts.SourceFile;
  syntheticPath: string;
  scope: PendingEmbeddedScope;
  ownerBlock: FunctionLogicBlock;
  maxNewBlocks: number;
}): EmbeddedScopeBuildResult {
  const expression = input.scope.node.body;
  if (input.maxNewBlocks < 2 || ts.isBlock(expression)) {
    return createEmptyEmbeddedScopeBuild(
      input.ownerBlock,
      input.maxNewBlocks < 2 ? 1 : 0
    );
  }
  const expressionBlock = createEmbeddedExpressionReturnBlock(
    input.sourceFile,
    input.syntheticPath,
    expression,
    input.ownerBlock
  );
  const exitBlock = createEmbeddedScopeExitBlock(
    input.sourceFile,
    input.syntheticPath,
    input.scope,
    input.ownerBlock
  );
  const expressionTarget = !hasTypeScriptJsxLogic(expression)
    ? readTypeScriptExpressionBodyFlowTarget(expression)
    : undefined;
  const baseEdges = [
    createFunctionLogicEdge(
      input.ownerBlock.id,
      expressionBlock.id,
      "defines",
      "callable body · not invoked",
      "exact"
    ),
    createFunctionLogicEdge(expressionBlock.id, exitBlock.id, "return", "return", "exact")
  ];
  const expressionExpansion = expandTypeScriptExpressionFlows({
    sourceFile: input.sourceFile,
    filePath: input.syntheticPath,
    blocks: [input.ownerBlock, expressionBlock, exitBlock],
    edges: baseEdges,
    requests: expressionTarget
      ? [{ anchorBlockId: expressionBlock.id, ...expressionTarget }]
      : [],
    remainingBlockBudget: Math.max(0, input.maxNewBlocks - 2)
  });
  const jsxExpansion = expandTypeScriptJsxValueFlows({
    sourceFile: input.sourceFile,
    filePath: input.syntheticPath,
    blocks: expressionExpansion.blocks,
    edges: expressionExpansion.edges,
    requests: hasTypeScriptJsxLogic(expression)
      ? [createTypeScriptJsxValueFlowRequest(expressionBlock.id, expression)]
      : [],
    remainingBlockBudget: Math.max(
      0,
      input.maxNewBlocks - 2 - expressionExpansion.addedBlockCount
    )
  });
  return finalizeScopeBuild(
    input,
    jsxExpansion.blocks,
    jsxExpansion.edges,
    [],
    expressionExpansion.omittedRegionCount + jsxExpansion.omittedBlockCount
  );
}

/** Adds lexical facts, callsite ownership, and nested-scope work records. */
function finalizeScopeBuild(
  input: {
    sourceFile: ts.SourceFile;
    syntheticPath: string;
    scope: PendingEmbeddedScope;
    ownerBlock: FunctionLogicBlock;
  },
  blocks: FunctionLogicBlock[],
  edges: FunctionLogicEdge[],
  discoveredCallables: DiscoveredEmbeddedCallable[],
  omittedBlockCount: number
): EmbeddedScopeBuildResult {
  const dataFlow = createFunctionLogicDataFlowProjection(
    blocks,
    edges,
    collectTypeScriptFunctionValueFacts(input.sourceFile, input.scope.node)
  );
  const owner = dataFlow.blocks.find((block) => block.id === input.ownerBlock.id)
    ?? input.ownerBlock;
  const mergedOwner = mergeEmbeddedValueAccesses(input.ownerBlock, owner);
  const callsites = collectFunctionCallsites(
    input.sourceFile,
    input.syntheticPath,
    input.scope.node
  ).map((callsite) => ({
    ...callsite,
    blockId: findEmbeddedCallsiteBlockId(dataFlow.blocks, callsite.range)
  }));
  return {
    ownerBlock: mergedOwner,
    newBlocks: dataFlow.blocks.filter((block) => block.id !== input.ownerBlock.id),
    edges,
    callsites,
    valueBindings: dataFlow.valueBindings,
    valueFlows: dataFlow.valueFlows,
    nestedScopes: discoveredCallables.map((callable) => ({
      node: callable.node,
      ownerBlockId: callable.ownerBlockId,
      relationship: "definition",
      label: callable.label
    })),
    omittedBlockCount: omittedBlockCount
      + dataFlow.omittedFactCount
      + dataFlow.omittedFlowCount
  };
}

/** Builds a unique virtual filename so block/binding identities cannot collide. */
function createSyntheticPath(
  hostFilePath: string,
  request: TypeScriptEmbeddedCodeRequest,
  scriptKind: ts.ScriptKind
): string {
  const extension = scriptKind === ts.ScriptKind.TSX ? "tsx"
    : scriptKind === ts.ScriptKind.JSX ? "jsx"
      : scriptKind === ts.ScriptKind.JS ? "js" : "ts";
  const key = [
    hostFilePath,
    request.range.startLine,
    request.range.startCharacter,
    request.mode,
    request.consumer,
    request.code
  ].join("\0");
  return `${hostFilePath}.embedded-${createContentHash(key).slice(0, 16)}.${extension}`;
}

/** SourceFile parser diagnostics are retained as limits instead of thrown errors. */
function readParseDiagnosticCount(sourceFile: ts.SourceFile): number {
  return (sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] })
    .parseDiagnostics?.length ?? 0;
}

/** Keeps one edge record after scope and expression rewrites. */
function deduplicateEdges(edges: readonly FunctionLogicEdge[]): FunctionLogicEdge[] {
  const seen = new Set<string>();
  return edges.filter((edge) => {
    if (seen.has(edge.id)) return false;
    seen.add(edge.id);
    return true;
  });
}

/** Keeps each virtual lexical binding once across owner/body scope projections. */
function deduplicateBindings(
  bindings: readonly FunctionLogicValueBinding[]
): FunctionLogicValueBinding[] {
  const seen = new Set<string>();
  return bindings.filter((binding) => {
    if (seen.has(binding.id)) return false;
    seen.add(binding.id);
    return true;
  });
}

/** Keeps each virtual reaching-definition relationship once. */
function deduplicateValueFlows(
  flows: readonly FunctionLogicValueFlow[]
): FunctionLogicValueFlow[] {
  const seen = new Set<string>();
  return flows.filter((flow) => {
    if (seen.has(flow.id)) return false;
    seen.add(flow.id);
    return true;
  });
}
