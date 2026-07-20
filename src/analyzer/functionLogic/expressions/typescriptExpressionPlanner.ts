/**
 * Iterative TypeScript/JavaScript expression-flow planner. Ternaries and
 * short-circuit operators become bounded syntax-backed fragments without
 * entering nested callable scopes or using recursive AST traversal.
 */

import * as ts from "typescript";
import type { SourceRange } from "../../../shared/types";
import {
  createFunctionLogicBlockId,
  createFunctionLogicEdge,
  isPotentialFunctionEffectCall
} from "../core/functionLogicSupport";
import type {
  FunctionLogicBlock,
  FunctionLogicBlockKind,
  FunctionLogicEdge
} from "../types";
import { collectTypeScriptExpressionValueChanges } from "../valueChanges";
import type {
  TypeScriptBooleanExpressionFlowFragment,
  TypeScriptExpressionFlowExit,
  TypeScriptExpressionFlowMode,
  TypeScriptExpressionFlowPlan,
  TypeScriptValueExpressionFlowFragment
} from "./types";
import { isShortCircuitBinary } from "./typescriptExpressionTargets";

type PlanMode = TypeScriptExpressionFlowMode | "presence";

type PresenceExpressionFlowFragment = {
  mode: "presence";
  entryBlockId: string;
  blocks: FunctionLogicBlock[];
  edges: FunctionLogicEdge[];
  presentExits: TypeScriptExpressionFlowExit[];
  nullishExits: TypeScriptExpressionFlowExit[];
};

type PlannedFragment = TypeScriptValueExpressionFlowFragment
  | TypeScriptBooleanExpressionFlowFragment
  | PresenceExpressionFlowFragment;

type PlannerTask = {
  expression: ts.Expression;
  mode: PlanMode;
  expanded: boolean;
};

type PlannerContext = {
  sourceFile: ts.SourceFile;
  filePath: string;
  maxBlocks: number;
  createdBlockCount: number;
  budgetExceeded: boolean;
};

type FragmentParts = Pick<PlannedFragment, "blocks" | "edges">;

/** Plans one expression root and omits the whole region if its budget is exceeded. */
export function planTypeScriptExpressionFlow(input: {
  sourceFile: ts.SourceFile;
  filePath: string;
  expression: ts.Expression;
  mode: TypeScriptExpressionFlowMode;
  maxBlocks: number;
}): TypeScriptExpressionFlowPlan {
  if (input.maxBlocks < 1) {
    return { omittedRegionCount: 1 };
  }
  const context: PlannerContext = {
    sourceFile: input.sourceFile,
    filePath: input.filePath,
    maxBlocks: Math.max(1, Math.floor(input.maxBlocks)),
    createdBlockCount: 0,
    budgetExceeded: false
  };
  const root = normalizePlanExpression(input.expression);
  const results = new Map<ts.Expression, Partial<Record<PlanMode, PlannedFragment>>>();
  const pending: PlannerTask[] = [{ expression: root, mode: input.mode, expanded: false }];
  // Each composite contributes at most three child tasks. This second bound
  // guards malformed/extremely deep syntax before it can grow the work stack.
  const maxTaskCount = (context.maxBlocks * 12) + 48;
  let processedTaskCount = 0;

  while (pending.length > 0 && !context.budgetExceeded) {
    const task = pending.pop();
    if (!task) {
      continue;
    }
    processedTaskCount += 1;
    if (processedTaskCount > maxTaskCount) {
      context.budgetExceeded = true;
      break;
    }
    const expression = normalizePlanExpression(task.expression);
    if (readPlannedResult(results, expression, task.mode)) {
      continue;
    }
    if (!task.expanded) {
      pending.push({ expression, mode: task.mode, expanded: true });
      const children = readChildPlans(expression, task.mode);
      for (let index = children.length - 1; index >= 0; index -= 1) {
        const child = children[index];
        pending.push({
          expression: normalizePlanExpression(child.expression),
          mode: child.mode,
          expanded: false
        });
      }
      continue;
    }

    const fragment = buildPlannedFragment(context, results, expression, task.mode);
    if (!fragment) {
      context.budgetExceeded = true;
      break;
    }
    writePlannedResult(results, expression, task.mode, fragment);
  }

  const fragment = readPlannedResult(results, root, input.mode);
  if (context.budgetExceeded || !fragment || fragment.mode === "presence") {
    return { omittedRegionCount: 1 };
  }
  return {
    fragment: {
      ...fragment,
      edges: deduplicateEdges(fragment.edges)
    },
    omittedRegionCount: 0
  };
}

