/**
 * Python and Java Function Logic value-flow fact collectors. Each collector
 * interprets its Lezer grammar but shares bounded, iterative traversal and
 * stable binding identity helpers; nested callable scopes are always pruned.
 */

import type { SyntaxNode } from "@lezer/common";
import { createContentHash } from "../../../shared/hash";
import {
  getLezerChildNamed,
  getLezerChildren,
  lezerNodeRange,
  type LezerSource
} from "../../core/lezerSource";
import { isJavaNestedScope } from "../../languages/java/javaLezerSyntax";
import { isPythonNestedScope } from "../../languages/python/pythonLezerSyntax";
import type { LezerCallableDescriptor } from "../core/lezerFunctionLogicAnalyzer";
import type {
  FunctionLogicValueAccessFact,
  FunctionLogicValueBindingFact,
  FunctionLogicValueBindingKind,
  FunctionLogicValueFacts
} from "./types";

const MAX_VALUE_BINDINGS = 80;
const MAX_VALUE_ACCESSES = 700;

type LezerBindingCandidate = {
  name: string;
  node: SyntaxNode;
  kind: FunctionLogicValueBindingKind;
  definitionPlacement: "entry" | "source";
  confidence: "exact" | "inferred";
};

/** Collects Python parameters, function-local assignments, and uppercase constants. */
export function collectPythonFunctionValueFacts(
  source: LezerSource,
  callable: LezerCallableDescriptor
): FunctionLogicValueFacts {
  const parameters = collectPythonParameters(source, callable.node);
  const targetAccessByNodeKey = collectPythonTargetAccesses(source, callable.body);
  const excludedNames = collectPythonScopeDeclarationNames(source, callable.body);
  const firstTargetByName = new Map<string, SyntaxNode>();
  const writeCountByName = new Map<string, number>();
  for (const [key, target] of targetAccessByNodeKey) {
    const name = source.text.slice(target.node.from, target.node.to);
    if (excludedNames.has(name)) {
      targetAccessByNodeKey.delete(key);
      continue;
    }
    if (!firstTargetByName.has(name)) {
      firstTargetByName.set(name, target.node);
    }
    writeCountByName.set(name, (writeCountByName.get(name) ?? 0) + 1);
  }
  const parameterNames = new Set(parameters.map((candidate) => candidate.name));
  const locals: LezerBindingCandidate[] = [...firstTargetByName].flatMap(([name, node]) => {
    if (parameterNames.has(name)) {
      return [];
    }
    const inferredConstant = isPythonConstantName(name)
      && writeCountByName.get(name) === 1;
    return [{
      name,
      node,
      kind: inferredConstant ? "constant" as const : "local" as const,
      definitionPlacement: "source" as const,
      confidence: inferredConstant ? "inferred" as const : "exact" as const
    }];
  });
  return createLezerValueFacts(
    source,
    callable.body,
    [...parameters, ...locals],
    targetAccessByNodeKey,
    (node) => node.name === "VariableName",
    isPythonValueName,
    isPythonNestedScope
  );
}

/** Collects Java parameters, mutable locals, and exact `final` local constants. */
export function collectJavaFunctionValueFacts(
  source: LezerSource,
  callable: LezerCallableDescriptor
): FunctionLogicValueFacts {
  const parameters = collectJavaParameters(source, callable.node);
  const locals = collectJavaLocals(source, callable.body);
  const targetAccessByNodeKey = collectJavaTargetAccesses(source, callable.body);
  return createLezerValueFacts(
    source,
    callable.body,
    [...parameters, ...locals],
    targetAccessByNodeKey,
    (node) => node.name === "Identifier",
    isJavaValueIdentifier,
    isJavaNestedScope
  );
}

/** Reads the first direct Python name from each comma-delimited parameter segment. */
function collectPythonParameters(
  source: LezerSource,
  callableNode: SyntaxNode
): LezerBindingCandidate[] {
  const parameters = getLezerChildNamed(callableNode, "ParamList");
  if (!parameters) {
    return [];
  }
  const result: LezerBindingCandidate[] = [];
  let foundInSegment = false;
  for (const child of getLezerChildren(parameters)) {
    if (source.text.slice(child.from, child.to) === ",") {
      foundInSegment = false;
      continue;
    }
    if (!foundInSegment && child.name === "VariableName") {
      result.push(createCandidate(source, child, "parameter", "entry", "exact"));
      foundInSegment = true;
    }
  }
  return result;
}

