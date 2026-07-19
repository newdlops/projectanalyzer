/**
 * Shared construction rules for value-change evidence. They bound display
 * text, classify source targets, recognize conservative receiver mutators, and
 * de-duplicate annotations before they cross the analyzer boundary.
 */

import type {
  FunctionLogicValueChange,
  FunctionLogicValueTargetKind
} from "./types";

const MAX_VALUE_CHANGES_PER_BLOCK = 6;
const TARGET_TEXT_LIMIT = 80;
const OPERATOR_TEXT_LIMIT = 24;
const VALUE_TEXT_LIMIT = 120;

/** Input accepted by the bounded value-change factory. */
export type FunctionLogicValueChangeInput = Omit<FunctionLogicValueChange, "targetKind"> & {
  targetKind?: FunctionLogicValueTargetKind;
};

/** Creates one normalized annotation or rejects a missing target/operator. */
export function createFunctionLogicValueChange(
  input: FunctionLogicValueChangeInput
): FunctionLogicValueChange | undefined {
  const target = compactValueChangeText(input.target, TARGET_TEXT_LIMIT);
  const operator = compactValueChangeText(input.operator, OPERATOR_TEXT_LIMIT);
  if (!target || !operator) {
    return undefined;
  }
  const value = input.value
    ? compactValueChangeText(input.value, VALUE_TEXT_LIMIT) || undefined
    : undefined;
  return {
    target,
    targetKind: input.targetKind ?? classifyFunctionLogicValueTarget(target),
    operation: input.operation,
    operator,
    value,
    confidence: input.confidence
  };
}

/** Returns a stable, bounded, de-duplicated block annotation list. */
export function finalizeFunctionLogicValueChanges(
  values: Array<FunctionLogicValueChange | undefined>
): FunctionLogicValueChange[] {
  const result: FunctionLogicValueChange[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value) {
      continue;
    }
    const key = [
      value.targetKind,
      value.target,
      value.operation,
      value.operator,
      value.value ?? "",
      value.confidence
    ].join("\0");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(value);
    if (result.length >= MAX_VALUE_CHANGES_PER_BLOCK) {
      break;
    }
  }
  return result;
}

/** Distinguishes a bare binding from a member/indexed property target. */
export function classifyFunctionLogicValueTarget(
  target: string
): FunctionLogicValueTargetKind {
  return /^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(target.trim())
    ? "variable"
    : "property";
}

/**
 * Recognizes common in-place collection/container operations. The result is a
 * hint only; language adapters always publish receiver calls as inferred.
 */
export function isPotentialReceiverMutationMethod(methodName: string): boolean {
  return RECEIVER_MUTATION_METHODS.has(methodName.trim().toLowerCase());
}

/** Avoids presenting a likely Java/TypeScript static type call as a receiver write. */
export function looksLikeStaticTypeReceiver(receiver: string): boolean {
  return /^[A-Z][\p{L}\p{N}_$]*$/u.test(receiver.trim());
}

/** Normalizes source snippets without pretending to evaluate their values. */
export function compactValueChangeText(value: string, limit = VALUE_TEXT_LIMIT): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length <= limit
    ? normalized
    : `${normalized.slice(0, Math.max(0, limit - 1))}…`;
}

/** Known container mutators across JavaScript, Python, and Java standard APIs. */
const RECEIVER_MUTATION_METHODS = new Set([
  "add",
  "addall",
  "append",
  "clear",
  "compareandset",
  "compute",
  "computeifabsent",
  "computeifpresent",
  "copywithin",
  "decrementandget",
  "delete",
  "discard",
  "drainto",
  "extend",
  "fill",
  "getanddecrement",
  "getandincrement",
  "incrementandget",
  "insert",
  "merge",
  "offer",
  "poll",
  "pop",
  "prepend",
  "push",
  "put",
  "putall",
  "remove",
  "removeall",
  "removeif",
  "replace",
  "replaceall",
  "retainall",
  "reverse",
  "set",
  "setdefault",
  "setstate",
  "shift",
  "sort",
  "splice",
  "unshift",
  "update"
]);
