/** Pure language-common behavior planning from bounded declaration, CFG and collected context facts. */
import type { FunctionLogicAnalysis, FunctionLogicBlock, FunctionLogicValueChange } from "../../../../analyzer/functionLogic";
import type { FunctionTutorDeclarationAnalysis, FunctionTutorEvidence, FunctionTutorGap, FunctionTutorStaticValue } from "../../../../analyzer/functionTutor";
import { createContentHash } from "../../../../shared/hash";
import type { FunctionTutorCodebaseContext } from "../types";
import { collectFunctionBehaviorScope, type FunctionBehaviorReachableScope } from "./reachableScope";
import { collectCurrentScopeCalls } from "./currentScopeCalls";
import type { FunctionBehaviorSummary, FunctionBehaviorSummaryInput, FunctionBehaviorSummaryItem, FunctionBehaviorSummaryKind } from "./types";

/** Display omissions are independent of the analyzer's control/data limits. */
export const FUNCTION_BEHAVIOR_SUMMARY_LIMITS = { lists: 8, steps: 5, references: 24, evidence: 8, sourcePreview: 240, purposePreview: 480 } as const;
export type BuildFunctionBehaviorSummaryInput = {
  declaration: FunctionTutorDeclarationAnalysis;
  functionLogic: FunctionLogicAnalysis;
  context: FunctionTutorCodebaseContext;
  gaps?: FunctionTutorGap[];
  maxDepth?: number;
};