/** Lists child plans in evaluation order; the caller reverses them for LIFO. */
function readChildPlans(
  expression: ts.Expression,
  mode: PlanMode
): Array<{ expression: ts.Expression; mode: PlanMode }> {
  if (ts.isConditionalExpression(expression)) {
    return [
      { expression: expression.condition, mode: "boolean" },
      { expression: expression.whenTrue, mode },
      { expression: expression.whenFalse, mode }
    ];
  }
  if (ts.isPrefixUnaryExpression(expression)
    && expression.operator === ts.SyntaxKind.ExclamationToken
    && mode !== "presence") {
    return [{ expression: expression.operand, mode: "boolean" }];
  }
  if (!isShortCircuitBinary(expression)) {
    return [];
  }
  const operator = expression.operatorToken.kind;
  if (operator === ts.SyntaxKind.QuestionQuestionToken) {
    return [
      { expression: expression.left, mode: "presence" },
      { expression: expression.right, mode }
    ];
  }
  if (mode === "presence") {
    return [];
  }
  return [
    { expression: expression.left, mode: "boolean" },
    { expression: expression.right, mode }
  ];
}

/** Combines already-planned children or emits one atomic evidence block. */
function buildPlannedFragment(
  context: PlannerContext,
  results: Map<ts.Expression, Partial<Record<PlanMode, PlannedFragment>>>,
  expression: ts.Expression,
  mode: PlanMode
): PlannedFragment | undefined {
  if (ts.isConditionalExpression(expression)) {
    return combineConditional(context, results, expression, mode);
  }
  if (ts.isPrefixUnaryExpression(expression)
    && expression.operator === ts.SyntaxKind.ExclamationToken
    && mode !== "presence") {
    return combineNegation(context, results, expression, mode);
  }
  if (isShortCircuitBinary(expression)) {
    if (expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
      return combineNullish(context, results, expression, mode);
    }
    if (mode !== "presence") {
      return combineLogical(results, expression, mode);
    }
  }
  return createAtomicFragment(context, expression, mode);
}

