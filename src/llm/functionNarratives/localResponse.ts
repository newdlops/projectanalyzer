/** Converts grammar-owned JSON inputs to the portable text contract without interpreting source-language literals. */
import { FunctionNarrativeError } from "../../application/functionNarratives";
import { isFunctionNarrativeExample, type FunctionNarrativeContext } from "../../shared/functionNarratives";

/** Primary local readings generate real JSON values; node/call and legacy replies keep their original contracts. */
export function normalizeLocalNarrativeResponse(text: string, context: FunctionNarrativeContext): string {
  if (context.detailLevel !== "rich" || !context.parameters || context.nodeTask || context.callTask) return text;
  if (text.length > 24000) throw new FunctionNarrativeError("invalid-response");
  let response: unknown;
  try { response = JSON.parse(text); } catch { throw new FunctionNarrativeError("invalid-response"); }
  if (!response || typeof response !== "object" || !("scenarios" in response) || !Array.isArray(response.scenarios)) {
    throw new FunctionNarrativeError("invalid-response");
  }
  for (const scenario of response.scenarios) {
    if (!scenario || typeof scenario !== "object" || !Array.isArray(scenario.exampleInputs)) {
      throw new FunctionNarrativeError("invalid-response");
    }
    const inputs = scenario.exampleInputs.map((input: unknown) => {
      if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 2
        || !("name" in input) || typeof input.name !== "string" || !("value" in input)) {
        throw new FunctionNarrativeError("invalid-response");
      }
      return { name: input.name, json: JSON.stringify(input.value, (_key, value: unknown) => {
        // JSON.parse accepts overflowing exponents; stringify would silently
        // turn them into null and change the model's input before validation.
        if (typeof value === "number" && !Number.isFinite(value)) throw new FunctionNarrativeError("invalid-response");
        return value;
      }) };
    });
    // Reuse the portable bound, finite-number and unsafe-key checks before
    // handing the encoded values to the unchanged source/route validator.
    if (!isFunctionNarrativeExample({ inputs, result: scenario.exampleResult })) throw new FunctionNarrativeError("invalid-response");
    scenario.exampleInputs = inputs;
  }
  const normalized = JSON.stringify(response);
  if (normalized.length > 24000) throw new FunctionNarrativeError("invalid-response");
  return normalized;
}
