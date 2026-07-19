/**
 * Java Function Logic syntax interpretation. It matches graph callables,
 * classifies visible statements, and collects exact invocation expressions.
 */

import type { SyntaxNode } from "@lezer/common";
import type { SymbolNode } from "../../../../shared/types";
import type {
  FunctionLogicBlock,
  FunctionLogicBlockKind,
  FunctionLogicCallsite,
  FunctionLogicConfidence,
  FunctionLogicGap
} from "../../types";
import type {
  LezerCallableDescriptor,
  LezerStatementTask
} from "../../core/lezerFunctionLogicAnalyzer";
import {
  compactLezerText,
  findLezerDescendants,
  getLezerChildren,
  lezerNodeRange,
  lezerOffsetsRange,
  type LezerSource
} from "../../../core/lezerSource";
import {
  createFunctionLogicBlockId,
  isPotentialFunctionEffectCall
} from "../../core/functionLogicSupport";
import {
  collectJavaCallables,
  collectJavaCalls,
  createJavaCallableSignature,
  getJavaBodyStatements,
  getJavaCallableBodyRange,
  isJavaNestedScope,
  type JavaCallableSyntax
} from "../../../languages/java/javaLezerSyntax";
import { collectJavaValueChanges } from "../../valueChanges";

const JAVA_CONTROL_NODES = new Map<string, {
  kind: FunctionLogicBlockKind;
  keyword: string;
  detail: string;
}>([
  ["IfStatement", {
    kind: "condition",
    keyword: "if",
    detail: "Chooses the true or false branch from this condition."
  }],
  ["WhileStatement", {
    kind: "loop",
    keyword: "while",
    detail: "Repeats the body while the loop condition remains true."
  }],
  ["ForStatement", {
    kind: "loop",
    keyword: "for",
    detail: "Repeats the body while the for-loop specification continues."
  }],
  ["EnhancedForStatement", {
    kind: "loop",
    keyword: "for",
    detail: "Repeats the body for each value from the iterable."
  }],
  ["DoStatement", {
    kind: "loop",
    keyword: "do / while",
    detail: "Executes the body before checking whether to repeat it."
  }],
  ["SwitchStatement", {
    kind: "switch",
    keyword: "switch",
    detail: "Dispatches control to a matching case or default branch."
  }]
]);

/** Locates a graph symbol's Java callable body by source identity and name. */
export function findSelectedJavaCallable(
  source: LezerSource,
  graphNode: SymbolNode
): LezerCallableDescriptor | undefined {
  const wantedNames = new Set([
    graphNode.name,
    graphNode.qualifiedName.split(".").at(-1) ?? graphNode.name
  ].filter(Boolean));
  const allowPositionFallback = graphNode.metadata?.cursorResolved === true;
  const candidates = collectJavaCallables(source).flatMap((callable) => {
    const selection = lezerOffsetsRange(
      source,
      callable.selectionFrom,
      callable.selectionTo
    );
    const exactPosition = selection.startLine === graphNode.selectionRange.startLine
      && selection.startCharacter === graphNode.selectionRange.startCharacter;
    const nameMatches = wantedNames.has(callable.name);
    if (!nameMatches && !(allowPositionFallback && exactPosition)) {
      return [];
    }
    const distance = Math.abs(selection.startLine - graphNode.selectionRange.startLine) * 10_000
      + Math.abs(selection.startCharacter - graphNode.selectionRange.startCharacter);
    return [{ callable, exactPosition, distance }];
  }).sort((left, right) =>
    Number(right.exactPosition) - Number(left.exactPosition)
    || Number(right.callable.qualifiedName === graphNode.qualifiedName)
      - Number(left.callable.qualifiedName === graphNode.qualifiedName)
    || left.distance - right.distance
  );
  return candidates[0]
    ? createJavaDescriptor(source, candidates[0].callable)
    : undefined;
}

/** Returns a method's direct statements or a lambda's expression body. */
export function getJavaRootStatements(
  _source: LezerSource,
  callable: LezerCallableDescriptor
): SyntaxNode[] {
  return callable.expressionBody ? [callable.body] : getJavaBodyStatements(callable.body);
}

