/**
 * Context-backed Function Tutor input recommendation synthesis.
 * It combines declared parameter shapes with source-proven member constraints
 * without evaluating source or replacing an object parameter with a leaf value.
 */

import type {
  FunctionTutorDeclarationAnalysis,
  FunctionTutorParameterFact,
  FunctionTutorStaticValue
} from "../../../analyzer/functionTutor";
import {
  areFunctionTutorStaticValuesEqual,
  isFunctionTutorSafeObjectKey
} from "../../../analyzer/functionTutor/staticValue";

const MAX_RECOMMENDED_MEMBER_DEPTH = 8;
const MAX_RECOMMENDED_COLLECTION_LENGTH = 8;

type FunctionTutorConstraint = FunctionTutorDeclarationAnalysis["constraints"][number];
type FunctionTutorMemberFact = FunctionTutorParameterFact["memberFacts"][number];
type FunctionTutorTypeKind = FunctionTutorParameterFact["typeKind"];

/**
 * Produces true/false boundary values for one parameter constraint. Member
 * constraints are written into a complete typed base so the recommendation
 * remains a valid object input instead of degrading to the scalar leaf.
 */
export function createFunctionTutorConstraintRecommendations(
  parameter: FunctionTutorParameterFact,
  constraint: FunctionTutorConstraint,
  preferredBases: FunctionTutorStaticValue[] = []
): FunctionTutorStaticValue[] {
  const memberPath = constraint.memberPath;
  if (memberPath.length > MAX_RECOMMENDED_MEMBER_DEPTH
    || memberPath.some((part) => !isFunctionTutorSafeObjectKey(part))) return [];

  const selectedBase = memberPath.length > 0 || constraint.operator.startsWith("length-")
    ? selectRecommendationBase(parameter, preferredBases)
    : undefined;
  // A direct safe member predicate proves an object-like input even when the
  // declaration omitted its type. Bare `.length` remains ambiguous by design.
  const base = selectedBase ?? (parameter.typeKind === "unknown"
    && memberPath.length > 0
    && memberPath[0] !== "length"
    ? { kind: "object" as const, entries: [], truncated: false }
    : undefined);
  const memberFact = findMemberFact(parameter, memberPath);
  const targetKind = memberPath.length === 0 ? parameter.typeKind : memberFact?.typeKind ?? "unknown";
  const targetLiterals = memberPath.length === 0 ? parameter.literalValues : memberFact?.literalValues ?? [];
  const boundaryValues = constraint.operator.startsWith("length-")
    ? createLengthBoundaryValues(targetKind, constraint, base ? readStaticValueAtPath(base, memberPath) : undefined)
    : createScalarBoundaryValues(targetKind, targetLiterals, constraint);

  if (memberPath.length === 0) return boundaryValues;
  if (!base || (base.kind !== "object" && base.kind !== "array")) return [];
  return boundaryValues.flatMap((value) => {
    const recommendation = replaceStaticValueAtPath(base, memberPath, value);
    return recommendation ? [recommendation] : [];
  });
}

/** Chooses exact known context first, then the analyzer-owned declared shape. */
function selectRecommendationBase(
  parameter: FunctionTutorParameterFact,
  preferredBases: FunctionTutorStaticValue[]
): FunctionTutorStaticValue | undefined {
  for (const value of [...preferredBases, ...(parameter.typeRepresentative ? [parameter.typeRepresentative] : [])]) {
    if (!isCompleteStaticValue(value)) continue;
    if (parameter.typeKind === "object" && value.kind === "object") return value;
    if ((parameter.typeKind === "array" || parameter.typeKind === "tuple") && value.kind === "array") return value;
    if (parameter.typeKind === "string" && value.kind === "string") return value;
    // An exact object caller/default can safely establish an otherwise broad type.
    if (parameter.typeKind === "unknown" && (value.kind === "object" || value.kind === "array")) return value;
  }
  return undefined;
}

/** Rejects partial bases so inferred field values never hide unrelated unknowns. */
function isCompleteStaticValue(root: FunctionTutorStaticValue): boolean {
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current.kind === "unknown") return false;
    if (current.kind === "array" || current.kind === "object") {
      if (current.truncated) return false;
      if (current.kind === "array") pending.push(...current.items);
      else pending.push(...current.entries.map((entry) => entry.value));
    }
  }
  return true;
}

