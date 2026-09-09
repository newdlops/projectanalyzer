/** Conservative concrete path checks used to rank inputs by demonstrated behavior. */
import type { FunctionTutorDeclarationAnalysis, FunctionTutorOperation, FunctionTutorStaticValue as Value } from "../types";
import { stringifyFunctionTutorStaticValue } from "../staticValue";
import { evaluateInputBinary, evaluateInputExpression, inputValueTruth, readInputMember, unknownInputValue, writeInputMember } from "./expression";
import type { FunctionTutorDecisionObservation, FunctionTutorInputAssignment, FunctionTutorInputEvaluation } from "./types";
import { observeInputDecision } from "./observation";
import { evaluatePythonTutorInputs } from "./python";

/** Interprets a bounded supported IR prefix, stopping at unknown effects or control. */
export function evaluateFunctionTutorInputs(
  declaration: FunctionTutorDeclarationAnalysis,
  inputs: readonly FunctionTutorInputAssignment[],
  options: { maxSteps?: number; maxLoopVisits?: number; observeDecision?: (observation: FunctionTutorDecisionObservation) => void } = {}
): FunctionTutorInputEvaluation {
  if (declaration.language === "python" && declaration.program.python) return evaluatePythonTutorInputs(declaration, inputs, options);
  const result: FunctionTutorInputEvaluation = { status: "partial", blockIds: [], edgeIds: [], decisions: [] };
  if (!["typescript", "javascript"].includes(declaration.language)) return { ...result, reason: "language-gap" };
  const program = declaration.program;
  const blocks = new Map(program.blocks.map((block) => [block.blockId, block]));
  const outgoing = new Map<string, typeof program.edges>();
  for (const edge of program.edges) {
    if (edge.kind === "defines" || edge.kind === "deferred") continue;
    const group = outgoing.get(edge.sourceBlockId) ?? []; group.push(edge); outgoing.set(edge.sourceBlockId, group);
  }
  const bindings = new Map<string, Value>();
  for (const binding of program.bindings) {
    const parameter = declaration.parameters.find((candidate) => candidate.id === binding.parameterId || candidate.bindingId === binding.bindingId);
    const input = parameter && inputs.find((candidate) => candidate.parameterId === parameter.id);
    const value = input?.omitted || input?.value.kind === "undefined" ? parameter?.defaultValue ?? { kind: "undefined" as const } : input?.value;
    bindings.set(binding.bindingId, value ?? unknownInputValue());
  }
  const visited = new Set<string>();
  const visits = new Map<string, number>();
  const maxSteps = Math.max(1, Math.min(256, options.maxSteps ?? 128));
  const maxLoopVisits = Math.max(1, Math.min(32, options.maxLoopVisits ?? 8));
  let blockId = program.entryBlockId;
  for (let step = 0; step < maxSteps; step += 1) {
    const block = blocks.get(blockId);
    if (!block || block.embeddedRelation === "defines" || block.embeddedRelation === "deferred") return { ...result, reason: "control-gap" };
    const visitKey = blockId + ":" + [...bindings].map(([id, value]) => id + "=" + stringifyFunctionTutorStaticValue(value)).join(";");
    const count = (visits.get(blockId) ?? 0) + 1;
    if (visited.has(visitKey) || count > maxLoopVisits) return { ...result, reason: "loop-budget" };
    visited.add(visitKey); visits.set(blockId, count); result.blockIds.push(blockId);
    // A source-backed block can have no IR operations when the adapter could
    // not translate it. Its gap must stop evaluation instead of becoming a no-op.
    if (declaration.gaps.some((gap) => gap.blockId === blockId && gap.kind === "unsupported-expression")) return { ...result, reason: "unsupported-expression" };
    if (["call", "effect"].includes(block.kind) && !block.operations.length) return { ...result, reason: "external-state" };
    // Exception/finally dispatch needs a completion stack that this bounded
    // checker deliberately does not implement; do not bypass a handler.
    if (["try", "catch", "finally"].includes(block.kind)) return { ...result, reason: "control-gap" };
    for (const operation of block.operations) {
      const reason = applyOperation(operation, bindings);
      if (reason) return { ...result, reason };
    }
    if (block.terminal && (block.terminal.kind === "return" || block.terminal.kind === "throw" || block.terminal.kind === "exit")) {
      if ("continuationId" in block.terminal && block.terminal.continuationId) return { ...result, reason: "control-gap" };
      const value = "value" in block.terminal && block.terminal.value ? evaluateInputExpression(block.terminal.value, bindings) : undefined;
      result.terminal = { blockId, kind: block.terminal.kind, value };
      return value?.kind === "unknown" ? { ...result, reason: "unsupported-expression" } : { ...result, status: "verified" };
    }
    let choices = outgoing.get(blockId) ?? [];
    if (block.decision) {
      const value = evaluateInputExpression(block.decision.expression, bindings);
      const truth = inputValueTruth(value);
      if (truth === undefined || block.decision.continuationId) return { ...result, reason: "unknown-input" };
      if (options.observeDecision) { const observation = observeInputDecision(blockId, block.decision.expression, bindings, truth); if (observation) options.observeDecision(observation); }
      const matches = block.decision.outcomes.filter((outcome) => outcome.matches === (truth ? "true" : "false") || (!truth && outcome.matches === "loop-exit"));
      choices = choices.filter((edge) => matches.some((outcome) => outcome.edgeId === edge.edgeId));
      if (choices.length === 1) result.decisions.push({ blockId, edgeId: choices[0].edgeId, outcome: truth ? "true" : "false" });
    } else choices = choices.filter((edge) => edge.kind !== "exception");
    if (choices.length !== 1 || !blocks.has(choices[0].targetBlockId)) return { ...result, reason: "control-gap" };
    result.edgeIds.push(choices[0].edgeId); blockId = choices[0].targetBlockId;
  }
  return { ...result, reason: "step-budget" };
}

