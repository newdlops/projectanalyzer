/**
 * Python Lezer syntax adapter shared by cursor resolution, Function Logic, and
 * the in-process graph fallback. It discovers lexical callables iteratively.
 */

import type { SyntaxNode } from "@lezer/common";
import { parser as pythonParser } from "@lezer/python";
import {
  compactLezerText,
  createLezerSource,
  findLezerDescendants,
  getLezerChildNamed,
  getLezerChildren,
  lezerNodeRange,
  type LezerSource
} from "../../core/lezerSource";

/** Callable syntax identity retained across Python feature adapters. */
export type PythonCallableSyntax = {
  node: SyntaxNode;
  declarationNode: SyntaxNode;
  body: SyntaxNode;
  name: string;
  qualifiedName: string;
  kind: "function" | "method" | "constructor";
  selectionFrom: number;
  selectionTo: number;
  anonymous: boolean;
  expressionBody: boolean;
  /** Qualified scope path ending at the nearest lexical class, if one exists. */
  lexicalClassOwner: string;
};

/** One exact Python call expression reused by logic and graph adapters. */
export type PythonCallSyntax = {
  node: SyntaxNode;
  calleeName: string;
  calleeText: string;
  argumentCount: number;
};

/** One lexical owner carried by the explicit syntax traversal stack. */
type PythonScope = {
  name: string;
  kind: "class" | "function";
};

/** Work item retaining scope names without relying on parser parent recursion. */
type PythonTraversalEntry = {
  node: SyntaxNode;
  scopes: PythonScope[];
};

const PYTHON_STATEMENT_NAMES = new Set([
  "AssertStatement",
  "AssignStatement",
  "BreakStatement",
  "ClassDefinition",
  "ContinueStatement",
  "DecoratedStatement",
  "DeleteStatement",
  "ExpressionStatement",
  "ForStatement",
  "FunctionDefinition",
  "IfStatement",
  "ImportStatement",
  "MatchStatement",
  "PassStatement",
  "PrintStatement",
  "RaiseStatement",
  "ReturnStatement",
  "ScopeStatement",
  "StatementGroup",
  "TryStatement",
  "TypeDefinition",
  "UpdateStatement",
  "WhileStatement",
  "WithStatement",
  "YieldStatement"
]);

/** Parses one Python source snapshot with a pure JavaScript grammar. */
export function parsePythonLezerSource(text: string): LezerSource {
  return createLezerSource(pythonParser, text);
}

/** Collects named definitions and lambdas with stable lexical qualification. */
export function collectPythonCallables(source: LezerSource): PythonCallableSyntax[] {
  const callables: PythonCallableSyntax[] = [];
  const rootChildren = getLezerChildren(source.tree.topNode);
  const pending: PythonTraversalEntry[] = [];
  for (let index = rootChildren.length - 1; index >= 0; index -= 1) {
    pending.push({ node: rootChildren[index], scopes: [] });
  }

  while (pending.length > 0) {
    const entry = pending.pop();
    if (!entry) {
      continue;
    }
    let childScopes = entry.scopes;
    if (entry.node.name === "ClassDefinition") {
      const className = readDirectPythonName(source, entry.node, "anonymous class");
      childScopes = [...entry.scopes, { name: className, kind: "class" }];
    } else if (entry.node.name === "FunctionDefinition"
      || entry.node.name === "LambdaExpression") {
      const callable = createPythonCallable(source, entry.node, entry.scopes);
      if (callable) {
        callables.push(callable);
        childScopes = [
          ...entry.scopes,
          { name: callable.name, kind: "function" }
        ];
      }
    }

    const children = getLezerChildren(entry.node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push({ node: children[index], scopes: childScopes });
    }
  }
  return callables.sort((left, right) =>
    left.declarationNode.from - right.declarationNode.from
    || left.declarationNode.to - right.declarationNode.to
  );
}

/** Returns direct executable statements from an indented Python body. */
export function getPythonBodyStatements(body: SyntaxNode): SyntaxNode[] {
  return getLezerChildren(body).filter((child) => PYTHON_STATEMENT_NAMES.has(child.name));
}

/** Tests whether traversal must stop before entering a nested lexical scope. */
export function isPythonNestedScope(node: SyntaxNode): boolean {
  return node.name === "FunctionDefinition"
    || node.name === "ClassDefinition"
    || node.name === "LambdaExpression";
}

