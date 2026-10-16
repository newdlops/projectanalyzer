/** Complete root native output codec: all original modes, raw model calculations, field tuples and response-local prose. */
import { copyCodec, MAX_NATIVE_CHARACTERS, parseCodec, requireCodec, type Schema } from "./data";
import { createNativeApplicabilitySchema } from "./applicability";
import { createNativeNamedWire } from "./named";
import { createNativeProseWire, isNativeProsePath } from "./prose";
import { createNativeObjectTupleWire } from "./tuples";
import { releaseNativeModelValues, requireNativeModelValues } from "./modelValues";
import { factorNativeSchema } from "./schemaSharing";
import { codecValidator, compileCodec, validateCodec } from "./validation";
import type { NativeNamedWire, NativeNarrativeMode, NativeObjectTupleWire, NativeProseWire, NativeRootCodec, NativeRootCodecInput } from "./types";

/** Static explanatory constants cannot become hidden source metadata; they must be freed by the source-schema constructor first. */
function requireModelProse(schema: Schema, mode: NativeNarrativeMode): void {
  const work: Array<{ rule: Schema; path: Array<string | number>; depth: number }> = [{ rule: schema, path: [], depth: 0 }], visited = new Set<Schema>();
  while (work.length) {
    const { rule, path, depth } = work.pop()!; if (!rule || typeof rule !== "object") continue; requireCodec(!visited.has(rule) && visited.size < 100000 && depth <= 128); visited.add(rule);
    if (isNativeProsePath(path, mode)) requireCodec(!Object.hasOwn(rule, "const") && !Object.hasOwn(rule, "enum"), "native-codec-fixed-prose");
    if (Object.hasOwn(rule, "const") || Object.hasOwn(rule, "enum")) continue;
    if (rule.properties) for (const [key, child] of Object.entries(rule.properties) as Array<[string, Schema]>) work.push({ rule: child, path: [...path, key], depth: depth + 1 });
    if (rule.items) for (const [index, child] of (Array.isArray(rule.items) ? rule.items : [rule.items] as Schema[]).entries()) work.push({ rule: child, path: [...path, Array.isArray(rule.items) ? index : "*"], depth: depth + 1 });
    for (const key of ["anyOf", "oneOf", "allOf"]) if (rule[key]) for (const child of rule[key]) work.push({ rule: child, path, depth: depth + 1 });
  }
}

/** Source/domain inputs alone determine the wire; no frame teacher, applicability proof table or source evaluator is accepted. */
export function createNativeRootCodec(input: NativeRootCodecInput): NativeRootCodec {
  const fullSchema = createNativeApplicabilitySchema(input.readingSchema, input.loopOperationOrdinals) as Schema;
  const released = releaseNativeModelValues(input.readingSchema, input.calculatedValueDomains, input.knownNullPaths), branches = new Map<NativeNarrativeMode, { named: NativeNamedWire; prose: NativeProseWire; tuple: NativeObjectTupleWire }>();
  const namedSchema: Schema = { anyOf: fullSchema.anyOf.map((original: Schema) => {
    const mode = original.properties.mode.const as NativeNarrativeMode; requireModelProse(original, mode);
    const reading = mode === "computed" || mode === "loop-visit" ? released.schema : original.properties.reading;
    const named = createNativeNamedWire(reading, { modelValuePaths: mode === "computed" || mode === "loop-visit" ? released.modelValuePaths : [] }), branch = copyCodec(original); branch.properties.reading = named.schema;
    const prose = createNativeProseWire(branch, mode), tuple = createNativeObjectTupleWire((prose.schema as Schema).properties.reading);
    const native = copyCodec(prose.schema) as Schema; native.properties.reading = tuple.schema; branches.set(mode, { named, prose, tuple }); return native;
  }) };
  const validation = codecValidator(), fullValid = compileCodec(fullSchema, validation), nativeValid = compileCodec(namedSchema, validation), compact = factorNativeSchema(namedSchema);
  const audit = copyCodec(released.audit);

  /** Decode the entire model response, check raw computed cells, then restore source metadata and validate the original full contract. */
  function decode(raw: string): unknown {
    const wire = parseCodec(raw) as Schema; validateCodec(nativeValid, wire);
    const mode = wire.mode as NativeNarrativeMode, branch = branches.get(mode); requireCodec(branch);
    const shared = { ...wire, reading: branch.tuple.decode(wire.reading) }, named = branch.prose.decode(shared) as Schema;
    const actualAudit = mode === "computed" || mode === "loop-visit" ? audit : [];
    requireNativeModelValues(named.reading, actualAudit);
    const full = { ...named, reading: branch.named.decode(JSON.stringify(named.reading)) };
    requireNativeModelValues(full.reading, actualAudit); validateCodec(fullValid, full); return copyCodec(full, MAX_NATIVE_CHARACTERS);
  }

  /** Encoding is an authoring/test inverse only; every supplied free value and string must already exist and remain exact. */
  function encode(value: unknown, options?: { shareProse?: boolean }): string {
    const full = copyCodec(value, MAX_NATIVE_CHARACTERS) as Schema; validateCodec(fullValid, full);
    const mode = full.mode as NativeNarrativeMode, branch = branches.get(mode); requireCodec(branch);
    requireNativeModelValues(full.reading, mode === "computed" || mode === "loop-visit" ? audit : []);
    const named = { ...full, reading: JSON.parse(branch.named.encode(full.reading)) }, shared = options?.shareProse === false ? named : branch.prose.encode(named) as Schema;
    const wire = { ...shared, reading: branch.tuple.encode(shared.reading) }; validateCodec(nativeValid, wire);
    const raw = JSON.stringify(wire); requireCodec(raw.length <= MAX_NATIVE_CHARACTERS); return raw;
  }
  return { schema: copyCodec(compact.schema), nativeSchema: copyCodec(namedSchema), fullSchema: copyCodec(fullSchema), calculatedValueAudit: copyCodec(audit), encode, decode };
}