/** Plans current-scope syntax facts only; no evaluator, caller lookup or source I/O is performed. */
export function buildFunctionBehaviorSummary(input: BuildFunctionBehaviorSummaryInput): FunctionBehaviorSummary {
  const { declaration, functionLogic: logic, context } = input;
  const scope = collectFunctionBehaviorScope(logic, declaration, input.maxDepth);
  const blocksById = new Map(logic.blocks.map((block) => [block.id, block]));
  const edgesById = new Map(logic.edges.map((edge) => [edge.id, edge]));
  const blocks = logic.blocks.filter((block) => scope.blockIds.has(block.id));
  const changesByBlock = new Map(blocks.map((block) => [block.id, currentScopeChanges(block, declaration)]));
  const callsByBlock = collectCurrentScopeCalls(logic, declaration, scope.blockIds);
  const item = (kind: FunctionBehaviorSummaryKind, block: FunctionLogicBlock, source = sourcePreview(block), discriminator = ""): FunctionBehaviorSummaryItem => {
    const guards = [...(scope.guardsByBlockId.get(block.id) ?? [])].flatMap((id) => {
      const edge = edgesById.get(id); const control = edge ? blocksById.get(edge.sourceId) : undefined;
      return edge && control ? [{ blockId: control.id, edgeId: edge.id, outcome: edge.kind, sourcePreview: sourcePreview(control) }] : [];
    }).slice(0, 8);
    const ancestry = collectAncestry(block, blocksById);
    const repeated = block.kind === "loop" || ancestry.some((parent) => parent.kind === "loop");
    // Normal cleanup uses next continuations in structured adapters. The typed
    // lexical branch marker survives on its nested owners even without a finally edge.
    const finallyScope = [block, ...ancestry].some((owner) => owner.branchPresentation?.key === "logic-edge-finally")
      || [...scope.edgeIds].some((id) => { const edge = edgesById.get(id); return edge?.kind === "finally" && (edge.targetId === block.id || ancestry.some((parent) => parent.id === edge.targetId)); });
    return {
      id: identity(declaration.functionNode.id, kind, `${block.id}:${discriminator}`), kind,
      sourcePreview: preview(source), presentationKey: `summary-item-${kind}`, certainty: block.confidence,
      scope: finallyScope ? "finally" : repeated ? "repeated" : guards.length ? "conditional" : "source",
      conditions: guards,
      blockIds: unique([block.id, ...guards.map((guard) => guard.blockId)]).slice(0, 24),
      edgeIds: unique([...guards.map((guard) => guard.edgeId), ...(scope.outgoing.get(block.id) ?? []).map((edge) => edge.id)]).slice(0, 24),
      evidence: [blockEvidence(block, kind)]
    };
  };
  const inputs: FunctionBehaviorSummaryInput[] = declaration.parameters.map((parameter) => {
    const usedBlocks = blocks.filter((block) => block.valueAccesses?.some((access) => access.bindingId === parameter.bindingId));
    return {
      id: identity(declaration.functionNode.id, "parameter", parameter.id), kind: "parameter", name: preview(parameter.name),
      typeText: parameter.typeText ? preview(parameter.typeText) : undefined,
      defaultText: parameter.defaultValue ? preview(defaultValueText(parameter.defaultValue)) : undefined,
      optional: parameter.optional, rest: parameter.rest,
      sourcePreview: preview(parameter.name + (parameter.typeText ? `: ${parameter.typeText}` : "")),
      presentationKey: "summary-item-parameter", certainty: parameter.declarationEvidence.some((evidence) => evidence.certainty === "unknown") ? "unknown" : "exact",
      scope: "source", conditions: [], blockIds: usedBlocks.map((block) => block.id).slice(0, 24), edgeIds: [], evidence: parameter.declarationEvidence.slice(0, 8)
    };
  });
  // Synthetic exit joins add no alternate result when concrete source return/
  // throw forms already explain all predecessors of that scope marker.
  const outcomes = blocks.filter((block) => block.kind === "return" || block.kind === "throw" || block.kind === "exit").map((block) => item(block.kind as "return" | "throw" | "exit", block));
  const impacts: FunctionBehaviorSummaryItem[] = [];
  for (const block of blocks) {
    const calls = callsByBlock.get(block.id) ?? [];
    for (const call of calls) {
      const invocation = item("call", block, call.sourcePreview, call.identity);
      invocation.certainty = call.certainty;
      invocation.evidence = [{ ...blockEvidence(block, "call"), range: call.range, certainty: call.certainty }];
      impacts.push(invocation);
    }
    if (!calls.length && (block.kind === "call" || block.kind === "effect")) impacts.push(item(block.kind, block));
    for (const change of changesByBlock.get(block.id) ?? []) {
      const write = item("write", block, `${change.target} ${change.operator}${change.value ? ` ${change.value}` : ""}`, `${change.target}:${change.operation}`);
      write.certainty = change.confidence; impacts.push(write);
    }
  }
  const sourceCalls = impacts.filter((candidate) => candidate.kind === "call");
  const enrichedCallIds = new Set<string>();
  for (const callee of context.callees) {
    // Context edges without a current-scope source block cannot establish an
    // immediate operation. Event/render dispatch is also a separate boundary.
    const block = callee.sourceBlockId ? blocksById.get(callee.sourceBlockId) : undefined;
    if (!block || !scope.blockIds.has(block.id) || callee.relation !== "call") continue;
    // Nested invocations can share a return/initializer block. Only an exact
    // source occurrence joins relation metadata; a block or name alone cannot
    // resolve its receiver, create another invocation, or identify a fallback
    // effect whose evidence covers the whole enclosing expression.
    const matches = sourceCalls.filter((candidate) => candidate.blockIds[0] === block.id
      && callee.evidence.some((evidence) => sameSourceLocation(candidate.evidence[0], evidence)));
    if (matches.length !== 1 || enrichedCallIds.has(matches[0].id)) continue;
    const fact = matches[0];
    const kind = callee.kind === "local" ? "call" : callee.kind === "external" ? "external-call" : "unresolved-call";
    const relationEvidence = callee.evidence.filter((evidence) => sameSourceLocation(fact.evidence[0], evidence));
    enrichedCallIds.add(fact.id);
    fact.kind = kind; fact.presentationKey = `summary-item-${kind}`; fact.certainty = callee.certainty;
    fact.evidence = [...fact.evidence, ...relationEvidence].slice(0, 8);
  }
  const stageBlocks = blocks.filter((block) => ["condition", "loop", "switch", "try", "call", "effect", "return", "throw"].includes(block.kind) || Boolean(changesByBlock.get(block.id)?.length) || callsByBlock.has(block.id));
  const steps = stageBlocks.map((block) => {
    const kind = ["condition", "loop", "switch", "try", "call", "effect", "return", "throw"].includes(block.kind) ? block.kind as FunctionBehaviorSummaryKind : changesByBlock.get(block.id)?.length ? "write" : "call";
    const source = kind === "write" ? (changesByBlock.get(block.id) ?? []).map((change) => `${change.target} ${change.operator}${change.value ? ` ${change.value}` : ""}`).join("; ") : sourcePreview(block);
    const step = item(kind, block, source);
    if (kind === "call" || kind === "effect") {
      const calls = callsByBlock.get(block.id) ?? [];
      if (calls.some((call) => call.certainty === "unknown")) step.certainty = "unknown";
      else if (calls.some((call) => call.certainty === "inferred")) step.certainty = "inferred";
    }
    if (["condition", "loop", "switch", "try"].includes(block.kind)) step.alternatives = (scope.outgoing.get(block.id) ?? []).filter((edge) => !["next", "return", "throw", "repeat"].includes(edge.kind)).slice(0, 8).map((edge) => ({ edgeId: edge.id, outcome: edge.kind, sourcePreview: preview(edge.label ?? ""), blockIds: [edge.targetId] }));
    return step;
  });
  const gaps = collectGaps(input, scope, blocks, impacts);
  const documentation = context.documentation ?? declaration.documentation;
  const certainty = impacts.some((impact) => impact.certainty === "unknown") ? "unknown"
    : blocks.some((block) => block.confidence !== "exact") || impacts.some((impact) => impact.certainty !== "exact") ? "inferred" : "exact";
  const purpose: FunctionBehaviorSummary["purpose"] = documentation?.summary ? {
    basis: "documentation", sourcePreview: preview(documentation.summary, 480), certainty: "exact", evidence: documentation.evidence.slice(0, 8)
  } : {
    basis: "structure", presentationKey: "summary-purpose-structure",
    presentationParams: { inputs: inputs.length, calls: impacts.filter((fact) => ["call", "external-call", "unresolved-call"].includes(fact.kind)).length, writes: impacts.filter((fact) => fact.kind === "write").length, returns: outcomes.filter((fact) => fact.kind === "return").length, throws: outcomes.filter((fact) => fact.kind === "throw").length },
    certainty, evidence: blocks.filter((block) => block.kind === "entry").slice(0, 1).map((block) => blockEvidence(block, "effect"))
  };
  const hasFacts = blocks.some((block) => !["entry", "exit", "unknown", "callable"].includes(block.kind)) || inputs.length > 0 || Boolean(documentation?.summary);
  return {
    schema: 1, status: hasFacts ? gaps.length || scope.limited ? "partial" : "ready" : "unavailable", purpose,
    inputs: inputs.slice(0, 8), outcomes: outcomes.slice(0, 8), steps: steps.slice(0, 5), impacts: impacts.slice(0, 8), gaps: gaps.slice(0, 8),
    omittedCounts: { inputs: Math.max(0, inputs.length - 8), outcomes: Math.max(0, outcomes.length - 8), steps: Math.max(0, steps.length - 5), impacts: Math.max(0, impacts.length - 8), gaps: Math.max(0, gaps.length - 8) },
    limited: scope.limited || logic.gaps.some((gap) => gap.code === "parseLimited") || (input.gaps ?? declaration.gaps).some((gap) => gap.kind.endsWith("budget"))
  };
}

