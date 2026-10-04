/**
 * Kotlin expression/control adaptation for the shared iterative CFG scheduler.
 * Lazy source seeds retain selected-arm return/write context; no Kotlin evaluator
 * or recursive AST walker is introduced by expression expansion.
 */
import type { FunctionLogicBlock, FunctionLogicBlockKind } from "../../types";
import type {
  StructuredCallableDescriptor, StructuredControlBranchDescription, StructuredControlDescription,
  StructuredStatementInput, StructuredStatementSeed, StructuredStatementTask
} from "../../core/structuredFunctionLogicAnalyzer";
import { createFunctionLogicBlockId } from "../../core/functionLogicSupport";
import {
  getKotlinChildNamed, getKotlinBodyStatements, kotlinNodeRange,
  type KotlinSource, type KotlinSyntaxNode
} from "../../../languages/kotlin";
import {
  createKotlinWriteChange, kotlinBodyStatements, normalizeKotlinText,
  readKotlinWrite, unwrapKotlinNode, type KotlinWrite
} from "./kotlinFunctionLogicSyntax";

type KotlinValueContext = { kind: "statement" } | { kind: "return" | "throw" }
  | { kind: "write"; write: KotlinWrite };
type KotlinValueData = { feature: "kotlinFlow"; kind: "value"; context: KotlinValueContext;
  literal?: "null" | "true" | "false"; selected?: boolean };
type KotlinDecisionData = { feature: "kotlinFlow"; kind: "decision"; predicate: KotlinSyntaxNode;
  expression: string; groupExpression?: string; groupFrom: number; groupTo: number;
  whenTrue: StructuredStatementInput<KotlinSyntaxNode>[];
  whenFalse: StructuredStatementInput<KotlinSyntaxNode>[]; memberIndex: number };
type KotlinControlData = { feature: "kotlinFlow"; kind: "control"; blockKind: "switch" | "loop" | "try";
  label: string; description: StructuredControlDescription<KotlinSyntaxNode> };
export type KotlinFlowData = KotlinValueData | KotlinDecisionData | KotlinControlData;

/** Narrows opaque scheduler metadata without coupling the core to Kotlin syntax. */
export function readKotlinFlowData(value: unknown): KotlinFlowData | undefined {
  if (!value || typeof value !== "object" || (value as { feature?: unknown }).feature !== "kotlinFlow") return undefined;
  return value as KotlinFlowData;
}

/** Supplies direct body statements and an expression body's source-backed return. */
export function getKotlinRootStatements(_source: KotlinSource,
  callable: StructuredCallableDescriptor<KotlinSyntaxNode>): StructuredStatementInput<KotlinSyntaxNode>[] {
  if (callable.expressionBody) {
    const expression = getKotlinChildNamed(callable.body, "expression");
    return expression ? [valueSeed(expression, { kind: "return" })] : [];
  }
  return getKotlinBodyStatements(callable.body).map((node) => valueSeed(node, { kind: "statement" }));
}

