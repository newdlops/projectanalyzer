/** Source-owned scenario frames bind model prose to known predicates, terminals and cited route locations. */
import type { FunctionNarrativeContext, FunctionNarrativeSource } from "../../shared/functionNarratives";
import { FunctionNarrativeError } from "./provider";

/** Frames contain syntax or supported static results, never an asserted external/runtime outcome. */
export type FunctionNarrativeScenarioFrame = {
  title: string;
  when: string[];
  outcome: string;
  sources: FunctionNarrativeSource[];
};

/** Only parser-proven primitive entry choices are fixed; arbitrary numeric feasibility stays unverified. */
export function getFunctionNarrativeExampleConstraints(context: FunctionNarrativeContext, index: number) {
  const path = context.sourceFlow?.paths[index];
  const booleans = new Map<string, boolean>(), conflicts = new Set<string>();
  const nullInputs = new Set<string>(), nonNullInputs = new Set<string>();
  for (const step of path?.steps ?? []) {
    const match = step.branch?.inputCondition?.match(/^(.+) = (true|false)$/u);
    if (match && context.parameters?.some((parameter) => parameter.name === match[1])) {
      const value = match[2] === "true";
      if (booleans.has(match[1]) && booleans.get(match[1]) !== value) conflicts.add(match[1]);
      booleans.set(match[1], value);
    }
    // Kotlin parameters are immutable. Only a direct parameter in the analyzer's
    // Elvis/safe-call lowering can constrain nullability; members/aliases stay free.
    const nullable = context.language === "kotlin" && step.loweredPredicate?.match(/^([\p{L}_][\p{L}\p{N}_]*) != null$/u);
    if (nullable && step.branch?.confidence === "exact" && context.parameters?.some((parameter) => parameter.name === nullable[1])) {
      if (step.branch.outcome === "false") nullInputs.add(nullable[1]);
      if (step.branch.outcome === "true") nonNullInputs.add(nullable[1]);
    }
  }
  for (const name of conflicts) booleans.delete(name);
  for (const name of nullInputs) if (nonNullInputs.has(name)) { nullInputs.delete(name); nonNullInputs.delete(name); }
  return { booleans: [...booleans].map(([name, value]) => ({ name, json: String(value) })),
    nullInputs: [...nullInputs], nonNullInputs: [...nonNullInputs], partial: path?.status === "partial" };
}

/** Uses complete static examples first, otherwise complete exact source routes; partial models stay unconstrained. */
export function buildFunctionNarrativeScenarioFrames(context: FunctionNarrativeContext): FunctionNarrativeScenarioFrame[] {
  if (context.nodeTask) return [withSourceTitle({ ...context.nodeTask.frame, sources: context.nodeTask.targets.map((step) => step.source) })];
  if (context.scenarioBatch) return (context.sourceFlow?.paths ?? []).map((path) => {
    // Pack every decision in order. A response-size bound must not silently drop
    // later conditions or collapse several source routes into one scenario.
    const decisions = path.steps.filter((step) => step.branch);
    const reference = (step: typeof decisions[number]) => `${step.source.snippetId} L${step.source.startLine}–${step.source.endLine}: ${step.branch!.outcome}`;
    // Long loop/condition syntax is already present in sourceFlow and numbered
    // snippets. Repeat its source identity/outcome instead of its entire body in
    // fixed output. Every decision remains ordered; nothing is dropped.
    const conditions = decisions.map((step) => step.branch!.inputCondition
      ?? (step.code.length > 200 ? reference(step) : `${step.loweredPredicate ?? step.code} => ${step.branch!.outcome}`));
    let when = packConditions(conditions);
    if (!when) when = packConditions(decisions.map(reference));
    if (!when) throw new FunctionNarrativeError("context-too-large");
    const last = path.steps.at(-1);
    const outcome = path.status === "source-terminal" ? last && ["return", "throw"].includes(last.kind) ? last.code : "implicit function end"
      : `partial source route (${path.reason ?? "control-gap"})`;
    const sources = uniqueSources(path.steps.map((step) => step.source));
    if (!sources.length) {
      const root = context.snippets.find((snippet) => snippet.role === "function");
      if (root) sources.push({ snippetId: root.id, startLine: root.startLine, endLine: root.startLine });
    }
    return withSourceTitle({ when, outcome, sources });
  });
  if (context.checkedExamples?.length) return context.checkedExamples.slice(0, 3).map((example) => ({
    when: example.inputs.map((input) => `${input.name} = ${input.omitted ? "(omitted)" : input.value}`),
    outcome: `${example.terminal.kind} ${example.terminal.value}`,
    sources: uniqueSources(example.sources)
  })).filter((frame) => frame.when.length <= 4 && frame.sources.length > 0).map(withSourceTitle);
  const paths = context.sourceFlow?.paths;
  if (!paths?.length || paths.some((path) => path.status !== "source-terminal" || path.confidence !== "exact"
    || !["return", "throw"].includes(path.steps.at(-1)?.kind ?? ""))) return [];
  const frames = paths.map((path) => ({
    when: path.steps.filter((step) => step.branch).map((step) => step.branch!.inputCondition ?? `${step.loweredPredicate ?? step.code} => ${step.branch!.outcome}`),
    outcome: path.steps.at(-1)!.code,
    sources: uniqueSources(path.steps.map((step) => step.source))
  }));
  // Branch labels are source choices, not assumed input values. All routes in a
  // constrained response must fit the portable when/source validator bounds.
  return frames.every((frame) => frame.when.length <= 4 && frame.when.every((condition) => condition.length <= 600)
    && frame.outcome.length <= 600 && frame.sources.length) ? frames.slice(0, 3).map(withSourceTitle) : [];
}

/** Fits the portable response shape without losing any ordered decision. */
function packConditions(conditions: string[]): string[] | undefined {
  const when: string[] = [];
  for (const condition of conditions) {
    if (condition.length > 600) return undefined;
    const last = when.length - 1;
    if (last >= 0 && when[last].length + condition.length + 3 <= 600) when[last] += " · " + condition;
    else when.push(condition);
  }
  return when.length <= 4 ? when : undefined;
}

/** A visible heading cannot contradict its own fixed conditions; full conditions remain in the evidence disclosure. */
function withSourceTitle(frame: Omit<FunctionNarrativeScenarioFrame, "title">): FunctionNarrativeScenarioFrame {
  return { title: (frame.when.length ? frame.when.join(" · ") : frame.outcome).slice(0, 160), ...frame };
}

/** Deduplicates same-line guard/return citations; overlong source blocks stay in raw source only. */
function uniqueSources(sources: FunctionNarrativeSource[]): FunctionNarrativeSource[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = JSON.stringify(source);
    if (source.endLine - source.startLine > 20 || seen.has(key)) return false;
    seen.add(key); return true;
  });
}
