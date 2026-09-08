/** Bounded abstract expression evaluation over parser-owned IR, never source execution. */
import type { FunctionTutorExpression as Expression, FunctionTutorStaticValue as Value } from "../types";
import { isFunctionTutorSafeObjectKey } from "../staticValue";

export const unknownInputValue = (): Value => ({ kind: "unknown", reason: "unsupported-expression" });

/** JavaScript truthiness is known only for complete values of a supported kind. */
export function inputValueTruth(value: Value): boolean | undefined {
  switch (value.kind) {
    case "unknown": case "enum": return undefined;
    case "undefined": case "null": return false;
    case "boolean": case "number": case "string": return Boolean(value.value);
    default: return true;
  }
}

/** Reads only own data and built-in length, preserving missing versus truncated values. */
export function readInputMember(root: Value, path: string[], optional = false): Value {
  let value = root;
  for (const key of path) {
    if (!isFunctionTutorSafeObjectKey(key)) return unknownInputValue();
    if ((value.kind === "object" || value.kind === "array") && value.truncated) return unknownInputValue();
    if (value.kind === "null" || value.kind === "undefined") return optional ? { kind: "undefined" } : unknownInputValue();
    if (key === "length" && (value.kind === "array" || value.kind === "string")) {
      value = value.kind === "array" && value.truncated ? unknownInputValue()
        : { kind: "number", value: value.kind === "array" ? value.items.length : value.value.length };
    } else if (value.kind === "object") {
      value = value.entries.find((entry) => entry.key === key)?.value ?? (value.truncated ? unknownInputValue() : { kind: "undefined" });
    } else if (value.kind === "array" && /^(0|[1-9]\d*)$/u.test(key)) {
      value = value.items[Number(key)] ?? (value.truncated ? unknownInputValue() : { kind: "undefined" });
    } else return unknownInputValue();
  }
  return value;
}

/** Applies one immutable own-data write; intermediate objects must already exist. */
export function writeInputMember(root: Value, path: string[], next: Value): Value {
  if (!path.length) return next;
  if (path.length > 16 || path.some((key) => !isFunctionTutorSafeObjectKey(key))) return unknownInputValue();
  const parents: Array<{ value: Value; key: string }> = [];
  let current = root;
  for (const key of path) {
    if ((current.kind !== "object" && current.kind !== "array") || current.truncated) return unknownInputValue();
    parents.push({ value: current, key });
    current = readInputMember(current, [key]);
  }
  let result = next;
  for (let index = parents.length - 1; index >= 0; index -= 1) {
    const { value, key } = parents[index];
    if (value.kind === "object") {
      const entries = value.entries.filter((entry) => entry.key !== key);
      if (entries.length >= 64) return unknownInputValue();
      entries.push({ key, value: result });
      result = { kind: "object", entries, truncated: false };
    } else if (value.kind === "array" && /^(0|[1-9]\d*)$/u.test(key) && Number(key) < 64) {
      const items = value.items.slice();
      while (items.length <= Number(key)) items.push({ kind: "undefined" });
      items[Number(key)] = result;
      result = { kind: "array", items, truncated: false };
    } else return unknownInputValue();
  }
  return result;
}

/** Evaluates a bounded DAG with explicit frames and a cycle guard. */
export function evaluateInputExpression(expression: Expression, bindings: ReadonlyMap<string, Value>): Value {
  const values = new Map<Expression, Value>();
  const active = new Set<Expression>();
  const stack: Array<{ node: Expression; ready: boolean; depth: number }> = [{ node: expression, ready: false, depth: 0 }];
  let steps = 0;
  while (stack.length && steps++ < 512) {
    const frame = stack.pop()!;
    if (values.has(frame.node)) continue;
    if (frame.depth > 32) return unknownInputValue();
    if (!frame.ready) {
      if (active.has(frame.node)) return unknownInputValue();
      active.add(frame.node);
      stack.push({ ...frame, ready: true });
      for (const node of expressionChildren(frame.node).reverse()) stack.push({ node, ready: false, depth: frame.depth + 1 });
    } else {
      active.delete(frame.node);
      values.set(frame.node, evaluateNode(frame.node, (node) => values.get(node) ?? unknownInputValue(), bindings));
    }
  }
  return values.get(expression) ?? unknownInputValue();
}

