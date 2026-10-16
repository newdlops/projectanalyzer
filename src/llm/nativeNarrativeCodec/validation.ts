/** Non-coercing JSON Schema validation, using the same pinned validator/options as the canonical pure codecs. */
import Ajv, { type ValidateFunction } from "ajv";
import { FunctionNarrativeError } from "../../shared/functionNarratives";
import { copyCodec, requireCodec } from "./data";
import type { NativeNarrativeSchema } from "./types";

/** Each contract owns its validator cache; Ajv is never shared across retained source actions. */
export function codecValidator(): Ajv {
  return new Ajv({ strict: false, allErrors: true, allowUnionTypes: true, coerceTypes: false, useDefaults: false, removeAdditional: false, logger: false });
}
/** Compile only the caller-owned schema snapshot; no default value or coercion may author a model field. */
export function compileCodec(schema: NativeNarrativeSchema, validator = codecValidator()): ValidateFunction {
  try {
    const compiled = validator.compile(copyCodec(schema));
    // The transport is synchronous: a Promise must never count as a successful raw-field validation.
    requireCodec(!(compiled as ValidateFunction & { $async?: boolean }).$async, "native-codec-async-schema"); return compiled;
  }
  catch { throw new FunctionNarrativeError("invalid-response", "native-codec-schema"); }
}
export function validateCodec(validate: ValidateFunction, value: unknown): void { requireCodec(validate(value), "native-codec-fields"); }
