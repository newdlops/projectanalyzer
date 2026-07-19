/**
 * Java structured-control adapter. It maps statement-owned blocks to shared
 * branch containers while keeping loops, switch, try, and synchronized iterative.
 */

import type { SyntaxNode } from "@lezer/common";
import type {
  LezerControlBranchDescription,
  LezerControlDescription
} from "../../core/lezerFunctionLogicAnalyzer";
import {
  compactLezerText,
  getLezerChildNamed,
  getLezerChildren,
  type LezerSource
} from "../../../core/lezerSource";
import {
  getJavaBodyStatements,
  isJavaStatementNode
} from "../../../languages/java/javaLezerSyntax";

/** Describes Java branch containers owned by one visible statement. */
export function describeJavaControl(
  source: LezerSource,
  node: SyntaxNode
): LezerControlDescription | undefined {
  switch (node.name) {
    case "IfStatement":
      return describeJavaIf(node);
    case "WhileStatement":
    case "ForStatement":
    case "EnhancedForStatement":
    case "DoStatement":
      return describeJavaLoop(node);
    case "SwitchStatement":
      return describeJavaSwitch(source, node);
    case "TryStatement":
    case "TryWithResourcesStatement":
      return describeJavaTry(source, node);
    case "SynchronizedStatement":
    case "LabeledStatement":
    case "Block":
      return describeJavaNestedRegion(node);
    default:
      return undefined;
  }
}

/** Maps the first and optional second statement to true/false branches. */
function describeJavaIf(node: SyntaxNode): LezerControlDescription {
  const statements = getLezerChildren(node).filter(isJavaStatementNode);
  const branches: LezerControlBranchDescription[] = [];
  if (statements[0]) {
    branches.push({
      role: "then",
      edgeKind: "true",
      label: "true",
      statements: unwrapJavaStatement(statements[0])
    });
  }
  if (statements[1]) {
    branches.push({
      role: "else",
      edgeKind: "false",
      label: "false",
      statements: unwrapJavaStatement(statements[1])
    });
  }
  return { kind: "condition", branches };
}

/** Maps while/for/do bodies to one iterate branch plus an implicit exit. */
function describeJavaLoop(node: SyntaxNode): LezerControlDescription {
  const statements = getLezerChildren(node).filter(isJavaStatementNode);
  const body = node.name === "DoStatement" ? statements[0] : statements.at(-1);
  return {
    kind: "loop",
    branches: body
      ? [{
          role: "loopBody",
          edgeKind: "iterate",
          label: "iterate",
          statements: unwrapJavaStatement(body)
        }]
      : []
  };
}

/** Groups switch statements under the nearest preceding case/default label. */
function describeJavaSwitch(
  source: LezerSource,
  node: SyntaxNode
): LezerControlDescription {
  const block = getLezerChildNamed(node, "SwitchBlock");
  const branches: LezerControlBranchDescription[] = [];
  let active: LezerControlBranchDescription | undefined;
  let hasDefaultBranch = false;

  for (const child of block ? getLezerChildren(block) : []) {
    if (child.name === "SwitchLabel") {
      const label = compactLezerText(
        source.text.slice(child.from, child.to).replace(/:\s*$/u, ""),
        "case"
      );
      const isDefault = /^default\b/u.test(label);
      hasDefaultBranch ||= isDefault;
      active = {
        role: "case",
        edgeKind: "case",
        label: isDefault ? "default" : label.replace(/^case\s+/u, ""),
        statements: []
      };
      branches.push(active);
      continue;
    }
    if (active && isJavaStatementNode(child)) {
      active.statements.push(...unwrapJavaStatement(child));
    }
  }
  return { kind: "switch", branches, hasDefaultBranch };
}

/** Retains try, each catch, and finally as distinct structured regions. */
function describeJavaTry(
  source: LezerSource,
  node: SyntaxNode
): LezerControlDescription {
  const branches: LezerControlBranchDescription[] = [];
  const tryBlock = getLezerChildren(node).find((child) => child.name === "Block");
  if (tryBlock) {
    branches.push({
      role: "tryBody",
      edgeKind: "next",
      label: "try",
      statements: getJavaBodyStatements(tryBlock)
    });
  }
  for (const child of getLezerChildren(node)) {
    if (child.name === "CatchClause") {
      const block = getLezerChildNamed(child, "Block");
      const parameter = getLezerChildNamed(child, "CatchFormalParameter");
      branches.push({
        role: "catch",
        edgeKind: "exception",
        label: parameter
          ? compactLezerText(source.text.slice(parameter.from, parameter.to), "catch")
          : "catch",
        statements: block ? getJavaBodyStatements(block) : []
      });
    } else if (child.name === "FinallyClause") {
      const block = getLezerChildNamed(child, "Block");
      branches.push({
        role: "finally",
        edgeKind: "finally",
        label: "finally",
        statements: block ? getJavaBodyStatements(block) : []
      });
    }
  }
  return { kind: "try", branches };
}

/** Preserves transparent lexical regions as one normal nested flow. */
function describeJavaNestedRegion(node: SyntaxNode): LezerControlDescription | undefined {
  const block = node.name === "Block" ? node : getLezerChildNamed(node, "Block");
  const statements = block
    ? getJavaBodyStatements(block)
    : getLezerChildren(node).filter(isJavaStatementNode).flatMap(unwrapJavaStatement);
  return statements.length > 0
    ? {
        kind: "try",
        branches: [{
          role: "tryBody",
          edgeKind: "next",
          label: node.name === "SynchronizedStatement" ? "synchronized body" : "nested block",
          statements
        }]
      }
    : undefined;
}

/** Turns a block or single Java statement into one scheduling sequence. */
function unwrapJavaStatement(statement: SyntaxNode): SyntaxNode[] {
  return statement.name === "Block" ? getJavaBodyStatements(statement) : [statement];
}