/** Matches source writes to parser-built current-scope operations when that stronger contract exists. */
function currentScopeChanges(block: FunctionLogicBlock, declaration: FunctionTutorDeclarationAnalysis): FunctionLogicValueChange[] {
  const changes = block.valueChanges ?? [];
  if (declaration.language !== "typescript" && declaration.language !== "javascript") return changes;
  const operations = declaration.program.blocks.find((candidate) => candidate.blockId === block.id)?.operations ?? [];
  const writes = operations.filter((operation) => ["define", "assign", "increment", "delete"].includes(operation.kind));
  if (!writes.length) return [];
  const bindings = new Map(declaration.program.bindings.map((binding) => [binding.bindingId, binding.name]));
  const targets = new Map<string, boolean>();
  for (const operation of writes) {
    if (operation.kind === "define") targets.set(bindings.get(operation.bindingId) ?? "", operation.value.kind === "unsupported");
    else if (operation.kind === "assign" || operation.kind === "increment" || operation.kind === "delete") targets.set(bindings.get(operation.target.bindingId) ?? "", false);
  }
  return changes.flatMap((change) => {
    const target = change.fieldRef?.rootName ?? change.target;
    if (!targets.has(target)) return [];
    // Source expressions inside an unsupported callable initializer cannot be
    // represented as immediate body work. Its binding creation remains factual.
    return [{ ...change, ...(targets.get(target) ? { value: undefined } : {}) }];
  });
}

/** Formats bounded literal declaration values with an explicit stack and no object coercion. */
function defaultValueText(value: FunctionTutorStaticValue): string {
  const pending: Array<{ value: FunctionTutorStaticValue | string; depth: number }> = [{ value, depth: 0 }]; let output = ""; let work = 0;
  while (pending.length && work++ < 96 && output.length < 240) {
    const item = pending.pop()!; const current = item.value;
    if (typeof current === "string") { output += current; continue; }
    if (item.depth > 4 || current.kind === "unknown") { output += "?"; continue; }
    if (current.kind === "number" || current.kind === "boolean" || current.kind === "string") { output += JSON.stringify(current.value); continue; }
    if (current.kind === "enum") { output += [current.typeName, current.memberName].filter(Boolean).join("."); continue; }
    if (current.kind === "null" || current.kind === "undefined") { output += current.kind; continue; }
    const array = current.kind === "array"; const entries = array ? current.items.slice(0, 8).map((entry) => ({ value: entry, key: "" })) : current.entries.slice(0, 8);
    output += array ? "[" : "{"; pending.push({ value: (current.truncated ? "…" : "") + (array ? "]" : "}"), depth: 0 });
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      pending.push({ value: entries[index].value, depth: item.depth + 1 });
      if (!array) pending.push({ value: JSON.stringify(entries[index].key) + ": ", depth: 0 });
      if (index > 0) pending.push({ value: ", ", depth: 0 });
    }
  }
  return preview(output + (pending.length ? "…" : ""));
}

