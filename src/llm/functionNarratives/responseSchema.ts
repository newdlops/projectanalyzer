/** A small constrained JSON grammar guides local generation; Host validation still verifies snippet ownership. */
import type { FunctionNarrativeContext } from "../../shared/functionNarratives";
import { buildFunctionNarrativeScenarioFrames } from "../../application/functionNarratives";

export function createLocalNarrativeSchema(context: FunctionNarrativeContext, language: "ko" | "en" = "en"): Record<string, unknown> {
  // Anchored character classes are supported by llama.cpp's JSON grammar. A
  // Korean start guides the decoder's language while source const/enum fields
  // remain untouched. Bounds are in the pattern because pattern takes precedence.
  const description = (limit: number) => ({ type: "string", minLength: 1, maxLength: limit,
    ...(language === "ko" ? { pattern: `^[가-힣][^"\\\\\\x00-\\x1F]{0,${limit - 1}}$` } : {}) });
  const prose = description(600);
  const facts = { type: "array", items: prose, maxItems: 4 };
  const source = { type: "object", additionalProperties: false, required: ["snippetId", "startLine", "endLine"], properties: {
    snippetId: { type: "string", enum: context.snippets.map((snippet) => snippet.id) },
    startLine: { type: "integer", minimum: 1 }, endLine: { type: "integer", minimum: 1 }
  } };
  const step = { type: "object", additionalProperties: false, required: ["text", "reason", "effect", "source"], properties: { text: prose, reason: prose, effect: prose, source } };
  const scenario = { type: "object", additionalProperties: false, required: ["title", "when", "explanation", "steps", "outcome", "assumptions"], properties: {
    title: description(160), when: facts,
    explanation: description(1800),
    steps: { type: "array", minItems: 1, maxItems: 5, items: step }, outcome: prose, assumptions: facts
  } };
  const frames = buildFunctionNarrativeScenarioFrames(context);
  // llama.cpp supports tuple items. Each fixed slot keeps its own conditions,
  // terminal and source citations; free prose cannot substitute another route.
  const scenarios = frames.length ? { type: "array", minItems: frames.length, maxItems: frames.length, items: frames.map((frame) => ({
    ...scenario, properties: { ...scenario.properties, when: { const: frame.when }, outcome: { const: frame.outcome },
      steps: { ...scenario.properties.steps, items: { ...step, properties: { ...step.properties,
        source: { enum: frame.sources } } } } }
  })) } : { type: "array", minItems: 1, maxItems: 3, items: scenario };
  return { type: "object", additionalProperties: false, required: ["summary", "scenarios", "limitations"], properties: {
    summary: description(1200), scenarios,
    limitations: { ...facts, maxItems: 6 }
  } };
}