/** Unsupported calls have no evaluated children because this is not a runtime. */
function expressionChildren(node: Expression): Expression[] {
  switch (node.kind) {
    case "member": return [node.object];
    case "unary": return [node.operand];
    case "binary": return [node.left, node.right];
    case "logical": return node.members.slice();
    case "conditional": return [node.condition, node.whenTrue, node.whenFalse];
    case "array": return node.items.slice();
    case "object": return node.entries.map((entry) => entry.value);
    default: return [];
  }
}

function evaluateNode(node: Expression, read: (node: Expression) => Value, bindings: ReadonlyMap<string, Value>): Value {
  switch (node.kind) {
    case "literal": return node.value;
    case "binding": return bindings.get(node.bindingId) ?? unknownInputValue();
    case "member": return readInputMember(read(node.object), node.path, node.optional);
    case "array": return node.items.length <= 64 && node.items.every((item) => read(item).kind !== "unknown") ? { kind: "array", items: node.items.map(read), truncated: false } : unknownInputValue();
    case "object": return node.entries.length <= 64 && node.entries.every((entry) => isFunctionTutorSafeObjectKey(entry.key) && read(entry.value).kind !== "unknown")
      ? { kind: "object", entries: node.entries.map((entry) => ({ key: entry.key, value: read(entry.value) })), truncated: false } : unknownInputValue();
    case "unary": {
      const value = read(node.operand);
      if (value.kind === "unknown") return value;
      if (node.operator === "not") { const truth = inputValueTruth(value); return truth === undefined ? unknownInputValue() : { kind: "boolean", value: !truth }; }
      if (node.operator === "non-nullish") return { kind: "boolean", value: value.kind !== "undefined" && value.kind !== "null" };
      if (node.operator === "typeof") return value.kind === "enum" ? unknownInputValue() : { kind: "string", value: value.kind === "array" || value.kind === "object" || value.kind === "null" ? "object" : value.kind };
      return value.kind === "number" ? { kind: "number", value: node.operator === "minus" ? -value.value : value.value } : unknownInputValue();
    }
    case "binary": return evaluateInputBinary(node.operator, read(node.left), read(node.right));
    case "conditional": { const truth = inputValueTruth(read(node.condition)); return truth === undefined ? unknownInputValue() : read(truth ? node.whenTrue : node.whenFalse); }
    case "logical": {
      for (let index = 0; index < node.members.length; index += 1) {
        const value = read(node.members[index]);
        if (value.kind === "unknown") return value;
        if (index === node.members.length - 1) return value;
        if (node.operator === "nullish") { if (value.kind !== "null" && value.kind !== "undefined") return value; }
        else { const truth = inputValueTruth(value); if (truth === undefined) return unknownInputValue(); if (node.operator === "and" ? !truth : truth) return value; }
      }
      return unknownInputValue();
    }
    default: return unknownInputValue();
  }
}

/** Restricts comparisons/arithmetic to types whose language semantics are explicit. */
export function evaluateInputBinary(operator: string, left: Value, right: Value): Value {
  if (["unknown", "array", "object", "enum"].includes(left.kind) || ["unknown", "array", "object", "enum"].includes(right.kind)) return unknownInputValue();
  const a = "value" in left ? left.value : left.kind === "null" ? null : undefined;
  const b = "value" in right ? right.value : right.kind === "null" ? null : undefined;
  if (["eq", "neq", "strict-eq", "strict-neq"].includes(operator)) {
    if ((operator === "eq" || operator === "neq") && typeof a !== typeof b && !(a == null && b == null)) return unknownInputValue();
    const equal = a === b || ((operator === "eq" || operator === "neq") && a == null && b == null);
    return { kind: "boolean", value: operator.endsWith("neq") ? !equal : equal };
  }
  if ((typeof a !== "number" || typeof b !== "number") && (typeof a !== "string" || typeof b !== "string")) return unknownInputValue();
  if (operator === "lt") return { kind: "boolean", value: a < b };
  if (operator === "lte") return { kind: "boolean", value: a <= b };
  if (operator === "gt") return { kind: "boolean", value: a > b };
  if (operator === "gte") return { kind: "boolean", value: a >= b };
  if (operator === "add" && typeof a === "string" && typeof b === "string") return a.length + b.length <= 4096 ? { kind: "string", value: a + b } : unknownInputValue();
  if (typeof a !== "number" || typeof b !== "number") return unknownInputValue();
  const value = operator === "add" ? a + b : operator === "subtract" ? a - b : operator === "multiply" ? a * b
    : operator === "divide" ? a / b : operator === "modulo" ? a % b : NaN;
  return Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value)) ? { kind: "number", value } : unknownInputValue();
}
