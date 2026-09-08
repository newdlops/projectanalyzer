/** Typed input codec: complete tuples, bounded numeric leaves and declared categorical choices. */
import type { FunctionTutorInputAssignment as Input, FunctionTutorStaticValue as Value } from "../functionTutor";
import type { NeuralScenarioProblem } from "./types";

type Dimension = { parameter: number; path: string[]; scale: number; choices?: Value[] };
export type NeuralInputSpace = {
  dimensions: Dimension[];
  encode(inputs: Input[]): number[] | undefined;
  decode(vector: number[]): Input[];
};

/** Keeps one complete shape. Alternatives outside that shape are not silently flattened. */
export function createNeuralInputSpace(problem: NeuralScenarioProblem): NeuralInputSpace | undefined {
  const parameters = problem.declaration.parameters;
  if (!parameters.length || parameters.length > 16) return undefined;
  const wholeTuple = problem.examples.find((tuple) => parameters.every((parameter) => {
    const input = tuple.find((item) => item.parameterId === parameter.id);
    return input && !input.omitted && isComplete(input.value);
  }));
  const base = parameters.map((parameter) => {
    const value = [wholeTuple?.find((input) => input.parameterId === parameter.id)?.value, parameter.typeRepresentative, parameter.defaultValue,
      ...(problem.domains.find((domain) => domain.parameterId === parameter.id)?.values ?? [])].find((candidate) => candidate && isComplete(candidate));
    return { parameterId: parameter.id, value: value ?? { kind: "unknown" as const, reason: "unsupported-expression" as const }, omitted: false };
  });
  if (base.some((input) => !isComplete(input.value))) return undefined;
  // Constants define a finite search region, not predicted solutions. Values beyond it remain unexplored.
  let scale = 8;
  const pending: unknown[] = [problem.declaration.program, ...problem.examples]; const visited = new Set<object>();
  while (pending.length && visited.size < 8192) {
    const value = pending.pop();
    if (!value || typeof value !== "object" || visited.has(value)) continue;
    visited.add(value);
    const record = value as Record<string, unknown>;
    if (record.kind === "number" && typeof record.value === "number" && Number.isFinite(record.value)) scale = Math.max(scale, Math.abs(record.value));
    pending.push(...Object.values(record));
  }
  scale = Math.min(1e6, scale * 2);
  const dimensions: Dimension[] = [];
  const queue = base.map((input, parameter) => ({ value: input.value, parameter, path: [] as string[] }));
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    if (cursor >= 256 || dimensions.length > 32) return undefined;
    const item = queue[cursor]; const parameter = parameters[item.parameter];
    if (item.path.length > 6) return undefined;
    const fact = item.path.length ? parameter.memberFacts.find((member) => member.path.join("\0") === item.path.join("\0")) : parameter;
    const choices = fact?.literalValues.length ? fact.literalValues.filter(isComplete) : item.value.kind === "boolean" ? [{ kind: "boolean" as const, value: false }, { kind: "boolean" as const, value: true }] : undefined;
    if (choices?.length) { dimensions.push({ ...item, scale: 1, choices }); continue; }
    if (item.value.kind === "number") dimensions.push({ ...item, scale });
    else if (item.value.kind === "object") queue.push(...item.value.entries.map((entry) => ({ ...item, value: entry.value, path: [...item.path, entry.key] })));
    else if (item.value.kind === "array") queue.push(...item.value.items.map((value, index) => ({ ...item, value, path: [...item.path, String(index)] })));
  }
  if (!dimensions.length || dimensions.length > 32) return undefined;
  return {
    dimensions,
    encode(inputs) {
      const result: number[] = [];
      for (const dimension of dimensions) {
        const input = inputs.find((item) => item.parameterId === base[dimension.parameter].parameterId);
        const value = input && !input.omitted ? read(input.value, dimension.path) : undefined;
        if (!value) return undefined;
        if (dimension.choices) {
          const index = dimension.choices.findIndex((choice) => JSON.stringify(choice) === JSON.stringify(value));
          if (index < 0) return undefined;
          result.push(dimension.choices.length === 1 ? 0 : index * 2 / (dimension.choices.length - 1) - 1);
        } else if (value.kind === "number" && Math.abs(value.value) <= dimension.scale) result.push(value.value / dimension.scale);
        else return undefined;
      }
      // Fixed strings/shape must match; encoding must never mislabel a different tuple.
      const decoded = this.decode(result);
      if (JSON.stringify(decoded.map((item) => item.value)) !== JSON.stringify(base.map((item) => inputs.find((input) => input.parameterId === item.parameterId)?.value))) return undefined;
      return result;
    },
    decode(vector) {
      const result = structuredClone(base);
      dimensions.forEach((dimension, index) => {
        const normalized = Math.max(-1, Math.min(1, vector[index]));
        const value: Value = dimension.choices ? structuredClone(dimension.choices[Math.round((normalized + 1) * (dimension.choices.length - 1) / 2)])
          : { kind: "number", value: normalized * dimension.scale };
        if (!dimension.path.length) result[dimension.parameter].value = value;
        else {
          const parent = read(result[dimension.parameter].value, dimension.path.slice(0, -1)); const key = dimension.path.at(-1)!;
          if (parent?.kind === "object") parent.entries.find((entry) => entry.key === key)!.value = value;
          else if (parent?.kind === "array") parent.items[Number(key)] = value;
        }
      });
      return result;
    }
  };
}

function read(root: Value, path: string[]): Value | undefined {
  let value: Value | undefined = root;
  for (const key of path) value = value?.kind === "object" ? value.entries.find((entry) => entry.key === key)?.value : value?.kind === "array" ? value.items[Number(key)] : undefined;
  return value;
}

/** Reject unknown/truncated values before they can become training examples. */
function isComplete(root: Value): boolean {
  const queue = [root]; const visited = new Set<Value>();
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    if (cursor >= 256) return false;
    const value = queue[cursor]; if (visited.has(value)) return false; visited.add(value);
    if (value.kind === "unknown" || value.kind === "enum" || value.kind === "undefined") return false;
    if (value.kind === "number" && !Number.isFinite(value.value)) return false;
    if (value.kind === "object" || value.kind === "array") {
      if (value.truncated) return false;
      queue.push(...(value.kind === "array" ? value.items : value.entries.map((entry) => entry.value)));
    }
  }
  return true;
}
