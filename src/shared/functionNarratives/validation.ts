/** Validation shared by Host parsing and the CSP-safe browser renderer through an explicit helper dependency. */
import type { FunctionNarrative, FunctionNarrativePage, FunctionNarrativeSnippet } from "./types";
import { isFunctionNarrativeExample } from "./exampleValidation";

type Bounds = readonly Pick<FunctionNarrativeSnippet, "id" | "startLine" | "endLine">[];
export function createFunctionNarrativeValidator(validateExample: typeof isFunctionNarrativeExample): (value: unknown, snippets?: Bounds) => value is FunctionNarrative;
export function createFunctionNarrativeValidator(validateExample: typeof isFunctionNarrativeExample, complete: true): (value: unknown, snippets?: Bounds) => value is FunctionNarrativePage;
/** Factory serialization keeps compiled module imports out of the emitted Webview program. */
export function createFunctionNarrativeValidator(validateExample: typeof isFunctionNarrativeExample, complete = false) {
  /** Rejects excess fields, unbounded prose and evidence outside the supplied excerpts. */
  return function isFunctionNarrative(value: unknown, snippets?: Bounds): value is FunctionNarrativePage {
    const record = (item: unknown): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item);
    const keys = (item: Record<string, unknown>, allowed: string[]) => Object.keys(item).every((key) => allowed.includes(key));
    const text = (item: unknown, limit: number, unicode = false): item is string => typeof item === "string" && item.trim().length > 0 && (unicode ? [...item].length : item.length) <= limit;
    const texts = (items: unknown, count: number) => Array.isArray(items) && items.length <= count && items.every((item) => text(item, 600));
    const unavailable = (item: unknown): boolean => record(item) && keys(item, ["kind", "reason"])
      && item.kind === "not-evaluated" && text(item.reason, 180, true);
    if (!record(value) || !keys(value, ["summary", "scenarios", "limitations"]) || !text(value.summary, 1200) || !texts(value.limitations, 6)
      || !Array.isArray(value.scenarios) || value.scenarios.length < 1 || value.scenarios.length > 4) return false;
    for (const scenario of value.scenarios) {
      if (!record(scenario)) return false;
      const evaluation = scenario.evaluation;
      const native = complete && evaluation !== undefined;
      if (evaluation !== undefined && (!native || !record(evaluation) || !keys(evaluation, ["mode", "justification", "loopVisits"])
        || !["computed", "loop-visit", "source-infeasible", "unverified"].includes(evaluation.mode as string) || !text(evaluation.justification, 240, true)
        || (evaluation.mode === "loop-visit" ? !Array.isArray(evaluation.loopVisits) || evaluation.loopVisits.length < 1 || evaluation.loopVisits.length > 24
          || evaluation.loopVisits.some(visit => !record(visit) || !keys(visit, ["sourceOperationOrdinal", "visit", "earlierIterations", "meaning"])
            || !Number.isSafeInteger(visit.sourceOperationOrdinal) || (visit.sourceOperationOrdinal as number) < 1 || (visit.sourceOperationOrdinal as number) > 900
            || !Number.isInteger(visit.visit) || !Number.isFinite(visit.visit) || (visit.visit as number) < 1
            || !Number.isInteger(visit.earlierIterations) || !Number.isFinite(visit.earlierIterations) || (visit.earlierIterations as number) < 0 || !text(visit.meaning, 240, true))
          : evaluation.loopVisits !== undefined))) return false;
      const symbolic = native && record(evaluation) && ["source-infeasible", "unverified"].includes(evaluation.mode as string);
      const cell = (item: unknown): boolean => symbolic && unavailable(item) || text(item, native ? 24000 : 240);
      if (!keys(scenario, ["title", "when", "explanation", "analysis", "steps", "outcome", "assumptions", "example", "nodeDetails", "graph", "evaluation"]) || !text(scenario.title, 160, native)
        || (scenario.explanation !== undefined && !text(scenario.explanation, 1800))
        || (scenario.analysis !== undefined && (!record(scenario.analysis) || !keys(scenario.analysis, ["pathReason", "stateChange", "alternative"])
          || !text(scenario.analysis.pathReason, 600) || !text(scenario.analysis.stateChange, 600) || !text(scenario.analysis.alternative, 600)))
        || (scenario.example !== undefined && !(native ? validateExample(scenario.example, true) : validateExample(scenario.example)))
        || !texts(scenario.when, 4) || !texts(scenario.assumptions, 4) || !text(scenario.outcome, native ? 24000 : 600)
        || !Array.isArray(scenario.steps) || scenario.steps.length < 1 || scenario.steps.length > 5) return false;
      if (native) {
        if (value.scenarios.length !== 1 || !record(scenario.example) || !Array.isArray(scenario.example.inputs) || !Array.isArray(scenario.nodeDetails)
          || !scenario.nodeDetails.length || !record(scenario.graph) || !text(scenario.explanation, 600, true) || !record(scenario.analysis)) return false;
        if (symbolic ? !unavailable(scenario.example.result) || scenario.example.inputs.some(input => !record(input) || !unavailable(input.json))
          : typeof scenario.example.result !== "string" || scenario.example.inputs.some(input => !record(input) || typeof input.json !== "string")) return false;
      }
      if (scenario.nodeDetails !== undefined && (!Array.isArray(scenario.nodeDetails) || scenario.nodeDetails.length > 900
        || scenario.nodeDetails.some((detail) => !record(detail) || typeof detail.nodeId !== "string"))) return false;
      if (scenario.graph !== undefined && (!record(scenario.graph) || !keys(scenario.graph, ["nodeIds", "edgeIds"])
        || !Array.isArray(scenario.graph.nodeIds) || scenario.graph.nodeIds.length > 900
        || !scenario.graph.nodeIds.every((id) => typeof id === "string" && /^function-logic-block:[0-9a-f]{32}$/.test(id))
        || !Array.isArray(scenario.graph.edgeIds) || scenario.graph.edgeIds.length > 900
        || !scenario.graph.edgeIds.every((id) => typeof id === "string" && /^function-logic-edge:[0-9a-f]{32}$/.test(id)))) return false;
      for (const step of [...scenario.steps, ...(scenario.nodeDetails ?? [])]) {
        if (native && (!record(step) || !text(step.code, 24000) || !text(step.syntax, 160, true) || !text(step.reason, 180, true) || !text(step.effect, 160, true)
          || !Array.isArray(step.values) || step.values.length < 1 || step.values.length > 2)) return false;
        if (!record(step) || !keys(step, ["text", "syntax", "code", "reason", "effect", "source", "values", "nodeId", "occurrence"]) || !text(step.text, 600)
          || (step.syntax !== undefined && !text(step.syntax, 600))
          || (step.code !== undefined && !text(step.code, native ? 196608 : 480))
          || (step.occurrence !== undefined && (!Number.isSafeInteger(step.occurrence) || (step.occurrence as number) < 0 || (step.occurrence as number) >= 900))
          || (step.nodeId !== undefined && (!text(step.nodeId, 80) || !/^function-logic-block:[0-9a-f]{32}$/.test(step.nodeId)))
          || (step.values !== undefined && (!Array.isArray(step.values) || step.values.length > 4 || step.values.some((item) => !record(item)
            || !keys(item, ["name", "before", "after"]) || !text(item.name, native ? 24000 : 120) || !cell(item.before) || !cell(item.after)
            || symbolic && !unavailable(item.after))))
          || (step.reason !== undefined && !text(step.reason, 600)) || (step.effect !== undefined && !text(step.effect, 600)) || !record(step.source)
          || !keys(step.source, ["snippetId", "startLine", "endLine"]) || !text(step.source.snippetId, native ? 24000 : 80)
          || !Number.isSafeInteger(step.source.startLine) || !Number.isSafeInteger(step.source.endLine)) return false;
        const source = step.source as { snippetId: string; startLine: number; endLine: number };
        if (source.startLine < 1 || source.endLine < source.startLine || !native && source.endLine - source.startLine > 20) return false;
        if (snippets && !snippets.some((snippet) => snippet.id === source.snippetId && source.startLine >= snippet.startLine && source.endLine <= snippet.endLine)) return false;
      }
    }
    return true;
  };
}

/** Host validator uses the same helper as the browser's explicitly constructed instance. */
export const isFunctionNarrative = createFunctionNarrativeValidator(isFunctionNarrativeExample);
/** Complete pages are separately admitted; legacy model parsers continue to reject native-only fields and unavailable values. */
export const isFunctionNarrativePage = createFunctionNarrativeValidator(isFunctionNarrativeExample, true);
