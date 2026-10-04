/** Iterative Kotlin declaration/owner indexing and execution-scope invocation facts. */
import {
  findKotlinDescendants, getKotlinChildNamed, kotlinNodeText, kotlinOffsetsRange
} from "./kotlinSyntaxTree";
import type {
  KotlinCallableSyntax, KotlinCallSyntax, KotlinFunctionDeclarationSyntax, KotlinOwnerSyntax,
  KotlinParameterSyntax, KotlinSource, KotlinSyntaxNode
} from "./kotlinSyntaxTypes";

type Scope = { name: string; kind: "type" | "callable" };
type DeclarationIndex = { declarations: KotlinFunctionDeclarationSyntax[]; owners: KotlinOwnerSyntax[] };
/** A weak snapshot index cannot retain snapshots after cache eviction/disposal. */
const declarationIndices = new WeakMap<KotlinSource, DeclarationIndex>();
const OWNER_NAMES = new Set(["classDeclaration", "objectDeclaration", "companionObject", "objectLiteral"]);
const CALLABLE_BOUNDARIES = new Set(["functionDeclaration", "anonymousFunction", "lambdaLiteral"]);

/** Collects executable named functions in declaration source order. */
export function collectKotlinCallables(source: KotlinSource): KotlinCallableSyntax[] {
  return getDeclarationIndex(source).declarations.filter((callable): callable is KotlinCallableSyntax => Boolean(callable.body));
}

/** Includes bodyless/abstract function declarations for the project graph. */
export function collectKotlinFunctionDeclarations(source: KotlinSource): KotlinFunctionDeclarationSyntax[] {
  return [...getDeclarationIndex(source).declarations];
}

/** Returns all lexical type owners used to parent source-backed graph symbols. */
export function collectKotlinOwners(source: KotlinSource): KotlinOwnerSyntax[] {
  return [...getDeclarationIndex(source).owners];
}

/** Returns direct grammar statement nodes from a function/block/control body. */
export function getKotlinBodyStatements(body: KotlinSyntaxNode): KotlinSyntaxNode[] {
  if (body.name === "statement") return [body];
  const block = getKotlinChildNamed(body, "block");
  if (block) return getKotlinBodyStatementsFromContainer(block);
  const direct = getKotlinChildNamed(body, "statement");
  if (direct && body.name === "controlStructureBody") return [direct];
  return getKotlinBodyStatementsFromContainer(body);
}

/** Tests lexical execution boundaries before traversing call/value facts. */
export function isKotlinNestedScope(node: KotlinSyntaxNode): boolean {
  return CALLABLE_BOUNDARIES.has(node.name) || OWNER_NAMES.has(node.name);
}

