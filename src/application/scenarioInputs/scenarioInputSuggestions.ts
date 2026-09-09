/** Neural input proposals are untrusted data; this module never executes model or project code. */
import { createContentHash } from "../../shared/hash";
import { evaluateFunctionTutorInputs, type FunctionTutorParameterFact, type FunctionTutorStaticValue as Value } from "../../analyzer/functionTutor";
import type { NeuralBoundary, NeuralTrainingReport } from "../../analyzer/neuralScenarios";
import { areFunctionTutorStaticValuesEqual, isFunctionTutorSafeObjectKey, stringifyFunctionTutorStaticValue } from "../../analyzer/functionTutor/staticValue";
import { evaluateScenarioSeed, selectScenarioSeeds } from "../codeFlow/functionTutor";
import type { FunctionTutorBuildModel, FunctionTutorScenarioSeed } from "../codeFlow/functionTutor";

export type ScenarioInputFailure = "unavailable" | "cancelled" | "denied" | "timeout" | "invalid-response" | "failed" | "stale";
export type ScenarioInputProviderResult = { modelName: string; text: string; boundaries?: NeuralBoundary[]; training?: NeuralTrainingReport };
/** Host-owned structured facts feed local training; no source text or external model is required. */
export type ScenarioInputProvider = {
  suggest(model: FunctionTutorBuildModel, language: "ko" | "en", signal: AbortSignal): Promise<ScenarioInputProviderResult>;
};
export class ScenarioInputError extends Error {
  public constructor(public readonly code: ScenarioInputFailure) { super(code); this.name = "ScenarioInputError"; }
}

/** Validates each tuple, removes duplicates, and ranks by independently checked behavior. */
export function parseScenarioInputSuggestions(text: string, model: FunctionTutorBuildModel, boundaries: NeuralBoundary[] = []): {
  seeds: FunctionTutorScenarioSeed[]; accepted: number; rejected: number;
} {
  if (text.length > 48000) throw new ScenarioInputError("invalid-response");
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new ScenarioInputError("invalid-response"); }
  if (!isRecord(parsed) || !onlyKeys(parsed, ["scenarios"]) || !Array.isArray(parsed.scenarios) || parsed.scenarios.length > 8) throw new ScenarioInputError("invalid-response");
  const seeds: FunctionTutorScenarioSeed[] = [];
  const seen = new Set(model.seeds.map(seedKey));
  const knownOutcomes = new Set(model.seeds.flatMap((seed) => outcomeKeys(seed)));
  const checkedBoundaries = new Map<string, string>();
  const previousTargets = new Set(model.seeds.filter((seed) => seed.source === "model").flatMap((seed) => seed.quality?.targetBlockIds ?? []));
  for (const boundary of boundaries.slice(0, 4)) {
    if (previousTargets.has(boundary.blockId)) continue;
    const tuples = [boundary.inputs, boundary.neighbor];
    if (tuples.some((tuple) => tuple.length !== model.declaration.parameters.length || model.declaration.parameters.some((parameter) => {
      const input = tuple.find((item) => item.parameterId === parameter.id);
      return !input || input.omitted || !matchesParameter(input.value, parameter);
    }))) continue;
    if (boundary.occurrence !== undefined && (!Number.isInteger(boundary.occurrence) || boundary.occurrence < 0 || boundary.occurrence > 2)) continue;
    const outcomes = tuples.map((inputs) => evaluateFunctionTutorInputs(model.declaration, inputs).decisions.filter((item) => item.blockId === boundary.blockId)[boundary.occurrence ?? 0]?.outcome);
    if (outcomes[0] === undefined || outcomes[1] === undefined || outcomes[0] === outcomes[1]) continue;
    for (const inputs of tuples) checkedBoundaries.set(inputKey(inputs), boundary.blockId);
  }
  let rejected = 0;
  for (const item of parsed.scenarios) {
    const seed = parseSeed(item, model);
    if (!seed || seen.has(seedKey(seed))) { rejected += 1; continue; }
    seen.add(seedKey(seed));
    const evaluated = evaluateScenarioSeed(model.declaration, seed, model.objectives);
    const targetBlockId = checkedBoundaries.get(seedKey(seed));
    if (targetBlockId && evaluated.quality) evaluated.quality.targetBlockIds = [targetBlockId];
    // A different ordinary number is not automatically a new scenario. For a
    // complete supported path, require additional demonstrated behavior.
    if ((evaluated.quality?.evaluation.status === "verified" || evaluated.quality?.evaluation.terminal?.kind === "throw")
      && outcomeKeys(evaluated).every((key) => knownOutcomes.has(key)) && !targetBlockId) {
      rejected += 1; continue;
    }
    seeds.push(evaluated);
  }
  // Append bounded suggestions so selecting a neural case never discards the user's
  // selected existing row, input edits, or playback. Rank suggestions among themselves.
  const selected = selectScenarioSeeds(seeds, 8);
  return { seeds: selected, accepted: selected.length, rejected: rejected + seeds.length - selected.length };
}

