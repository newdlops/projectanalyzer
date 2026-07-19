/**
 * Python expression-level flow planning. Eager comprehensions become nested
 * loop/filter tasks and receiver-call chains become execution-ordered steps.
 * The shared Lezer scheduler consumes the resulting seeds without recursion.
 */

import type { SyntaxNode } from "@lezer/common";
import type {
  FunctionLogicBlock,
  FunctionLogicBlockKind,
  FunctionLogicConfidence,
  FunctionLogicValueChange
} from "../../types";
import type {
  LezerControlDescription,
  LezerStatementInput,
  LezerStatementSeed,
  LezerStatementTask
} from "../../core/lezerFunctionLogicAnalyzer";
import {
  createFunctionLogicBlockId,
  isPotentialFunctionEffectCall
} from "../../core/functionLogicSupport";
import {
  getLezerChildren,
  lezerOffsetsRange,
  normalizeLezerText,
  type LezerSource
} from "../../../core/lezerSource";
import {
  collectPythonCalls,
  createPythonCallSyntax,
  findPythonReceiverCall,
  isPythonGeneratorArgumentList,
  isPythonNestedScope
} from "../../../languages/python/pythonLezerSyntax";
import { collectPythonValueChanges } from "../../valueChanges";

const EAGER_COMPREHENSION_NAMES = new Set([
  "ArrayComprehensionExpression",
  "DictionaryComprehensionExpression",
  "SetComprehensionExpression"
]);
const ALL_COMPREHENSION_NAMES = new Set([
  ...EAGER_COMPREHENSION_NAMES,
  "ComprehensionExpression"
]);

type PythonComprehensionKind = "list" | "set" | "dictionary" | "generator argument";

type PythonExpressionSpan = {
  from: number;
  to: number;
  nodes: SyntaxNode[];
};

type PythonComprehensionClause = {
  kind: "loop" | "condition";
  from: number;
  to: number;
  expression: PythonExpressionSpan;
  target?: string;
  asynchronous?: boolean;
};

type PythonCallChainData = {
  feature: "pythonExpressionFlow";
  kind: "callChain";
  call: SyntaxNode;
  chainedFromPrevious: boolean;
};

type PythonComprehensionLoopData = {
  feature: "pythonExpressionFlow";
  kind: "comprehensionLoop";
  comprehensionKind: PythonComprehensionKind;
  from: number;
  to: number;
  target: string;
  iterable: string;
  asynchronous: boolean;
  body: LezerStatementInput[];
};

type PythonComprehensionConditionData = {
  feature: "pythonExpressionFlow";
  kind: "comprehensionCondition";
  comprehensionKind: PythonComprehensionKind;
  from: number;
  to: number;
  condition: string;
  body: LezerStatementInput[];
};

type PythonComprehensionResultData = {
  feature: "pythonExpressionFlow";
  kind: "comprehensionResult";
  comprehensionKind: PythonComprehensionKind;
  from: number;
  to: number;
  expression: string;
  nodes: SyntaxNode[];
  containsCallChain: boolean;
};

export type PythonExpressionFlowData =
  | PythonCallChainData
  | PythonComprehensionLoopData
  | PythonComprehensionConditionData
  | PythonComprehensionResultData;

/** Expands source-ordered statements while retaining raw commits/returns. */
export function expandPythonFlowStatements(
  source: LezerSource,
  statements: readonly SyntaxNode[]
): LezerStatementInput[] {
  return statements.flatMap((statement) => expandPythonFlowStatement(source, statement));
}

/**
 * Turns eager comprehensions and method chains in one direct statement into a
 * bounded flow sequence. Owned suites and nested callables are never entered.
 */
export function expandPythonFlowStatement(
  source: LezerSource,
  statement: SyntaxNode
): LezerStatementInput[] {
  // Re-evaluated while/elif headers and suite-owning statements keep their
  // expression calls on the control block. Hoisting them into preceding
  // siblings would incorrectly execute them once or evaluate later branches.
  if (hasOwnedStatementSuite(statement)) {
    return [statement];
  }
  const ownedComprehensions = findOwnedComprehensions(statement);
  const comprehensions = ownedComprehensions.filter((node) =>
    EAGER_COMPREHENSION_NAMES.has(node.name)
    || isPythonGeneratorArgumentList(node)
    || isGeneratorExpressionArgument(node, statement)
  );
  // Standalone lazy generator bodies stay excluded from eager chain steps.
  // Generator arguments are expanded with inferred consumption semantics.
  const comprehensionRanges = ownedComprehensions.map((node) => ({
    from: node.from,
    to: node.to
  }));
  const seeds: LezerStatementInput[] = [];

  for (const comprehension of comprehensions) {
    seeds.push(...createComprehensionSeeds(source, comprehension));
  }
  seeds.push(...createCallChainSeeds(source, [statement], comprehensionRanges));

  if (seeds.length === 0) {
    return [statement];
  }
  if (shouldRetainOriginalStatement(source, statement, seeds, comprehensionRanges)) {
    seeds.push(statement);
  }
  return seeds;
}

