/**
 * Shared bounded Function Logic orchestration for Lezer-backed languages.
 * Python and Java adapters provide syntax classification while this module
 * iteratively schedules containers and delegates CFG construction to core.
 */

import type { SyntaxNode } from "@lezer/common";
import type { SourceRange, SymbolNode } from "../../../shared/types";
import type {
  FunctionLogicAnalysis,
  FunctionLogicAnalysisInput,
  FunctionLogicBlock,
  FunctionLogicCallsite,
  FunctionLogicConfidence,
  FunctionLogicEdgeKind,
  FunctionLogicGap,
  FunctionLogicLanguage
} from "../types";
import {
  appendDirectBlock,
  createStructuredControlEdges,
  type ContainerRole,
  type ControlBranch,
  type ControlRecord,
  type InternalBlock,
  type LogicContainer
} from "./structuredControlFlow";
import {
  createFunctionLogicEndRange,
  createFunctionLogicSummary,
  createSyntheticFunctionLogicBlock,
  createUnavailableFunctionLogicAnalysis,
  normalizeFunctionLogicMaxBlocks
} from "./functionLogicSupport";
import type { LezerSource } from "../../core/lezerSource";
import { hasLezerError } from "../../core/lezerSource";

/** Selected callable and its executable body in one parsed source snapshot. */
export type LezerCallableDescriptor = {
  node: SyntaxNode;
  body: SyntaxNode;
  signature: string;
  bodyRange: SourceRange;
  expressionBody?: boolean;
  lexicalOwnerQualifiedName?: string;
};

/** Iterative work item for one direct source statement. */
export type LezerStatementTask = {
  node: SyntaxNode;
  containerId: string;
  depth: number;
  branchLabel?: string;
  implicitReturn?: boolean;
  /** Opaque language-owned metadata for syntax-backed synthetic flow steps. */
  adapterData?: unknown;
};

/** Syntax node plus optional language metadata before a container is assigned. */
export type LezerStatementSeed = {
  taskSeed: true;
  node: SyntaxNode;
  implicitReturn?: boolean;
  adapterData?: unknown;
};

/** Raw parser statements and adapter-created flow steps share one scheduler. */
export type LezerStatementInput = SyntaxNode | LezerStatementSeed;

/** One adapter-described branch scheduled under a control block. */
export type LezerControlBranchDescription = {
  role: ContainerRole;
  edgeKind: FunctionLogicEdgeKind;
  label?: string;
  statements: LezerStatementInput[];
};

/** Complete structured branching metadata for one syntax statement. */
export type LezerControlDescription = {
  kind: ControlRecord["kind"];
  branches: LezerControlBranchDescription[];
  confidence?: FunctionLogicConfidence;
  hasDefaultBranch?: boolean;
};

/** Language contract consumed by the shared Lezer Function Logic pipeline. */
export type LezerFunctionLogicAdapter = {
  language: Exclude<FunctionLogicLanguage, "typescript" | "javascript" | "unsupported">;
  findSelectedCallable(
    source: LezerSource,
    graphNode: SymbolNode
  ): LezerCallableDescriptor | undefined;
  getRootStatements(
    source: LezerSource,
    callable: LezerCallableDescriptor
  ): LezerStatementInput[];
  classifyStatement(
    source: LezerSource,
    filePath: string,
    task: LezerStatementTask
  ): FunctionLogicBlock;
  describeControl(
    source: LezerSource,
    node: SyntaxNode,
    task: LezerStatementTask
  ): LezerControlDescription | undefined;
  collectCallsites(
    source: LezerSource,
    filePath: string,
    callable: LezerCallableDescriptor
  ): FunctionLogicCallsite[];
  createDefaultGaps(): FunctionLogicGap[];
};

/** Builds one language-adapted Function Logic analysis from a parsed snapshot. */
export function analyzeLezerFunctionLogic(
  input: FunctionLogicAnalysisInput,
  source: LezerSource | undefined,
  adapter: LezerFunctionLogicAdapter
): FunctionLogicAnalysis {
  if (!source) {
    return createUnavailableFunctionLogicAnalysis(
      input.functionNode,
      adapter.language,
      "sourceUnavailable",
      "The selected function source could not be read from the current workspace."
    );
  }
  const callable = adapter.findSelectedCallable(source, input.functionNode);
  if (!callable) {
    return createUnavailableFunctionLogicAnalysis(
      input.functionNode,
      adapter.language,
      "functionNotFound",
      "The analyzed symbol could not be matched to a callable body in the current source. Reanalyze after source changes."
    );
  }
  return buildLezerFunctionLogic(
    input.functionNode,
    source,
    callable,
    adapter,
    normalizeFunctionLogicMaxBlocks(input.maxBlocks)
  );
}