/** Applies interface constraints to a model-owned tuple without trusting its explanation. */
function parseSeed(item: unknown, model: FunctionTutorBuildModel): FunctionTutorScenarioSeed | undefined {
  if (!isRecord(item) || !onlyKeys(item, ["title", "reason", "inputs", "omitted", "assumptions"])
    || !shortText(item.title, 100) || !shortText(item.reason, 700) || !isRecord(item.inputs)
    || item.omitted !== undefined && (!Array.isArray(item.omitted) || item.omitted.length > 16 || !item.omitted.every((value) => shortText(value, 100)))
    || item.assumptions !== undefined && (!Array.isArray(item.assumptions) || item.assumptions.length > 4 || !item.assumptions.every((value) => shortText(value, 300)))) return undefined;
  const omitted = new Set((item.omitted ?? []) as string[]);
  const parameters = model.declaration.parameters;
  if (Object.keys(item.inputs).some((name) => !parameters.some((parameter) => parameter.name === name))
    || [...omitted].some((name) => !parameters.some((parameter) => parameter.name === name))) return undefined;
  const inputs: FunctionTutorScenarioSeed["inputs"] = [];
  for (const parameter of parameters) {
    const exists = Object.hasOwn(item.inputs, parameter.name);
    if (omitted.has(parameter.name)) {
      if (exists || (!parameter.optional && !parameter.defaultValue)) return undefined;
      inputs.push({ parameterId: parameter.id, value: parameter.defaultValue ?? { kind: "undefined" }, omitted: true, certainty: "inferred", evidence: [] });
    } else {
      if (!exists) return undefined;
      const value = parseDataValue(item.inputs[parameter.name]);
      if (!value || !matchesParameter(value, parameter)) return undefined;
      inputs.push({ parameterId: parameter.id, value, omitted: false, certainty: "inferred", evidence: [] });
    }
  }
  return { id: "tutor-seed:model:" + createContentHash(JSON.stringify(inputs)).slice(0, 24), ordinal: 0,
    title: item.title, source: "model", certainty: "inferred", inputs, objectiveIds: [], evidence: [], gaps: [],
    quality: { purpose: "model", reason: item.reason, assumptions: (item.assumptions ?? []) as string[], targetBlockIds: [],
      evaluation: { status: "partial", blockIds: [], edgeIds: [], decisions: [] } }
  };
}

/** Converts bounded JSON data iteratively, excluding prototype keys and oversized trees. */
function parseDataValue(root: unknown): Value | undefined {
  const values = new Map<unknown, Value>();
  const stack = [{ value: root, depth: 0, ready: false }];
  let steps = 0;
  while (stack.length) {
    if (++steps > 512) return undefined;
    const frame = stack.pop()!; const current = frame.value;
    if (frame.depth > 6) return undefined;
    if (current === null) { values.set(current, { kind: "null" }); continue; }
    if (typeof current === "boolean") { values.set(current, { kind: "boolean", value: current }); continue; }
    if (typeof current === "number" && Number.isFinite(current) && (!Number.isInteger(current) || Number.isSafeInteger(current))) { values.set(current, { kind: "number", value: current }); continue; }
    if (typeof current === "string" && current.length <= 1024) { values.set(current, { kind: "string", value: current }); continue; }
    if (!isRecord(current) && !Array.isArray(current)) return undefined;
    const children = Array.isArray(current) ? current : Object.values(current);
    if (children.length > 32 || !Array.isArray(current) && Object.keys(current).some((key) => !isFunctionTutorSafeObjectKey(key) || key.length > 100)) return undefined;
    if (!frame.ready) {
      stack.push({ ...frame, ready: true });
      for (const value of children) stack.push({ value, depth: frame.depth + 1, ready: false });
    } else if (Array.isArray(current)) values.set(current, { kind: "array", items: current.map((value) => values.get(value)!), truncated: false });
    else values.set(current, { kind: "object", entries: Object.entries(current).map(([key, value]) => ({ key, value: values.get(value)! })), truncated: false });
  }
  return values.get(root);
}

