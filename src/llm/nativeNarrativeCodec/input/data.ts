/** Bounded JSON ownership for complete native inputs; no source evaluation, input clipping or response synthesis. */
import { copyCodec, putCodec, requireCodec, sameCodec } from "../data";

export type InputRecord = Record<string, any>;
export const INPUT_CHARACTERS = 196608;
export const INPUT_NODES = 100000;
export const INPUT_DEPTH = 128;
export const putInput = putCodec;
export const requireInput: typeof requireCodec = requireCodec;
export const sameInput = sameCodec;

/** Preserve ordinary finite JSON fields and order, refusing capabilities/aliases/cycles and -0 before copying. */
export function copyInput<T>(value: T): T { return copyCodec(value, INPUT_CHARACTERS, INPUT_NODES, INPUT_DEPTH); }

/** Canonical JSON schema/packet member keys remain order-sensitive, including opaque literal data. */
export function inputKeys(value: unknown, expected: readonly string[]): void {
  requireInput(value && typeof value === "object" && !Array.isArray(value)); sameInput(Object.keys(value), expected, "native-input-keys");
}

/** Require the complete top-level record before reading a format tag or any caller-controlled member. */
export function inputRecord(input: unknown): InputRecord {
  const value = copyInput(input); requireInput(value && typeof value === "object" && !Array.isArray(value)); return value as InputRecord;
}

/** Validate record descriptors before reading options, without imposing a new aggregate limit on nonserialized constructor metadata. */
export function inputOptions(input: unknown, required: readonly string[], optional: readonly string[] = []): InputRecord {
  requireInput(input && typeof input === "object" && !Array.isArray(input) && [null, Object.prototype].includes(Object.getPrototypeOf(input)) && Object.getOwnPropertySymbols(input).length === 0);
  const names = Object.getOwnPropertyNames(input), allowed = new Set([...required, ...optional]);
  requireInput(required.every(name => Object.hasOwn(input, name)) && names.every(name => allowed.has(name)));
  for (const name of names) { const descriptor = Object.getOwnPropertyDescriptor(input, name)!; requireInput(descriptor.enumerable && Object.hasOwn(descriptor, "value")); }
  return input as InputRecord;
}

/** Compare the complete reconstructed representation, including key order, never only a digest or selected source fields. */
export function sameInputJson(left: unknown, right: unknown): void {
  sameInput(JSON.stringify(copyInput(left)), JSON.stringify(copyInput(right)), "native-input-identity");
}