/** Classifies one visible Java statement with exact source evidence. */
export function classifyJavaStatement(
  source: LezerSource,
  filePath: string,
  task: LezerStatementTask
): FunctionLogicBlock {
  const node = task.node;
  let kind: FunctionLogicBlockKind = "operation";
  let confidence: FunctionLogicConfidence = "exact";
  let label = compactLezerText(source.text.slice(node.from, node.to), "Statement");
  let detail = "Executes one Java source statement.";
  const control = JAVA_CONTROL_NODES.get(node.name);
  const valueChanges = collectJavaValueChanges(source, node);

  if (task.implicitReturn) {
    kind = "return";
    label = `return ${compactLezerText(source.text.slice(node.from, node.to), "expression")}`;
    detail = "Expression-bodied lambda implicitly returns this value.";
  } else if (control) {
    kind = control.kind;
    label = createJavaControlLabel(source, node, control.keyword);
    detail = control.detail;
  } else if (node.name === "TryStatement" || node.name === "TryWithResourcesStatement") {
    kind = "try";
    label = node.name === "TryWithResourcesStatement"
      ? "try with resources / catch / finally"
      : "try / catch / finally";
    detail = "Separates normal, exceptional, resource, and cleanup control paths.";
  } else if (node.name === "ReturnStatement") {
    kind = "return";
    detail = "Ends this method and returns control to its caller.";
  } else if (node.name === "ThrowStatement") {
    kind = "throw";
    detail = "Ends the normal path by throwing an exception.";
  } else if (node.name === "BreakStatement") {
    kind = "break";
    label = "break";
    detail = "Leaves the nearest loop or switch.";
  } else if (node.name === "ContinueStatement") {
    kind = "continue";
    label = "continue";
    detail = "Starts the next iteration of the nearest loop.";
  } else if (isJavaMutationStatement(node)) {
    kind = "mutation";
    detail = "Variable declaration, assignment, or update mutates local or object state.";
  } else {
    const calls = collectJavaCallNames(source, node, true);
    if (valueChanges.length > 0) {
      kind = "mutation";
      confidence = valueChanges.some((change) => change.confidence === "exact")
        ? "exact"
        : "inferred";
      detail = confidence === "exact"
        ? "Shows which Java variable or field receives a new source-level value."
        : "A known in-place method suggests that its receiver may change; verify the callee semantics.";
    } else if (calls.length > 0) {
      const effectCall = calls.find(isPotentialFunctionEffectCall);
      kind = effectCall ? "effect" : "call";
      confidence = effectCall ? "inferred" : "exact";
      detail = effectCall
        ? `Possible state or external effect suggested by ${effectCall}; verify the callee implementation.`
        : `Calls ${calls.slice(0, 3).join(", ")}${calls.length > 3 ? ` and ${calls.length - 3} more` : ""}.`;
    }
  }

  const range = lezerNodeRange(source, node);
  return {
    id: createFunctionLogicBlockId(filePath, kind, range, label),
    kind,
    label,
    detail,
    depth: task.depth,
    branchLabel: task.branchLabel,
    confidence,
    valueChanges: valueChanges.length > 0 ? valueChanges : undefined,
    filePath,
    range
  };
}

/** Collects direct Java calls while pruning nested callable and type scopes. */
export function collectJavaFunctionCallsites(
  source: LezerSource,
  filePath: string,
  callable: LezerCallableDescriptor
): FunctionLogicCallsite[] {
  return collectJavaCalls(source, callable.body).map((call) => ({
    filePath,
    range: lezerNodeRange(source, call.node),
    calleeName: call.calleeName,
    calleeText: call.calleeText
  }));
}

/** Returns honest static-analysis limitations for every Java projection. */
export function createJavaFunctionLogicGaps(): FunctionLogicGap[] {
  return [{
    code: "parseLimited",
    message: "Boolean short-circuiting, ternaries, stream pipelines, expression-level switches, and labeled break/continue targets are simplified inside their containing block."
  }, {
    code: "dynamicBehavior",
    message: "Virtual dispatch, reflection, framework interception, exceptions from callees, threads, and runtime values are not observed."
  }];
}

/** Converts shared Java callable syntax into the core analyzer descriptor. */
function createJavaDescriptor(
  source: LezerSource,
  callable: JavaCallableSyntax
): LezerCallableDescriptor {
  return {
    node: callable.node,
    body: callable.body,
    signature: createJavaCallableSignature(source, callable),
    bodyRange: getJavaCallableBodyRange(source, callable),
    expressionBody: callable.expressionBody,
    lexicalOwnerQualifiedName: callable.lexicalTypeOwner || undefined
  };
}

/** Creates a concise control label ending before the owned statement body. */
function createJavaControlLabel(
  source: LezerSource,
  node: SyntaxNode,
  fallback: string
): string {
  const children = getLezerChildren(node);
  const body = node.name === "DoStatement"
    ? children.find((child) => child.name === "Block")
    : children.find((child) =>
      child.name === "Block"
      || child.name === "SwitchBlock"
      || child.name.endsWith("Statement")
    );
  return compactLezerText(
    source.text.slice(node.from, body?.from ?? node.to),
    fallback
  );
}

/** Tests declaration and expression forms that mutate Java state. */
function isJavaMutationStatement(node: SyntaxNode): boolean {
  if (node.name === "LocalVariableDeclaration") {
    return true;
  }
  return findLezerDescendants(
    node,
    (candidate) => candidate.name === "AssignmentExpression"
      || candidate.name === "UpdateExpression",
    (candidate) => candidate.name === "Block" || isJavaNestedScope(candidate)
  ).length > 0;
}

/** Collects calls belonging to a statement header or complete simple statement. */
function collectJavaCallNames(
  source: LezerSource,
  root: SyntaxNode,
  skipBodies: boolean
): string[] {
  return collectJavaCalls(source, root, skipBodies).map((call) => call.calleeText);
}
