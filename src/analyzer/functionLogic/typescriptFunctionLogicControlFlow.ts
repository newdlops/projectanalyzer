/**
 * Structured CFG construction for TypeScript/JavaScript function logic. It
 * consumes already classified statement blocks and derives conservative edges
 * with explicit stacks, containers, and loop/switch control targets.
 */

import * as ts from "typescript";
import { createContentHash } from "../../shared/hash";
import type {
  FunctionLogicBlock,
  FunctionLogicConfidence,
  FunctionLogicEdge,
  FunctionLogicEdgeKind
} from "./types";
import type {
  ContainerRole,
  ControlBranch,
  ControlRecord,
  InternalBlock,
  LogicContainer,
  PendingStatement
} from "./typescriptFunctionLogicInternal";
import { isLoopStatement, safeText } from "./typescriptFunctionLogicSyntax";

/** Inputs retained while direct statement order becomes control-flow edges. */
export type ControlFlowBuildInput = {
  entryBlock: FunctionLogicBlock;
  exitBlock: FunctionLogicBlock;
  visibleBlocks: InternalBlock[];
  blocksById: Map<string, InternalBlock>;
  containers: Map<string, LogicContainer>;
  controlsByBlockId: Map<string, ControlRecord>;
  directBlockIdsByContainer: Map<string, string[]>;
  rootContainerId: string;
};

/** Adds control-owned statement containers without recursively walking syntax. */
export function scheduleControlChildren(
  sourceFile: ts.SourceFile,
  task: PendingStatement,
  block: InternalBlock,
  pending: PendingStatement[],
  containers: Map<string, LogicContainer>,
  controlsByBlockId: Map<string, ControlRecord>
): void {
  const node = task.node;
  const branches: Array<{
    role: ContainerRole;
    edgeKind: FunctionLogicEdgeKind;
    label?: string;
    statements: readonly ts.Statement[];
  }> = [];
  let controlKind: ControlRecord["kind"] | undefined;
  let hasDefaultBranch = false;

  if (ts.isIfStatement(node)) {
    controlKind = "condition";
    branches.push({
      role: "then",
      edgeKind: "true",
      label: "true",
      statements: getStatements(node.thenStatement)
    });
    if (node.elseStatement) {
      branches.push({
        role: "else",
        edgeKind: "false",
        label: ts.isIfStatement(node.elseStatement) ? "else if" : "false",
        statements: getStatements(node.elseStatement)
      });
    }
  } else if (isLoopStatement(node)) {
    controlKind = "loop";
    branches.push({
      role: "loopBody",
      edgeKind: "iterate",
      label: "iterate",
      statements: getStatements(node.statement)
    });
  } else if (ts.isSwitchStatement(node)) {
    controlKind = "switch";
    for (const clause of node.caseBlock.clauses) {
      const isDefault = ts.isDefaultClause(clause);
      hasDefaultBranch ||= isDefault;
      branches.push({
        role: "case",
        edgeKind: "case",
        label: isDefault ? "default" : safeText(clause.expression.getText(sourceFile), "case"),
        statements: clause.statements
      });
    }
  } else if (ts.isTryStatement(node)) {
    controlKind = "try";
    branches.push({
      role: "tryBody",
      edgeKind: "next",
      label: "try",
      statements: node.tryBlock.statements
    });
    if (node.catchClause) {
      branches.push({
        role: "catch",
        edgeKind: "exception",
        label: node.catchClause.variableDeclaration?.name.getText(sourceFile) ?? "catch",
        statements: node.catchClause.block.statements
      });
    }
    if (node.finallyBlock) {
      branches.push({
        role: "finally",
        edgeKind: "finally",
        label: "finally",
        statements: node.finallyBlock.statements
      });
    }
  }

  if (!controlKind) {
    return;
  }

  const controlBranches: ControlBranch[] = [];
  let finallyContainerId: string | undefined;
  const childTasks: PendingStatement[] = [];
  for (let index = 0; index < branches.length; index += 1) {
    const branch = branches[index];
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
      childTasks.push({
        node: statement,
        containerId,
        depth: task.depth + 1,
        branchLabel: branch.label
      });
    }
  }

  for (let index = childTasks.length - 1; index >= 0; index -= 1) {
    pending.push(childTasks[index]);
  }
  controlsByBlockId.set(block.id, {
    kind: controlKind,
    branches: controlBranches,
    hasDefaultBranch,
    finallyContainerId
  });
}

/** Converts direct-container order and control metadata into a bounded CFG. */
export function createControlEdges(input: ControlFlowBuildInput): FunctionLogicEdge[] {
  const edges: FunctionLogicEdge[] = [];
  const edgeKeys = new Set<string>();
  const firstRoot = input.directBlockIdsByContainer.get(input.rootContainerId)?.[0];
  addEdge(edges, edgeKeys, input.entryBlock.id, firstRoot ?? input.exitBlock.id, "next", undefined, "exact");

  for (const block of input.visibleBlocks) {
    const control = input.controlsByBlockId.get(block.id);
    if (control) {
      appendControlEdges(block, control, input, edges, edgeKeys);
      continue;
    }

    if (block.kind === "return" || block.kind === "throw") {
      addEdge(edges, edgeKeys, block.id, input.exitBlock.id, block.kind, block.kind, "exact");
      continue;
    }
    if (block.kind === "break" || block.kind === "continue") {
      const target = findLoopControlTarget(block, block.kind, input);
      addEdge(
        edges,
        edgeKeys,
        block.id,
        target ?? input.exitBlock.id,
        block.kind,
        block.kind,
        target ? "exact" : "inferred"
      );
      continue;
    }

    const transfer = findContinuation(block.id, input);
    addEdge(
      edges,
      edgeKeys,
      block.id,
      transfer.targetId,
      transfer.kind,
      transfer.kind === "repeat" ? "repeat" : undefined,
      "exact"
    );
  }

  return edges;
}