/** Finds Python assignment/iteration targets and their write semantics. */
function collectPythonTargetAccesses(
  source: LezerSource,
  root: SyntaxNode
): Map<string, { node: SyntaxNode; access: "write" | "readwrite" }> {
  const result = new Map<string, { node: SyntaxNode; access: "write" | "readwrite" }>();
  walkLezerTree(root, isPythonNestedScope, (node) => {
    if (node.name === "AssignStatement" || node.name === "NamedExpression") {
      appendNamesBeforeMarker(source, node, "AssignOp", "write", result);
    } else if (node.name === "UpdateStatement") {
      appendNamesBeforeMarker(source, node, "UpdateOp", "readwrite", result);
    } else if (node.name === "ForStatement") {
      appendNamesBetweenTokens(source, node, "for", "in", "write", result);
    } else if (node.name === "WithStatement") {
      appendNamesAfterTokenBeforeBody(source, node, "as", "write", result);
    } else if (node.name === "TryStatement") {
      appendNamesAfterTokenBeforeBody(source, node, "as", "write", result);
    }
  });
  return result;
}

/** Excludes names declared `global` or `nonlocal` from function-local flow. */
function collectPythonScopeDeclarationNames(
  source: LezerSource,
  root: SyntaxNode
): Set<string> {
  const result = new Set<string>();
  walkLezerTree(root, isPythonNestedScope, (node) => {
    if (node.name !== "ScopeStatement") {
      return;
    }
    for (const child of getLezerChildren(node)) {
      if (child.name === "VariableName") {
        result.add(source.text.slice(child.from, child.to));
      }
    }
  });
  return result;
}

/** Reads Java formal, spread, and inferred lambda parameter definitions. */
function collectJavaParameters(
  source: LezerSource,
  callableNode: SyntaxNode
): LezerBindingCandidate[] {
  const result: LezerBindingCandidate[] = [];
  const pending = [callableNode];
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) continue;
    if (node !== callableNode && (node.name === "Block" || isJavaNestedScope(node))) {
      continue;
    }
    if (node.name === "Definition" && isJavaParameterDefinition(node)) {
      result.push(createCandidate(source, node, "parameter", "entry", "exact"));
      continue;
    }
    const children = getLezerChildren(node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index]);
    }
  }
  return result;
}

/** Reads Java body definitions and classifies `final` locals as constants. */
function collectJavaLocals(
  source: LezerSource,
  root: SyntaxNode
): LezerBindingCandidate[] {
  const result: LezerBindingCandidate[] = [];
  walkLezerTree(root, isJavaNestedScope, (node) => {
    if (node.name !== "Definition" || !isJavaLocalDefinition(node)) {
      return;
    }
    result.push(createCandidate(
      source,
      node,
      hasJavaFinalModifier(source, node) ? "constant" : "local",
      "source",
      "exact"
    ));
  });
  return result;
}

/** Finds direct Java assignments and updates for retained local names. */
function collectJavaTargetAccesses(
  source: LezerSource,
  root: SyntaxNode
): Map<string, { node: SyntaxNode; access: "write" | "readwrite" }> {
  const result = new Map<string, { node: SyntaxNode; access: "write" | "readwrite" }>();
  walkLezerTree(root, isJavaNestedScope, (node) => {
    if (node.name === "AssignmentExpression") {
      const children = getLezerChildren(node);
      const operatorIndex = children.findIndex((child) => child.name === "AssignOp");
      const target = operatorIndex > 0 ? children[operatorIndex - 1] : undefined;
      const operator = operatorIndex >= 0
        ? source.text.slice(children[operatorIndex].from, children[operatorIndex].to)
        : "=";
      if (target?.name === "Identifier") {
        result.set(nodeKey(target), {
          node: target,
          access: operator === "=" ? "write" : "readwrite"
        });
      }
    } else if (node.name === "UpdateExpression") {
      const identifier = getLezerChildren(node).find((child) => child.name === "Identifier");
      if (identifier) {
        result.set(nodeKey(identifier), { node: identifier, access: "readwrite" });
      }
    }
  });
  return result;
}

