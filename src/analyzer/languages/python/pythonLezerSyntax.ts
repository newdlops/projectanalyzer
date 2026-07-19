/**
 * Python Lezer syntax adapter shared by cursor resolution, Function Logic, and
 * the in-process graph fallback. It discovers lexical callables iteratively.
 */

import type { SyntaxNode } from "@lezer/common";
import { parser as pythonParser } from "@lezer/python";
import {
  compactLezerText,
  createLezerSource,
  getLezerChildNamed,
  getLezerChildren,
  lezerNodeRange,
  normalizeLezerText,
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
  /** Receiver-chain role in runtime inner-to-outer evaluation order. */
  callChain?: "start" | "continuation";
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

/** Detects Python's flat `consumer(item for item in values)` ArgList form. */
export function isPythonGeneratorArgumentList(node: SyntaxNode): boolean {
  return node.name === "ArgList"
    && getLezerChildren(node).some((child) => child.name === "for");
}

/** Collects exact call expressions while optionally pruning nested bodies. */
export function collectPythonCalls(
  source: LezerSource,
  root: SyntaxNode,
  skipBodies = false
): PythonCallSyntax[] {
  const callNodes = collectPythonCallNodesInExecutionOrder(root, skipBodies);
  const chainRoles = createPythonCallChainRoles(callNodes);
  return callNodes.map((node) =>
    createPythonCallSyntax(source, node, chainRoles.get(pythonSyntaxNodeKey(node)))
  );
}

/** Reads one call without shortening a chained callee's source identity. */
export function createPythonCallSyntax(
  source: LezerSource,
  node: SyntaxNode,
  callChain?: PythonCallSyntax["callChain"]
): PythonCallSyntax {
  const argList = getLezerChildren(node).find((child) => child.name === "ArgList");
  const raw = source.text.slice(node.from, argList?.from ?? node.to);
  const calleeText = normalizeLezerText(raw, "call").replace(/\s+/gu, "");
  const nameMatch = calleeText.match(/([\p{L}_][\p{L}\p{N}_]*)$/u);
  return {
    node,
    calleeName: nameMatch?.[1] ?? calleeText,
    calleeText,
    argumentCount: argList ? countPythonArguments(argList) : 0,
    callChain
  };
}

/** Locates the evaluated call that supplies another call's callee/receiver. */
export function findPythonReceiverCall(call: SyntaxNode): SyntaxNode | undefined {
  let receiver = getLezerChildren(call).find((child) => child.name !== "ArgList");
  const visited = new Set<string>();
  while (receiver) {
    const key = pythonSyntaxNodeKey(receiver);
    if (visited.has(key)) {
      return undefined;
    }
    visited.add(key);
    if (receiver.name === "CallExpression") {
      return receiver;
    }
    if (receiver.name !== "MemberExpression"
      && receiver.name !== "ParenthesizedExpression"
      && receiver.name !== "AwaitExpression") {
      return undefined;
    }

    // Only the left/base expression supplies the receiver. Calls inside a
    // subscript key such as `registry[make_key()]()` are ordinary arguments to
    // lookup and must never be labeled as receiver-chain stages.
    receiver = getLezerChildren(receiver).find((child) =>
      child.name !== "("
      && child.name !== ")"
      && child.name !== "await"
    );
  }
  return undefined;
}

/** Marks every call participating in a receiver chain without recursive walks. */
function createPythonCallChainRoles(
  callNodes: readonly SyntaxNode[]
): ReadonlyMap<string, PythonCallSyntax["callChain"]> {
  const callKeys = new Set(callNodes.map(pythonSyntaxNodeKey));
  const roles = new Map<string, PythonCallSyntax["callChain"]>();
  for (const call of callNodes) {
    const receiver = findPythonReceiverCall(call);
    const receiverKey = receiver ? pythonSyntaxNodeKey(receiver) : undefined;
    if (!receiverKey || !callKeys.has(receiverKey)) {
      continue;
    }
    roles.set(receiverKey, roles.get(receiverKey) ?? "start");
    roles.set(pythonSyntaxNodeKey(call), "continuation");
  }
  return roles;
}

/** Stable positional identity avoids depending on ephemeral Lezer wrappers. */
function pythonSyntaxNodeKey(node: SyntaxNode): string {
  return `${node.name}:${node.from}:${node.to}`;
}

/**
 * Collects calls in Python evaluation order with an iterative post-order walk.
 * This makes `source().filter().map()` read inner-to-outer and also places
 * argument calls before the call that consumes their result.
 */
function collectPythonCallNodesInExecutionOrder(
  root: SyntaxNode,
  skipBodies: boolean
): SyntaxNode[] {
  const calls: SyntaxNode[] = [];
  const pending: Array<{ node: SyntaxNode; exiting: boolean }> = [{
    node: root,
    exiting: false
  }];

  while (pending.length > 0) {
    const entry = pending.pop();
    if (!entry) {
      continue;
    }
    if (entry.exiting) {
      if (entry.node.name === "CallExpression") {
        calls.push(entry.node);
      }
      continue;
    }
    if (entry.node !== root && (
      isPythonNestedScope(entry.node)
      || (skipBodies && entry.node.name === "Body")
    )) {
      continue;
    }
    pending.push({ node: entry.node, exiting: true });
    const children = getPythonEvaluationChildren(entry.node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push({ node: children[index], exiting: false });
    }
  }
  return calls;
}

/**
 * Reorders flat comprehension syntax into its runtime evaluation sequence:
 * iterable, filters/nested iterables, then the value emitted per iteration.
 */
function getPythonEvaluationChildren(node: SyntaxNode): SyntaxNode[] {
  const children = getLezerChildren(node);
  const expressionComprehension = ["ArrayComprehensionExpression", "ComprehensionExpression",
    "DictionaryComprehensionExpression", "SetComprehensionExpression"].includes(node.name);
  if (!expressionComprehension && !isPythonGeneratorArgumentList(node)) {
    return children;
  }
  const markers: Array<{ name: "for" | "if"; index: number; from: number }> = [];
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child.name === "for" || child.name === "if") {
      markers.push({
        name: child.name,
        index,
        from: child.name === "for" && children[index - 1]?.name === "async"
          ? children[index - 1].from
          : child.from
      });
    }
  }
  if (markers.length === 0) {
    return children;
  }
  const closingFrom = children.at(-1)?.from ?? node.to;
  const resultNodes = children.filter((child) =>
    child.from >= (children[0]?.to ?? node.from)
    && child.to <= markers[0].from
  );
  const evaluated: SyntaxNode[] = [];
  for (let markerIndex = 0; markerIndex < markers.length; markerIndex += 1) {
    const marker = markers[markerIndex];
    const segmentEnd = markers[markerIndex + 1]?.from ?? closingFrom;
    const expressionStart = marker.name === "if"
      ? children[marker.index].to
      : children.find((child, index) =>
          index > marker.index && child.from < segmentEnd && child.name === "in"
        )?.to;
    if (expressionStart === undefined) {
      continue;
    }
    evaluated.push(...children.filter((child) =>
      child.from >= expressionStart && child.to <= segmentEnd
    ));
  }
  evaluated.push(...resultNodes);
  return evaluated;
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