/** Finds the declaration fact for the exact opaque member path. */
function findMemberFact(
  parameter: FunctionTutorParameterFact,
  path: string[]
): FunctionTutorMemberFact | undefined {
  return parameter.memberFacts.find((fact) => pathsEqual(fact.path, path));
}

function pathsEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((part, index) => part === right[index]);
}

/** Returns satisfying then non-satisfying scalar values for branch objectives. */
function createScalarBoundaryValues(
  typeKind: FunctionTutorTypeKind,
  literalValues: FunctionTutorStaticValue[],
  constraint: FunctionTutorConstraint
): FunctionTutorStaticValue[] {
  if (constraint.operator === "truthy" || constraint.operator === "falsy") {
    const truthyPair = createTruthinessPair(typeKind, literalValues);
    return constraint.operator === "truthy" ? truthyPair : truthyPair.slice().reverse();
  }
  const operand = constraint.operand;
  if (!operand || !isOperandCompatible(typeKind, literalValues, operand)) return [];
  const declaredPair = createDeclaredLiteralPair(constraint.operator, operand, literalValues);
  if (declaredPair) return declaredPair;
  if (operand.kind === "number") return createNumberComparisonPair(constraint.operator, operand.value);
  if (constraint.operator !== "eq" && constraint.operator !== "neq") return [];
  const alternate = createAlternateScalarValue(operand, literalValues);
  if (!alternate) return [];
  return constraint.operator === "eq" ? [operand, alternate] : [alternate, operand];
}

/** Selects true/false values from a declared literal domain without leaving it. */
function createDeclaredLiteralPair(
  operator: FunctionTutorConstraint["operator"],
  operand: FunctionTutorStaticValue,
  literalValues: FunctionTutorStaticValue[]
): FunctionTutorStaticValue[] | undefined {
  if (literalValues.length < 2) return undefined;
  const satisfying = literalValues.find((value) => matchesScalarConstraint(value, operator, operand));
  const nonSatisfying = literalValues.find((value) => !matchesScalarConstraint(value, operator, operand));
  return satisfying && nonSatisfying ? [satisfying, nonSatisfying] : undefined;
}

function matchesScalarConstraint(
  value: FunctionTutorStaticValue,
  operator: FunctionTutorConstraint["operator"],
  operand: FunctionTutorStaticValue
): boolean {
  if (operator === "eq" || operator === "neq") {
    const equal = areFunctionTutorStaticValuesEqual(value, operand);
    return operator === "eq" ? equal : !equal;
  }
  if (value.kind !== "number" || operand.kind !== "number") return false;
  if (operator === "lt") return value.value < operand.value;
  if (operator === "lte") return value.value <= operand.value;
  if (operator === "gt") return value.value > operand.value;
  return operator === "gte" && value.value >= operand.value;
}

/** Uses declared literal alternatives before conservative same-kind fallbacks. */
function createAlternateScalarValue(
  operand: FunctionTutorStaticValue,
  literalValues: FunctionTutorStaticValue[]
): FunctionTutorStaticValue | undefined {
  const declared = literalValues.find((value) => !areFunctionTutorStaticValuesEqual(value, operand));
  if (declared) return declared;
  if (operand.kind === "boolean") return { kind: "boolean", value: !operand.value };
  if (operand.kind === "string") return { kind: "string", value: operand.value === "" ? "sample" : "" };
  if (operand.kind === "number") return offsetNumber(operand.value, 1);
  if (operand.kind === "null") return { kind: "undefined" };
  if (operand.kind === "undefined") return { kind: "null" };
  return undefined;
}

/** Keeps declared type facts authoritative over an incompatible source comparison. */
function isOperandCompatible(
  typeKind: FunctionTutorTypeKind,
  literalValues: FunctionTutorStaticValue[],
  operand: FunctionTutorStaticValue
): boolean {
  if (literalValues.length > 0) {
    return literalValues.some((value) => areFunctionTutorStaticValuesEqual(value, operand));
  }
  if (typeKind === "unknown") return isScalarStaticValue(operand);
  if (typeKind === "literal-union") return false;
  return typeKind === operand.kind;
}

