/** A small constrained JSON grammar guides local generation; Host validation still verifies snippet ownership. */
import type { FunctionNarrativeContext } from "../../shared/functionNarratives";

export function createLocalNarrativeSchema(context: FunctionNarrativeContext): Record<string, unknown> {
  const prose = { type: "string", minLength: 1, maxLength: 600 };
  const facts = { type: "array", items: prose, maxItems: 4 };
  const source = { type: "object", additionalProperties: false, required: ["snippetId", "startLine", "endLine"], properties: {
    snippetId: { type: "string", enum: context.snippets.map((snippet) => snippet.id) },
    startLine: { type: "integer", minimum: 1 }, endLine: { type: "integer", minimum: 1 }
  } };
  const step = { type: "object", additionalProperties: false, required: ["text", "source"], properties: { text: prose, source } };
  const scenario = { type: "object", additionalProperties: false, required: ["title", "when", "steps", "outcome", "assumptions"], properties: {
    title: { type: "string", minLength: 1, maxLength: 160 }, when: facts,
    steps: { type: "array", minItems: 1, maxItems: 3, items: step }, outcome: prose, assumptions: facts
  } };
  return { type: "object", additionalProperties: false, required: ["summary", "scenarios", "limitations"], properties: {
    summary: { type: "string", minLength: 1, maxLength: 1200 }, scenarios: { type: "array", minItems: 1, maxItems: 2, items: scenario },
    limitations: { ...facts, maxItems: 6 }
  } };
}