/** Connects a ternary condition to its two independently planned branches. */
function combineConditional(
  context: PlannerContext,
  results: Map<ts.Expression, Partial<Record<PlanMode, PlannedFragment>>>,
  expression: ts.ConditionalExpression,
  mode: PlanMode
): PlannedFragment | undefined {
  const condition = readBooleanResult(results, expression.condition);
  const whenTrue = readPlannedResult(results, normalizePlanExpression(expression.whenTrue), mode);
  const whenFalse = readPlannedResult(results, normalizePlanExpression(expression.whenFalse), mode);
  if (!condition || !whenTrue || !whenFalse || whenTrue.mode !== mode || whenFalse.mode !== mode) {
    return undefined;
  }
  const parts = mergeFragments(condition, whenTrue, whenFalse);
  const edges = [
    ...parts.edges,
    ...connectExits(condition.truthyExits, whenTrue.entryBlockId, "true", "true · choose then"),
    ...connectExits(condition.falsyExits, whenFalse.entryBlockId, "false", "false · choose else")
  ];
  if (mode === "value" && whenTrue.mode === "value" && whenFalse.mode === "value") {
    return {
      mode,
      entryBlockId: condition.entryBlockId,
      blocks: parts.blocks,
      edges,
      exits: [
        ...relabelExits(whenTrue.exits, "then value"),
        ...relabelExits(whenFalse.exits, "else value")
      ]
    };
  }
  if (mode === "boolean" && whenTrue.mode === "boolean" && whenFalse.mode === "boolean") {
    return {
      mode,
      entryBlockId: condition.entryBlockId,
      blocks: parts.blocks,
      edges,
      truthyExits: [
        ...relabelExits(whenTrue.truthyExits, "then · truthy"),
        ...relabelExits(whenFalse.truthyExits, "else · truthy")
      ],
      falsyExits: [
        ...relabelExits(whenTrue.falsyExits, "then · falsy"),
        ...relabelExits(whenFalse.falsyExits, "else · falsy")
      ]
    };
  }
  if (mode === "presence" && whenTrue.mode === "presence" && whenFalse.mode === "presence") {
    return {
      mode,
      entryBlockId: condition.entryBlockId,
      blocks: parts.blocks,
      edges,
      presentExits: [
        ...relabelExits(whenTrue.presentExits, "then · present"),
        ...relabelExits(whenFalse.presentExits, "else · present")
      ],
      nullishExits: [
        ...relabelExits(whenTrue.nullishExits, "then · nullish"),
        ...relabelExits(whenFalse.nullishExits, "else · nullish")
      ]
    };
  }
  context.budgetExceeded = true;
  return undefined;
}

/** Inverts one boolean child without inventing a duplicate runtime evaluation. */
function combineNegation(
  context: PlannerContext,
  results: Map<ts.Expression, Partial<Record<PlanMode, PlannedFragment>>>,
  expression: ts.PrefixUnaryExpression,
  mode: Exclude<PlanMode, "presence">
): PlannedFragment | undefined {
  const operand = readBooleanResult(results, expression.operand);
  if (!operand) {
    return undefined;
  }
  const blocks = operand.blocks.length === 1 && operand.edges.length === 0
    ? operand.blocks.map((block) => block.id === operand.entryBlockId
      ? {
          ...block,
          label: `check ${normalizeExpressionText(expression.getText(context.sourceFile), "condition")}`,
          detail: "Tests this negated operand only when short-circuit evaluation reaches it.",
          range: toSourceRange(context.sourceFile, expression)
        }
      : block
    )
    : operand.blocks;
  const truthy = relabelExits(operand.falsyExits, "negated · truthy");
  const falsy = relabelExits(operand.truthyExits, "negated · falsy");
  if (mode === "boolean") {
    return {
      ...operand,
      blocks,
      truthyExits: truthy,
      falsyExits: falsy
    };
  }
  return {
    mode: "value",
    entryBlockId: operand.entryBlockId,
    blocks,
    edges: operand.edges,
    exits: [...truthy, ...falsy]
  };
}

/** Applies JavaScript `&&` / `||` short-circuit continuation semantics. */
function combineLogical(
  results: Map<ts.Expression, Partial<Record<PlanMode, PlannedFragment>>>,
  expression: ts.BinaryExpression,
  mode: Exclude<PlanMode, "presence">
): PlannedFragment | undefined {
  const left = readBooleanResult(results, expression.left);
  const right = readPlannedResult(results, normalizePlanExpression(expression.right), mode);
  if (!left || !right || right.mode !== mode) {
    return undefined;
  }
  const isAnd = expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken;
  const continued = isAnd ? left.truthyExits : left.falsyExits;
  const skipped = isAnd ? left.falsyExits : left.truthyExits;
  const parts = mergeFragments(left, right);
  const edges = [
    ...parts.edges,
    ...connectExits(
      continued,
      right.entryBlockId,
      isAnd ? "true" : "false",
      isAnd ? "truthy · evaluate right" : "falsy · evaluate right"
    )
  ];
  const skippedLabel = isAnd ? "falsy · short-circuit" : "truthy · short-circuit";
  if (mode === "value" && right.mode === "value") {
    return {
      mode,
      entryBlockId: left.entryBlockId,
      blocks: parts.blocks,
      edges,
      exits: [...relabelExits(skipped, skippedLabel), ...right.exits]
    };
  }
  if (mode === "boolean" && right.mode === "boolean") {
    return {
      mode,
      entryBlockId: left.entryBlockId,
      blocks: parts.blocks,
      edges,
      truthyExits: isAnd
        ? right.truthyExits
        : [...relabelExits(left.truthyExits, skippedLabel), ...right.truthyExits],
      falsyExits: isAnd
        ? [...relabelExits(left.falsyExits, skippedLabel), ...right.falsyExits]
        : right.falsyExits
    };
  }
  return undefined;
}

