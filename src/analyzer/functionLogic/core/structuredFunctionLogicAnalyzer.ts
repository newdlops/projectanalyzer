/**
 * Parser-independent bounded Function Logic orchestration. Syntax adapters
 * provide statement/control facts; this module schedules containers, builds
 * shared CFG edges and projects lexical values without owning parser lifetimes.
 */

import type { FunctionLogicEdgePresentationKey, PresentationParams } from "../../../localization/presentationDescriptors";
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
import {
  createFunctionLogicDataFlowProjection,
  type FunctionLogicValueFacts
} from "../dataFlow";

/** Selected callable and its executable body in one parsed source snapshot. */
export type StructuredCallableDescriptor<TNode> = {
  node: TNode;
  body: TNode;
  signature: string;
  /** Parser-owned declaration and body extent; never inferred from neighboring symbols. */
  sourceRange: SourceRange;
  bodyRange: SourceRange;
  expressionBody?: boolean;
  lexicalOwnerQualifiedName?: string;
};

/** Iterative work item for one direct source statement. */
export type StructuredStatementTask<TNode> = {
  node: TNode;
  containerId: string;
  depth: number;
  branchLabel?: string;
  branchPresentation?: { key: FunctionLogicEdgePresentationKey; params?: PresentationParams };
  implicitReturn?: boolean;
  /** Opaque language-owned metadata for syntax-backed synthetic flow steps. */
  adapterData?: unknown;
};

/** Syntax node plus optional language metadata before a container is assigned. */
export type StructuredStatementSeed<TNode> = {
  taskSeed: true;
  node: TNode;
  implicitReturn?: boolean;
  adapterData?: unknown;
};

/** Raw parser statements and adapter-created flow steps share one scheduler. */
export type StructuredStatementInput<TNode> = TNode | StructuredStatementSeed<TNode>;

/** One adapter-described branch scheduled under a control block. */
export type StructuredControlBranchDescription<TNode> = {
  role: ContainerRole;
  edgeKind: FunctionLogicEdgeKind;
  label?: string;
  presentation?: { key: FunctionLogicEdgePresentationKey; params?: PresentationParams };
  statements: StructuredStatementInput<TNode>[];
};

/** Complete structured branching metadata for one syntax statement. */
export type StructuredControlDescription<TNode> = {
  kind: ControlRecord["kind"];
  branches: StructuredControlBranchDescription<TNode>[];
  confidence?: FunctionLogicConfidence;
  hasDefaultBranch?: boolean;
};

/** Language contract consumed by the shared Structured Function Logic pipeline. */
export type StructuredFunctionLogicAdapter<TSource, TNode> = {
  language: Exclude<FunctionLogicLanguage, "typescript" | "javascript" | "unsupported">;
  findSelectedCallable(
    source: TSource,
    graphNode: SymbolNode
  ): StructuredCallableDescriptor<TNode> | undefined;
  getRootStatements(
    source: TSource,
    callable: StructuredCallableDescriptor<TNode>
  ): StructuredStatementInput<TNode>[];
  classifyStatement(
    source: TSource,
    filePath: string,
    task: StructuredStatementTask<TNode>
  ): FunctionLogicBlock;
  describeControl(
    source: TSource,
    node: TNode,
    task: StructuredStatementTask<TNode>
  ): StructuredControlDescription<TNode> | undefined;
  collectCallsites(
    source: TSource,
    filePath: string,
    callable: StructuredCallableDescriptor<TNode>
  ): FunctionLogicCallsite[];
  collectValueFacts?(
    source: TSource,
    callable: StructuredCallableDescriptor<TNode>
  ): FunctionLogicValueFacts;
  /** Reports syntax recovery in the selected callable without exposing parser internals. */
  hasParseError?(source: TSource, node: TNode): boolean;
  createDefaultGaps(): FunctionLogicGap[];
};

/** Builds one language-adapted Function Logic analysis from a parsed snapshot. */
export function analyzeStructuredFunctionLogic<TSource, TNode>(
  input: FunctionLogicAnalysisInput,
  source: TSource | undefined,
  adapter: StructuredFunctionLogicAdapter<TSource, TNode>
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
  return buildStructuredFunctionLogic(
    input.functionNode,
    source,
    callable,
    adapter,
    normalizeFunctionLogicMaxBlocks(input.maxBlocks)
  );
}

