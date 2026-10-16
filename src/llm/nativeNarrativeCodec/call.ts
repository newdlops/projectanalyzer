/** Strict complete named call responses; all original six-field slots and declared prose domains remain source-bound. */
import { copyCodec, MAX_NATIVE_CHARACTERS, parseCodec, requireCodec, type Schema } from "./data";
import { createNativeNamedWire } from "./named";
import { releaseNativeModelValues, requireNativeModelValues } from "./modelValues";
import { codecValidator, compileCodec, validateCodec } from "./validation";
import type { NativeNarrativeSchema, NativeValueAudit } from "./types";

/** Free model roles/output/effects/reasons must not be replaced by a source-produced explanatory constant. */
export function createNativeCallCodec(original: NativeNarrativeSchema, domains: Readonly<Record<string, NativeNarrativeSchema>> = {}): {
  schema: NativeNarrativeSchema; calculatedValueAudit: readonly NativeValueAudit[]; encode(value: unknown): string; decode(raw: string): unknown;
} {
  const source = copyCodec(original) as Schema, properties = source.properties;
  requireCodec(properties && properties.calls?.type === "array" && properties.calls.items);
  // The final summary has exactly zero new calls. Its unreachable homogeneous item schema has no generated row fields.
  const calls: Schema[] = properties.calls.maxItems === 0 ? [] : Array.isArray(properties.calls.items) ? properties.calls.items : [properties.calls.items];
  const fields = ["callId", "role", "inputs", "output", "effects", "reason"];
  for (const row of calls) {
    requireCodec(row.type === "object" && row.additionalProperties === false && row.properties && Array.isArray(row.required)
      && Object.keys(row.properties).length === fields.length && row.required.length === fields.length && new Set(row.required).size === fields.length
      && fields.every(key => Object.hasOwn(row.properties, key) && row.required.includes(key)), "native-codec-call-fields");
    for (const key of ["role", "output", "effects", "reason"])
      requireCodec(!Object.hasOwn(row.properties[key], "const") && !Object.hasOwn(row.properties[key], "enum"), "native-codec-fixed-prose");
  }
  for (const key of ["summary", "flow"]) if (properties[key]) requireCodec(!Object.hasOwn(properties[key], "const") && !Object.hasOwn(properties[key], "enum"), "native-codec-fixed-prose");
  const released = releaseNativeModelValues(source, domains), named = createNativeNamedWire(released.schema, { modelValuePaths: released.modelValuePaths }), validation = codecValidator();
  const fullValid = compileCodec(source, validation), audit = copyCodec(released.audit);
  function decode(raw: string): unknown {
    const actual = parseCodec(raw); requireNativeModelValues(actual, audit);
    const full = named.decode(raw); requireNativeModelValues(full, audit); validateCodec(fullValid, full); return copyCodec(full, MAX_NATIVE_CHARACTERS);
  }
  return { schema: copyCodec(named.schema), calculatedValueAudit: copyCodec(audit), decode, encode(value) {
    const full = copyCodec(value, MAX_NATIVE_CHARACTERS); validateCodec(fullValid, full); requireNativeModelValues(full, audit); return named.encode(full);
  } };
}
