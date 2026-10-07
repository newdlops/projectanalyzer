/** Converts grammar-owned JSON inputs/results to portable text without interpreting source-language literals. */
import { FunctionNarrativeError } from "../../application/functionNarratives";
import { isFunctionNarrativeExample, type FunctionNarrativeContext } from "../../shared/functionNarratives";
import { createLocalNarrativeSchema } from "./responseSchema";
import { isDeepStrictEqual } from "node:util";

/** Primary local readings generate real JSON values; node/call and legacy replies keep their original contracts. */
export function normalizeLocalNarrativeResponse(text: string, context: FunctionNarrativeContext): string {
  if (context.detailLevel !== "rich" || !context.parameters || context.callTask) return text;
  if (text.length > 24000) throw new FunctionNarrativeError("invalid-response");
  let response: unknown;
  try { response = JSON.parse(text); } catch { throw new FunctionNarrativeError("invalid-response"); }
  if (!response || typeof response !== "object") throw new FunctionNarrativeError("invalid-response");
  const schema = createLocalNarrativeSchema(context) as { properties: { scenarios?: { items: any }; steps?: any } };
  if (context.nodeTask) {
    if (!("steps" in response) || !Array.isArray(response.steps)) throw new FunctionNarrativeError("invalid-response");
    normalizeStepValues(response.steps, schema.properties.steps);
    const normalized = JSON.stringify(response);
    if (normalized.length > 24000) throw new FunctionNarrativeError("invalid-response");
    return normalized;
  }
  if (!("scenarios" in response) || !Array.isArray(response.scenarios)) {
    throw new FunctionNarrativeError("invalid-response");
  }
  for (const [index, scenario] of response.scenarios.entries()) {
    if (!scenario || typeof scenario !== "object" || !Array.isArray(scenario.exampleInputs)) {
      throw new FunctionNarrativeError("invalid-response");
    }
    const inputs = scenario.exampleInputs.map((input: unknown) => {
      if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 2
        || !("name" in input) || typeof input.name !== "string" || !("value" in input)) {
        throw new FunctionNarrativeError("invalid-response");
      }
      return { name: input.name, json: encodeJson(input.value) };
    });
    const item = Array.isArray(schema.properties.scenarios!.items) ? schema.properties.scenarios!.items[index] : schema.properties.scenarios!.items;
    const resultSchema = item?.properties.exampleResult;
    if (!matchesResultKind(scenario.exampleResult, resultSchema)) throw new FunctionNarrativeError("invalid-response");
    // A fixed nested JSON result may arrive with different object-key order.
    // Restore the source-owned canonical value before exact Host comparison.
    const result = encodeJson(Object.hasOwn(resultSchema, "const") ? resultSchema.const : scenario.exampleResult);
    // Reuse the portable bound, finite-number and unsafe-key checks before
    // handing the encoded values to the unchanged source/route validator.
    if (!isFunctionNarrativeExample({ inputs, result })
      || !isFunctionNarrativeExample({ inputs: [{ name: "result", json: result }], result })) throw new FunctionNarrativeError("invalid-response");
    scenario.exampleInputs = inputs;
    scenario.exampleResult = result;
    if (Array.isArray(scenario.steps)) normalizeStepValues(scenario.steps, item.properties.steps);
  }
  const normalized = JSON.stringify(response);
  if (normalized.length > 24000) throw new FunctionNarrativeError("invalid-response");
  return normalized;
}

/** Numeric writes and return rows decode real JSON; other/constant display rows retain their portable contract. */
function normalizeStepValues(steps: any[], schema: Record<string, any> | undefined): void {
  if (!schema || Object.hasOwn(schema, "const")) return;
  for (const [index, step] of steps.entries()) {
    const spec = Array.isArray(schema.items) ? schema.items[index] : schema.items;
    const values = spec?.properties.values;
    if (!values || Object.hasOwn(values, "const") || !Array.isArray(step?.values)) continue;
    for (const [position, row] of step.values.entries()) {
      const item = Array.isArray(values.items) ? values.items[position] : values.items;
      const after = item?.properties.after;
      if (!after || after.type === "string") continue;
      if (!matchesResultKind(row.after, after)) throw new FunctionNarrativeError("invalid-response");
      const encoded = encodeJson(row.after);
      if (encoded.length > 240 || !isFunctionNarrativeExample({ inputs: [{ name: "result", json: encoded }], result: encoded })) {
        throw new FunctionNarrativeError("invalid-response");
      }
      row.after = encoded;
    }
  }
}

/** JSON encoding cannot silently turn overflowing model numbers into null. */
function encodeJson(value: unknown): string {
  const encoded = JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === "number" && !Number.isFinite(item)) throw new FunctionNarrativeError("invalid-response");
    return item;
  });
  if (encoded === undefined) throw new FunctionNarrativeError("invalid-response");
  return encoded;
}

/** Result schemas contain only JSON-kind alternatives/partial null; portable validation owns nested safety and bounds. */
function matchesResultKind(value: unknown, schema: Record<string, any> | undefined): boolean {
  const pending = schema ? [schema] : [], visited = new Set<Record<string, any>>();
  while (pending.length) {
    const current = pending.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    if (Array.isArray(current.anyOf)) { pending.push(...current.anyOf); continue; }
    if (Object.hasOwn(current, "const")) { if (isDeepStrictEqual(value, current.const)) return true; continue; }
    if (current.type === "null" && value === null || current.type === "boolean" && typeof value === "boolean"
      || current.type === "string" && typeof value === "string" || current.type === "number" && typeof value === "number" && Number.isFinite(value)
      || current.type === "integer" && typeof value === "number" && Number.isInteger(value)
      || current.type === "array" && Array.isArray(value) || current.type === "object" && value !== null && typeof value === "object" && !Array.isArray(value)) return true;
  }
  return false;
}