/** Classifies visible statements and builds their shared structured CFG. */
function buildStructuredFunctionLogic<TSource, TNode>(
  graphNode: SymbolNode,
  source: TSource,
  callable: StructuredCallableDescriptor<TNode>,
  adapter: StructuredFunctionLogicAdapter<TSource, TNode>,
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
  const pending: StructuredStatementTask<TNode>[] = [];
  const rootStatements = adapter.getRootStatements(source, callable);
  pushStructuredStatements(
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
      scheduleStructuredControlChildren(
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
      message: `${omittedBlockCount} additional statement(s) were omitted after the ${maxBlocks}-block reading limit.`,
      presentation: { key: "logic-gap-statement-limit", params: { count: omittedBlockCount, limit: maxBlocks } }
    });
  }
  if (adapter.hasParseError?.(source, callable.node)) {
    gaps.push({
      code: "parseLimited",
      message: "The parser recovered from incomplete or unsupported syntax inside this callable; verify nearby blocks in source.",
      presentation: { key: "logic-gap-parser-recovered" }
    });
  }
  if ([...controlsByBlockId.values()].some((control) =>
    control.kind === "try" && control.finallyContainerId !== undefined
  )) {
    gaps.push({
      code: "parseLimited",
      message: "Abrupt return, throw, break, and continue paths through finally are conservatively simplified.",
      presentation: { key: "logic-gap-finally" }
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
  const dataFlow = adapter.collectValueFacts
    ? createFunctionLogicDataFlowProjection(
        blocks,
        edges,
        adapter.collectValueFacts(source, callable)
      )
    : undefined;
  const omittedDataFlowCount = (dataFlow?.omittedFactCount ?? 0)
    + (dataFlow?.omittedFlowCount ?? 0);
  if (omittedDataFlowCount > 0) {
    gaps.push({
      code: "parseLimited",
      message: `${omittedDataFlowCount} additional value-flow fact(s) were omitted after the bounded data-flow limit.`,
      presentation: { key: "logic-gap-value-limit", params: { count: omittedDataFlowCount } }
    });
  }
  const projectedBlocks = dataFlow?.blocks ?? blocks;
  return {
    functionNode: graphNode,
    sourceRange: callable.sourceRange,
    language: adapter.language,
    signature: callable.signature,
    lexicalOwnerQualifiedName: callable.lexicalOwnerQualifiedName || undefined,
    blocks: projectedBlocks,
    edges,
    callsites,
    valueBindings: dataFlow?.valueBindings,
    valueFlows: dataFlow?.valueFlows,
    gaps,
    summary: createFunctionLogicSummary(projectedBlocks, callsites.length)
  };
}

/** Creates child containers and schedules branch statements without recursion. */
function scheduleStructuredControlChildren<TNode>(
  task: StructuredStatementTask<TNode>,
  block: InternalBlock,
  description: StructuredControlDescription<TNode>,
  pending: StructuredStatementTask<TNode>[],
  containers: Map<string, LogicContainer>,
  controlsByBlockId: Map<string, ControlRecord>
): void {
  const controlBranches: ControlBranch[] = [];
  const childTasks: StructuredStatementTask<TNode>[] = [];
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
      label: branch.label,
      presentation: branch.presentation
    });
    for (const statement of branch.statements) {
      const seed = normalizeStructuredStatementInput(statement);
      childTasks.push({
        node: seed.node,
        containerId,
        depth: task.depth + 1,
        branchLabel: branch.label,
        branchPresentation: branch.presentation,
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
function pushStructuredStatements<TNode>(
  pending: StructuredStatementTask<TNode>[],
  statements: readonly StructuredStatementInput<TNode>[],
  containerId: string,
  depth: number,
  branchLabel?: string,
  implicitReturn = false
): void {
  for (let index = statements.length - 1; index >= 0; index -= 1) {
    const seed = normalizeStructuredStatementInput(statements[index]);
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
function normalizeStructuredStatementInput<TNode>(
  input: StructuredStatementInput<TNode>
): StructuredStatementSeed<TNode> {
  return isStructuredStatementSeed(input)
    ? input
    : { taskSeed: true, node: input };
}

/** Uses an explicit marker rather than parser-owned node shapes. */
function isStructuredStatementSeed<TNode>(input: StructuredStatementInput<TNode>): input is StructuredStatementSeed<TNode> {
  return (input as { taskSeed?: unknown }).taskSeed === true;
}
