/**
 * Java Lezer syntax adapter shared by cursor resolution, Function Logic, and
 * project-graph fallback analysis. Traversal and scope discovery are iterative.
 */

import type { SyntaxNode } from "@lezer/common";
import { parser as javaParser } from "@lezer/java";
import {
  compactLezerText,
  createLezerSource,
  findLezerDescendants,
  getLezerChildNamed,
  getLezerChildren,
  lezerNodeRange,
  type LezerSource
} from "../../core/lezerSource";

/** Callable syntax identity retained across Java feature adapters. */
export type JavaCallableSyntax = {
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
  /** Qualified scope path ending at the nearest lexical type owner. */
  lexicalTypeOwner: string;
  parameterCount: number;
};

/** One exact Java invocation reused by logic and graph adapters. */
export type JavaCallSyntax = {
  node: SyntaxNode;
  calleeName: string;
  calleeText: string;
  argumentCount: number;
  constructor: boolean;
};

/** Work item retaining lexical owners without walking parent chains recursively. */
type JavaTraversalEntry = {
  node: SyntaxNode;
  scopes: JavaScope[];
};

/** One type or callable segment carried by the iterative lexical traversal. */
type JavaScope = {
  name: string;
  kind: "type" | "callable";
};

const JAVA_OWNER_NODE_NAMES = new Set([
  "AnnotationTypeDeclaration",
  "ClassDeclaration",
  "EnumDeclaration",
  "InterfaceDeclaration"
]);

const JAVA_STATEMENT_NAMES = new Set([
  ";",
  "AssertStatement",
  "Block",
  "BreakStatement",
  "ContinueStatement",
  "DoStatement",
  "EnhancedForStatement",
  "ExplicitConstructorInvocation",
  "ExpressionStatement",
  "ForStatement",
  "IfStatement",
  "LabeledStatement",
  "LocalVariableDeclaration",
  "ReturnStatement",
  "SwitchStatement",
  "SynchronizedStatement",
  "ThrowStatement",
  "TryStatement",
  "TryWithResourcesStatement",
  "WhileStatement"
]);

/** Parses one Java source snapshot with a pure JavaScript grammar. */
export function parseJavaLezerSource(text: string): LezerSource {
  return createLezerSource(javaParser, text);
}

