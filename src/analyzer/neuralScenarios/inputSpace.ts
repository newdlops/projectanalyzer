/** Typed input codec: complete tuples, bounded numeric leaves and declared categorical choices. */
import type { FunctionTutorInputAssignment as Input, FunctionTutorStaticValue as Value } from "../functionTutor";
import type { NeuralScenarioProblem } from "./types";
import { collectNeuralInputEvidence, createNeuralStringDomain } from "./inputEvidence";
import { encodeNeuralTextChoices } from "./textFeatures";

type Dimension = { parameter: number; path: string[]; scale: number; choices?: Value[]; featureKind?: "text" | "collection"; textReferences?: string[]; numericElements?: boolean; integer?: boolean };
export type NeuralInputSpace = {
  dimensions: Dimension[];
  featureCount: number;
  features(vector: number[]): number[];
  encode(inputs: Input[]): number[] | undefined;
  decode(vector: number[]): Input[];
};

/** Keeps one complete shape. Alternatives outside that shape are not silently flattened. */
export function createNeuralInputSpace(problem: NeuralScenarioProblem, options: { includeFeatures?: boolean } = {}): NeuralInputSpace | undefined {
  const parameters = problem.declaration.parameters;
  const evidence = collectNeuralInputEvidence(problem);
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
    if ((record.kind === "number" || record.op === "literal") && typeof record.value === "number" && Number.isFinite(record.value)) scale = Math.max(scale, Math.abs(record.value));
    pending.push(...Object.values(record));
  }
  // Power-of-two scaling preserves binary64 values across normalization. An
  // arbitrary radius can turn 31 into 31.000000000000004 and miss an equality.
  scale = Math.min(2 ** 20, 2 ** Math.ceil(Math.log2(scale * 2)));
  const dimensions: Dimension[] = [];
  const queue = base.map((input, parameter) => ({ value: input.value, parameter, path: [] as string[] }));
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    if (cursor >= 256 || dimensions.length > 32) return undefined;
    const item = queue[cursor]; const parameter = parameters[item.parameter];
    if (item.path.length > 6) return undefined;
    const fact = item.path.length ? parameter.memberFacts.find((member) => member.path.join("\0") === item.path.join("\0")) : parameter;
    const choices = fact?.literalValues.length ? fact.literalValues.filter(isComplete) : item.value.kind === "boolean" ? [{ kind: "boolean" as const, value: false }, { kind: "boolean" as const, value: true }] : undefined;
    if (choices?.length) { dimensions.push({ ...item, scale: 1, choices, featureKind: choices.every((value) => value.kind === "string") ? "text" : undefined }); continue; }
    const alternatives = [...problem.examples.flatMap((tuple) => tuple.filter((input) => input.parameterId === parameter.id && !input.omitted).map((input) => read(input.value, item.path))),
      ...(problem.domains.find((domain) => domain.parameterId === parameter.id)?.values ?? []).map((value) => read(value, item.path))].filter((value): value is Value => Boolean(value && isComplete(value)));
    if (item.value.kind === "string") {
      const strings = [...new Set([...(problem.declaration.program.python?.stringCandidates ?? []),
        ...createNeuralStringDomain(alternatives.flatMap((value) => value.kind === "string" ? [value.value] : []), evidence.get(parameter.id)!, parameter.name)])].slice(0, problem.declaration.program.python ? 400 : 160);
      dimensions.push({ ...item, scale: 1, featureKind: "text", textReferences: strings.filter(Boolean).slice(0, 8), choices: strings.map((value) => ({ kind: "string", value })) }); continue;
    }
    if (item.value.kind === "array" && fact?.typeKind !== "tuple" && item.value.items.every((value) => !["array", "object"].includes(value.kind))) {
      const shape = parameter.typeRepresentative && read(parameter.typeRepresentative, item.path);
      const arrays = [item.value, ...alternatives, shape].filter((value): value is Value & { kind: "array" } => value?.kind === "array" && isComplete(value));
      const template = arrays.flatMap((value) => value.items).find(isComplete);
      const variants: Value[] = arrays.slice();
      if (template) for (let length = 0; length <= 32; length += 1) variants.push({ kind: "array", items: Array.from({ length }, () => structuredClone(template)), truncated: false });
      const unique = [...new Map(variants.filter((value) => value.kind === "array" && value.items.length <= 32).map((value) => [JSON.stringify(value), value])).values()];
      if (unique.length > 1) {
        const elementShape = arrays.reduce((longest, value) => value.items.length > longest.length ? value.items : longest, [] as Value[]);
        const numericElements = elementShape.length > 0 && elementShape.every((value) => value.kind === "number");
        dimensions.push({ ...item, scale: 1, choices: unique, featureKind: "collection", numericElements });
        // Keep existing numeric element search while allowing those elements to be absent at shorter sizes.
        if (numericElements) queue.push(...elementShape.map((value, index) => ({ ...item, value, path: [...item.path, String(index)] })));
        continue;
      }
    }
    if (item.value.kind === "number") dimensions.push({ ...item, scale,
      integer: problem.declaration.language === "python" && !item.path.length && /^int$/u.test(parameter.typeText?.trim() ?? "") });
    else if (item.value.kind === "object") queue.push(...item.value.entries.map((entry) => ({ ...item, value: entry.value, path: [...item.path, entry.key] })));
    else if (item.value.kind === "array") queue.push(...item.value.items.map((value, index) => ({ ...item, value, path: [...item.path, String(index)] })));
  }
  if (!dimensions.length || dimensions.length > 32) return undefined;
  const pythonPatterns = problem.declaration.program.python?.regexPatterns ?? [];
  const textCount = dimensions.filter((dimension) => dimension.featureKind === "text").length;
  const collectionCount = dimensions.filter((dimension) => dimension.featureKind === "collection").length;
  const textBudget = Math.floor((192 - dimensions.length - collectionCount * 5) / Math.max(1, textCount));
  if (textCount && textBudget < 4) return undefined;
  // Cache source-only encodings once. Neither parameter values nor later teacher
  // outcomes change this representation or leak labels into network features.
  const textFeatures = dimensions.map((dimension) => options.includeFeatures !== false && dimension.featureKind === "text"
    ? encodeNeuralTextChoices(dimension.choices!.map((value) => (value as Value & { kind: "string" }).value), dimension.textReferences ?? [], textBudget, pythonPatterns) : undefined);
  const featureCount = options.includeFeatures === false ? dimensions.length : dimensions.length + collectionCount * 5 + textFeatures.reduce((sum, choices) => sum + (choices?.[0]?.length ?? 0), 0);
  if (featureCount > 192) return undefined;
  return {
    dimensions,
    featureCount,
    features(vector) {
      if (options.includeFeatures === false) return vector.slice();
      const result = vector.map((value, index) => dimensions[index].featureKind ? 0 : value);
      dimensions.forEach((dimension, index) => {
        const value = choiceAt(dimension, vector[index]);
        if (dimension.featureKind === "text" && value?.kind === "string") {
          result.push(...textFeatures[index]![Math.round((Math.max(-1, Math.min(1, vector[index])) + 1) * (dimension.choices!.length - 1) / 2)]);
        } else if (dimension.featureKind === "collection" && value?.kind === "array") {
          result.push(value.items.length / 32);
          for (let i = 0; i < 4; i += 1) { const item = value.items[i]; result.push(dimension.numericElements ? 0 : item?.kind === "number" ? Math.max(-1, Math.min(1, item.value / scale)) : item?.kind === "string" ? item.value.length / 512 : item ? 1 : 0); }
        }
      });
      return result;
    },
    encode(inputs) {
      const result: number[] = [];
      for (const dimension of dimensions) {
        const input = inputs.find((item) => item.parameterId === base[dimension.parameter].parameterId);
        const value = input && !input.omitted ? read(input.value, dimension.path) : undefined;
        if (!value) {
          const parent = input && read(input.value, dimension.path.slice(0, -1));
          if (!dimension.choices && parent?.kind === "array" && Number(dimension.path.at(-1)) >= parent.items.length) { result.push(0); continue; }
          return undefined;
        }
        if (dimension.choices) {
          const index = dimension.choices.findIndex((choice) => dimension.numericElements && choice.kind === "array" && value.kind === "array"
            ? choice.items.length === value.items.length && value.items.every((item) => item.kind === "number")
            : JSON.stringify(choice) === JSON.stringify(value));
          if (index < 0) return undefined;
          result.push(dimension.choices.length === 1 ? 0 : index * 2 / (dimension.choices.length - 1) - 1);
        } else if (value.kind === "number" && Math.abs(value.value) <= dimension.scale && (!dimension.integer || Number.isInteger(value.value))) result.push(value.value / dimension.scale);
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
        const value: Value = dimension.choices ? structuredClone(choiceAt(dimension, normalized)!)
          : { kind: "number", value: dimension.integer ? Math.round(normalized * dimension.scale) : normalized * dimension.scale };
        if (!dimension.path.length) result[dimension.parameter].value = value;
        else {
          const parent = read(result[dimension.parameter].value, dimension.path.slice(0, -1)); const key = dimension.path.at(-1)!;
          if (parent?.kind === "object") parent.entries.find((entry) => entry.key === key)!.value = value;
          else if (parent?.kind === "array" && Number(key) < parent.items.length) parent.items[Number(key)] = value;
        }
      });
      return result;
    }
  };
}

function choiceAt(dimension: Dimension, coordinate: number): Value | undefined {
  return dimension.choices?.[Math.round((Math.max(-1, Math.min(1, coordinate)) + 1) * (dimension.choices.length - 1) / 2)];
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