/** Classifies source-proven decisions, controls, and selected expression values. */
export function classifyKotlinFlowTask(source: KotlinSource, filePath: string,
  task: StructuredStatementTask<KotlinSyntaxNode>): FunctionLogicBlock | undefined {
  const planned = planKotlinTask(source, task);
  if (!planned) return undefined;
  const data = planned.data;
  let kind: FunctionLogicBlockKind;
  let label: string;
  let detail: string;
  let valueChanges: FunctionLogicBlock["valueChanges"];
  let condition: FunctionLogicBlock["condition"];
  if (data.kind === "decision") {
    kind = "condition";
    label = `if (${normalizeKotlinText(data.expression, "condition")})`;
    detail = "Chooses a source branch; Kotlin predicate values are not computed.";
    condition = { groupId: `kotlin-condition:${data.groupFrom}:${data.groupTo}`,
      expression: data.expression, groupExpression: data.groupExpression,
      memberIndex: data.memberIndex, root: data.memberIndex === 0 };
  } else if (data.kind === "control") {
    kind = data.blockKind; label = data.label;
    detail = kind === "switch" ? "Selects one when arm; exhaustiveness is not inferred from Kotlin types."
      : kind === "loop" ? "Describes source iterations with a bounded symbolic path."
        : "Separates try, catch, and cleanup source regions.";
    const node = unwrapKotlinNode(task.node);
    if (node.name === "forStatement") {
      const variable = getKotlinChildNamed(node, "variableDeclaration");
      const identifier = variable && getKotlinChildNamed(variable, "simpleIdentifier");
      const iterable = getKotlinChildNamed(node, "expression");
      if (identifier && iterable) valueChanges = [{ target: source.text.slice(identifier.from, identifier.to),
        targetKind: "variable", operation: "iterate", operator: "in",
        value: source.text.slice(iterable.from, iterable.to), confidence: "exact" }];
    }
  } else {
    if (data.context.kind === "statement") return undefined;
    const expression = data.literal ?? source.text.slice(planned.node.from, planned.node.to);
    if (data.context.kind === "write") {
      kind = "mutation"; label = `${data.context.write.target} ${data.context.write.operator} ${normalizeKotlinText(expression, "value")}`;
      detail = "This selected expression arm writes the source value; Kotlin runtime evaluation remains symbolic.";
      valueChanges = [createKotlinWriteChange(data.context.write, expression)];
    } else {
      kind = data.context.kind; label = `${kind} ${normalizeKotlinText(expression, "Unit")}`;
      detail = "Ends the selected path with this source expression; its runtime value is not computed.";
    }
  }
  const range = kotlinNodeRange(source, planned.rangeNode);
  return { id: createFunctionLogicBlockId(filePath, kind, range, label), kind, label, detail,
    presentation: { labelKey: `logic-block-label-${kind}`, labelParams: { source: label }, detailKey: `logic-block-detail-${kind}` },
    depth: task.depth, branchLabel: task.branchLabel, branchPresentation: task.branchPresentation,
    confidence: "exact", filePath, range, condition, valueChanges };
}

/** Returns the same lazy control plan used during classification. */
export function describeKotlinControl(source: KotlinSource, _node: KotlinSyntaxNode,
  task: StructuredStatementTask<KotlinSyntaxNode>): StructuredControlDescription<KotlinSyntaxNode> | undefined {
  const planned = planKotlinTask(source, task);
  const data = planned?.data;
  if (data?.kind === "control") return data.description;
  if (data?.kind !== "decision") return undefined;
  return { kind: "condition", branches: [
    { role: "then", edgeKind: "true", label: "true", presentation: { key: "logic-edge-true" }, statements: data.whenTrue },
    { role: "else", edgeKind: "false", label: "false", presentation: { key: "logic-edge-false" }, statements: data.whenFalse }
  ] };
}

