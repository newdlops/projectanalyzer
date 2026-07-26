/**
 * Safe, bounded static-value helpers shared by Tutor declaration and callsite
 * collection. They never evaluate source text and reject prototype-sensitive
 * object paths before a value reaches the browser protocol.
 */

import type {
  FunctionTutorObjectEntry,
  FunctionTutorStaticValue,
  FunctionTutorUnknownReason
} from "./types";

const MAX_VALUE_DEPTH = 2;
const MAX_ARRAY_ITEMS = 8;
const MAX_OBJECT_ENTRIES = 8;
const UNSAFE_OBJECT_KEYS = new Set(["__proto__", "prototype", "constructor"]);

/** Creates an unresolved value while preserving the concrete static reason. */
export function createFunctionTutorUnknown(
  reason: FunctionTutorUnknownReason,
  detail?: string
): FunctionTutorStaticValue {
  return detail ? { kind: "unknown", reason, detail } : { kind: "unknown", reason };
}

/** Rejects keys that could alter prototypes in a later interpreter object write. */
export function isFunctionTutorSafeObjectKey(key: string): boolean {
  return !UNSAFE_OBJECT_KEYS.has(key);
}

/** Bounds one already-static value without interpreting or coercing it. */
export function boundFunctionTutorStaticValue(
  value: FunctionTutorStaticValue,
  depth = 0
): FunctionTutorStaticValue {
  if (depth >= MAX_VALUE_DEPTH && (value.kind === "array" || value.kind === "object")) {
    return createFunctionTutorUnknown("depth-budget", "Nested value exceeds the Tutor depth limit.");
  }
  if (value.kind === "number") {
    if (!Number.isFinite(value.value) || !Number.isSafeInteger(value.value) && Number.isInteger(value.value)) {
      return createFunctionTutorUnknown("unsupported-type", "The numeric literal is outside the safe static range.");
    }
    return value;
  }
  if (value.kind === "array") {
    const items = value.items.slice(0, MAX_ARRAY_ITEMS)
      .map((item) => boundFunctionTutorStaticValue(item, depth + 1));
    return {
      kind: "array",
      items,
      truncated: value.truncated || value.items.length > MAX_ARRAY_ITEMS
    };
  }
  if (value.kind === "object") {
    const seen = new Set<string>();
    const entries: FunctionTutorObjectEntry[] = [];
    for (const entry of value.entries) {
      if (!isFunctionTutorSafeObjectKey(entry.key) || seen.has(entry.key)) continue;
      seen.add(entry.key);
      if (entries.length >= MAX_OBJECT_ENTRIES) break;
      entries.push({
        key: entry.key,
        value: boundFunctionTutorStaticValue(entry.value, depth + 1)
      });
    }
    entries.sort((left, right) => left.key.localeCompare(right.key));
    return {
      kind: "object",
      entries,
      truncated: value.truncated || entries.length < value.entries.length
    };
  }
  return value;
}

/** Produces a deterministic, JSON-safe identity input for deduplication. */
export function stringifyFunctionTutorStaticValue(value: FunctionTutorStaticValue): string {
  if (value.kind === "boolean" || value.kind === "number" || value.kind === "string") {
    return `${value.kind}:${JSON.stringify(value.value)}`;
  }
  if (value.kind === "null" || value.kind === "undefined") return value.kind;
  if (value.kind === "enum") return `enum:${value.typeName ?? ""}:${value.memberName}`;
  if (value.kind === "unknown") return `unknown:${value.reason}:${value.detail ?? ""}`;
  if (value.kind === "array") {
    return `array:${value.truncated ? "1" : "0"}:[${value.items.map(stringifyFunctionTutorStaticValue).join(",")}]`;
  }
  return `object:${value.truncated ? "1" : "0"}:{${value.entries
    .slice()
    .sort((left, right) => left.key.localeCompare(right.key))
    .map((entry) => `${JSON.stringify(entry.key)}=${stringifyFunctionTutorStaticValue(entry.value)}`)
    .join(",")}}`;
}

/** Uses canonical value text rather than object identity for stable seed deduplication. */
export function areFunctionTutorStaticValuesEqual(
  left: FunctionTutorStaticValue,
  right: FunctionTutorStaticValue
): boolean {
  return stringifyFunctionTutorStaticValue(left) === stringifyFunctionTutorStaticValue(right);
}
