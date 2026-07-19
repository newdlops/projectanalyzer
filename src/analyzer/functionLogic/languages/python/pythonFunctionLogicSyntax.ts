/**
 * Python Function Logic syntax interpretation. It matches graph callables,
 * classifies visible statements, and collects exact direct call expressions.
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
  LezerStatementInput,
  LezerStatementTask
} from "../../core/lezerFunctionLogicAnalyzer";
import {
  getLezerChildren,
  lezerNodeRange,
  lezerOffsetsRange,
  normalizeLezerText,
  type LezerSource
} from "../../../core/lezerSource";
import {
  createFunctionLogicBlockId,
  isPotentialFunctionEffectCall
} from "../../core/functionLogicSupport";
import {
  collectPythonCallables,
  collectPythonCalls,
  createPythonCallableSignature,
  getPythonBodyStatements,
  getPythonCallableBodyRange,
  type PythonCallableSyntax
} from "../../../languages/python/pythonLezerSyntax";
import { collectPythonValueChanges } from "../../valueChanges";
import {
  classifyPythonExpressionFlowTask,
  expandPythonFlowStatements
} from "./pythonExpressionFlow";

const PYTHON_MUTATION_NODES = new Set([
  "AssignStatement",
  "DeleteStatement",
  "UpdateStatement"
]);

/** Locates a graph symbol's callable body by source identity and lexical name. */
export function findSelectedPythonCallable(
  source: LezerSource,
  graphNode: SymbolNode
): LezerCallableDescriptor | undefined {
  const wantedNames = new Set([
    graphNode.name,
    graphNode.qualifiedName.split(".").at(-1) ?? graphNode.name
  ].filter(Boolean));
  const allowPositionFallback = graphNode.metadata?.cursorResolved === true;
  const candidates = collectPythonCallables(source).flatMap((callable) => {
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
    ? createPythonDescriptor(source, candidates[0].callable)
    : undefined;
}

/** Returns a selected callable's direct body statements or lambda expression. */
export function getPythonRootStatements(
  source: LezerSource,
  callable: LezerCallableDescriptor
): LezerStatementInput[] {
  return expandPythonFlowStatements(
    source,
    callable.expressionBody ? [callable.body] : getPythonBodyStatements(callable.body)
  );
}

/** Classifies one visible Python statement with exact source evidence. */
export function classifyPythonStatement(
  source: LezerSource,
  filePath: string,
  task: LezerStatementTask
): FunctionLogicBlock {
  const expressionFlowBlock = classifyPythonExpressionFlowTask(source, filePath, task);
  if (expressionFlowBlock) {
    return expressionFlowBlock;
  }
  const node = task.node;
  let kind: FunctionLogicBlockKind = "operation";
  let confidence: FunctionLogicConfidence = "exact";
  let label = normalizeLezerText(source.text.slice(node.from, node.to), "Statement");
  let detail = "Executes one Python source statement.";
  const valueChanges = collectPythonValueChanges(source, node);

  if (task.implicitReturn) {
    kind = "return";
    label = `return ${normalizeLezerText(source.text.slice(node.from, node.to), "expression")}`;
    detail = "Lambda expression implicitly returns this value.";
  } else if (node.name === "IfStatement") {
    kind = "condition";
    label = createPythonControlLabel(source, node, "if", "condition");
    detail = "Chooses an if, elif, or else branch from source conditions.";
  } else if (node.name === "WhileStatement" || node.name === "ForStatement") {
    kind = "loop";
    label = createPythonControlLabel(
      source,
      node,
      node.name === "WhileStatement" ? "while" : "for",
      "iteration"
    );
    detail = "Repeats the body while the condition or iterator continues.";
  } else if (node.name === "MatchStatement") {
    kind = "switch";
    label = createPythonControlLabel(source, node, "match", "value");
    detail = "Dispatches control to a matching case pattern.";
  } else if (node.name === "TryStatement") {
    kind = "try";
    label = "try / except / finally";
    detail = "Separates normal, exceptional, and cleanup control paths.";
  } else if (node.name === "WithStatement") {
    kind = "try";
    label = createPythonWithLabel(source, node);
    detail = "Enters the context managers, executes the nested statements, then guarantees context exit.";
  } else if (node.name === "ReturnStatement") {
    kind = "return";
    detail = "Ends this function and returns control to its caller.";
  } else if (node.name === "RaiseStatement") {
    kind = "throw";
    label = label.replace(/^raise\b/u, "raise");
    detail = "Ends the normal path by raising an exception.";
  } else if (node.name === "BreakStatement") {
    kind = "break";
    label = "break";
    detail = "Leaves the nearest loop.";
  } else if (node.name === "ContinueStatement") {
    kind = "continue";
    label = "continue";
    detail = "Starts the next iteration of the nearest loop.";
  } else if (PYTHON_MUTATION_NODES.has(node.name)) {
    kind = "mutation";
    detail = "Assignment, update, or deletion mutates a binding or object value.";
  } else {
    const calls = collectPythonCallNames(source, node, true);
    if (valueChanges.length > 0) {
      kind = "mutation";
      confidence = valueChanges.some((change) => change.confidence === "exact")
        ? "exact"
        : "inferred";
      detail = confidence === "exact"
        ? "Shows which Python binding or property receives a new source-level value."
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

/** Collects direct calls while pruning nested function, class, and lambda scopes. */
export function collectPythonFunctionCallsites(
  source: LezerSource,
  filePath: string,
  callable: LezerCallableDescriptor
): FunctionLogicCallsite[] {
  return collectPythonCalls(source, callable.body).map((call) => ({
    filePath,
    range: lezerNodeRange(source, call.node),
    calleeName: call.calleeName,
    calleeText: call.calleeText,
    callChain: call.callChain
  }));
}

/** Returns honest static-analysis limitations for every Python projection. */
export function createPythonFunctionLogicGaps(): FunctionLogicGap[] {
  return [{
    code: "parseLimited",
    message: "Boolean short-circuiting, standalone lazy generator expressions, nested comprehension result expressions, and other expression-level conditions stay inside their containing block. Generator-argument loops are structural; whether and how far a callee consumes them remains inferred."
  }, {
    code: "dynamicBehavior",
    message: "Monkey patching, decorators, descriptors, dynamic dispatch, exceptions from callees, and runtime values are not observed."
  }];
}

/** Converts shared Python callable syntax into the core analyzer descriptor. */
function createPythonDescriptor(
  source: LezerSource,
  callable: PythonCallableSyntax
): LezerCallableDescriptor {
  return {
    node: callable.node,
    body: callable.body,
    signature: createPythonCallableSignature(source, callable),
    bodyRange: getPythonCallableBodyRange(source, callable),
    expressionBody: callable.expressionBody,
    lexicalOwnerQualifiedName: callable.lexicalClassOwner || undefined
  };
}

/** Creates a concise control header ending before the first indented body. */
function createPythonControlLabel(
  source: LezerSource,
  node: SyntaxNode,
  keyword: string,
  fallback: string
): string {
  const firstBody = getLezerChildren(node).find((child) =>
    child.name === "Body" || child.name === "MatchBody"
  );
  const end = firstBody?.from ?? node.to;
  const header = normalizeLezerText(
    source.text.slice(node.from, end).replace(/:\s*$/u, ""),
    fallback
  );
  return header.startsWith(keyword) ? header : `${keyword} ${header}`;
}

/** Keeps a with control block limited to its header instead of duplicating its body. */
function createPythonWithLabel(
  source: LezerSource,
  node: SyntaxNode
): string {
  const body = getLezerChildren(node).find((child) => child.name === "Body");
  return normalizeLezerText(
    source.text.slice(node.from, body?.from ?? node.to).replace(/:\s*$/u, ""),
    "with context"
  );
}

/** Collects calls belonging to one statement header or complete simple statement. */
function collectPythonCallNames(
  source: LezerSource,
  root: SyntaxNode,
  skipBodies: boolean
): string[] {
  return collectPythonCalls(source, root, skipBodies).map((call) => call.calleeText);
}