/** Interprets one task's root expression without descending into argument or scope bodies. */
function planKotlinTask(source: KotlinSource, task: StructuredStatementTask<KotlinSyntaxNode>):
  { node: KotlinSyntaxNode; rangeNode: KotlinSyntaxNode; data: KotlinFlowData } | undefined {
  const inherited = readKotlinFlowData(task.adapterData);
  if (inherited && inherited.kind !== "value") return { node: task.node, rangeNode: task.node, data: inherited };
  let context: KotlinValueContext = inherited?.context ?? (task.implicitReturn ? { kind: "return" } : { kind: "statement" });
  let node = unwrapKotlinNode(task.node);
  let rangeNode = task.node;
  if (inherited?.selected) return { node, rangeNode, data: inherited };
  const write = readKotlinWrite(source, node);
  if (write) { context = { kind: "write", write }; node = unwrapKotlinNode(write.expression); }
  if (node.name === "jumpExpression") {
    const keyword = node.children.find((child) => child.name === "RETURN" || child.name === "THROW");
    const expression = getKotlinChildNamed(node, "expression");
    // Labeled/non-local jumps retain conservative raw classification instead
    // of being upgraded to the outer callable's selected-arm return.
    if (!keyword || !expression) return undefined;
    context = { kind: keyword.name === "THROW" ? "throw" : "return" };
    node = unwrapKotlinNode(expression);
  }
  const valueData: KotlinValueData = { feature: "kotlinFlow", kind: "value", context };
  if (node.name === "ifExpression") {
    const predicate = getKotlinChildNamed(node, "expression");
    const bodies = node.children.filter((child) => child.name === "controlStructureBody");
    if (!predicate) return undefined;
    const seed = decisionSeed(source, predicate,
      bodies[0] ? contextualBody(bodies[0], context) : [],
      bodies[1] ? contextualBody(bodies[1], context) : []);
    return { node: seed.node, rangeNode, data: seed.adapterData as KotlinDecisionData };
  }
  if (node.name === "whenExpression") return { node, rangeNode, data: describeWhen(source, node, context) };
  if (node.name === "tryExpression") return { node, rangeNode, data: describeTry(source, node, context) };
  if (["forStatement", "whileStatement", "doWhileStatement"].includes(node.name)) {
    const body = getKotlinChildNamed(node, "controlStructureBody");
    const condition = getKotlinChildNamed(node, "expression");
    const headerEnd = node.name === "doWhileStatement" ? node.to : body?.from ?? node.to;
    return { node, rangeNode, data: { feature: "kotlinFlow", kind: "control", blockKind: "loop",
      label: node.name === "doWhileStatement" ? `do / while (${normalizeKotlinText(condition ? source.text.slice(condition.from, condition.to) : "", "condition")})`
        : normalizeKotlinText(source.text.slice(node.from, headerEnd), "loop"),
      description: { kind: "loop", branches: body ? [{ role: "loopBody", edgeKind: "iterate", label: "iterate",
        presentation: { key: "logic-edge-iterate" }, statements: contextualBody(body, { kind: "statement" }) }] : [] } } };
  }
  const logical = logicalOperands(node);
  if (logical) {
    const seed = decisionSeed(source, node, [valueSeed(node, context, "true")], [valueSeed(node, context, "false")]);
    return { node: seed.node, rangeNode, data: seed.adapterData as KotlinDecisionData };
  }
  if (node.name === "elvisExpression") {
    const operands = node.children.filter((child) => child.name === "infixFunctionCall");
    if (operands.length > 1) {
      const first = operands[0];
      const rest: KotlinSyntaxNode = operands.length === 2 ? operands[1]
        : { name: "elvisExpression", from: operands[1].from, to: node.to,
            children: node.children.filter((child) => child.from >= operands[1].from) };
      const expression = `${source.text.slice(first.from, first.to)} != null`;
      const elvisDecision: KotlinDecisionData = { feature: "kotlinFlow", kind: "decision", predicate: first,
        expression, groupExpression: source.text.slice(node.from, node.to), groupFrom: node.from, groupTo: node.to,
        memberIndex: 0, whenTrue: [valueSeed(first, context, undefined, true)], whenFalse: [valueSeed(rest, context)] };
      const receivers = readSafeReceivers(source, unwrapKotlinNode(first));
      // The safe-call suffix is skipped on a null receiver. Only its present
      // branch may then test the call/property result for Elvis nullness.
      if (receivers.length) {
        elvisDecision.memberIndex = receivers.length;
        elvisDecision.groupExpression = undefined;
        return { node, rangeNode, data: safeGuardChain(source, node, receivers,
          [{ taskSeed: true, node: first, adapterData: elvisDecision }], [valueSeed(rest, context)]).adapterData as KotlinDecisionData };
      }
      return { node, rangeNode, data: elvisDecision };
    }
  }
  const receivers = readSafeReceivers(source, node);
  if (receivers.length) {
    return { node, rangeNode, data: safeGuardChain(source, node, receivers,
      [valueSeed(node, context, undefined, true)], [valueSeed(node, context, "null")]).adapterData as KotlinDecisionData };
  }
  // A raw return/property keeps the complete syntax range so binding definitions
  // and source evidence can map to this block. Selected arms use their own range.
  if (context.kind === "statement") return undefined;
  if (write || task.node !== node) rangeNode = task.node;
  return { node, rangeNode, data: valueData };
}

/** Gives only a body's last value the enclosing initializer or return context. */
function contextualBody(body: KotlinSyntaxNode, context: KotlinValueContext): StructuredStatementInput<KotlinSyntaxNode>[] {
  const statements = kotlinBodyStatements(body);
  return statements.map((node, index) => valueSeed(node,
    index === statements.length - 1 ? context : { kind: "statement" }));
}