/** Detects statements whose header evaluation is owned by structured CFG. */
function hasOwnedStatementSuite(statement: SyntaxNode): boolean {
  return getLezerChildren(statement).some((child) =>
    child.name === "Body" || child.name === "MatchBody"
  );
}

/** Classifies one language-owned synthetic task, leaving raw statements alone. */
export function classifyPythonExpressionFlowTask(
  source: LezerSource,
  filePath: string,
  task: LezerStatementTask
): FunctionLogicBlock | undefined {
  const data = readPythonExpressionFlowData(task.adapterData);
  if (!data) {
    return undefined;
  }
  if (data.kind === "callChain") {
    return classifyCallChainTask(source, filePath, task, data);
  }
  if (data.kind === "comprehensionLoop") {
    const asyncPrefix = data.asynchronous ? "async " : "";
    const deferred = data.comprehensionKind === "generator argument";
    return createExpressionFlowBlock(source, filePath, task, {
      kind: "loop",
      label: `${asyncPrefix}for ${data.target} in ${data.iterable} · ${formatComprehensionContext(data.comprehensionKind)}`,
      detail: deferred
        ? `Describes deferred generator iterations if and when the receiving call consumes this argument.`
        : data.asynchronous
        ? `Asynchronously binds ${data.target} for each value before producing the ${data.comprehensionKind}.`
        : `Binds ${data.target} for each iterable value before producing the ${data.comprehensionKind}.`,
      from: data.from,
      to: data.to,
      confidence: deferred ? "inferred" : "exact",
      valueChanges: [{
        target: data.target,
        targetKind: "variable",
        operation: "iterate",
        operator: "← each",
        value: data.iterable,
        confidence: "exact"
      }]
    });
  }
  if (data.kind === "comprehensionCondition") {
    const deferred = data.comprehensionKind === "generator argument";
    return createExpressionFlowBlock(source, filePath, task, {
      kind: "condition",
      label: `if ${data.condition} · ${data.comprehensionKind} filter`,
      detail: deferred
        ? "Filters values only when the receiving call advances this generator argument."
        : `Keeps only iterations whose ${data.comprehensionKind}-comprehension filter is truthy.`,
      from: data.from,
      to: data.to,
      confidence: deferred ? "inferred" : "exact"
    });
  }
  const calls = data.nodes.flatMap((node) => collectPythonCalls(source, node))
    .filter((call) => call.node.from >= data.from && call.node.to <= data.to);
  const effect = calls.find((call) => isPotentialFunctionEffectCall(call.calleeName));
  const deferred = data.comprehensionKind === "generator argument";
  const kind: FunctionLogicBlockKind = data.containsCallChain
    ? "operation"
    : effect ? "effect" : calls.length > 0 ? "call" : "operation";
  return createExpressionFlowBlock(source, filePath, task, {
    kind,
    label: `${data.comprehensionKind} item ← ${data.expression}`,
    detail: deferred
      ? "Yields this value if and when the receiving call advances the generator argument."
      : data.containsCallChain
      ? `Adds the preceding chained-call result to the ${data.comprehensionKind}.`
      : `Evaluates and adds this value to the ${data.comprehensionKind} comprehension result.`,
    from: data.from,
    to: data.to,
    confidence: deferred || effect ? "inferred" : "exact"
  });
}

/** Returns nested loop/filter branches retained on a synthetic task. */
export function describePythonExpressionFlowControl(
  task: LezerStatementTask
): LezerControlDescription | undefined {
  const data = readPythonExpressionFlowData(task.adapterData);
  if (data?.kind === "comprehensionLoop") {
    return {
      kind: "loop",
      confidence: data.comprehensionKind === "generator argument"
        ? "inferred"
        : "exact",
      branches: [{
        role: "loopBody",
        edgeKind: "iterate",
        label: `each ${data.target}`,
        statements: data.body
      }]
    };
  }
  if (data?.kind === "comprehensionCondition") {
    return {
      kind: "condition",
      confidence: data.comprehensionKind === "generator argument"
        ? "inferred"
        : "exact",
      branches: [{
        role: "then",
        edgeKind: "true",
        label: "filter passed",
        statements: data.body
      }]
    };
  }
  return undefined;
}

