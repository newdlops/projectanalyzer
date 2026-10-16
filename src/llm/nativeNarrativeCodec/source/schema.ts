/** Complete original rich-root schema built from source DTOs and declared domains, without old schema/prose/worksheet factories or expected-value records. */
import type { NativeRootCodecInput } from "../types";
import { copyRootSource } from "./data";
import { declaredRootValueDomain, rootResultDomain } from "./domains";
import { rootProseDomain, rootStepSchema } from "./stepSchema";
import { rootEntryConstraints, rootSourceFrame } from "./syntax";
import { createRootNumericPlan } from "./typeFlow";
import type { NativeRootSourceContext } from "./types";

type Rule = Record<string, any>;

/** Construct all original source-bound output slots together. Every generated prose domain is free before any codec runs. */
export function rootSourceSchema(context: NativeRootSourceContext, locale: "ko" | "en"): NativeRootCodecInput {
  const route = context.sourceFlow.paths[0], constraints = rootEntryConstraints(context), frame = rootSourceFrame(context), batched = context.scenarioBatch !== undefined;
  const facts = { type: "array", items: rootProseDomain(160, locale), maxItems: batched ? 2 : 4 };
  const exampleInputs = { type: "array", minItems: context.parameters.length, maxItems: context.parameters.length, items: context.parameters.length ? context.parameters.map(parameter => ({ type: "object", additionalProperties: false, required: ["name", "value"], properties: { name: { const: parameter.name }, value: constraints.booleans.has(parameter.name) ? { const: constraints.booleans.get(parameter.name) } : constraints.nullInputs.has(parameter.name) ? { const: null } : declaredRootValueDomain(context.language, parameter.type, constraints.nonNullInputs.has(parameter.name)) } })) : { type: "object" } };
  const numericWrites = createRootNumericPlan(context), builtSteps = route.steps.map(target => rootStepSchema(context, target, locale, numericWrites));
  const properties: Rule = {
    exampleInputs, when: { const: frame.when }, steps: { type: "array", minItems: builtSteps.length, maxItems: builtSteps.length, items: builtSteps.map(step => step.schema) },
    outcome: { const: frame.outcome }, exampleResult: route.status === "partial" ? { const: null } : rootResultDomain(context.language, context.returnTypeText),
    title: rootProseDomain(batched ? 64 : 160, locale), explanation: rootProseDomain(600, locale),
    analysis: { type: "object", additionalProperties: false, required: ["pathReason", "stateChange", "alternative"], properties: { pathReason: rootProseDomain(220, locale), stateChange: rootProseDomain(220, locale), alternative: rootProseDomain(220, locale) } }, assumptions: facts
  };
  const scenario = { type: "object", additionalProperties: false, required: ["title", "when", "explanation", "steps", "outcome", "assumptions", "analysis", "exampleInputs", "exampleResult"], properties };
  const readingSchema = { type: "object", additionalProperties: false, required: ["summary", "scenarios", "limitations"], properties: { scenarios: { type: "array", minItems: 1, maxItems: 1, items: [scenario] }, summary: rootProseDomain(240, locale), limitations: { ...facts, maxItems: batched ? 2 : 6 } } };
  const calculatedValueDomains: Record<string, Rule> = {}, knownNullPaths: string[] = [];
  for (const [index, step] of builtSteps.entries()) if (step.calculatedAfter) {
    const path = `$.scenarios[0].steps[${index}].values[0].after`; calculatedValueDomains[path] = step.calculatedAfter.domain;
    if (step.calculatedAfter.knownNull) knownNullPaths.push(path);
  }
  const loopOperationOrdinals = route.steps.flatMap((step, index) => step.kind === "loop" && step.branch?.outcome === "iterate" ? [index + 1] : []);
  // Generated domains reuse immutable local shapes while constructing. Materialize their values once before the strict codecs, whose public JSON boundary rejects aliases.
  return copyRootSource({ readingSchema, calculatedValueDomains, knownNullPaths, loopOperationOrdinals });
}
