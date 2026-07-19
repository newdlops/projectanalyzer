/**
 * Python structured-control adapter. It maps indentation-owned Lezer bodies to
 * language-neutral branch containers without recursively traversing syntax.
 */

import type { SyntaxNode } from "@lezer/common";
import type {
  LezerControlBranchDescription,
  LezerControlDescription
} from "../../core/lezerFunctionLogicAnalyzer";
import {
  getLezerChildNamed,
  getLezerChildren,
  normalizeLezerText,
  type LezerSource
} from "../../../core/lezerSource";
import { getPythonBodyStatements } from "../../../languages/python/pythonLezerSyntax";

/** Describes Python branch containers owned by one visible statement. */
export function describePythonControl(
  source: LezerSource,
  node: SyntaxNode
): LezerControlDescription | undefined {
  switch (node.name) {
    case "IfStatement":
      return describePythonIf(source, node);
    case "WhileStatement":
    case "ForStatement":
      return describePythonLoop(source, node);
    case "MatchStatement":
      return describePythonMatch(source, node);
    case "TryStatement":
      return describePythonTry(source, node);
    case "WithStatement":
      return describePythonWith(node);
    default:
      return undefined;
  }
}

/** Maps if/elif/else bodies to explicit choice branches. */
function describePythonIf(
  source: LezerSource,
  node: SyntaxNode
): LezerControlDescription {
  const branches: LezerControlBranchDescription[] = [];
  const children = getLezerChildren(node);
  let keyword = "if";
  let keywordEnd = node.from;

  for (const child of children) {
    if (child.name === "if" || child.name === "elif" || child.name === "else") {
      keyword = child.name;
      keywordEnd = child.to;
      continue;
    }
    if (child.name !== "Body") {
      continue;
    }
    const isFirst = branches.length === 0;
    const isElse = keyword === "else";
    const condition = normalizeLezerText(
      source.text.slice(keywordEnd, child.from).replace(/:\s*$/u, ""),
      keyword
    );
    branches.push({
      role: isFirst ? "then" : isElse ? "else" : "case",
      edgeKind: isFirst ? "true" : isElse ? "false" : "case",
      label: isFirst ? "true" : isElse ? "false" : `elif ${condition}`,
      statements: getPythonBodyStatements(child)
    });
  }
  return { kind: "condition", branches };
}

/** Preserves Python loop-else as the normal exit branch skipped by break. */
function describePythonLoop(
  _source: LezerSource,
  node: SyntaxNode
): LezerControlDescription {
  const bodies = getLezerChildren(node).filter((child) => child.name === "Body");
  const branches: LezerControlBranchDescription[] = [];
  if (bodies[0]) {
    branches.push({
      role: "loopBody",
      edgeKind: "iterate",
      label: "iterate",
      statements: getPythonBodyStatements(bodies[0])
    });
  }
  if (bodies[1]) {
    branches.push({
      role: "else",
      edgeKind: "exit",
      label: "loop completed",
      statements: getPythonBodyStatements(bodies[1])
    });
  }
  return { kind: "loop", branches };
}

/** Maps match clauses to switch-style case branches. */
function describePythonMatch(
  source: LezerSource,
  node: SyntaxNode
): LezerControlDescription {
  const matchBody = getLezerChildNamed(node, "MatchBody");
  const clauses = matchBody
    ? getLezerChildren(matchBody).filter((child) => child.name === "MatchClause")
    : [];
  let hasDefaultBranch = false;
  const branches = clauses.flatMap((clause): LezerControlBranchDescription[] => {
    const body = getLezerChildNamed(clause, "Body");
    if (!body) {
      return [];
    }
    const rawLabel = normalizeLezerText(
      source.text.slice(clause.from, body.from)
        .replace(/^\s*case\s+/u, "")
        .replace(/:\s*$/u, ""),
      "case"
    );
    const defaultCase = /^_\s*(?:if\b.*)?$/u.test(rawLabel);
    hasDefaultBranch ||= defaultCase;
    return [{
      role: "case",
      edgeKind: "case",
      label: defaultCase ? "default" : rawLabel,
      statements: getPythonBodyStatements(body)
    }];
  });
  return { kind: "switch", branches, hasDefaultBranch };
}

/** Combines try-else with the normal try path and retains catch/finally lanes. */
function describePythonTry(
  source: LezerSource,
  node: SyntaxNode
): LezerControlDescription {
  const branches: LezerControlBranchDescription[] = [];
  const children = getLezerChildren(node);
  let keyword = "try";
  let keywordStart = node.from;

  for (const child of children) {
    if (["try", "except", "else", "finally"].includes(child.name)) {
      keyword = child.name;
      keywordStart = child.from;
      continue;
    }
    if (child.name !== "Body") {
      continue;
    }
    const statements = getPythonBodyStatements(child);
    if (keyword === "else") {
      const normalBranch = branches.find((branch) => branch.role === "tryBody");
      normalBranch?.statements.push(...statements);
      continue;
    }
    const label = keyword === "except"
      ? normalizeLezerText(
          source.text.slice(keywordStart, child.from).replace(/:\s*$/u, ""),
          "except"
        )
      : keyword;
    branches.push({
      role: keyword === "try" ? "tryBody" : keyword === "finally" ? "finally" : "catch",
      edgeKind: keyword === "try" ? "next" : keyword === "finally" ? "finally" : "exception",
      label,
      statements
    });
  }
  return { kind: "try", branches };
}

/** Treats a with body as one guaranteed nested execution region. */
function describePythonWith(node: SyntaxNode): LezerControlDescription | undefined {
  const body = getLezerChildNamed(node, "Body");
  return body
    ? {
        kind: "try",
        branches: [{
          role: "tryBody",
          edgeKind: "next",
          label: "with body",
          statements: getPythonBodyStatements(body)
        }]
      }
    : undefined;
}