/**
 * Converts candidates and identifier occurrences to stable bounded facts.
 * Duplicate lexical names are omitted because this lightweight pass does not
 * claim exact resolution across shadowing declarations.
 */
function createLezerValueFacts(
  source: LezerSource,
  root: SyntaxNode,
  candidates: LezerBindingCandidate[],
  targetAccessByNodeKey: ReadonlyMap<string, {
    node: SyntaxNode;
    access: "write" | "readwrite";
  }>,
  isIdentifier: (node: SyntaxNode) => boolean,
  isValueIdentifier: (source: LezerSource, node: SyntaxNode) => boolean,
  isNestedScope: (node: SyntaxNode) => boolean
): FunctionLogicValueFacts {
  const candidatesByName = new Map<string, LezerBindingCandidate[]>();
  for (const candidate of candidates) {
    const values = candidatesByName.get(candidate.name) ?? [];
    if (!values.some((value) => nodeKey(value.node) === nodeKey(candidate.node))) {
      values.push(candidate);
      candidatesByName.set(candidate.name, values);
    }
  }
  const unique = candidates.filter((candidate) =>
    candidatesByName.get(candidate.name)?.length === 1
  );
  const retained = unique.slice(0, MAX_VALUE_BINDINGS);
  const bindings = retained.map((candidate) => createBindingFact(source, candidate));
  const bindingByName = new Map(bindings.map((binding) => [binding.name, binding]));
  const declarationKeys = new Set(retained.map((candidate) => nodeKey(candidate.node)));
  const accesses: FunctionLogicValueAccessFact[] = [];
  let omittedAccessCount = 0;

  walkLezerTree(root, isNestedScope, (node) => {
    if (!isIdentifier(node) || declarationKeys.has(nodeKey(node))
      || !isValueIdentifier(source, node)) {
      return;
    }
    const binding = bindingByName.get(source.text.slice(node.from, node.to));
    if (!binding) {
      return;
    }
    const target = targetAccessByNodeKey.get(nodeKey(node));
    const access = target?.access ?? "read";
    const usage = classifyLezerValueUsage(node, access);
    if (accesses.length >= MAX_VALUE_ACCESSES) {
      omittedAccessCount += 1;
      return;
    }
    accesses.push({
      bindingId: binding.id,
      access,
      ...(usage ? { usage } : {}),
      range: lezerNodeRange(source, node),
      confidence: "exact"
    });
  });

  return {
    bindings,
    accesses,
    omittedBindingCount: Math.max(0, unique.length - retained.length),
    omittedAccessCount
  };
}

/**
 * Classifies reads from both Lezer grammars without evaluating expressions.
 * Argument lists, returns/throws/yields, aggregates, and external assignment
 * targets are lexical sinks; ordinary computations remain consumes.
 */
function classifyLezerValueUsage(
  node: SyntaxNode,
  access: FunctionLogicValueAccessFact["access"]
): FunctionLogicValueAccessFact["usage"] {
  if (access === "write") return undefined;
  let current = node;
  while (current.parent) {
    const parent = current.parent;
    if (LEZER_SINK_OWNER_NAMES.has(parent.name)) return "sink";
    if (LEZER_AGGREGATE_NAMES.has(parent.name)) return "sink";
    const assignmentUsage = classifyLezerAssignmentUsage(parent, current);
    if (assignmentUsage) return assignmentUsage;
    if (LEZER_CALL_NAMES.has(parent.name)) {
      // Arguments encounter ArgList/ArgumentList first. Reaching the call node
      // here means this binding supplies only the callee or receiver.
      return "consume";
    }
    if (parent.name.endsWith("Statement") || isPythonNestedScope(parent)
      || isJavaNestedScope(parent)) {
      break;
    }
    current = parent;
  }
  return "consume";
}

const LEZER_SINK_OWNER_NAMES = new Set([
  "ArgList",
  "ArgumentList",
  "ReturnStatement",
  "ThrowStatement",
  "RaiseStatement",
  "YieldExpression",
  "YieldStatement"
]);

