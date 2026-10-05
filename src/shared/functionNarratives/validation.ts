/** Validation shared by Host parsing and the CSP-safe browser renderer through an explicit helper dependency. */
import type { FunctionNarrative, FunctionNarrativeSnippet } from "./types";
import { isFunctionNarrativeExample } from "./exampleValidation";

/** Factory serialization keeps compiled module imports out of the emitted Webview program. */
export function createFunctionNarrativeValidator(validateExample: typeof isFunctionNarrativeExample) {
  /** Rejects excess fields, unbounded prose and evidence outside the supplied excerpts. */
  return function isFunctionNarrative(value: unknown, snippets?: readonly Pick<FunctionNarrativeSnippet, "id" | "startLine" | "endLine">[]): value is FunctionNarrative {
    const record = (item: unknown): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item);
    const keys = (item: Record<string, unknown>, allowed: string[]) => Object.keys(item).every((key) => allowed.includes(key));
    const text = (item: unknown, limit: number): item is string => typeof item === "string" && item.trim().length > 0 && item.length <= limit;
    const texts = (items: unknown, count: number) => Array.isArray(items) && items.length <= count && items.every((item) => text(item, 600));
    if (!record(value) || !keys(value, ["summary", "scenarios", "limitations"]) || !text(value.summary, 1200) || !texts(value.limitations, 6)
      || !Array.isArray(value.scenarios) || value.scenarios.length < 1 || value.scenarios.length > 4) return false;
    for (const scenario of value.scenarios) {
      if (!record(scenario) || !keys(scenario, ["title", "when", "explanation", "steps", "outcome", "assumptions", "example", "nodeDetails", "graph"]) || !text(scenario.title, 160)
        || (scenario.explanation !== undefined && !text(scenario.explanation, 1800))
        || (scenario.example !== undefined && !validateExample(scenario.example))
        || !texts(scenario.when, 4) || !texts(scenario.assumptions, 4) || !text(scenario.outcome, 600)
        || !Array.isArray(scenario.steps) || scenario.steps.length < 1 || scenario.steps.length > 5) return false;
      if (scenario.nodeDetails !== undefined && (!Array.isArray(scenario.nodeDetails) || scenario.nodeDetails.length > 900
        || scenario.nodeDetails.some((detail) => !record(detail) || typeof detail.nodeId !== "string"))) return false;
      if (scenario.graph !== undefined && (!record(scenario.graph) || !keys(scenario.graph, ["nodeIds", "edgeIds"])
        || !Array.isArray(scenario.graph.nodeIds) || scenario.graph.nodeIds.length > 900
        || !scenario.graph.nodeIds.every((id) => typeof id === "string" && /^function-logic-block:[0-9a-f]{32}$/.test(id))
        || !Array.isArray(scenario.graph.edgeIds) || scenario.graph.edgeIds.length > 900
        || !scenario.graph.edgeIds.every((id) => typeof id === "string" && /^function-logic-edge:[0-9a-f]{32}$/.test(id)))) return false;
      for (const step of [...scenario.steps, ...(scenario.nodeDetails ?? [])]) {
        if (!record(step) || !keys(step, ["text", "reason", "effect", "source", "values", "nodeId", "occurrence"]) || !text(step.text, 600)
          || (step.occurrence !== undefined && (!Number.isSafeInteger(step.occurrence) || (step.occurrence as number) < 0 || (step.occurrence as number) >= 900))
          || (step.nodeId !== undefined && (!text(step.nodeId, 80) || !/^function-logic-block:[0-9a-f]{32}$/.test(step.nodeId)))
          || (step.values !== undefined && (!Array.isArray(step.values) || step.values.length > 4 || step.values.some((item) => !record(item)
            || !keys(item, ["name", "before", "after"]) || !text(item.name, 120) || !text(item.before, 240) || !text(item.after, 240))))
          || (step.reason !== undefined && !text(step.reason, 600)) || (step.effect !== undefined && !text(step.effect, 600)) || !record(step.source)
          || !keys(step.source, ["snippetId", "startLine", "endLine"]) || !text(step.source.snippetId, 80)
          || !Number.isSafeInteger(step.source.startLine) || !Number.isSafeInteger(step.source.endLine)) return false;
        const source = step.source as { snippetId: string; startLine: number; endLine: number };
        if (source.startLine < 1 || source.endLine < source.startLine || source.endLine - source.startLine > 20) return false;
        if (snippets && !snippets.some((snippet) => snippet.id === source.snippetId && source.startLine >= snippet.startLine && source.endLine <= snippet.endLine)) return false;
      }
    }
    return true;
  };
}

/** Host validator uses the same helper as the browser's explicitly constructed instance. */
export const isFunctionNarrative = createFunctionNarrativeValidator(isFunctionNarrativeExample);
