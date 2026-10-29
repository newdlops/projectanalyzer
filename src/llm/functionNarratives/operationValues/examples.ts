/** Check concrete model examples against a bounded exact source prefix.
 * Known contradictions reject; aliases, opaque operations, inferred/truncated
 * source and unsupported arithmetic remain unknown. No model value/prose is
 * supplied or repaired and no source-language code is executed.
 */
import type { FunctionNarrativeContext, FunctionNarrativeExample } from "../../../shared/functionNarratives";
import { applyExampleWrite, knownExampleInput, readExampleOperand, readExamplePredicate, type ExampleBindings } from "./exampleOperands";

export interface SourceExampleCheck {
  status: "compatible" | "contradiction" | "unknown";
  reason?: "unavailable-source" | "step-limit" | "unsupported-operation" | "predicate" | "result";
  stepIndex?: number;
  /** Concrete prefix decisions, never computed through an opaque operation. */
  decisions?: Array<{ stepIndex: number; value: boolean }>;
}

/** Validate only facts proved from this example and this exact source owner.
 * Iteration has an explicit step bound and occurrence visited set. Unknown
 * operations terminate the proof so no later predicate uses stale local state.
 * A final primitive result is checked only on a complete route whose last exact
 * operation is return; finally/throw/call/partial routes keep their old fallback.
 */
export function checkSourceExample(context: FunctionNarrativeContext, routeIndex: number,
  example: FunctionNarrativeExample, maximumSteps = 256): SourceExampleCheck {
  const route = context.sourceFlow?.paths[routeIndex];
  const root = context.snippets.find(snippet => snippet.role === "function");
  if (!route || route.confidence !== "exact" || context.limited || !root || root.truncated
    || context.nodePreparation && !context.nodeTask
    || !["kotlin", "typescript", "javascript"].includes(context.language)) return { status: "unknown", reason: "unavailable-source" };
  if (!Number.isSafeInteger(maximumSteps) || maximumSteps < 1 || route.steps.length > maximumSteps) return { status: "unknown", reason: "step-limit" };
  const bindings: ExampleBindings = { values: new Map(), types: new Map() };
  for (const parameter of context.parameters ?? []) {
    bindings.types.set(parameter.name, parameter.type);
    const input = example.inputs.find(item => item.name === parameter.name);
    if (!input) continue;
    try {
      const value = knownExampleInput(context.language, parameter.type, JSON.parse(input.json));
      if (value) bindings.values.set(parameter.name, value);
    } catch { /* The existing Host owns malformed input/arity/name validation. */ }
  }
  const visited = new Set<string>();
  const decisions: NonNullable<SourceExampleCheck["decisions"]> = [];
  const finish = (status: SourceExampleCheck["status"], reason?: SourceExampleCheck["reason"], stepIndex?: number): SourceExampleCheck =>
    ({ status, reason, stepIndex, decisions });
  for (const [index, target] of route.steps.entries()) {
    const identity = target.graphNodeId !== undefined && target.graphOccurrence !== undefined
      ? target.graphNodeId + ":" + target.graphOccurrence : "position:" + index;
    if (visited.has(identity)) return finish("unknown", "unsupported-operation", index);
    visited.add(identity);
    if (target.confidence !== "exact" || target.source.snippetId !== root.id) return finish("unknown", "unsupported-operation", index);
    if (target.kind === "condition" || target.kind === "loop") {
      const branch = target.branch;
      const expected = branch?.confidence === "exact" && (branch.outcome === "true" || branch.outcome === "iterate") ? true
        : branch?.confidence === "exact" && (branch.outcome === "false" || branch.outcome === "exit") ? false : undefined;
      const actual = readExamplePredicate(context.language, target.loweredPredicate ?? target.code, bindings);
      if (expected === undefined || actual === undefined) return finish("unknown", "unsupported-operation", index);
      if (expected !== actual) return finish("contradiction", "predicate", index);
      decisions.push({ stepIndex: index, value: actual });
    } else if (target.kind === "mutation") {
      if (target.writeTargets?.length !== 1 || !applyExampleWrite(context.language, target.code, target.writeTargets[0], bindings)) {
        return finish("unknown", "unsupported-operation", index);
      }
    } else if (target.kind === "return") {
      if (index !== route.steps.length - 1 || route.status !== "source-terminal") return finish("unknown", "unsupported-operation", index);
      // Node preparation's null result is an unfinished UI state. Node work
      // still verifies its concrete input decisions without claiming a result.
      if (context.nodeTask) continue;
      const match = /^return\b\s*(.*?)\s*;?$/u.exec(target.code);
      const value = match && readExampleOperand(context.language, match[1], bindings);
      if (!value || value.kind === "array") return finish("unknown", "unsupported-operation", index);
      try {
        if (JSON.parse(example.result) !== value.value) return finish("contradiction", "result", index);
      } catch { return finish("unknown", "unsupported-operation", index); }
    } else return finish("unknown", "unsupported-operation", index);
  }
  return finish("compatible");
}

/** Require the model's known decision row while retaining optional other rows.
 * Repeated occurrences use graph identity or unique source matching. Unknown
 * or ambiguous decisions keep their original contract, and no value is fixed.
 */
export function hasConsistentDecisionRows(context: FunctionNarrativeContext, routeIndex: number,
  check: SourceExampleCheck, readings: Array<{ code?: string; source?: unknown; values?: Array<{ name?: string; after?: unknown }> }>): boolean {
  const targets = context.sourceFlow?.paths[routeIndex]?.steps;
  if (!targets || !context.valueNames?.includes("condition")) return true;
  // The reserved display name can also be an actual source binding. Preserve
  // its old rows when provenance cannot distinguish binding and decision data.
  if (context.parameters?.some(parameter => parameter.name === "condition")
    || targets.some(target => target.writeTargets?.includes("condition"))) return true;
  for (const [index, reading] of readings.entries()) {
    const target = context.nodeTask?.targets[index] ?? targets[index];
    if (!target || reading.code !== target.code) continue;
    let ordinal = targets.indexOf(target);
    if (ordinal < 0) {
      const matches = targets.map((candidate, position) => ({ candidate, position })).filter(({ candidate }) =>
        target.graphNodeId !== undefined && target.graphOccurrence !== undefined
          ? candidate.graphNodeId === target.graphNodeId && candidate.graphOccurrence === target.graphOccurrence
          : candidate.code === target.code && JSON.stringify(candidate.source) === JSON.stringify(target.source));
      if (matches.length !== 1) continue;
      ordinal = matches[0].position;
    }
    const fact = check.decisions?.find(decision => decision.stepIndex === ordinal);
    if (!fact) continue;
    const row = reading.values?.find(value => value.name === "condition");
    if (!row || row.after !== fact.value && row.after !== String(fact.value)) return false;
  }
  return true;
}