/** Narrows unknown adapter metadata to this Python feature's private union. */
function readPythonExpressionFlowData(value: unknown): PythonExpressionFlowData | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const candidate = value as Partial<PythonExpressionFlowData>;
  return candidate.feature === "pythonExpressionFlow"
    ? value as PythonExpressionFlowData
    : undefined;
}

/** Builds the nested clause chain from the final emitted value backwards. */
function createComprehensionSeeds(
  source: LezerSource,
  comprehension: SyntaxNode
): LezerStatementInput[] {
  const parsed = parseComprehension(source, comprehension);
  if (!parsed || parsed.clauses.length === 0) {
    return [];
  }
  const resultChains = createCallChainSeeds(source, parsed.result.nodes, []);
  let current: LezerStatementInput[] = [
    ...resultChains,
    createSeed(parsed.result.nodes[0] ?? comprehension, {
      feature: "pythonExpressionFlow",
      kind: "comprehensionResult",
      comprehensionKind: parsed.kind,
      from: parsed.result.from,
      to: parsed.result.to,
      expression: normalizeLezerText(
        source.text.slice(parsed.result.from, parsed.result.to),
        "item"
      ),
      nodes: parsed.result.nodes,
      containsCallChain: resultChains.length > 0
    })
  ];

  for (let index = parsed.clauses.length - 1; index >= 0; index -= 1) {
    const clause = parsed.clauses[index];
    const expressionText = normalizeLezerText(
      source.text.slice(clause.expression.from, clause.expression.to),
      clause.kind === "loop" ? "iterable" : "condition"
    );
    const expressionChains = createCallChainSeeds(source, clause.expression.nodes, []);
    if (clause.kind === "condition") {
      const condition = createSeed(clause.expression.nodes[0] ?? comprehension, {
        feature: "pythonExpressionFlow",
        kind: "comprehensionCondition",
        comprehensionKind: parsed.kind,
        from: clause.from,
        to: clause.to,
        condition: expressionText,
        body: current
      });
      current = [...expressionChains, condition];
      continue;
    }
    const loop = createSeed(clause.expression.nodes[0] ?? comprehension, {
      feature: "pythonExpressionFlow",
      kind: "comprehensionLoop",
      comprehensionKind: parsed.kind,
      from: clause.from,
      to: clause.to,
      target: clause.target ?? "item",
      iterable: expressionText,
      asynchronous: clause.asynchronous === true,
      body: current
    });
    current = [...expressionChains, loop];
  }
  return current;
}

/** Finds outermost eager or generator-argument comprehensions in one statement. */
function findOwnedComprehensions(statement: SyntaxNode): SyntaxNode[] {
  const result: SyntaxNode[] = [];
  const pending: SyntaxNode[] = [statement];
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) {
      continue;
    }
    if (ALL_COMPREHENSION_NAMES.has(node.name)
      || isPythonGeneratorArgumentList(node)) {
      result.push(node);
      continue;
    }
    if (node !== statement && (
      isPythonNestedScope(node)
      || node.name === "Body"
      || node.name === "MatchBody"
    )) {
      continue;
    }
    const children = getLezerChildren(node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index]);
    }
  }
  return result.sort((left, right) => left.from - right.from || left.to - right.to);
}

/** Tests whether an explicit `(item for item in values)` belongs to a call argument. */
function isGeneratorExpressionArgument(
  node: SyntaxNode,
  statement: SyntaxNode
): boolean {
  if (node.name !== "ComprehensionExpression") {
    return false;
  }
  let owner = node.parent;
  while (owner && owner.from >= statement.from && owner.to <= statement.to) {
    if (owner.name === "ArgList") {
      return true;
    }
    if (owner === statement || isPythonNestedScope(owner)) {
      return false;
    }
    owner = owner.parent;
  }
  return false;
}

