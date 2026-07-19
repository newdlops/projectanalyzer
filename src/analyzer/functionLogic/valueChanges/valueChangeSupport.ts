/**
 * Shared construction rules for value-change evidence. They preserve complete
 * source text, classify targets, recognize conservative receiver mutators, and
 * de-duplicate annotations before they cross the analyzer boundary.
 */

import type {
  FunctionLogicValueChange,
  FunctionLogicValueTargetKind
} from "./types";

/** Input accepted by the normalized value-change factory. */
export type FunctionLogicValueChangeInput = Omit<FunctionLogicValueChange, "targetKind"> & {
  targetKind?: FunctionLogicValueTargetKind;
};

/** Creates one normalized annotation or rejects a missing target/operator. */
export function createFunctionLogicValueChange(
  input: FunctionLogicValueChangeInput
): FunctionLogicValueChange | undefined {
  const target = normalizeValueChangeText(input.target);
  const operator = normalizeValueChangeText(input.operator);
  if (!target || !operator) {
    return undefined;
  }
  const value = input.value
    ? normalizeValueChangeText(input.value) || undefined
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

/** Returns every stable, de-duplicated block annotation in source order. */
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
export function normalizeValueChangeText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
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