/** Adds outgoing transfers for a condition, loop, switch, or try statement. */
function appendControlEdges(
  block: InternalBlock,
  control: ControlRecord,
  input: ControlFlowBuildInput,
  edges: FunctionLogicEdge[],
  edgeKeys: Set<string>
): void {
  const continuation = findContinuation(block.id, input).targetId;
  const finallyEntry = control.finallyContainerId
    ? input.directBlockIdsByContainer.get(control.finallyContainerId)?.[0]
    : undefined;

  for (const branch of control.branches) {
    // finally is a continuation of try/catch paths, not a sibling choice made
    // when entering the try statement.
    if (branch.containerId === control.finallyContainerId) {
      continue;
    }
    const first = input.directBlockIdsByContainer.get(branch.containerId)?.[0];
    if (first) {
      addEdge(
        edges,
        edgeKeys,
        block.id,
        first,
        branch.edgeKind,
        branch.label,
        branch.edgeKind === "exception" ? "inferred" : "exact"
      );
    } else if (branch.edgeKind !== "exception") {
      const emptyBranchContinuation = control.kind === "try"
        ? finallyEntry ?? continuation
        : continuation;
      addEdge(
        edges,
        edgeKeys,
        block.id,
        emptyBranchContinuation,
        branch.edgeKind,
        branch.label,
        "exact"
      );
    }
  }

  if (control.kind === "condition" && !control.branches.some((branch) => branch.edgeKind === "false")) {
    addEdge(edges, edgeKeys, block.id, continuation, "false", "false", "exact");
  }
  if (control.kind === "loop") {
    addEdge(edges, edgeKeys, block.id, continuation, "exit", "exit loop", "exact");
  }
  if (control.kind === "switch" && !control.hasDefaultBranch) {
    addEdge(edges, edgeKeys, block.id, continuation, "exit", "no case matched", "exact");
  }
}

/** Finds the next source block, climbing structured containers iteratively. */
function findContinuation(
  blockId: string,
  input: ControlFlowBuildInput
): { targetId: string; kind: "next" | "repeat" } {
  let currentBlock = input.blocksById.get(blockId);

  while (currentBlock) {
    const siblings = input.directBlockIdsByContainer.get(currentBlock.containerId) ?? [];
    const index = siblings.indexOf(currentBlock.id);
    if (index >= 0 && index + 1 < siblings.length) {
      return { targetId: siblings[index + 1], kind: "next" };
    }

    const container = input.containers.get(currentBlock.containerId);
    if (!container?.ownerBlockId) {
      return { targetId: input.exitBlock.id, kind: "next" };
    }
    const owner = input.blocksById.get(container.ownerBlockId);
    if (!owner) {
      return { targetId: input.exitBlock.id, kind: "next" };
    }
    const ownerControl = input.controlsByBlockId.get(owner.id);
    if (container.role === "loopBody") {
      return { targetId: owner.id, kind: "repeat" };
    }
    if (
      ownerControl?.kind === "try"
      && container.role !== "finally"
      && ownerControl.finallyContainerId
    ) {
      const firstFinally = input.directBlockIdsByContainer.get(ownerControl.finallyContainerId)?.[0];
      if (firstFinally) {
        return { targetId: firstFinally, kind: "next" };
      }
    }
    currentBlock = owner;
  }

  return { targetId: input.exitBlock.id, kind: "next" };
}

/** Resolves break/continue to the nearest loop or switch without recursion. */
function findLoopControlTarget(
  block: InternalBlock,
  kind: "break" | "continue",
  input: ControlFlowBuildInput
): string | undefined {
  let container = input.containers.get(block.containerId);

  while (container?.ownerBlockId) {
    const owner = input.blocksById.get(container.ownerBlockId);
    const control = owner ? input.controlsByBlockId.get(owner.id) : undefined;
    if (owner && control?.kind === "loop") {
      return kind === "continue" ? owner.id : findContinuation(owner.id, input).targetId;
    }
    if (owner && kind === "break" && control?.kind === "switch") {
      return findContinuation(owner.id, input).targetId;
    }
    container = owner ? input.containers.get(owner.containerId) : undefined;
  }
  return undefined;
}

/** Turns a block or single statement into a common scheduling sequence. */
function getStatements(statement: ts.Statement): readonly ts.Statement[] {
  return ts.isBlock(statement) ? statement.statements : [statement];
}

/** Appends one direct statement identity to its structural container. */
export function appendDirectBlock(
  byContainer: Map<string, string[]>,
  containerId: string,
  blockId: string
): void {
  const values = byContainer.get(containerId) ?? [];
  values.push(blockId);
  byContainer.set(containerId, values);
}

/** Creates one control edge with deterministic dedupe. */
function addEdge(
  edges: FunctionLogicEdge[],
  keys: Set<string>,
  sourceId: string,
  targetId: string,
  kind: FunctionLogicEdgeKind,
  label: string | undefined,
  confidence: FunctionLogicConfidence
): void {
  const key = `${sourceId}\0${targetId}\0${kind}\0${label ?? ""}`;
  if (keys.has(key)) {
    return;
  }
  keys.add(key);
  edges.push({
    id: `logic-edge:${createContentHash(key).slice(0, 32)}`,
    sourceId,
    targetId,
    kind,
    label,
    confidence
  });
}