/** Keeps parser/semantic limits distinct from display omissions and external outcome uncertainty. */
function collectGaps(input: BuildFunctionBehaviorSummaryInput, scope: FunctionBehaviorReachableScope, blocks: FunctionLogicBlock[], impacts: FunctionBehaviorSummaryItem[]): FunctionBehaviorSummary["gaps"] {
  const gaps: FunctionBehaviorSummary["gaps"] = []; const rootId = input.declaration.functionNode.id;
  for (const gap of input.functionLogic.gaps) gaps.push({ id: identity(rootId, "gap", gap.code + gap.message), presentationKey: gap.presentation?.key ?? "summary-gap-analysis", presentationParams: gap.presentation?.params, blockIds: [], evidence: [] });
  for (const gap of input.gaps ?? input.declaration.gaps) {
    if (gap.blockId && !scope.blockIds.has(gap.blockId)) continue;
    gaps.push({ id: identity(rootId, "gap", gap.kind + gap.summary), presentationKey: `tutor-gap-${gap.kind}`, blockIds: gap.blockId ? [gap.blockId] : [], evidence: (gap.evidence ?? []).slice(0, 8) });
  }
  if (scope.excludedBoundaryIds.length) gaps.push({ id: identity(rootId, "gap", "scope-boundary"), presentationKey: "summary-gap-boundary", blockIds: scope.excludedBoundaryIds.slice(0, 24), evidence: [] });
  for (const impact of impacts.filter((item) => item.kind === "external-call" || item.kind === "unresolved-call")) gaps.push({ id: identity(rootId, "gap", impact.id), presentationKey: impact.kind === "external-call" ? "summary-gap-external" : "summary-gap-unresolved", sourcePreview: impact.sourcePreview, blockIds: impact.blockIds, evidence: impact.evidence });
  for (const block of blocks.filter((block) => block.kind === "unknown")) gaps.push({ id: identity(rootId, "gap", block.id), presentationKey: "summary-gap-unknown", sourcePreview: sourcePreview(block), blockIds: [block.id], evidence: [blockEvidence(block, "effect")] });
  if (scope.limited) gaps.push({ id: identity(rootId, "gap", "scope-limit"), presentationKey: "summary-gap-limit", blockIds: [], evidence: [] });
  return [...new Map(gaps.map((gap) => [gap.id, gap])).values()];
}

/** Walks only lexical owners, bounded and cycle-safe, to retain loop/finally structure. */
function collectAncestry(block: FunctionLogicBlock, blocks: ReadonlyMap<string, FunctionLogicBlock>): FunctionLogicBlock[] {
  const parents: FunctionLogicBlock[] = []; const visited = new Set([block.id]); let id = block.parentBlockId;
  while (id && !visited.has(id) && parents.length < 24) { visited.add(id); const parent = blocks.get(id); if (!parent) break; parents.push(parent); id = parent.parentBlockId; }
  return parents;
}

function blockEvidence(block: FunctionLogicBlock, kind: FunctionBehaviorSummaryKind): FunctionTutorEvidence {
  return { kind: kind === "write" ? "value-change" : ["return", "throw", "exit"].includes(kind) ? "terminal" : "fallback", certainty: block.confidence, filePath: block.filePath, range: block.range, summary: "Source-backed function behavior." };
}
/** Exact file/range equality identifies one source invocation; containment is deliberately insufficient. */
function sameSourceLocation(left: FunctionTutorEvidence | undefined, right: FunctionTutorEvidence): boolean {
  const a = left?.range; const b = right.range;
  return Boolean(left?.filePath && left.filePath === right.filePath && a && b
    && a.startLine === b.startLine && a.startCharacter === b.startCharacter
    && a.endLine === b.endLine && a.endCharacter === b.endCharacter);
}
function sourcePreview(block: FunctionLogicBlock): string { return preview(block.condition?.groupExpression || block.condition?.expression || block.label); }
function preview(value: string, limit = 240): string { return value.length <= limit ? value : value.slice(0, limit - 1) + "…"; }
function identity(root: string, kind: string, source: string): string { return `function-summary-${kind}:${createContentHash(`${root}\0${source}`).slice(0, 24)}`; }
function unique(values: string[]): string[] { return [...new Set(values)]; }
