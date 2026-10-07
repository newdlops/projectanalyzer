/** Local grammar transport omits constant locations/opaque IDs while keeping code, route and input tokens as prose anchors. */
import { FunctionNarrativeError } from "../../shared/functionNarratives";

type Schema = Record<string, any>;
export type LocalNarrativeWire = { schema: Record<string, unknown>; fixedFields: number; decode(text: string): string };

/** Keeps tuple order and all variable constraints; omitted values cannot be supplied or replaced by model output. */
export function createLocalNarrativeWire(original: Record<string, unknown>): LocalNarrativeWire {
  const schema = structuredClone(original) as Schema;
  const fixed = new Map<Schema, Map<string, unknown>>();
  const pending: Schema[] = [schema];
  let fixedFields = 0;
  while (pending.length) {
    const item = pending.pop()!;
    if (item.properties) {
      const required = new Set<string>(item.required ?? []);
      const supplied = new Map<string, unknown>();
      for (const [name, property] of Object.entries(item.properties) as Array<[string, Schema]>) {
        const constant = Object.hasOwn(property, "const") ? { value: property.const }
          : Array.isArray(property.enum) && property.enum.length === 1 ? { value: property.enum[0] } : undefined;
        // Keeping the exact current code, route choices and named input values
        // in decoding anchors a small model's prose. Locations and opaque
        // identities still come from owned schema slots after generation.
        if (required.has(name) && constant && !["code", "name", "value", "when", "outcome"].includes(name)) {
          supplied.set(name, constant.value); delete item.properties[name]; required.delete(name); fixedFields++;
        } else pending.push(property);
      }
      item.required = [...required];
      if (supplied.size) fixed.set(item, supplied);
    }
    if (Array.isArray(item.items)) pending.push(...item.items);
    else if (item.items && typeof item.items === "object") pending.push(item.items);
    // Union alternatives remain unchanged: a fixed value in one alternative
    // is not a fixed value for the whole property.
  }
  return { schema, fixedFields, decode(text) {
    if (!fixedFields) return text;
    if (text.length > 24000) throw new FunctionNarrativeError("invalid-response", "output-limit");
    let result: unknown;
    try { result = JSON.parse(text); } catch { throw new FunctionNarrativeError("invalid-response"); }
    const work: Array<{ schema: Schema; value: unknown }> = [{ schema, value: result }];
    while (work.length) {
      const current = work.pop()!;
      if (Object.hasOwn(current.schema, "const") && (current.schema.const === null || typeof current.schema.const !== "object")
        && current.value !== current.schema.const) throw new FunctionNarrativeError("invalid-response", "wire-fields");
      if (Array.isArray(current.schema.const) && JSON.stringify(current.value) !== JSON.stringify(current.schema.const)) {
        throw new FunctionNarrativeError("invalid-response", "wire-fields");
      }
      if (Array.isArray(current.schema.enum) && current.schema.enum.length === 1 && current.value !== current.schema.enum[0]) {
        throw new FunctionNarrativeError("invalid-response", "wire-fields");
      }
      if (current.schema.properties) {
        if (!current.value || typeof current.value !== "object" || Array.isArray(current.value)) throw new FunctionNarrativeError("invalid-response");
        const value = current.value as Record<string, unknown>;
        if (current.schema.additionalProperties === false && Object.keys(value).some(name => !Object.hasOwn(current.schema.properties, name))) {
          throw new FunctionNarrativeError("invalid-response", "wire-fields");
        }
        if ((current.schema.required ?? []).some((name: string) => !Object.hasOwn(value, name))) throw new FunctionNarrativeError("invalid-response");
        for (const [name, constant] of fixed.get(current.schema) ?? []) {
          if (Object.hasOwn(value, name)) throw new FunctionNarrativeError("invalid-response", "wire-fields");
          Object.defineProperty(value, name, { value: structuredClone(constant), enumerable: true, configurable: true, writable: true });
        }
        for (const [name, property] of Object.entries(current.schema.properties) as Array<[string, Schema]>) {
          if (Object.hasOwn(value, name)) work.push({ schema: property, value: value[name] });
        }
      }
      if (current.schema.type === "array" || current.schema.items) {
        if (!Array.isArray(current.value) || current.value.length < (current.schema.minItems ?? 0)
          || current.value.length > (current.schema.maxItems ?? 900)) throw new FunctionNarrativeError("invalid-response");
        for (let index = 0; index < current.value.length; index++) {
          const child = Array.isArray(current.schema.items) ? current.schema.items[index] : current.schema.items;
          if (child) work.push({ schema: child, value: current.value[index] });
        }
      }
    }
    let expanded: string;
    try { expanded = JSON.stringify(result); } catch { throw new FunctionNarrativeError("invalid-response"); }
    if (expanded.length > 24000) throw new FunctionNarrativeError("invalid-response", "output-limit");
    return expanded;
  } };
}