const LEZER_AGGREGATE_NAMES = new Set([
  "ArrayExpression",
  "DictionaryExpression",
  "SetExpression",
  "TupleExpression",
  "ArrayInitializer"
]);

const LEZER_CALL_NAMES = new Set([
  "CallExpression",
  "MethodInvocation",
  "ClassInstanceCreationExpression",
  "ExplicitConstructorInvocation",
  "ConstructorInvocation",
  "SuperConstructorInvocation"
]);

/** Distinguishes an assignment RHS sink from receiver/index reads on its LHS. */
function classifyLezerAssignmentUsage(
  parent: SyntaxNode,
  child: SyntaxNode
): FunctionLogicValueAccessFact["usage"] {
  if (parent.name !== "AssignStatement" && parent.name !== "UpdateStatement"
    && parent.name !== "NamedExpression" && parent.name !== "AssignmentExpression") {
    return undefined;
  }
  const children = getLezerChildren(parent);
  const markerIndex = children.findIndex((candidate) =>
    candidate.name === "AssignOp" || candidate.name === "UpdateOp"
  );
  const childIndex = children.findIndex((candidate) => nodeKey(candidate) === nodeKey(child));
  if (markerIndex < 0 || childIndex < 0) return undefined;
  if (childIndex < markerIndex) return "consume";
  const target = children.slice(0, markerIndex).find((candidate) =>
    !candidate.type.isAnonymous
  );
  return target && LEZER_EXTERNAL_TARGET_NAMES.has(target.name)
    ? "sink"
    : "consume";
}

const LEZER_EXTERNAL_TARGET_NAMES = new Set([
  "MemberExpression",
  "FieldAccess",
  "ArrayAccess"
]);

/** Creates one stable parser-independent binding fact. */
function createBindingFact(
  source: LezerSource,
  candidate: LezerBindingCandidate
): FunctionLogicValueBindingFact {
  const range = lezerNodeRange(source, candidate.node);
  const key = [
    candidate.kind,
    candidate.name,
    candidate.node.from,
    candidate.node.to
  ].join("\0");
  return {
    id: `logic-value-binding:${createContentHash(key).slice(0, 32)}`,
    name: candidate.name,
    kind: candidate.kind,
    declarationRange: range,
    definitionPlacement: candidate.definitionPlacement,
    confidence: candidate.confidence
  };
}

/** Creates a concise candidate from one grammar-owned name node. */
function createCandidate(
  source: LezerSource,
  node: SyntaxNode,
  kind: FunctionLogicValueBindingKind,
  definitionPlacement: "entry" | "source",
  confidence: "exact" | "inferred"
): LezerBindingCandidate {
  return {
    name: source.text.slice(node.from, node.to),
    node,
    kind,
    definitionPlacement,
    confidence
  };
}

/** Adds direct Python VariableName children before an assignment marker. */
function appendNamesBeforeMarker(
  source: LezerSource,
  node: SyntaxNode,
  markerName: string,
  access: "write" | "readwrite",
  result: Map<string, { node: SyntaxNode; access: "write" | "readwrite" }>
): void {
  const children = getLezerChildren(node);
  const markerIndex = children.reduce(
    (selected, child, index) => child.name === markerName ? index : selected,
    -1
  );
  const targetChildren = markerIndex >= 0 ? children.slice(0, markerIndex) : [];
  for (const child of targetChildren) {
    appendVariableNameDescendants(source, child, access, result);
  }
}

/** Adds Python target names between two direct keyword tokens. */
function appendNamesBetweenTokens(
  source: LezerSource,
  node: SyntaxNode,
  startToken: string,
  endToken: string,
  access: "write" | "readwrite",
  result: Map<string, { node: SyntaxNode; access: "write" | "readwrite" }>
): void {
  let active = false;
  for (const child of getLezerChildren(node)) {
    const text = source.text.slice(child.from, child.to);
    if (text === startToken) {
      active = true;
      continue;
    }
    if (text === endToken) break;
    if (active) appendVariableNameDescendants(source, child, access, result);
  }
}