/** Classifies visible statements and builds their shared structured CFG. */
function buildLezerFunctionLogic(
  graphNode: SymbolNode,
  source: LezerSource,
  callable: LezerCallableDescriptor,
  adapter: LezerFunctionLogicAdapter,
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
  const gaps = adapter.createDefaultGaps();
  const callsites = adapter.collectCallsites(source, graphNode.filePath, callable);
  const entryBlock = createSyntheticFunctionLogicBlock(
    graphNode,
    "entry",
    `Enter ${graphNode.name || "function"}`,
    "Function arguments and captured values are available here.",
    graphNode.selectionRange
  );
  const exitBlock = createSyntheticFunctionLogicBlock(
    graphNode,
    "exit",
    `Exit ${graphNode.name || "function"}`,
    "All non-throwing paths that do not return earlier finish here.",
    createFunctionLogicEndRange(callable.bodyRange)
  );
  const pending: LezerStatementTask[] = [];
  const rootStatements = adapter.getRootStatements(source, callable);
  pushLezerStatements(
    pending,
    rootStatements,
    rootContainerId,
    1,
    undefined,
    callable.expressionBody === true
  );
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
    const classified = adapter.classifyStatement(source, graphNode.filePath, task);
    const block: InternalBlock = {
      ...classified,
      parentBlockId: containers.get(task.containerId)?.ownerBlockId,
      containerId: task.containerId
    };
    visibleBlocks.push(block);
    blocksById.set(block.id, block);
    appendDirectBlock(directBlockIdsByContainer, task.containerId, block.id);
    const control = adapter.describeControl(source, task.node, task);
    if (control) {
      scheduleLezerControlChildren(
        task,
        block,
        control,
        pending,
        containers,
        controlsByBlockId
      );
    }
  }

  if (omittedBlockCount > 0) {
    gaps.push({
      code: "parseLimited",
      message: `${omittedBlockCount} additional statement(s) were omitted after the ${maxBlocks}-block reading limit.`
    });
  }
  if (hasLezerError(callable.node)) {
    gaps.push({
      code: "parseLimited",
      message: "The parser recovered from incomplete or unsupported syntax inside this callable; verify nearby blocks in source."
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
    language: adapter.language,
    signature: callable.signature,
    lexicalOwnerQualifiedName: callable.lexicalOwnerQualifiedName || undefined,
    blocks,
    edges,
    callsites,
    gaps,
    summary: createFunctionLogicSummary(blocks, callsites.length)
  };
}

/** Creates child containers and schedules branch statements without recursion. */
function scheduleLezerControlChildren(
  task: LezerStatementTask,
  block: InternalBlock,
  description: LezerControlDescription,
  pending: LezerStatementTask[],
  containers: Map<string, LogicContainer>,
  controlsByBlockId: Map<string, ControlRecord>
): void {
  const controlBranches: ControlBranch[] = [];
  const childTasks: LezerStatementTask[] = [];
  let finallyContainerId: string | undefined;

  for (let index = 0; index < description.branches.length; index += 1) {
    const branch = description.branches[index];
    const containerId = `${block.id}:container:${branch.role}:${index}`;
    containers.set(containerId, {
      id: containerId,
      role: branch.role,
      ownerBlockId: block.id,
      parentContainerId: task.containerId,
      label: branch.label
    });
    if (branch.role === "finally") {
      finallyContainerId = containerId;
    }
    controlBranches.push({
      containerId,
      edgeKind: branch.edgeKind,
      label: branch.label
    });
    for (const statement of branch.statements) {
      const seed = normalizeLezerStatementInput(statement);
      childTasks.push({
        node: seed.node,
        containerId,
        depth: task.depth + 1,
        branchLabel: branch.label,
        implicitReturn: seed.implicitReturn,
        adapterData: seed.adapterData
      });
    }
  }

  for (let index = childTasks.length - 1; index >= 0; index -= 1) {
    pending.push(childTasks[index]);
  }
  controlsByBlockId.set(block.id, {
    kind: description.kind,
    branches: controlBranches,
    confidence: description.confidence,
    hasDefaultBranch: description.hasDefaultBranch,
    finallyContainerId
  });
}

/** Schedules source-ordered statements on the shared LIFO work stack. */
function pushLezerStatements(
  pending: LezerStatementTask[],
  statements: readonly LezerStatementInput[],
  containerId: string,
  depth: number,
  branchLabel?: string,
  implicitReturn = false
): void {
  for (let index = statements.length - 1; index >= 0; index -= 1) {
    const seed = normalizeLezerStatementInput(statements[index]);
    pending.push({
      node: seed.node,
      containerId,
      depth,
      branchLabel,
      // An expression-bodied callable can be expanded into preparatory steps;
      // only its final seed performs the implicit return.
      implicitReturn: seed.implicitReturn
        ?? (implicitReturn && index === statements.length - 1),
      adapterData: seed.adapterData
    });
  }
}

/** Normalizes parser nodes and adapter seeds without leaking language details. */
function normalizeLezerStatementInput(
  input: LezerStatementInput
): LezerStatementSeed {
  return isLezerStatementSeed(input)
    ? input
    : { taskSeed: true, node: input };
}

/** Uses an explicit marker because Lezer nodes expose their own `node` getter. */
function isLezerStatementSeed(input: LezerStatementInput): input is LezerStatementSeed {
  return (input as { taskSeed?: unknown }).taskSeed === true;
}