/** Collects invocations in the current execution scope, never entering deferred/type bodies. */
export function collectKotlinCalls(source: KotlinSource, root: KotlinSyntaxNode, skipBodies = false): KotlinCallSyntax[] {
  const nodes = [
    ...(root.name === "postfixUnaryExpression" || root.name === "genericCallLikeComparison" ? [root] : []),
    ...findKotlinDescendants(root, (node) => node.name === "postfixUnaryExpression" || node.name === "genericCallLikeComparison",
      (node) => isKotlinNestedScope(node) || (skipBodies && (node.name === "block" || node.name === "controlStructureBody")))
  ];
  const calls: KotlinCallSyntax[] = [];
  for (const node of nodes) {
    const suffixes = node.name === "postfixUnaryExpression"
      ? node.children.filter((child) => child.name === "postfixUnarySuffix")
      : node.children.filter((child) => child.name === "callSuffix");
    for (const suffix of suffixes) {
      const callSuffix = suffix.name === "callSuffix" ? suffix : getKotlinChildNamed(suffix, "callSuffix");
      if (!callSuffix) continue;
      const typeArguments = getKotlinChildNamed(callSuffix, "typeArguments");
      let calleeEnd = typeArguments?.from ?? callSuffix.from;
      // A standalone typeArguments postfix (foo<Int>()) precedes callSuffix.
      const preceding = node.children.filter((child) => child.to <= callSuffix.from).at(-1);
      if (preceding?.name === "postfixUnarySuffix" && getKotlinChildNamed(preceding, "typeArguments")) {
        calleeEnd = preceding.from;
      }
      const calleeText = readCalleeTokens(source, node, calleeEnd);
      const identifier = calleeText.match(/(?:`([^`]+)`|([\p{L}\p{N}_]+))$/u);
      const calleeName = identifier?.[1] ?? identifier?.[2] ?? calleeText;
      const argumentsNode = getKotlinChildNamed(callSuffix, "valueArguments");
      const argumentCount = (argumentsNode?.children.filter((child) => child.name === "valueArgument").length ?? 0)
        + (getKotlinChildNamed(callSuffix, "annotatedLambda") ? 1 : 0);
      calls.push(Object.freeze({
        // Each chain invocation receives a half-open source span ending at its
        // own call suffix, so foo().bar() retains independent call evidence.
        node: Object.freeze({ name: node.name, from: node.from, to: callSuffix.to,
          children: Object.freeze(node.children.filter((child) => child.from < callSuffix.to)) }),
        calleeName, calleeText, argumentCount
      }));
    }
  }
  return calls.sort((left, right) => left.node.from - right.node.from || left.node.to - right.node.to);
}

/** Builds a stable declaration/owner index without recursive visitors or parent pointers. */
function getDeclarationIndex(source: KotlinSource): DeclarationIndex {
  const cached = declarationIndices.get(source);
  if (cached) return cached;
  const declarations: KotlinFunctionDeclarationSyntax[] = [];
  const owners: KotlinOwnerSyntax[] = [];
  const pending: Array<{ node: KotlinSyntaxNode; scopes: readonly Scope[]; lexicalScope: KotlinSyntaxNode }> = [
    { node: source.root, scopes: [], lexicalScope: source.root }
  ];
  const visited = new Set<KotlinSyntaxNode>();
  while (pending.length > 0) {
    const entry = pending.pop();
    if (!entry || visited.has(entry.node)) continue;
    visited.add(entry.node);
    let scopes = entry.scopes;
    // Named callables define graph ownership, while blocks define local name
    // visibility. Keeping those facts separate prevents sibling/finished
    // branches from exporting their declarations into the enclosing function.
    const lexicalScope = ["block", "controlStructureBody", "lambdaLiteral"].includes(entry.node.name)
      ? entry.node : entry.lexicalScope;
    if (OWNER_NAMES.has(entry.node.name)) {
      const owner = createOwner(source, entry.node, scopes);
      owners.push(owner);
      scopes = [...scopes, { name: owner.name, kind: "type" }];
    } else if (entry.node.name === "functionDeclaration") {
      const declaration = createFunctionDeclaration(source, entry.node, scopes, lexicalScope);
      if (declaration) {
        declarations.push(declaration);
        scopes = [...scopes, { name: declaration.receiverType ? `${declaration.receiverType}.${declaration.name}` : declaration.name, kind: "callable" }];
      }
    } else if (entry.node.name === "lambdaLiteral" || entry.node.name === "anonymousFunction") {
      const position = kotlinOffsetsRange(source, entry.node.from, entry.node.from);
      scopes = [...scopes, { name: `<lambda@${position.startLine + 1}:${position.startCharacter + 1}>`, kind: "callable" }];
    }
    for (let index = entry.node.children.length - 1; index >= 0; index -= 1) {
      pending.push({ node: entry.node.children[index], scopes, lexicalScope });
    }
  }
  const value = { declarations, owners };
  declarationIndices.set(source, value);
  return value;
}

/** Reads explicit function signatures without entering generic/parameter/body declarations. */
function createFunctionDeclaration(source: KotlinSource, node: KotlinSyntaxNode,
  scopes: readonly Scope[], lexicalScope: KotlinSyntaxNode): KotlinFunctionDeclarationSyntax | undefined {
  const nameNode = getKotlinChildNamed(node, "simpleIdentifier");
  if (!nameNode) return undefined;
  const name = unescapeIdentifier(kotlinNodeText(source, nameNode));
  const body = getKotlinChildNamed(node, "functionBody");
  const parametersNode = getKotlinChildNamed(node, "functionValueParameters");
  const parameters = (parametersNode?.children.filter((child) => child.name === "functionValueParameter") ?? [])
    .map((parameter) => createParameter(source, parameter));
  const receiver = getKotlinChildNamed(node, "receiverType");
  const receiverType = receiver ? kotlinNodeText(source, receiver).trim() : undefined;
  const modifiers = getKotlinChildNamed(node, "modifiers");
  const suspend = modifiers ? findKotlinDescendants(modifiers, (child) => child.name === "SUSPEND").length > 0 : false;
  let typeIndex = -1;
  for (let index = 0; index < scopes.length; index += 1) {
    if (scopes[index].kind === "type") typeIndex = index;
  }
  return Object.freeze({ node, body, name,
    lexicalScope: Object.freeze({ from: lexicalScope.from, to: lexicalScope.to }),
    qualifiedName: [...scopes.map((scope) => scope.name), ...(receiverType ? [receiverType] : []), name].join("."),
    kind: scopes.at(-1)?.kind === "type" ? "method" : "function",
    selectionFrom: nameNode.from, selectionTo: nameNode.to,
    expressionBody: Boolean(body && getKotlinChildNamed(body, "ASSIGNMENT")),
    parameterCount: parameters.length, parameters: Object.freeze(parameters), receiverType, suspend,
    lexicalTypeOwner: typeIndex < 0 ? "" : scopes.slice(0, typeIndex + 1).map((scope) => scope.name).join(".")
  });
}

/** Reads parameter type, default expression, and vararg modifier as source literals. */
function createParameter(source: KotlinSource, node: KotlinSyntaxNode): KotlinParameterSyntax {
  const parameter = getKotlinChildNamed(node, "parameter");
  const name = parameter && getKotlinChildNamed(parameter, "simpleIdentifier");
  const type = parameter && getKotlinChildNamed(parameter, "type");
  const defaultExpression = getKotlinChildNamed(node, "expression");
  const modifiers = getKotlinChildNamed(node, "parameterModifiers");
  return Object.freeze({ node, name: name ? unescapeIdentifier(kotlinNodeText(source, name)) : "parameter",
    typeText: type ? kotlinNodeText(source, type).trim() : undefined,
    defaultText: defaultExpression ? kotlinNodeText(source, defaultExpression).trim() : undefined,
    ...(modifiers && findKotlinDescendants(modifiers, (child) => child.name === "VARARG").length > 0 ? { vararg: true } : {}) });
}

/** Converts class/object/companion syntax into graph-compatible lexical ownership. */
function createOwner(source: KotlinSource, node: KotlinSyntaxNode, scopes: readonly Scope[]): KotlinOwnerSyntax {
  const nameNode = getKotlinChildNamed(node, "simpleIdentifier");
  const position = kotlinOffsetsRange(source, node.from, node.from);
  const name = nameNode ? unescapeIdentifier(kotlinNodeText(source, nameNode))
    : node.name === "companionObject" ? "Companion" : `<object@${position.startLine + 1}:${position.startCharacter + 1}>`;
  const modifiers = getKotlinChildNamed(node, "modifiers");
  const enumType = modifiers ? findKotlinDescendants(modifiers, (child) => child.name === "ENUM").length > 0 : false;
  return Object.freeze({ node, name, qualifiedName: [...scopes.map((scope) => scope.name), name].join("."),
    kind: getKotlinChildNamed(node, "INTERFACE") ? "interface" : enumType ? "enum" : "class",
    selectionFrom: nameNode?.from ?? node.from, selectionTo: nameNode?.to ?? node.from });
}

/** Unwraps the official statements container while preserving its direct lexical level. */
function getKotlinBodyStatementsFromContainer(node: KotlinSyntaxNode): KotlinSyntaxNode[] {
  const statements = node.name === "statements" ? node : getKotlinChildNamed(node, "statements");
  return statements?.children.filter((child) => child.name === "statement") ?? [];
}

/** Joins actual grammar terminals, preserving spaces inside backtick identifiers and nested comment trivia. */
function readCalleeTokens(source: KotlinSource, root: KotlinSyntaxNode, end: number): string {
  const tokens: string[] = [];
  const pending = [root];
  const visited = new Set<KotlinSyntaxNode>();
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node || node.from >= end || visited.has(node)) continue;
    visited.add(node);
    if (node.children.length === 0) {
      // Grammar rules are lowerCamelCase; only terminal leaves contribute to a
      // callee. Hidden comments/whitespace never enter the normalized tree.
      if (node.to <= end && /^[A-Z]/u.test(node.name) && node.name !== "NL" && node.name !== "EOF") {
        tokens.push(kotlinNodeText(source, node));
      }
      continue;
    }
    for (let index = node.children.length - 1; index >= 0; index -= 1) pending.push(node.children[index]);
  }
  return tokens.join("");
}

/** Backtick identifiers have the same lexical name as their unquoted call target. */
function unescapeIdentifier(text: string): string {
  return text.startsWith("`") && text.endsWith("`") ? text.slice(1, -1) : text;
}