/** Stops at unsupported writes/calls instead of preserving a potentially stale environment. */
function applyOperation(operation: FunctionTutorOperation, bindings: Map<string, Value>): FunctionTutorInputEvaluation["reason"] | undefined {
  if (operation.kind === "effect") return "external-state";
  if (operation.kind === "unsupported" || operation.kind === "delete") return "unsupported-expression";
  if (operation.kind === "define") {
    const value = evaluateInputExpression(operation.value, bindings);
    if (value.kind === "unknown") return "unsupported-expression";
    bindings.set(operation.bindingId, value); return;
  }
  const target = operation.target;
  const base = bindings.get(target.bindingId) ?? unknownInputValue();
  const path = target.kind === "member" ? target.path ?? [] : [];
  if (target.kind === "member" && target.segments?.some((segment) => segment.kind !== "static")) return "unsupported-expression";
  // Immutable writes cannot model shared object identity. Stop when another
  // binding shares any nested reference instead of verifying stale alias data.
  if (target.kind === "member" && hasSharedReference(base, target.bindingId, bindings)) return "unsupported-expression";
  const previous = target.kind === "member" ? readInputMember(base, path) : base;
  const next = operation.kind === "increment" ? evaluateInputBinary("add", previous, { kind: "number", value: operation.delta })
    : operation.operator === "set" ? evaluateInputExpression(operation.value, bindings)
      : evaluateInputBinary(operation.operator, previous, evaluateInputExpression(operation.value, bindings));
  const value = target.kind === "member" ? writeInputMember(base, path, next) : next;
  if (value.kind === "unknown") return "unsupported-expression";
  bindings.set(target.bindingId, value);
}

/** Checks bounded, parser-owned value trees for aliases before mutating a member. */
function hasSharedReference(root: Value, bindingId: string, bindings: Map<string, Value>): boolean {
  const owned = new Set<Value>();
  const pending = [root];
  while (pending.length && owned.size < 512) {
    const value = pending.pop()!;
    if (owned.has(value) || (value.kind !== "object" && value.kind !== "array")) continue;
    owned.add(value); pending.push(...(value.kind === "array" ? value.items : value.entries.map((entry) => entry.value)));
  }
  if (pending.length) return true;
  const visited = new Set<Value>();
  const others = [...bindings].filter(([id]) => id !== bindingId).map(([, value]) => value);
  while (others.length && visited.size < 512) {
    const value = others.pop()!;
    if (owned.has(value)) return true;
    if (visited.has(value)) continue;
    visited.add(value);
    if (value.kind === "array") others.push(...value.items);
    if (value.kind === "object") others.push(...value.entries.map((entry) => entry.value));
  }
  return others.length > 0;
}