/** Adds a Python `as name` target before the following body. */
function appendNamesAfterTokenBeforeBody(
  source: LezerSource,
  node: SyntaxNode,
  token: string,
  access: "write" | "readwrite",
  result: Map<string, { node: SyntaxNode; access: "write" | "readwrite" }>
): void {
  let active = false;
  for (const child of getLezerChildren(node)) {
    const text = source.text.slice(child.from, child.to);
    if (text === token) {
      active = true;
      continue;
    }
    if (active && child.name === "Body") {
      active = false;
      continue;
    }
    if (active && child.name === "VariableName") {
      result.set(nodeKey(child), { node: child, access });
      active = false;
    }
  }
}

/** Iteratively collects target variables beneath tuple/list patterns. */
function appendVariableNameDescendants(
  _source: LezerSource,
  root: SyntaxNode,
  access: "write" | "readwrite",
  result: Map<string, { node: SyntaxNode; access: "write" | "readwrite" }>
): void {
  const pending = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) continue;
    if (node.name === "VariableName") {
      result.set(nodeKey(node), { node, access });
      continue;
    }
    const children = getLezerChildren(node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index]);
    }
  }
}

/** Checks whether a Java definition belongs to the selected callable signature. */
function isJavaParameterDefinition(node: SyntaxNode): boolean {
  let current = node.parent;
  while (current) {
    if (current.name === "FormalParameter" || current.name === "SpreadParameter"
      || current.name === "InferredParameters") return true;
    if (current.name === "Block" || current.name === "MethodDeclaration"
      || current.name === "ConstructorDeclaration") return false;
    current = current.parent;
  }
  return false;
}

/** Checks whether a Java definition is a local, loop, resource, or catch binding. */
function isJavaLocalDefinition(node: SyntaxNode): boolean {
  let current = node.parent;
  while (current) {
    if (current.name === "VariableDeclarator" || current.name === "ForSpec"
      || current.name === "Resource" || current.name === "CatchFormalParameter") return true;
    if (current.name === "Block" || isJavaNestedScope(current)) return false;
    current = current.parent;
  }
  return false;
}

/** Finds an exact Java `final` modifier before the enclosing declaration boundary. */
function hasJavaFinalModifier(source: LezerSource, node: SyntaxNode): boolean {
  let current = node.parent;
  while (current) {
    for (const child of getLezerChildren(current)) {
      if (child.name === "Modifiers"
        && /\bfinal\b/u.test(source.text.slice(child.from, child.to))) return true;
    }
    if (current.name === "LocalVariableDeclaration" || current.name === "ForSpec"
      || current.name === "Resource" || current.name === "CatchFormalParameter") return false;
    current = current.parent;
  }
  return false;
}

/** Python VariableName nodes already distinguish attribute property names. */
function isPythonValueName(_source: LezerSource, node: SyntaxNode): boolean {
  let current = node.parent;
  while (current && current.from === node.from && current.to === node.to) {
    if (current.name === "TypeDef") return false;
    current = current.parent;
  }
  return current?.name !== "TypeDef";
}

/** Excludes Java method and right-hand field identifiers from binding reads. */
function isJavaValueIdentifier(source: LezerSource, node: SyntaxNode): boolean {
  const parent = node.parent;
  if (!parent || parent.name === "MethodName") return false;
  if (parent.name === "FieldAccess") {
    const children = getLezerChildren(parent);
    const identifierChildren = children.filter((child) => child.name === "Identifier");
    const lastIdentifier = identifierChildren.at(-1);
    if (lastIdentifier && nodeKey(lastIdentifier) === nodeKey(node)
      && source.text.slice(parent.from, node.from).includes(".")) return false;
  }
  return true;
}

/** Python has no const keyword, so only its conventional uppercase shape is inferred. */
function isPythonConstantName(name: string): boolean {
  return /^[A-Z][A-Z0-9_]*$/u.test(name);
}

/** Iterative grammar walk shared by both language collectors. */
function walkLezerTree(
  root: SyntaxNode,
  isNestedScope: (node: SyntaxNode) => boolean,
  visit: (node: SyntaxNode) => void
): void {
  const pending = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) continue;
    if (node !== root && isNestedScope(node)) continue;
    visit(node);
    const children = getLezerChildren(node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index]);
    }
  }
}

/** Stable syntax-node identity for declaration and target occurrence maps. */
function nodeKey(node: SyntaxNode): string {
  return `${node.from}:${node.to}:${node.name}`;
}