/** Collects exact call expressions while optionally pruning nested bodies. */
export function collectPythonCalls(
  source: LezerSource,
  root: SyntaxNode,
  skipBodies = false
): PythonCallSyntax[] {
  // Expression-bodied lambdas can use the call expression itself as `root`,
  // while the iterative descendant helper intentionally starts at children.
  const callNodes = [
    ...(root.name === "CallExpression" ? [root] : []),
    ...findLezerDescendants(
      root,
      (node) => node.name === "CallExpression",
      (node) => isPythonNestedScope(node) || (skipBodies && node.name === "Body")
    )
  ];
  return callNodes.map((node) => {
    const argList = getLezerChildren(node).find((child) => child.name === "ArgList");
    const raw = source.text.slice(node.from, argList?.from ?? node.to);
    const calleeText = compactLezerText(raw, "call").replace(/\s+/gu, "");
    const nameMatch = calleeText.match(/([\p{L}_][\p{L}\p{N}_]*)$/u);
    return {
      node,
      calleeName: nameMatch?.[1] ?? calleeText,
      calleeText,
      argumentCount: argList ? countPythonArguments(argList) : 0
    };
  });
}

/** Creates a normalized source signature ending at the executable body. */
export function createPythonCallableSignature(
  source: LezerSource,
  callable: PythonCallableSyntax
): string {
  return compactLezerText(
    source.text.slice(callable.node.from, callable.body.from + 1),
    callable.name
  );
}

/** Reads one callable's exact body range. */
export function getPythonCallableBodyRange(
  source: LezerSource,
  callable: PythonCallableSyntax
) {
  return lezerNodeRange(source, callable.body);
}

/** Builds a named definition or lambda descriptor. */
function createPythonCallable(
  source: LezerSource,
  node: SyntaxNode,
  scopes: PythonScope[]
): PythonCallableSyntax | undefined {
  if (node.name === "FunctionDefinition") {
    const nameNode = getLezerChildNamed(node, "VariableName");
    const body = getLezerChildNamed(node, "Body");
    if (!nameNode || !body) {
      return undefined;
    }
    const name = source.text.slice(nameNode.from, nameNode.to);
    const immediateOwner = scopes.at(-1);
    const kind = immediateOwner?.kind === "class"
      ? (name === "__init__" ? "constructor" : "method")
      : "function";
    return {
      node,
      declarationNode: node.parent?.name === "DecoratedStatement" ? node.parent : node,
      body,
      name,
      qualifiedName: [...scopes.map((scope) => scope.name), name].join("."),
      kind,
      selectionFrom: nameNode.from,
      selectionTo: nameNode.to,
      anonymous: false,
      expressionBody: false,
      lexicalClassOwner: createPythonClassOwnerPath(scopes)
    };
  }

  const body = findPythonLambdaBody(node);
  if (!body) {
    return undefined;
  }
  const binding = findPythonLambdaBinding(node);
  const position = lezerNodeRange(source, node);
  const name = binding ? source.text.slice(binding.from, binding.to) : "anonymous function";
  const ownSegment = binding
    ? name
    : `<anonymous@${position.startLine + 1}:${position.startCharacter + 1}>`;
  return {
    node,
    declarationNode: binding?.parent?.name === "AssignStatement" ? binding.parent : node,
    body,
    name,
    qualifiedName: [...scopes.map((scope) => scope.name), ownSegment].join("."),
    kind: "function",
    selectionFrom: binding?.from ?? node.from,
    selectionTo: binding?.to ?? Math.min(node.to, node.from + 6),
    anonymous: !binding,
    expressionBody: true,
    lexicalClassOwner: createPythonClassOwnerPath(scopes)
  };
}

/** Retains all qualification segments through the nearest enclosing class. */
function createPythonClassOwnerPath(scopes: readonly PythonScope[]): string {
  let classIndex = -1;
  for (let index = 0; index < scopes.length; index += 1) {
    if (scopes[index].kind === "class") {
      classIndex = index;
    }
  }
  return classIndex >= 0
    ? scopes.slice(0, classIndex + 1).map((scope) => scope.name).join(".")
    : "";
}

/** Locates the expression after a lambda's colon token. */
function findPythonLambdaBody(node: SyntaxNode): SyntaxNode | undefined {
  const children = getLezerChildren(node);
  const colonIndex = children.findIndex((child) => child.name === ":");
  return colonIndex >= 0 ? children[colonIndex + 1] : undefined;
}

/** Uses only a direct assignment binding as a trustworthy lambda name. */
function findPythonLambdaBinding(node: SyntaxNode): SyntaxNode | undefined {
  const assignment = node.parent?.name === "AssignStatement" ? node.parent : undefined;
  if (!assignment) {
    return undefined;
  }
  return getLezerChildren(assignment).find((child) =>
    child.name === "VariableName" && child.to <= node.from
  );
}

/** Reads the direct declaration identifier without entering parameters. */
function readDirectPythonName(
  source: LezerSource,
  node: SyntaxNode,
  fallback: string
): string {
  const name = getLezerChildNamed(node, "VariableName");
  return name ? source.text.slice(name.from, name.to) : fallback;
}

/** Counts top-level Python argument syntax nodes without resolving values. */
function countPythonArguments(argList: SyntaxNode): number {
  return getLezerChildren(argList).filter((child) =>
    !["(", ")", ","].includes(child.name)
  ).length;
}