/** Parses direct `for`/`if` clauses without recursive grammar assumptions. */
function parseComprehension(
  source: LezerSource,
  node: SyntaxNode
): {
  kind: PythonComprehensionKind;
  result: PythonExpressionSpan;
  clauses: PythonComprehensionClause[];
} | undefined {
  const kind = readComprehensionKind(node.name);
  const children = getLezerChildren(node);
  const markers: Array<{ kind: "loop" | "condition"; index: number; from: number }> = [];
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child.name === "for") {
      const asyncNode = children[index - 1]?.name === "async" ? children[index - 1] : undefined;
      markers.push({ kind: "loop", index, from: asyncNode?.from ?? child.from });
    } else if (child.name === "if") {
      markers.push({ kind: "condition", index, from: child.from });
    }
  }
  if (!kind || markers.length === 0) {
    return undefined;
  }
  const closing = children.at(-1);
  const resultFrom = children[0]?.to ?? node.from;
  const resultTo = markers[0].from;
  const result = createExpressionSpan(children, resultFrom, resultTo);
  const clauses: PythonComprehensionClause[] = [];

  for (let markerIndex = 0; markerIndex < markers.length; markerIndex += 1) {
    const marker = markers[markerIndex];
    const nextFrom = markers[markerIndex + 1]?.from ?? closing?.from ?? node.to;
    if (marker.kind === "condition") {
      const keyword = children[marker.index];
      clauses.push({
        kind: "condition",
        from: marker.from,
        to: nextFrom,
        expression: createExpressionSpan(children, keyword.to, nextFrom)
      });
      continue;
    }
    const forKeyword = children[marker.index];
    const inIndex = children.findIndex((child, index) =>
      index > marker.index && child.from < nextFrom && child.name === "in"
    );
    if (inIndex < 0) {
      continue;
    }
    const inKeyword = children[inIndex];
    clauses.push({
      kind: "loop",
      from: marker.from,
      to: nextFrom,
      target: normalizeLezerText(
        source.text.slice(forKeyword.to, inKeyword.from),
        "item"
      ),
      asynchronous: children[marker.index - 1]?.name === "async",
      expression: createExpressionSpan(children, inKeyword.to, nextFrom)
    });
  }
  return { kind, result, clauses };
}

/** Retains direct nodes wholly owned by an arbitrary expression offset span. */
function createExpressionSpan(
  children: readonly SyntaxNode[],
  from: number,
  to: number
): PythonExpressionSpan {
  return {
    from,
    to,
    nodes: children.filter((child) => child.from >= from && child.to <= to)
  };
}

/** Converts grammar names into graph-facing collection names. */
function readComprehensionKind(name: string): PythonComprehensionKind | undefined {
  if (name === "ArrayComprehensionExpression") return "list";
  if (name === "SetComprehensionExpression") return "set";
  if (name === "DictionaryComprehensionExpression") return "dictionary";
  if (name === "ComprehensionExpression" || name === "ArgList") {
    return "generator argument";
  }
  return undefined;
}

/** Keeps collection comprehensions and deferred generator arguments distinguishable. */
function formatComprehensionContext(kind: PythonComprehensionKind): string {
  return kind === "generator argument" ? kind : `${kind} comprehension`;
}

/**
 * Returns only calls participating in a receiver/callee chain. Post-order call
 * collection preserves argument evaluation and inner-to-outer chain order.
 */
function createCallChainSeeds(
  source: LezerSource,
  roots: readonly SyntaxNode[],
  excludedRanges: ReadonlyArray<{ from: number; to: number }>
): LezerStatementSeed[] {
  const orderedCalls = roots.flatMap((root) => collectPythonCalls(source, root))
    .filter((call) => !isInsideAnyRange(call.node, excludedRanges));
  const callsByKey = new Map(orderedCalls.map((call) => [nodeKey(call.node), call]));
  const receiverByCallKey = new Map<string, string>();
  const participantKeys = new Set<string>();

  for (const call of orderedCalls) {
    const receiver = findPythonReceiverCall(call.node);
    const receiverKey = receiver ? nodeKey(receiver) : undefined;
    if (!receiverKey || !callsByKey.has(receiverKey)) {
      continue;
    }
    const callKey = nodeKey(call.node);
    receiverByCallKey.set(callKey, receiverKey);
    participantKeys.add(callKey);
    participantKeys.add(receiverKey);
  }

  const seen = new Set<string>();
  return orderedCalls.flatMap((call): LezerStatementSeed[] => {
    const key = nodeKey(call.node);
    if (!participantKeys.has(key) || seen.has(key)) {
      return [];
    }
    seen.add(key);
    return [createSeed(call.node, {
      feature: "pythonExpressionFlow",
      kind: "callChain",
      call: call.node,
      chainedFromPrevious: receiverByCallKey.has(key)
    })];
  });
}

