/** A small constrained JSON grammar guides local generation; Host validation still verifies snippet ownership. */
import type { FunctionNarrativeContext } from "../../shared/functionNarratives";
import { createFunctionCallNarrativeSchema } from "../../shared/functionCallNarratives";
import { buildFunctionNarrativeScenarioFrames, getFunctionNarrativeExampleConstraints } from "../../application/functionNarratives";

export function createLocalNarrativeSchema(context: FunctionNarrativeContext, language: "ko" | "en" = "en"): Record<string, unknown> {
  if (context.callTask) return createFunctionCallNarrativeSchema(context.callTask, language);
  // Anchored character classes are supported by llama.cpp's JSON grammar. A
  // Korean start guides the decoder's language while source const/enum fields
  // remain untouched. Bounds are in the pattern because pattern takes precedence.
  const description = (limit: number) => ({ type: "string", minLength: 1, maxLength: limit,
    ...(language === "ko" ? { pattern: `^[가-힣][^"\\\\\\x00-\\x1F]{0,${limit - 1}}$` } : {}) });
  // Complete runs may contain many pages. Bound local prose independently from
  // path coverage so a verbose model cannot consume the entire output budget in
  // summary/explanation before completing every fixed scenario slot.
  const batched = context.scenarioBatch !== undefined;
  const rich = context.detailLevel === "rich";
  // Intermediate values belong to ordered node work, after earlier state exists.
  const withValues = Boolean(context.parameters && (!rich || context.nodeTask));
  const prose = description(rich ? 160 : batched ? context.parameters ? 80 : 120 : 600);
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
  const step = { type: "object", additionalProperties: false, required: ["text", "reason", "effect", "source", ...(rich ? ["syntax"] : []), ...(withValues ? ["values"] : [])],
    properties: { ...(rich ? { code: { type: "string", minLength: 1, maxLength: 480 }, syntax: description(160) } : {}),
      text: rich ? description(120) : prose, reason: rich ? description(180) : prose, effect: prose,
      source, ...(withValues ? { values } : {}) } };
  const targetedSteps = context.nodeTask ? { type: "array", minItems: context.nodeTask.targets.length, maxItems: context.nodeTask.targets.length,
    items: context.nodeTask.targets.map((target) => ({ ...step, required: [...step.required, ...(rich ? ["code"] : [])],
      properties: { ...step.properties, ...(rich ? { code: { const: target.code } } : {}), source: { const: target.source } } })) } : undefined;
  // Node generation spends its output on new syntax/causality. The Host retains
  // the original scenario/example; repeating it here wastes tokens and drifts.
  if (rich && targetedSteps) return { type: "object", additionalProperties: false, required: ["steps"], properties: { steps: targetedSteps } };
  const analysis = { type: "object", additionalProperties: false, required: ["pathReason", "stateChange", "alternative"],
    properties: { pathReason: description(220), stateChange: description(220), alternative: description(220) } };
  const example = context.nodeTask ? { const: context.nodeTask.example } : { type: "object", additionalProperties: false, required: ["inputs", "result"], properties: {
    inputs: { type: "array", minItems: context.parameters?.length ?? 0, maxItems: context.parameters?.length ?? 0,
      ...(context.parameters?.length ? { items: context.parameters.map((parameter) => ({ type: "object", additionalProperties: false, required: ["name", rich ? "value" : "json"],
        properties: { name: { const: parameter.name }, ...(rich ? { value: {} } : { json: { type: "string", minLength: 1, maxLength: 1200 } }) } })) } : { items: { type: "object" } }) },
    result: { type: "string", minLength: 1, maxLength: 1200 }
  } };
  const scenario = { type: "object", additionalProperties: false, required: ["title", "when", "explanation", "steps", "outcome", "assumptions", ...(rich ? ["analysis"] : []), ...(context.parameters ? ["example"] : [])], properties: {
    ...(rich && context.parameters ? { exampleInputs: example.properties!.inputs } : {}),
    title: description(batched ? 64 : 160), when: facts,
    explanation: description(rich ? 600 : batched ? context.parameters ? 280 : 480 : 1800),
    ...(rich ? { analysis } : {}),
    steps: { type: "array", minItems: 1, maxItems: rich ? 2 : batched ? 3 : 5, items: step }, outcome: prose, assumptions: facts,
    ...(context.parameters && !rich ? { example } : {}),
    ...(rich && context.parameters ? { exampleResult: example.properties!.result } : {})
  } };
  if (rich && context.parameters) scenario.required = scenario.required.filter((field) => field !== "example").concat("exampleInputs", "exampleResult");
  const frames = buildFunctionNarrativeScenarioFrames(context);
  // llama.cpp supports tuple items. Each fixed slot keeps its own conditions,
  // terminal and source citations; free prose cannot substitute another route.
  const scenarios = frames.length ? { type: "array", minItems: frames.length, maxItems: frames.length, items: frames.map((frame, index) => ({
    ...scenario, properties: { ...scenario.properties, when: { const: frame.when }, outcome: { const: frame.outcome },
      ...(rich && context.parameters ? { exampleInputs: constrainedExample(index).properties.inputs,
        exampleResult: constrainedExample(index).properties.result } : {}),
      steps: targetedSteps ?? (rich && context.sourceFlow?.paths[index]?.steps.length ? terminalEvidence(index) :
        { ...scenario.properties.steps, items: { ...step, properties: {
          ...(!rich || !context.sourceFlow?.paths[index] ? step.properties : sourceStepProperties(index)),
          source: { enum: frame.sources } } } }) }
  })) } : { type: "array", minItems: 1, maxItems: 3, items: scenario };
  return { type: "object", additionalProperties: false, required: ["summary", "scenarios", "limitations"], properties: {
    summary: description(rich ? 240 : batched ? context.parameters ? 160 : 240 : 1200), scenarios,
    limitations: { ...facts, maxItems: batched ? 2 : 6 }
  } };

  /** Empty partial/implicit routes cite the owned declaration without inventing an executable code step. */
  function sourceStepProperties(index: number) {
    const operations = context.sourceFlow!.paths[index].steps;
    const { code: _freeCode, ...properties } = step.properties;
    // llama.cpp rejects enum: [] before loading the model. Omitting code for
    // a step-less route also preserves the Host's
    // existing rejection of fabricated statements on that route.
    return operations.length ? { ...properties, code: { enum: operations.map(operation => operation.code) } } : properties;
  }

  /** Emit fixed entry choices before prose so generation anchors on the correct scenario. */
  function constrainedExample(index: number) {
    const constraints = getFunctionNarrativeExampleConstraints(context, index);
    return { ...example, properties: { ...example.properties,
      inputs: { type: "array", minItems: context.parameters!.length, maxItems: context.parameters!.length,
        // Decoding a JSON value directly prevents Python/Kotlin literals from
        // masquerading as JSON text. The adapter encodes it for portable inputs.
        items: context.parameters!.length ? context.parameters!.map((parameter) => ({ type: "object", additionalProperties: false, required: ["name", "value"], properties: {
          name: { const: parameter.name }, value: constraints.booleans.some((input) => input.name === parameter.name)
            ? { const: constraints.booleans.find((input) => input.name === parameter.name)!.json === "true" }
            : constraints.nullInputs.includes(parameter.name) ? { const: null }
              : constraints.nonNullInputs.includes(parameter.name) ? { anyOf: [
                { type: "string", maxLength: 1200 }, { type: "number" }, { type: "boolean" },
                { type: "array", items: {} }, { type: "object", additionalProperties: true }
              ] } : {}
        } })) : { type: "object" } }, ...(constraints.partial ? { result: { const: "null" } } : {}) } };
  }

  /** The paragraph's evidence ends at this source terminal/prefix; node tasks explain all earlier operations. */
  function terminalEvidence(index: number) {
    const target = context.sourceFlow!.paths[index].steps.at(-1)!;
    return { type: "array", minItems: 1, maxItems: 1, items: { ...step, required: [...step.required, "code"],
      properties: { ...step.properties, code: { const: target.code }, source: { const: target.source } } } };
  }
}