/** Applies `??`; boolean use reuses a present value before checking truthiness. */
function combineNullish(
  context: PlannerContext,
  results: Map<ts.Expression, Partial<Record<PlanMode, PlannedFragment>>>,
  expression: ts.BinaryExpression,
  mode: PlanMode
): PlannedFragment | undefined {
  const left = readPresenceResult(results, expression.left);
  const right = readPlannedResult(results, normalizePlanExpression(expression.right), mode);
  if (!left || !right || right.mode !== mode) {
    return undefined;
  }
  if (mode === "value" && right.mode === "value") {
    const parts = mergeFragments(left, right);
    return {
      mode,
      entryBlockId: left.entryBlockId,
      blocks: parts.blocks,
      edges: [
        ...parts.edges,
        ...connectExits(left.nullishExits, right.entryBlockId, "false", "nullish · evaluate fallback")
      ],
      exits: [
        ...relabelExits(left.presentExits, "present · skip fallback"),
        ...right.exits
      ]
    };
  }
  if (mode === "presence" && right.mode === "presence") {
    const parts = mergeFragments(left, right);
    return {
      mode,
      entryBlockId: left.entryBlockId,
      blocks: parts.blocks,
      edges: [
        ...parts.edges,
        ...connectExits(left.nullishExits, right.entryBlockId, "false", "nullish · evaluate fallback")
      ],
      presentExits: [
        ...relabelExits(left.presentExits, "present · skip fallback"),
        ...right.presentExits
      ],
      nullishExits: right.nullishExits
    };
  }
  if (mode === "boolean" && right.mode === "boolean") {
    const selectedValue = createAtomicBlock(context, expression.left, "selectedTruthiness");
    if (!selectedValue) {
      return undefined;
    }
    const parts = mergeFragments(left, { blocks: [selectedValue], edges: [] }, right);
    return {
      mode,
      entryBlockId: left.entryBlockId,
      blocks: parts.blocks,
      edges: [
        ...parts.edges,
        ...connectExits(left.presentExits, selectedValue.id, "true", "present · reuse value"),
        ...connectExits(left.nullishExits, right.entryBlockId, "false", "nullish · evaluate fallback")
      ],
      truthyExits: [
        createExit(selectedValue.id, "true", "present value · truthy"),
        ...right.truthyExits
      ],
      falsyExits: [
        createExit(selectedValue.id, "false", "present value · falsy"),
        ...right.falsyExits
      ]
    };
  }
  return undefined;
}

/** Emits one source-backed leaf with outcome slots appropriate to its mode. */
function createAtomicFragment(
  context: PlannerContext,
  expression: ts.Expression,
  mode: PlanMode
): PlannedFragment | undefined {
  const block = createAtomicBlock(context, expression, mode);
  if (!block) {
    return undefined;
  }
  const common = {
    entryBlockId: block.id,
    blocks: [block],
    edges: [] as FunctionLogicEdge[]
  };
  if (mode === "boolean") {
    return {
      mode,
      ...common,
      truthyExits: [createExit(block.id, "true", "truthy")],
      falsyExits: [createExit(block.id, "false", "falsy")]
    };
  }
  if (mode === "presence") {
    return {
      mode,
      ...common,
      presentExits: [createExit(block.id, "true", "present")],
      nullishExits: [createExit(block.id, "false", "nullish")]
    };
  }
  return {
    mode,
    ...common,
    exits: [createExit(block.id, "next")]
  };
}