/** Creates a lazy seed; actual root expansion happens when the scheduler visits it. */
function valueSeed(node: KotlinSyntaxNode, context: KotlinValueContext,
  literal?: KotlinValueData["literal"], selected = false): StructuredStatementSeed<KotlinSyntaxNode> {
  return { taskSeed: true, node, implicitReturn: false,
    adapterData: { feature: "kotlinFlow", kind: "value", context, literal, selected: selected || literal !== undefined } satisfies KotlinValueData };
}

/** Boolean tree compilation uses jobs and mutable branch arrays, never recursion. */
function decisionSeed(source: KotlinSource, expression: KotlinSyntaxNode,
  whenTrue: StructuredStatementInput<KotlinSyntaxNode>[], whenFalse: StructuredStatementInput<KotlinSyntaxNode>[]): StructuredStatementSeed<KotlinSyntaxNode> {
  const rootNode = unwrapKotlinNode(expression);
  type DecisionSeed = StructuredStatementSeed<KotlinSyntaxNode> & { adapterData: KotlinDecisionData };
  const make = (node: KotlinSyntaxNode, yes: StructuredStatementInput<KotlinSyntaxNode>[], no: StructuredStatementInput<KotlinSyntaxNode>[]): DecisionSeed => ({
    taskSeed: true as const, node, implicitReturn: false,
    adapterData: { feature: "kotlinFlow", kind: "decision", predicate: node,
      expression: source.text.slice(node.from, node.to), groupFrom: expression.from, groupTo: expression.to,
      memberIndex: 0, whenTrue: yes, whenFalse: no } satisfies KotlinDecisionData
  });
  const root = make(rootNode, whenTrue, whenFalse);
  const pending = [root];
  const leaves: Array<typeof root> = [];
  const visited = new Set<string>();
  while (pending.length && visited.size < 300) {
    const seed = pending.pop();
    if (!seed) continue;
    const logical = logicalOperands(unwrapKotlinNode(seed.node));
    const key = `${seed.node.name}:${seed.node.from}:${seed.node.to}`;
    if (!logical || visited.has(key)) { leaves.push(seed); continue; }
    visited.add(key);
    let next: StructuredStatementInput<KotlinSyntaxNode>[] = logical.operator === "and"
      ? seed.adapterData.whenTrue : seed.adapterData.whenFalse;
    for (let index = logical.members.length - 1; index >= 0; index -= 1) {
      const member = logical.members[index];
      const current = make(member, logical.operator === "and" ? next : seed.adapterData.whenTrue,
        logical.operator === "or" ? next : seed.adapterData.whenFalse);
      if (index === 0) {
        seed.node = current.node;
        seed.adapterData = current.adapterData;
        pending.push(seed);
      } else {
        pending.push(current);
      }
      next = [current];
    }
  }
  const orderedLeaves = [...new Set(leaves)].sort((left, right) => left.node.from - right.node.from);
  for (let index = 0; index < orderedLeaves.length; index += 1) {
    orderedLeaves[index].adapterData.memberIndex = index;
    if (index === 0) orderedLeaves[index].adapterData.groupExpression = source.text.slice(expression.from, expression.to);
  }
  return root;
}

/** Finds every grammar-proven safe-navigation receiver in a root call chain. */
function readSafeReceivers(source: KotlinSource, node: KotlinSyntaxNode): KotlinSyntaxNode[] {
  if (node.name !== "postfixUnaryExpression") return [];
  const suffixes = node.children.filter((child) => {
    const navigation = getKotlinChildNamed(child, "navigationSuffix");
    const operator = navigation && getKotlinChildNamed(navigation, "memberAccessOperator");
    return operator && source.text.slice(operator.from, operator.to) === "?.";
  });
  return suffixes.map((suffix) => ({ name: "kotlinReceiver", from: node.from, to: suffix.from,
    children: node.children.filter((child) => child.to <= suffix.from) }));
}

