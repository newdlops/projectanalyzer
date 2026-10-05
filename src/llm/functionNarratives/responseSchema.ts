/** A small constrained JSON grammar guides local generation; Host validation still verifies snippet ownership. */
import type { FunctionNarrativeContext } from "../../shared/functionNarratives";
import { buildFunctionNarrativeScenarioFrames } from "../../application/functionNarratives";

export function createLocalNarrativeSchema(context: FunctionNarrativeContext, language: "ko" | "en" = "en"): Record<string, unknown> {
  // Anchored character classes are supported by llama.cpp's JSON grammar. A
  // Korean start guides the decoder's language while source const/enum fields
  // remain untouched. Bounds are in the pattern because pattern takes precedence.
  const description = (limit: number) => ({ type: "string", minLength: 1, maxLength: limit,
    ...(language === "ko" ? { pattern: `^[가-힣][^"\\\\\\x00-\\x1F]{0,${limit - 1}}$` } : {}) });
  // Complete runs may contain many pages. Bound local prose independently from
  // path coverage so a verbose model cannot consume the entire output budget in
  // summary/explanation before completing every fixed scenario slot.
  const batched = context.scenarioBatch !== undefined;
  const prose = description(batched ? context.parameters ? 80 : 120 : 600);
  const facts = { type: "array", items: prose, maxItems: batched ? 2 : 4 };
  const source = { type: "object", additionalProperties: false, required: ["snippetId", "startLine", "endLine"], properties: {
    snippetId: { type: "string", enum: context.snippets.map((snippet) => snippet.id) },
    startLine: { type: "integer", minimum: 1 }, endLine: { type: "integer", minimum: 1 }
  } };
  const values = { type: "array", minItems: 1, maxItems: 2, items: { type: "object", additionalProperties: false,
    required: ["name", "before", "after"], properties: {
      name: { type: "string", ...(context.valueNames?.length ? { enum: context.valueNames } : { maxLength: 120 }) },
      before: { type: "string", minLength: 1, maxLength: 120 }, after: { type: "string", minLength: 1, maxLength: 120 }
    } } };
  const step = { type: "object", additionalProperties: false, required: ["text", "reason", "effect", "source", ...(context.parameters ? ["values"] : [])],
    properties: { text: prose, reason: prose, effect: prose, source, ...(context.parameters ? { values } : {}) } };
  const example = context.nodeTask ? { const: context.nodeTask.example } : { type: "object", additionalProperties: false, required: ["inputs", "result"], properties: {
    inputs: { type: "array", minItems: context.parameters?.length ?? 0, maxItems: context.parameters?.length ?? 0,
      ...(context.parameters?.length ? { items: context.parameters.map((parameter) => ({ type: "object", additionalProperties: false, required: ["name", "json"],
        properties: { name: { const: parameter.name }, json: { type: "string", minLength: 1, maxLength: 1200 } } })) } : { items: { type: "object" } }) },
    result: { type: "string", minLength: 1, maxLength: 1200 }
  } };
  const scenario = { type: "object", additionalProperties: false, required: ["title", "when", "explanation", "steps", "outcome", "assumptions", ...(context.parameters ? ["example"] : [])], properties: {
    title: description(batched ? 64 : 160), when: facts,
    explanation: description(batched ? context.parameters ? 280 : 480 : 1800),
    steps: { type: "array", minItems: 1, maxItems: batched ? 3 : 5, items: step }, outcome: prose, assumptions: facts,
    ...(context.parameters ? { example } : {})
  } };
  const frames = buildFunctionNarrativeScenarioFrames(context);
  // llama.cpp supports tuple items. Each fixed slot keeps its own conditions,
  // terminal and source citations; free prose cannot substitute another route.
  const scenarios = frames.length ? { type: "array", minItems: frames.length, maxItems: frames.length, items: frames.map((frame) => ({
    ...scenario, properties: { ...scenario.properties, when: { const: frame.when }, outcome: { const: frame.outcome },
      steps: context.nodeTask ? { type: "array", minItems: context.nodeTask.targets.length, maxItems: context.nodeTask.targets.length,
        items: context.nodeTask.targets.map((target) => ({ ...step, properties: { ...step.properties, source: { const: target.source } } })) }
        : { ...scenario.properties.steps, items: { ...step, properties: { ...step.properties, source: { enum: frame.sources } } } } }
  })) } : { type: "array", minItems: 1, maxItems: 3, items: scenario };
  return { type: "object", additionalProperties: false, required: ["summary", "scenarios", "limitations"], properties: {
    summary: description(batched ? context.parameters ? 160 : 240 : 1200), scenarios,
    limitations: { ...facts, maxItems: batched ? 2 : 6 }
  } };
}
