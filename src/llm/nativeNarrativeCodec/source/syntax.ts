/** Source route choices, declaration/literal syntax and type propagation. No arithmetic expression is executed and no example is selected or calculated. */
import { FunctionNarrativeError } from "../../../shared/functionNarratives";
import type { FunctionNarrativeFlowStep } from "../../../shared/functionNarratives";
import type { NativeRootSourceContext } from "./types";

export type RootEntryConstraints = { booleans: Map<string, boolean>; nullInputs: Set<string>; nonNullInputs: Set<string> };

/** Only parser-owned direct entry choices are fixed. Contradictory choices remain a model applicability question. */
export function rootEntryConstraints(context: NativeRootSourceContext): RootEntryConstraints {
  const booleans = new Map<string, boolean>(), conflicts = new Set<string>(), nullInputs = new Set<string>(), nonNullInputs = new Set<string>();
  for (const step of context.sourceFlow.paths[0].steps) {
    const direct = step.branch?.inputCondition?.match(/^(.+) = (true|false)$/u);
    if (direct && context.parameters.some(parameter => parameter.name === direct[1])) { const value = direct[2] === "true"; if (booleans.has(direct[1]) && booleans.get(direct[1]) !== value) conflicts.add(direct[1]); booleans.set(direct[1], value); }
    const nullable = context.language === "kotlin" && step.loweredPredicate?.match(/^([\p{L}_][\p{L}\p{N}_]*) != null$/u);
    if (nullable && step.branch?.confidence === "exact" && context.parameters.some(parameter => parameter.name === nullable[1])) {
      if (step.branch.outcome === "false") nullInputs.add(nullable[1]); if (step.branch.outcome === "true") nonNullInputs.add(nullable[1]);
    }
  }
  for (const name of conflicts) booleans.delete(name);
  for (const name of nullInputs) if (nonNullInputs.has(name)) { nullInputs.delete(name); nonNullInputs.delete(name); }
  return { booleans, nullInputs, nonNullInputs };
}

/** A direct JSON primitive token is source data. Operators, strings, calls and compound expressions are never evaluated here. */
export function rootSourceLiteral(code: string): { value: number | boolean | null; json: string } | undefined {
  if (!/^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)$/u.test(code.trim())) return undefined;
  const value = JSON.parse(code) as number | boolean | null;
  if (typeof value === "number" && (!Number.isFinite(value) || Object.is(value, -0))) return undefined;
  return { value, json: JSON.stringify(value) };
}

/** Preserve every ordered route decision. Long repeated syntax becomes a source citation only in the fixed output label, while all original code stays in input. */
export function rootSourceFrame(context: NativeRootSourceContext): { when: string[]; outcome: string } {
  const path = context.sourceFlow.paths[0], decisions = path.steps.filter(step => step.branch), batched = context.scenarioBatch !== undefined;
  const reference = (step: FunctionNarrativeFlowStep) => `${step.source.snippetId} L${step.source.startLine}–${step.source.endLine}: ${step.branch!.outcome}`;
  const conditions = decisions.map(step => step.branch!.inputCondition ?? (batched && step.code.length > 200 ? reference(step) : `${step.loweredPredicate ?? step.code} => ${step.branch!.outcome}`));
  const pack = (items: string[]): string[] | undefined => { const result: string[] = []; for (const item of items) { if (item.length > 600) return undefined; const last = result.length - 1; if (last >= 0 && result[last].length + item.length + 3 <= 600) result[last] += " · " + item; else result.push(item); } return result.length <= 4 ? result : undefined; };
  const when = batched ? pack(conditions) ?? pack(decisions.map(reference)) : conditions.length <= 4 && conditions.every(condition => condition.length <= 600) ? conditions : undefined;
  const last = path.steps.at(-1)!;
  if (!when || !batched && (path.status !== "source-terminal" || path.confidence !== "exact" || !["return", "throw"].includes(last.kind))) throw new FunctionNarrativeError("context-too-large", "native-root-source-frame");
  const outcome = path.status === "source-terminal" ? ["return", "throw"].includes(last.kind) ? last.code : "implicit function end" : `partial source route (${path.reason ?? "control-gap"})`;
  return { when, outcome };
}
