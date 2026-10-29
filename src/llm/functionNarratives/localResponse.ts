/** Converts grammar-owned JSON inputs/results to portable text without interpreting source-language literals. */
import { FunctionNarrativeError } from "../../application/functionNarratives";
import { isFunctionNarrativeExample, type FunctionNarrativeContext } from "../../shared/functionNarratives";
import { createLocalNarrativeSchema } from "./responseSchema";
import { matchesDeclaredValueSchema } from "./typedValues";
import { checkSourceExample, hasConsistentDecisionRows } from "./operationValues";

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
    const check = checkSourceExample(context, 0, context.nodeTask.example);
    if (check.status === "contradiction" || !hasConsistentDecisionRows(context, 0, check, response.steps)) throw new FunctionNarrativeError("invalid-response", "source-example-decision");
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
    const item = Array.isArray(schema.properties.scenarios!.items) ? schema.properties.scenarios!.items[index] : schema.properties.scenarios!.items;
    const inputSlots = item?.properties.exampleInputs?.items;
    const inputs = scenario.exampleInputs.map((input: unknown, position: number) => {
      if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 2
        || !("name" in input) || typeof input.name !== "string" || !("value" in input)) {
        throw new FunctionNarrativeError("invalid-response");
      }
      const slot = Array.isArray(inputSlots) ? inputSlots[position] : undefined;
      // The Host still owns full name/order/arity validation. Check a present declared slot's
      // value before encoding so a model cannot turn an array annotation into a scalar example.
      if (slot?.properties.name.const === input.name && !matchesDeclaredValueSchema(input.value, slot.properties.value)) {
        throw new FunctionNarrativeError("invalid-response");
      }
      return { name: input.name, json: encodeJson(input.value) };
    });
    const resultSchema = item?.properties.exampleResult;
    if (!matchesDeclaredValueSchema(scenario.exampleResult, resultSchema)) throw new FunctionNarrativeError("invalid-response");
    // A fixed nested JSON result may arrive with different object-key order.
    // Restore the source-owned canonical value before exact Host comparison.
    const result = encodeJson(Object.hasOwn(resultSchema, "const") ? resultSchema.const : scenario.exampleResult);
    // Reuse the portable bound, finite-number and unsafe-key checks before
    // handing the encoded values to the unchanged source/route validator.
    if (!isFunctionNarrativeExample({ inputs, result })
      || !isFunctionNarrativeExample({ inputs: [{ name: "result", json: result }], result })) throw new FunctionNarrativeError("invalid-response");
    const sourceCheck = checkSourceExample(context, index, { inputs, result });
    if (sourceCheck.status === "contradiction") throw new FunctionNarrativeError("invalid-response", "source-example-" + sourceCheck.reason);
    if (Array.isArray(scenario.steps) && !hasConsistentDecisionRows(context, index, sourceCheck, scenario.steps)) throw new FunctionNarrativeError("invalid-response", "source-example-decision");
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
    if (!values || !Array.isArray(step?.values)) continue;
    if (Array.isArray(values.const)) {
      // Fixed display data has localized before labels. Names and after values
      // are locale-independent source facts; validate them without rewriting.
      if (step.values.length !== values.const.length || step.values.some((row: any, position: number) =>
        row?.name !== values.const[position].name || row?.after !== values.const[position].after)) throw new FunctionNarrativeError("invalid-response");
      continue;
    }
    if (Object.hasOwn(values, "const")) continue;
    for (const [position, row] of step.values.entries()) {
      const item = Array.isArray(values.items) ? values.items[position] : values.items;
      const name = item?.properties.name;
      if (name && Object.hasOwn(name, "const") && row?.name !== name.const) throw new FunctionNarrativeError("invalid-response");
      const after = item?.properties.after;
      if (!after || after.type === "string") continue;
      if (!matchesDeclaredValueSchema(row.after, after)) throw new FunctionNarrativeError("invalid-response");
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
