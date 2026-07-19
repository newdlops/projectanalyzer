/**
 * Structured CFG construction for TypeScript/JavaScript function logic. It
 * consumes already classified statement blocks and derives conservative edges
 * with explicit stacks, containers, and loop/switch control targets.
 */

import * as ts from "typescript";
import type {
  ContainerRole,
  ControlBranch,
  ControlRecord,
  InternalBlock,
  LogicContainer
} from "./core/structuredControlFlow";
import type { FunctionLogicEdgeKind } from "./types";
import type { PendingStatement } from "./typescriptFunctionLogicInternal";
import { isLoopStatement, safeText } from "./typescriptFunctionLogicSyntax";

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

/** Turns a block or single statement into a common scheduling sequence. */
function getStatements(statement: ts.Statement): readonly ts.Statement[] {
  return ts.isBlock(statement) ? statement.statements : [statement];
}