/** Creates a complete call-chain block with receiver changes kept visible. */
function classifyCallChainTask(
  source: LezerSource,
  filePath: string,
  task: LezerStatementTask,
  data: PythonCallChainData
): FunctionLogicBlock {
  const call = createPythonCallSyntax(source, data.call);
  const argList = getLezerChildren(data.call).find((child) => child.name === "ArgList");
  const argumentsText = argList
    ? normalizeLezerText(source.text.slice(argList.from, argList.to), "()")
    : "()";
  const fullCall = normalizeLezerText(source.text.slice(data.call.from, data.call.to), "call()");
  const valueChanges = collectPythonValueChanges(source, data.call).filter((change) =>
    change.operator === `${call.calleeName}()`
  );
  const effect = isPotentialFunctionEffectCall(call.calleeName);
  const kind: FunctionLogicBlockKind = valueChanges.length > 0
    ? "mutation"
    : effect ? "effect" : "call";
  const confidence: FunctionLogicConfidence = valueChanges.length > 0 || effect
    ? "inferred"
    : "exact";
  return createExpressionFlowBlock(source, filePath, task, {
    kind,
    label: data.chainedFromPrevious
      ? `call ${call.calleeName}${argumentsText} on previous result`
      : `call ${fullCall}`,
    detail: data.chainedFromPrevious
      ? `Continues the Python call chain with ${call.calleeText}.`
      : `Evaluates the first call in a Python receiver chain: ${call.calleeText}.`,
    from: data.call.from,
    to: data.call.to,
    confidence,
    valueChanges
  });
}

type ExpressionFlowBlockInput = {
  kind: FunctionLogicBlockKind;
  label: string;
  detail: string;
  from: number;
  to: number;
  confidence?: FunctionLogicConfidence;
  valueChanges?: FunctionLogicValueChange[];
};

/** Creates one deterministic graph block from synthetic expression evidence. */
function createExpressionFlowBlock(
  source: LezerSource,
  filePath: string,
  task: LezerStatementTask,
  input: ExpressionFlowBlockInput
): FunctionLogicBlock {
  const range = lezerOffsetsRange(source, input.from, input.to);
  return {
    id: createFunctionLogicBlockId(filePath, input.kind, range, input.label),
    kind: input.kind,
    label: input.label,
    detail: input.detail,
    depth: task.depth,
    branchLabel: task.branchLabel,
    confidence: input.confidence ?? "exact",
    valueChanges: input.valueChanges && input.valueChanges.length > 0
      ? input.valueChanges
      : undefined,
    filePath,
    range
  };
}

/** Keeps assignment/return semantics and any non-chain outer call visible. */
function shouldRetainOriginalStatement(
  source: LezerSource,
  statement: SyntaxNode,
  seeds: readonly LezerStatementInput[],
  comprehensionRanges: ReadonlyArray<{ from: number; to: number }>
): boolean {
  if (statement.name !== "ExpressionStatement") {
    return true;
  }
  if (comprehensionRanges.length > 0) {
    return collectPythonCalls(source, statement, true).some((call) =>
      !isInsideAnyRange(call.node, comprehensionRanges)
    );
  }
  const representedCallKeys = new Set(seeds.flatMap((seed) => {
    if (!("taskSeed" in seed) || seed.taskSeed !== true) {
      return [];
    }
    const data = readPythonExpressionFlowData(seed.adapterData);
    return data?.kind === "callChain" ? [nodeKey(data.call)] : [];
  }));
  return collectPythonCalls(source, statement, true).some((call) =>
    !representedCallKeys.has(nodeKey(call.node))
  );
}

/** Creates one language-owned seed without exposing its metadata to core. */
function createSeed(
  node: SyntaxNode,
  adapterData: PythonExpressionFlowData
): LezerStatementSeed {
  return { taskSeed: true, node, adapterData };
}

/** Stable positional identity avoids relying on ephemeral Lezer node objects. */
function nodeKey(node: SyntaxNode): string {
  return `${node.name}:${node.from}:${node.to}`;
}

/** Tests complete containment against expression regions already expanded. */
function isInsideAnyRange(
  node: SyntaxNode,
  ranges: ReadonlyArray<{ from: number; to: number }>
): boolean {
  return ranges.some((range) => node.from >= range.from && node.to <= range.to);
}