/** Collects executable methods, constructors, and lambdas in source order. */
export function collectJavaCallables(source: LezerSource): JavaCallableSyntax[] {
  const callables: JavaCallableSyntax[] = [];
  const rootChildren = getLezerChildren(source.tree.topNode);
  const pending: JavaTraversalEntry[] = [];
  for (let index = rootChildren.length - 1; index >= 0; index -= 1) {
    pending.push({ node: rootChildren[index], scopes: [] });
  }

  while (pending.length > 0) {
    const entry = pending.pop();
    if (!entry) {
      continue;
    }
    let childScopes = entry.scopes;
    if (JAVA_OWNER_NODE_NAMES.has(entry.node.name)) {
      const ownerName = readJavaDefinitionName(source, entry.node, "AnonymousType");
      childScopes = [...entry.scopes, { name: ownerName, kind: "type" }];
    } else if (isJavaCallableNode(entry.node)) {
      const callable = createJavaCallable(source, entry.node, entry.scopes);
      if (callable) {
        callables.push(callable);
        childScopes = [
          ...entry.scopes,
          { name: callable.name, kind: "callable" }
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

/** Returns direct executable statements from a method, constructor, or block. */
export function getJavaBodyStatements(body: SyntaxNode): SyntaxNode[] {
  return getLezerChildren(body).filter((child) => JAVA_STATEMENT_NAMES.has(child.name));
}

/** Tests whether one direct child is an executable Java statement node. */
export function isJavaStatementNode(node: SyntaxNode): boolean {
  return JAVA_STATEMENT_NAMES.has(node.name);
}

/** Tests whether traversal must stop before entering a nested lexical scope. */
export function isJavaNestedScope(node: SyntaxNode): boolean {
  return isJavaCallableNode(node) || JAVA_OWNER_NODE_NAMES.has(node.name);
}

/** Collects exact invocations while optionally pruning nested statement blocks. */
export function collectJavaCalls(
  source: LezerSource,
  root: SyntaxNode,
  skipBodies = false
): JavaCallSyntax[] {
  // An expression-bodied lambda may expose its invocation as the root node,
  // which is outside the descendant-only traversal by design.
  const callNodes = [
    ...(isJavaCallNode(root) ? [root] : []),
    ...findLezerDescendants(
      root,
      isJavaCallNode,
      (node) => isJavaNestedScope(node) || (skipBodies && node.name === "Block")
    )
  ];
  return callNodes.map((node) => {
    const argumentList = findLezerDescendants(
      node,
      (candidate) => candidate.name === "ArgumentList"
    )[0];
    const raw = source.text.slice(node.from, argumentList?.from ?? node.to)
      .replace(/^\s*new\s+/u, "");
    const calleeText = compactLezerText(raw, "call").replace(/\s+/gu, "");
    const nameMatch = calleeText.match(/([\p{L}_$][\p{L}\p{N}_$]*)$/u);
    return {
      node,
      calleeName: nameMatch?.[1] ?? calleeText,
      calleeText,
      argumentCount: argumentList ? countJavaArguments(argumentList) : 0,
      constructor: node.name !== "MethodInvocation"
    };
  });
}

/** Creates a normalized declaration signature ending at the executable body. */
export function createJavaCallableSignature(
  source: LezerSource,
  callable: JavaCallableSyntax
): string {
  return compactLezerText(
    source.text.slice(callable.node.from, callable.body.from + 1),
    callable.name
  );
}

/** Reads one callable's exact body range. */
export function getJavaCallableBodyRange(
  source: LezerSource,
  callable: JavaCallableSyntax
) {
  return lezerNodeRange(source, callable.body);
}

/** Returns Java class/interface owner nodes recognized by graph extraction. */
export function isJavaOwnerNode(node: SyntaxNode): boolean {
  return JAVA_OWNER_NODE_NAMES.has(node.name);
}

/** Reads one direct type or callable definition identifier. */
export function readJavaDefinitionName(
  source: LezerSource,
  node: SyntaxNode,
  fallback: string
): string {
  const definition = getLezerChildNamed(node, "Definition")
    ?? getLezerChildNamed(node, "Identifier");
  return definition ? source.text.slice(definition.from, definition.to) : fallback;
}

/** Builds a method, constructor, or lambda descriptor. */
function createJavaCallable(
  source: LezerSource,
  node: SyntaxNode,
  scopes: JavaScope[]
): JavaCallableSyntax | undefined {
  if (node.name === "MethodDeclaration" || node.name === "ConstructorDeclaration") {
    const body = node.name === "ConstructorDeclaration"
      ? getLezerChildNamed(node, "ConstructorBody")
      : getLezerChildNamed(node, "Block");
    const nameNode = findDirectJavaDefinition(node);
    if (!body || !nameNode) {
      return undefined;
    }
    const name = source.text.slice(nameNode.from, nameNode.to);
    return {
      node,
      declarationNode: node,
      body,
      name,
      qualifiedName: [...scopes.map((scope) => scope.name), name].join("."),
      kind: node.name === "ConstructorDeclaration" ? "constructor" : "method",
      selectionFrom: nameNode.from,
      selectionTo: nameNode.to,
      anonymous: false,
      expressionBody: false,
      lexicalTypeOwner: createJavaTypeOwnerPath(scopes),
      parameterCount: countJavaParameters(node)
    };
  }

  const body = findJavaLambdaBody(node);
  if (!body) {
    return undefined;
  }
  const binding = findJavaLambdaBinding(node);
  const position = lezerNodeRange(source, node);
  const name = binding ? source.text.slice(binding.from, binding.to) : "anonymous function";
  const segment = binding
    ? name
    : `<anonymous@${position.startLine + 1}:${position.startCharacter + 1}>`;
  return {
    node,
    declarationNode: binding?.parent?.name === "VariableDeclarator" ? binding.parent : node,
    body,
    name,
    qualifiedName: [...scopes.map((scope) => scope.name), segment].join("."),
    kind: "function",
    selectionFrom: binding?.from ?? node.from,
    selectionTo: binding?.to ?? Math.min(node.to, node.from + 1),
    anonymous: !binding,
    expressionBody: body.name !== "Block",
    lexicalTypeOwner: createJavaTypeOwnerPath(scopes),
    parameterCount: countJavaLambdaParameters(node)
  };
}

/** Retains all qualification segments through the nearest enclosing Java type. */
function createJavaTypeOwnerPath(scopes: readonly JavaScope[]): string {
  let typeIndex = -1;
  for (let index = 0; index < scopes.length; index += 1) {
    if (scopes[index].kind === "type") {
      typeIndex = index;
    }
  }
  return typeIndex >= 0
    ? scopes.slice(0, typeIndex + 1).map((scope) => scope.name).join(".")
    : "";
}

/** Identifies Java callable syntax that may contain an executable body. */
function isJavaCallableNode(node: SyntaxNode): boolean {
  return node.name === "MethodDeclaration"
    || node.name === "ConstructorDeclaration"
    || node.name === "LambdaExpression";
}

/** Finds a method/constructor identifier without entering parameter definitions. */
function findDirectJavaDefinition(node: SyntaxNode): SyntaxNode | undefined {
  const children = getLezerChildren(node);
  const parameters = children.find((child) => child.name === "FormalParameters");
  const pending = children.filter((child) => !parameters || child.to <= parameters.from).reverse();
  while (pending.length > 0) {
    const candidate = pending.pop();
    if (!candidate) {
      continue;
    }
    if (candidate.name === "Definition") {
      return candidate;
    }
    const descendants = getLezerChildren(candidate);
    for (let index = descendants.length - 1; index >= 0; index -= 1) {
      pending.push(descendants[index]);
    }
  }
  return undefined;
}

/** Returns the expression or block following a lambda arrow. */
function findJavaLambdaBody(node: SyntaxNode): SyntaxNode | undefined {
  const children = getLezerChildren(node);
  const arrowIndex = children.findIndex((child) => child.name === "->");
  return arrowIndex >= 0 ? children[arrowIndex + 1] : children.at(-1);
}

/** Uses only a variable declarator definition as a trustworthy lambda name. */
function findJavaLambdaBinding(node: SyntaxNode): SyntaxNode | undefined {
  let current = node.parent;
  for (let depth = 0; current && depth < 3; depth += 1) {
    if (current.name === "VariableDeclarator") {
      return getLezerChildNamed(current, "Definition");
    }
    current = current.parent;
  }
  return undefined;
}

/** Counts declared parameters for conservative overload matching. */
function countJavaParameters(node: SyntaxNode): number {
  const parameters = getLezerChildNamed(node, "FormalParameters");
  return parameters
    ? getLezerChildren(parameters).filter((child) =>
        child.name === "FormalParameter" || child.name === "SpreadParameter"
      ).length
    : 0;
}

/** Counts inferred or formal lambda parameters without resolving their types. */
function countJavaLambdaParameters(node: SyntaxNode): number {
  const parameters = getLezerChildNamed(node, "FormalParameters")
    ?? getLezerChildNamed(node, "InferredParameters");
  if (!parameters) {
    return getLezerChildNamed(node, "Identifier") ? 1 : 0;
  }
  return getLezerChildren(parameters).filter((child) =>
    child.name === "FormalParameter"
      || child.name === "SpreadParameter"
      || child.name === "Identifier"
  ).length;
}

/** Identifies calls represented as method or constructor invocations. */
function isJavaCallNode(node: SyntaxNode): boolean {
  return node.name === "MethodInvocation"
    || node.name === "ObjectCreationExpression"
    || node.name === "ExplicitConstructorInvocation";
}

/** Counts top-level Java argument expressions without resolving their types. */
function countJavaArguments(argumentList: SyntaxNode): number {
  return getLezerChildren(argumentList).filter((child) =>
    !["(", ")", ","].includes(child.name)
  ).length;
}