/** Checks required member paths and declared literal alternatives, preserving optionality. */
function matchesParameter(value: Value, parameter: FunctionTutorParameterFact): boolean {
  if (!matchesKind(value, parameter.typeKind, parameter.literalValues)) return false;
  if (parameter.typeRepresentative && !matchesRequiredShape(value, parameter.typeRepresentative, parameter)) return false;
  for (const fact of parameter.memberFacts) {
    const member = readPath(value, fact.path);
    const missingParent = parameter.memberFacts.some((parent) => parent.optional && parent.path.length < fact.path.length
      && parent.path.every((part, index) => fact.path[index] === part) && readPath(value, parent.path) === undefined);
    if (member === undefined) { if (!fact.optional && !missingParent) return false; }
    else if (!matchesKind(member, fact.typeKind, fact.literalValues)) return false;
  }
  return true;
}

/** Validates known required shape and collection elements with bounded explicit frames. */
function matchesRequiredShape(value: Value, shape: Value, parameter: FunctionTutorParameterFact): boolean {
  const queue = [{ value, shape, path: [] as string[] }];
  const visited = new Set<object>();
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    if (cursor >= 256) return false;
    const frame = queue[cursor];
    if (frame.path.length > 8) return false;
    const fact = frame.path.length ? parameter.memberFacts.find((item) => item.path.join("\0") === frame.path.join("\0")) : parameter;
    if (fact && (fact.typeKind === "unknown" || fact.typeKind === "literal-union")) continue;
    if (frame.shape.kind === "unknown") continue;
    if (frame.value.kind !== frame.shape.kind) return false;
    if (frame.shape.kind === "object" && frame.value.kind === "object") {
      if (visited.has(frame.value)) continue;
      visited.add(frame.value);
      for (const entry of frame.shape.entries) {
        const child = frame.value.entries.find((item) => item.key === entry.key)?.value;
        if (!child) return false;
        queue.push({ value: child, shape: entry.value, path: [...frame.path, entry.key] });
      }
    } else if (frame.shape.kind === "array" && frame.value.kind === "array") {
      const tuple = fact?.typeKind === "tuple";
      if (tuple && frame.value.items.length !== frame.shape.items.length) return false;
      for (let index = 0; index < frame.value.items.length; index += 1) {
        const template = frame.shape.items[tuple ? index : 0];
        if (template) queue.push({ value: frame.value.items[index], shape: template, path: [...frame.path, String(index)] });
      }
    }
  }
  return true;
}

function matchesKind(value: Value, kind: string, literals: Value[]): boolean {
  if (kind === "literal-union" || literals.length) return literals.some((literal) => areFunctionTutorStaticValuesEqual(value, literal));
  if (kind === "unknown") return true;
  return value.kind === kind || kind === "tuple" && value.kind === "array";
}
function readPath(value: Value, path: string[]): Value | undefined {
  let current: Value | undefined = value;
  for (const key of path) {
    current = current?.kind === "object" ? current.entries.find((entry) => entry.key === key)?.value
      : current?.kind === "array" && /^\d+$/u.test(key) ? current.items[Number(key)] : undefined;
    if (!current) return undefined;
  }
  return current;
}
function seedKey(seed: FunctionTutorScenarioSeed): string {
  return inputKey(seed.inputs);
}
function inputKey(inputs: NeuralBoundary["inputs"]): string {
  return inputs.map((input) => input.parameterId + "=" + (input.omitted ? "<omitted>" : stringifyFunctionTutorStaticValue(input.value))).join("\0");
}
function outcomeKeys(seed: FunctionTutorScenarioSeed): string[] {
  const evaluation = seed.quality?.evaluation;
  return [...(evaluation?.decisions ?? []).map((item) => "edge:" + item.edgeId),
    ...(evaluation?.terminal ? ["terminal:" + evaluation.terminal.blockId] : [])];
}
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function onlyKeys(value: Record<string, unknown>, keys: string[]): boolean { return Object.keys(value).every((key) => keys.includes(key)); }
function shortText(value: unknown, max: number): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= max; }