type AtomicRole = PlanMode | "selectedTruthiness";

/** Creates one leaf block while enforcing the shared expression budget. */
function createAtomicBlock(
  context: PlannerContext,
  expression: ts.Expression,
  role: AtomicRole
): FunctionLogicBlock | undefined {
  context.createdBlockCount += 1;
  if (context.createdBlockCount > context.maxBlocks) {
    context.budgetExceeded = true;
    return undefined;
  }
  const text = normalizeExpressionText(expression.getText(context.sourceFile), "expression");
  const range = toSourceRange(context.sourceFile, expression);
  const valueChanges = role === "value"
    ? collectTypeScriptExpressionValueChanges(context.sourceFile, expression)
    : [];
  const callName = role === "value" ? findFirstCallName(context.sourceFile, expression) : undefined;
  let kind: FunctionLogicBlockKind = role === "value" ? "operation" : "condition";
  let confidence: FunctionLogicBlock["confidence"] = "exact";
  let label = `evaluate ${text}`;
  let detail = "Evaluates the selected expression branch and passes its value onward.";

  if (role === "boolean") {
    label = `check ${text}`;
    detail = "Tests this operand only when short-circuit evaluation reaches it.";
  } else if (role === "presence") {
    label = `check ${text} is not nullish`;
    detail = "Chooses the existing value or evaluates the nullish fallback.";
  } else if (role === "selectedTruthiness") {
    label = `check selected ${text}`;
    detail = "Tests the already selected non-nullish value without evaluating it again.";
  } else if (valueChanges.length > 0) {
    kind = "mutation";
    detail = "Evaluates the selected branch and applies its source-level value change.";
  } else if (callName) {
    const effect = isPotentialFunctionEffectCall(callName);
    kind = effect ? "effect" : "call";
    confidence = effect ? "inferred" : "exact";
    detail = effect
      ? `Evaluates the selected branch; ${callName} may produce a state or external effect.`
      : `Calls ${callName} only on this selected expression path.`;
  }

  return {
    id: createFunctionLogicBlockId(context.filePath, kind, range, label),
    kind,
    label,
    detail,
    depth: 0,
    confidence,
    valueChanges: valueChanges.length > 0 ? valueChanges : undefined,
    filePath: context.filePath,
    range
  };
}

/** Finds the first direct call inside one leaf without entering nested callables. */
function findFirstCallName(
  sourceFile: ts.SourceFile,
  expression: ts.Expression
): string | undefined {
  const pending: ts.Node[] = [expression];
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) {
      continue;
    }
    if (node !== expression && isNestedCallable(node)) {
      continue;
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      return normalizeExpressionText(node.expression.getText(sourceFile), "call");
    }
    const children: ts.Node[] = [];
    ts.forEachChild(node, (child) => {
      children.push(child);
      return undefined;
    });
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index]);
    }
  }
  return undefined;
}

/** Nested callbacks are separate functions and never belong to this leaf. */
function isNestedCallable(node: ts.Node): boolean {
  return ts.isFunctionDeclaration(node)
    || ts.isFunctionExpression(node)
    || ts.isArrowFunction(node)
    || ts.isMethodDeclaration(node)
    || ts.isConstructorDeclaration(node)
    || ts.isGetAccessorDeclaration(node)
    || ts.isSetAccessorDeclaration(node);
}

/** Removes grouping/type wrappers while preserving runtime await expressions. */
function normalizePlanExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current)
    || ts.isSatisfiesExpression(current)) {
    current = current.expression;
  }
  // The root target selector may have removed an outer await already. This
  // fallback keeps planner behavior stable when called directly by tests.
  return current === expression
    ? current
    : normalizeTransparentRootWithoutAwait(current);
}