function isScalarStaticValue(value: FunctionTutorStaticValue): boolean {
  return value.kind === "boolean" || value.kind === "number" || value.kind === "string"
    || value.kind === "null" || value.kind === "undefined";
}

/** Includes equality and both sides; candidate order never asserts path coverage. */
function createNumberComparisonPair(
  operator: FunctionTutorConstraint["operator"],
  value: number
): FunctionTutorStaticValue[] {
  const lower = offsetNumber(value, -1);
  const exact: FunctionTutorStaticValue = { kind: "number", value };
  const upper = offsetNumber(value, 1);
  switch (operator) {
    case "eq": case "neq": case "lt": case "lte": case "gt": case "gte":
      return [exact, lower, upper].filter((candidate): candidate is FunctionTutorStaticValue => Boolean(candidate));
    default: return [];
  }
}

function offsetNumber(value: number, delta: -1 | 1): FunctionTutorStaticValue | undefined {
  const candidate = value + delta;
  return Number.isFinite(candidate) && (!Number.isInteger(candidate) || Number.isSafeInteger(candidate))
    ? { kind: "number", value: candidate }
    : undefined;
}

/** Creates truthy/falsey values only for scalar types with both outcomes. */
function createTruthinessPair(
  typeKind: FunctionTutorTypeKind,
  literalValues: FunctionTutorStaticValue[]
): FunctionTutorStaticValue[] {
  const declaredTruthy = literalValues.find(isTruthyStaticValue);
  const declaredFalsy = literalValues.find((value) => !isTruthyStaticValue(value));
  if (declaredTruthy && declaredFalsy) return [declaredTruthy, declaredFalsy];
  switch (typeKind) {
    case "boolean": return [{ kind: "boolean", value: true }, { kind: "boolean", value: false }];
    case "number": return [{ kind: "number", value: 1 }, { kind: "number", value: 0 }];
    case "string": return [{ kind: "string", value: "sample" }, { kind: "string", value: "" }];
    default: return [];
  }
}

function isTruthyStaticValue(value: FunctionTutorStaticValue): boolean {
  if (value.kind === "boolean") return value.value;
  if (value.kind === "number") return value.value !== 0;
  if (value.kind === "string") return value.value.length > 0;
  return value.kind !== "null" && value.kind !== "undefined" && value.kind !== "unknown";
}

/** Turns a source `.length` constraint into concrete string/array values. */
function createLengthBoundaryValues(
  typeKind: FunctionTutorTypeKind,
  constraint: FunctionTutorConstraint,
  currentValue: FunctionTutorStaticValue | undefined
): FunctionTutorStaticValue[] {
  if (constraint.operand?.kind !== "number" || !Number.isSafeInteger(constraint.operand.value)) return [];
  const lengths = createLengthPair(constraint.operator, constraint.operand.value);
  if (!lengths) return [];
  const values: FunctionTutorStaticValue[] = [];
  for (const length of lengths) {
    if (typeKind === "string") {
      values.push({ kind: "string", value: buildStringOfLength(currentValue, length) });
      continue;
    }
    if (typeKind !== "array" || currentValue?.kind !== "array") return [];
    if (length > 0 && currentValue.items.length === 0) return [];
    const item = currentValue.items[0];
    values.push({
      kind: "array" as const,
      items: length === 0 || !item ? [] : Array.from({ length }, () => item),
      truncated: false
    });
  }
  return values.length === lengths.length ? values : [];
}

/** Returns satisfying then non-satisfying bounded collection lengths. */
function createLengthPair(
  operator: FunctionTutorConstraint["operator"],
  operand: number
): number[] | undefined {
  let pair: [number, number] | undefined;
  switch (operator) {
    case "length-eq": pair = [operand, operand === 0 ? 1 : 0]; break;
    case "length-lt": pair = [operand - 1, operand]; break;
    case "length-lte": pair = [operand, operand + 1]; break;
    case "length-gt": pair = [operand + 1, operand]; break;
    case "length-gte": pair = [operand, operand - 1]; break;
    default: return undefined;
  }
  return [...new Set([...pair, operand - 1, operand, operand + 1, 0, 1])]
    .filter((length) => length >= 0 && length <= MAX_RECOMMENDED_COLLECTION_LENGTH);
}

