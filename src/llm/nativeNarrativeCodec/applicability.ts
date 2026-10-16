/** Source-selectable complete root modes. Construction changes declared types, never evaluates whether a route is feasible. */
import { copyCodec, putCodec, requireCodec, sameCodec, type Schema } from "./data";
import type { NativeNarrativeMode, NativeNarrativeSchema } from "./types";

const phases = new Set(["선언 전", "미평가", "반환 전", "미확인", "not declared", "not evaluated", "not returned", "unconfirmed"]);

/** Mark all computation slots unavailable, including complete fixed values tuples that cannot be treated as opaque source data. */
function unavailableReading(original: Schema): Schema {
  const schema = copyCodec(original), scenarios = original.properties.scenarios.items;
  requireCodec(Array.isArray(scenarios) && scenarios.length > 0);
  const firstSteps = scenarios[0].properties.steps.items; requireCodec(Array.isArray(firstSteps) && firstSteps.length > 0);
  const reason = copyCodec(firstSteps[0].properties.reason), unavailable = { type: "object", additionalProperties: false, required: ["kind", "reason"], properties: { kind: { const: "not-evaluated" }, reason } };
  const stack: Array<{ schema: Schema; path: string[] }> = [{ schema, path: [] }], visited = new Set<object>(); let changed = 0;
  const single = new Set(["items", "additionalProperties", "contains", "not", "if", "then", "else", "propertyNames"]), multiple = new Set(["anyOf", "oneOf", "allOf", "prefixItems"]);
  while (stack.length) {
    const current = stack.pop()!, node = current.schema; if (!node || typeof node !== "object" || visited.has(node)) continue; visited.add(node); requireCodec(visited.size <= 100000);
    for (const [keyword, value] of Object.entries(node)) {
      if (keyword === "properties") for (const [name, child] of Object.entries(value as Schema) as Array<[string, Schema]>) {
        const owner = current.path.join("/"), computation = owner === "scenarios" && name === "exampleResult" || owner === "scenarios/exampleInputs" && name === "value"
          || owner === "scenarios/steps/values" && (name === "after" || name === "before" && child.const === undefined);
        if (computation) { putCodec(value, name, copyCodec(unavailable)); changed++; } else stack.push({ schema: child, path: [...current.path, name] });
      } else if (multiple.has(keyword) || keyword === "items" && Array.isArray(value)) for (const child of value as Schema[]) stack.push({ schema: child, path: current.path });
      else if (single.has(keyword) && value && typeof value === "object") stack.push({ schema: value, path: current.path });
      else if (keyword === "$defs" || keyword === "definitions") for (const child of Object.values(value as Schema)) stack.push({ schema: child, path: current.path });
    }
  }
  requireCodec(changed >= 1);
  for (const [scenarioIndex, sourceScenario] of scenarios.entries()) {
    const sourceSteps: Schema[] = sourceScenario.properties.steps.items, steps: Schema[] = schema.properties.scenarios.items[scenarioIndex].properties.steps.items;
    requireCodec(Array.isArray(sourceSteps) && Array.isArray(steps) && sourceSteps.length === steps.length);
    for (const [stepIndex, sourceStep] of sourceSteps.entries()) {
      const values = sourceStep.properties.values; if (!Object.hasOwn(values, "const")) continue; sameCodec(Object.keys(values), ["const"]); requireCodec(Array.isArray(values.const));
      const valueReason = copyCodec(sourceStep.properties.reason), notEvaluated = { type: "object", additionalProperties: false, required: ["kind", "reason"], properties: { kind: { const: "not-evaluated" }, reason: valueReason } };
      const items = values.const.map((value: Schema) => {
        sameCodec(Object.keys(value).sort(), ["after", "before", "name"]); requireCodec(typeof value.name === "string");
        const sourcePhase = typeof value.before === "string" && phases.has(value.before);
        return { type: "object", additionalProperties: false, required: ["name", "before", "after"], properties: {
          name: { const: value.name }, before: sourcePhase ? { const: value.before } : copyCodec(notEvaluated), after: copyCodec(notEvaluated) } };
      });
      steps[stepIndex].properties.values = { type: "array", minItems: items.length, maxItems: items.length, items };
    }
  }
  return schema;
}

/** Preserve computed/loop/unavailable choices and the exact original reading fields and loop metadata constraints. */
export function createNativeApplicabilitySchema(reading: NativeNarrativeSchema, loopOrdinals: readonly number[]): NativeNarrativeSchema {
  const original = copyCodec(reading) as Schema;
  requireCodec(Array.isArray(loopOrdinals) && loopOrdinals.every(value => Number.isSafeInteger(value) && value >= 1) && new Set(loopOrdinals).size === loopOrdinals.length);
  const symbolic = unavailableReading(original), metadata = copyCodec(original.properties.summary), modes: NativeNarrativeMode[] = ["computed", ...(loopOrdinals.length ? ["loop-visit" as const] : []), "source-infeasible", "unverified"];
  return { anyOf: modes.map(mode => {
    const branch: Schema = { type: "object", additionalProperties: false, required: ["mode", "reading", "justification"], properties: {
      mode: { const: mode }, reading: copyCodec(mode === "computed" || mode === "loop-visit" ? original : symbolic), justification: copyCodec(metadata) } };
    if (mode === "loop-visit") {
      branch.required.push("loopVisits"); branch.properties.loopVisits = { type: "array", minItems: 1, maxItems: 24, items: { type: "object", additionalProperties: false,
        required: ["sourceOperationOrdinal", "visit", "earlierIterations", "meaning"], properties: { sourceOperationOrdinal: { type: "integer", enum: [...loopOrdinals] },
          visit: { type: "integer", minimum: 1 }, earlierIterations: { type: "integer", minimum: 0 }, meaning: copyCodec(metadata) } } };
    }
    return branch;
  }) };
}