/** Finishes wrapper normalization iteratively without widening its semantics. */
function normalizeTransparentRootWithoutAwait(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current)
    || ts.isSatisfiesExpression(current)) {
    current = current.expression;
  }
  return current;
}

/** Reads a cached result for the exact AST identity and planning mode. */
function readPlannedResult(
  results: Map<ts.Expression, Partial<Record<PlanMode, PlannedFragment>>>,
  expression: ts.Expression,
  mode: PlanMode
): PlannedFragment | undefined {
  return results.get(normalizePlanExpression(expression))?.[mode];
}

/** Writes one post-order result after all children have been combined. */
function writePlannedResult(
  results: Map<ts.Expression, Partial<Record<PlanMode, PlannedFragment>>>,
  expression: ts.Expression,
  mode: PlanMode,
  fragment: PlannedFragment
): void {
  const normalized = normalizePlanExpression(expression);
  const values = results.get(normalized) ?? {};
  values[mode] = fragment;
  results.set(normalized, values);
}

/** Narrows one cached child result to boolean flow. */
function readBooleanResult(
  results: Map<ts.Expression, Partial<Record<PlanMode, PlannedFragment>>>,
  expression: ts.Expression
): TypeScriptBooleanExpressionFlowFragment | undefined {
  const result = readPlannedResult(results, normalizePlanExpression(expression), "boolean");
  return result?.mode === "boolean" ? result : undefined;
}

/** Narrows one cached child result to nullish-presence flow. */
function readPresenceResult(
  results: Map<ts.Expression, Partial<Record<PlanMode, PlannedFragment>>>,
  expression: ts.Expression
): PresenceExpressionFlowFragment | undefined {
  const result = readPlannedResult(results, normalizePlanExpression(expression), "presence");
  return result?.mode === "presence" ? result : undefined;
}

/** Concatenates disjoint child fragments in their static evaluation order. */
function mergeFragments(...fragments: FragmentParts[]): FragmentParts {
  return {
    blocks: fragments.flatMap((fragment) => fragment.blocks),
    edges: fragments.flatMap((fragment) => fragment.edges)
  };
}

/** Connects every pending outcome to the entry of the next fragment. */
function connectExits(
  exits: readonly TypeScriptExpressionFlowExit[],
  targetId: string,
  kind: Extract<TypeScriptExpressionFlowExit["kind"], "true" | "false">,
  label: string
): FunctionLogicEdge[] {
  return exits.map((exit) => createFunctionLogicEdge(
    exit.sourceId,
    targetId,
    kind,
    label,
    "exact"
  ));
}

/** Re-labels a propagated branch result without changing its boolean kind. */
function relabelExits(
  exits: readonly TypeScriptExpressionFlowExit[],
  label: string
): TypeScriptExpressionFlowExit[] {
  return exits.map((exit) => ({ ...exit, label }));
}

/** Creates one unresolved fragment exit. */
function createExit(
  sourceId: string,
  kind: TypeScriptExpressionFlowExit["kind"],
  label?: string
): TypeScriptExpressionFlowExit {
  return { sourceId, kind, label };
}

/** Keeps stable edge identities unique after fragments are combined. */
function deduplicateEdges(edges: FunctionLogicEdge[]): FunctionLogicEdge[] {
  const seen = new Set<string>();
  return edges.filter((edge) => {
    if (seen.has(edge.id)) {
      return false;
    }
    seen.add(edge.id);
    return true;
  });
}

/** Converts TypeScript offsets to the protocol's zero-based source range. */
function toSourceRange(sourceFile: ts.SourceFile, node: ts.Node): SourceRange {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
  return {
    startLine: start.line,
    startCharacter: start.character,
    endLine: end.line,
    endCharacter: end.character
  };
}

/** Normalizes display whitespace while retaining complete source evidence. */
function normalizeExpressionText(value: string, fallback: string): string {
  return value.replace(/\s+/gu, " ").trim() || fallback;
}
