/** Bounded plain-JSON ownership and controlled errors shared by native codecs; no source execution or response repair. */
import { isDeepStrictEqual } from "node:util";
import { FunctionNarrativeError } from "../../shared/functionNarratives";

// JSON Schema's keyword-dependent value types stay internal; public boundaries use unknown records.
export type Schema = Record<string, any>;
export type DataPath = Array<string | number>;
export const MAX_NATIVE_CHARACTERS = 24000;
export const MAX_SCHEMA_CHARACTERS = 196608;
export const OBJECT_KEYS = new Set(["type", "properties", "required", "additionalProperties", "description", "title", "$comment"]);
export const ARRAY_KEYS = new Set(["type", "items", "minItems", "maxItems", "additionalItems", "description", "title", "$comment"]);

/** Never expose schema constants, generated prose, source paths or validator exception text in task metadata. */
export function requireCodec(condition: unknown, detail = "native-codec"): asserts condition {
  if (!condition) throw new FunctionNarrativeError("invalid-response", detail);
}
export function sameCodec(left: unknown, right: unknown, detail = "native-codec-identity"): void { requireCodec(isDeepStrictEqual(left, right), detail); }
export function putCodec(parent: object, key: string | number, value: unknown): void {
  Object.defineProperty(parent, key, { value, enumerable: true, configurable: true, writable: true });
}

/** Own every accepted field without invoking getters or losing nonfinite/-0 values, sparse cells, aliases or cycles. */
export function copyCodec<T>(value: T, maximumCharacters = MAX_SCHEMA_CHARACTERS, maximumNodes = 100000, maximumDepth = 256): T {
  const pending = [{ value: value as unknown, depth: 0 }], seen = new Set<object>(); let count = 0;
  while (pending.length) {
    const row = pending.pop()!, item = row.value;
    requireCodec(++count <= maximumNodes && row.depth <= maximumDepth, "native-codec-budget");
    if (item === null || typeof item === "string" || typeof item === "boolean") continue;
    if (typeof item === "number") { requireCodec(Number.isFinite(item) && !Object.is(item, -0), "native-codec-number"); continue; }
    requireCodec(item && typeof item === "object", "native-codec-data"); requireCodec(!seen.has(item), "native-codec-cycle"); seen.add(item);
    const array = Array.isArray(item);
    requireCodec(array ? Object.getPrototypeOf(item) === Array.prototype : [null, Object.prototype].includes(Object.getPrototypeOf(item)), "native-codec-prototype");
    requireCodec(Object.getOwnPropertySymbols(item).length === 0, "native-codec-capability");
    const keys = Object.getOwnPropertyNames(item).filter(key => !array || key !== "length");
    if (array) sameCodec(keys, Array.from({ length: item.length }, (_, index) => String(index)), "native-codec-array");
    for (const key of keys) {
      const property = Object.getOwnPropertyDescriptor(item, key)!;
      requireCodec(Object.hasOwn(property, "value") && property.enumerable, "native-codec-accessor");
      pending.push({ value: property.value, depth: row.depth + 1 });
    }
  }
  const text = JSON.stringify(value); requireCodec(typeof text === "string" && text.length <= maximumCharacters, "native-codec-limit"); return JSON.parse(text) as T;
}

/** Parse the whole raw response. It is never trimmed, sliced, repaired or supplemented here. */
export function parseCodec(raw: string): unknown {
  requireCodec(typeof raw === "string" && raw.length <= MAX_NATIVE_CHARACTERS, "native-codec-output-limit");
  try { return copyCodec(JSON.parse(raw), MAX_NATIVE_CHARACTERS); }
  catch (error) { if (error instanceof FunctionNarrativeError) throw error; throw new FunctionNarrativeError("invalid-response", "native-codec-json"); }
}