/** Builds left-to-right safe-call guards, sharing the skipped suffix/fallback join. */
function safeGuardChain(source: KotlinSource, node: KotlinSyntaxNode, receivers: KotlinSyntaxNode[],
  whenPresent: StructuredStatementInput<KotlinSyntaxNode>[], whenNull: StructuredStatementInput<KotlinSyntaxNode>[]): StructuredStatementSeed<KotlinSyntaxNode> {
  let next = whenPresent;
  let seed: StructuredStatementSeed<KotlinSyntaxNode> = valueSeed(node, { kind: "statement" });
  for (let index = receivers.length - 1; index >= 0; index -= 1) {
    const receiver = receivers[index];
    seed = { taskSeed: true, node: receiver, implicitReturn: false,
      adapterData: { feature: "kotlinFlow", kind: "decision", predicate: receiver,
        expression: `${source.text.slice(receiver.from, receiver.to)} != null`, groupExpression: index === 0 ? source.text.slice(node.from, node.to) : undefined,
        groupFrom: node.from, groupTo: node.to, memberIndex: index, whenTrue: next, whenFalse: whenNull } satisfies KotlinDecisionData };
    next = [seed];
  }
  return seed;
}

/** Detects only grammar-proven &&/|| groups with more than one operand. */
function logicalOperands(node: KotlinSyntaxNode): { operator: "and" | "or"; members: KotlinSyntaxNode[] } | undefined {
  if (node.name === "conjunction") {
    const members = node.children.filter((child) => child.name === "equality");
    return members.length > 1 ? { operator: "and", members } : undefined;
  }
  if (node.name === "disjunction") {
    const members = node.children.filter((child) => child.name === "conjunction");
    return members.length > 1 ? { operator: "or", members } : undefined;
  }
  return undefined;
}

/** When arm values stay separate, including nested if/when and multi-statement blocks. */
function describeWhen(source: KotlinSource, node: KotlinSyntaxNode, context: KotlinValueContext): KotlinControlData {
  const subject = getKotlinChildNamed(node, "whenSubject");
  const branches: StructuredControlBranchDescription<KotlinSyntaxNode>[] = [];
  let hasDefaultBranch = false;
  for (const entry of node.children.filter((child) => child.name === "whenEntry")) {
    const body = getKotlinChildNamed(entry, "controlStructureBody");
    const arrow = entry.children.find((child) => child.name === "ARROW");
    const isDefault = entry.children.some((child) => child.name === "ELSE");
    hasDefaultBranch ||= isDefault;
    const label = isDefault ? "else" : normalizeKotlinText(source.text.slice(entry.from, arrow?.from ?? entry.to), "case");
    branches.push({ role: "case", edgeKind: "case", label,
      presentation: isDefault ? { key: "logic-edge-default" } : { key: "logic-edge-case", params: { source: label } },
      statements: body ? contextualBody(body, context) : [] });
  }
  return { feature: "kotlinFlow", kind: "control", blockKind: "switch",
    label: subject ? `when ${normalizeKotlinText(source.text.slice(subject.from, subject.to))}` : "when",
    description: { kind: "switch", branches, hasDefaultBranch } };
}

/** Finally is cleanup rather than an alternate choice or selected expression value. */
function describeTry(source: KotlinSource, node: KotlinSyntaxNode, context: KotlinValueContext): KotlinControlData {
  const branches: StructuredControlBranchDescription<KotlinSyntaxNode>[] = [];
  const body = getKotlinChildNamed(node, "block");
  if (body) branches.push({ role: "tryBody", edgeKind: "next", label: "try", presentation: { key: "logic-edge-try" }, statements: contextualBody(body, context) });
  for (const child of node.children) {
    if (child.name === "catchBlock") {
      const block = getKotlinChildNamed(child, "block");
      const close = child.children.find((candidate) => candidate.name === "RPAREN");
      const label = normalizeKotlinText(source.text.slice(child.from, close?.to ?? child.to), "catch");
      branches.push({ role: "catch", edgeKind: "exception", label,
        presentation: { key: "logic-edge-catch", params: { name: label } }, statements: block ? contextualBody(block, context) : [] });
    } else if (child.name === "finallyBlock") {
      const block = getKotlinChildNamed(child, "block");
      branches.push({ role: "finally", edgeKind: "finally", label: "finally", presentation: { key: "logic-edge-finally" },
        statements: block ? contextualBody(block, { kind: "statement" }) : [] });
    }
  }
  return { feature: "kotlinFlow", kind: "control", blockKind: "try", label: "try / catch / finally",
    description: { kind: "try", branches } };
}