function buildStringOfLength(currentValue: FunctionTutorStaticValue | undefined, length: number): string {
  if (length === 0) return "";
  const sample = currentValue?.kind === "string" && currentValue.value.length > 0 ? currentValue.value : "sample";
  return sample.repeat(Math.ceil(length / sample.length)).slice(0, length);
}

/** Reads a bounded own-data path without coercion or prototype access. */
function readStaticValueAtPath(
  root: FunctionTutorStaticValue,
  path: string[]
): FunctionTutorStaticValue | undefined {
  let current = root;
  for (const part of path) {
    if (current.kind === "object") {
      const entry = current.entries.find((candidate) => candidate.key === part);
      if (!entry) return undefined;
      current = entry.value;
      continue;
    }
    if (current.kind === "array") {
      const index = readArrayIndex(part);
      if (index === undefined || !current.items[index]) return undefined;
      current = current.items[index];
      continue;
    }
    return undefined;
  }
  return current;
}

/**
 * Clones only containers along the changed path. Untouched static subtrees are
 * immutable facts and can be shared safely between recommendation candidates.
 */
function replaceStaticValueAtPath(
  root: FunctionTutorStaticValue,
  path: string[],
  replacement: FunctionTutorStaticValue
): FunctionTutorStaticValue | undefined {
  const result = cloneContainer(root);
  if (!result) return undefined;
  let sourceCursor = root;
  let targetCursor = result;
  for (let index = 0; index < path.length; index += 1) {
    const part = path[index];
    const last = index === path.length - 1;
    if (targetCursor.kind === "object") {
      const sourceEntry = sourceCursor.kind === "object"
        ? sourceCursor.entries.find((entry) => entry.key === part)
        : undefined;
      if (last) {
        setObjectEntry(targetCursor, part, replacement);
        continue;
      }
      const sourceChild = sourceEntry?.value ?? { kind: "object", entries: [], truncated: false } as const;
      const targetChild = cloneContainer(sourceChild);
      if (!targetChild) return undefined;
      setObjectEntry(targetCursor, part, targetChild);
      sourceCursor = sourceChild;
      targetCursor = targetChild;
      continue;
    }
    if (targetCursor.kind === "array") {
      const itemIndex = readArrayIndex(part);
      if (itemIndex === undefined) return undefined;
      if (last) {
        if (!setArrayItem(targetCursor, sourceCursor, itemIndex, replacement)) return undefined;
        continue;
      }
      const sourceChild = sourceCursor.kind === "array"
        ? sourceCursor.items[itemIndex] ?? sourceCursor.items[0]
        : undefined;
      if (!sourceChild) return undefined;
      const targetChild = cloneContainer(sourceChild);
      if (!targetChild || !setArrayItem(targetCursor, sourceCursor, itemIndex, targetChild)) return undefined;
      sourceCursor = sourceChild;
      targetCursor = targetChild;
      continue;
    }
    return undefined;
  }
  return result;
}

function cloneContainer(value: FunctionTutorStaticValue): FunctionTutorStaticValue | undefined {
  if (value.kind === "object") {
    return { kind: "object", entries: value.entries.map((entry) => ({ ...entry })), truncated: value.truncated };
  }
  if (value.kind === "array") return { kind: "array", items: value.items.slice(), truncated: value.truncated };
  return undefined;
}

function setObjectEntry(
  object: FunctionTutorStaticValue & { kind: "object" },
  key: string,
  value: FunctionTutorStaticValue
): void {
  const index = object.entries.findIndex((entry) => entry.key === key);
  if (index >= 0) object.entries[index] = { key, value };
  else object.entries.push({ key, value });
}

function setArrayItem(
  array: FunctionTutorStaticValue & { kind: "array" },
  source: FunctionTutorStaticValue,
  index: number,
  value: FunctionTutorStaticValue
): boolean {
  const template = source.kind === "array" ? source.items[0] : undefined;
  while (array.items.length <= index) {
    if (!template && array.items.length < index) return false;
    array.items.push(template ?? value);
  }
  array.items[index] = value;
  return true;
}

function readArrayIndex(value: string): number | undefined {
  if (!/^(0|[1-7])$/u.test(value)) return undefined;
  const index = Number(value);
  return index < MAX_RECOMMENDED_COLLECTION_LENGTH ? index : undefined;
}
