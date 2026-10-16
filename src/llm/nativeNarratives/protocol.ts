/** Native JSON line budgets and plain-data checks; no token sampling, source execution or answer repair. */
import { FunctionNarrativeError } from "../../shared/functionNarratives";
import type { NativeNarrativePacket } from "./types";

export const NATIVE_MEMBER_BYTES = 196_608;
export const NATIVE_PACKET_BYTES = NATIVE_MEMBER_BYTES + 4_096;
export const NATIVE_LINE_BYTES = NATIVE_MEMBER_BYTES + 65_536;
export const NATIVE_OUTPUT_CHARACTERS = 24_000;

/** Fail with controlled diagnostics; arbitrary stderr/paths/source never become task metadata. */
export function requireNative(condition: unknown, detail: string): asserts condition {
  if (!condition) throw new FunctionNarrativeError("invalid-response", detail);
}
export function isNativeRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Reject capabilities/accessors/cycles before serialization; preserve every accepted JSON field and UTF-16 unit. */
export function serializeNativePacket(payload: NativeNarrativePacket): string {
  const work: Array<{ value: unknown; depth: number }> = [{ value: payload, depth: 0 }], seen = new Set<object>();
  while (work.length) {
    const { value, depth } = work.pop()!;
    requireNative(depth <= 1024 && seen.size <= 100_000, "worker-packet-structure");
    if (value === null || typeof value === "string" || typeof value === "boolean") continue;
    if (typeof value === "number") { requireNative(Number.isFinite(value) && !Object.is(value, -0), "worker-packet-number"); continue; }
    requireNative(value && typeof value === "object" && (Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype), "worker-packet-data");
    requireNative(!seen.has(value), "worker-packet-cycle"); seen.add(value);
    requireNative(Object.getOwnPropertySymbols(value).length === 0, "worker-packet-capability");
    const keys = Object.keys(value);
    requireNative(Object.getOwnPropertyNames(value).filter(key => !(Array.isArray(value) && key === "length")).length === keys.length, "worker-packet-hidden-field");
    if (Array.isArray(value)) requireNative(keys.length === value.length && keys.every((key, index) => key === String(index)), "worker-packet-array");
    for (const key of keys) {
      const property = Object.getOwnPropertyDescriptor(value, key)!;
      requireNative(Object.hasOwn(property, "value"), "worker-packet-accessor");
      work.push({ value: property.value, depth: depth + 1 });
    }
  }
  requireNative(isNativeRecord(payload.schema) && Array.isArray(payload.messages) && payload.messages.length > 0, "worker-packet-shape");
  for (const message of payload.messages) requireNative(isNativeRecord(message) && typeof message.role === "string" && ["system", "user", "assistant"].includes(message.role)
    && typeof message.content === "string", "worker-message-shape");
  const raw = JSON.stringify(payload);
  if (Buffer.byteLength(raw + "\n") > NATIVE_MEMBER_BYTES) throw new FunctionNarrativeError("context-too-large", "worker-packet-limit");
  return raw;
}
