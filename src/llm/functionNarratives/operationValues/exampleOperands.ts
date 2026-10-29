/** Internal bounded operands for source-example checks, without executing source.
 * Only explicit JSON kinds, simple local writes, array/string lengths and plain
 * primitive array reads are known. Aliases, calls and complex expressions stay
 * unknown; number domains prevent unsupported Kotlin rounding/overflow claims.
 */
import { createDeclaredValueSchema, matchesDeclaredValueSchema } from "../typedValues";
import { readSourcePrimitiveWrite } from "./literals";

type NumberDomain = "int8" | "int16" | "int32" | "safe-integer" | "float32" | "number";
export type KnownExampleValue = { kind: "number"; value: number; domain: NumberDomain }
  | { kind: "boolean"; value: boolean } | { kind: "string"; value: string } | { kind: "null"; value: null }
  | { kind: "array"; value: unknown[]; elementSchema: Record<string, unknown>; elementType?: string };
export interface ExampleBindings { values: Map<string, KnownExampleValue>; types: Map<string, string | undefined> }
const identifier = "[\\p{L}_$][\\p{L}\\p{N}_$]*";
const namePattern = new RegExp(`^${identifier}$`, "u");
const access = new RegExp(`^(${identifier})(?:\\s*\\.\\s*(size|length)|\\s*\\[\\s*(${identifier}|-?\\d+)\\s*\\])$`, "u");
const assignment = new RegExp(`^(?:(?:val|var|let|const)\\s+)?(${identifier})(?:\\s*:\\s*([^=]+?))?\\s*([+\\-]?=)\\s*(.+?)\\s*;?$`, "u");

/** Select a number domain only from explicit type spellings or a plain literal. */
function domainFor(language: string, type: string | undefined, expression = ""): NumberDomain {
  const text = (type ?? "").replace(/\s/gu, "").replace(/^kotlin\./u, "").replace(/\?$/u, "");
  if (language !== "kotlin") return "number";
  if (text === "Byte") return "int8";
  if (text === "Short") return "int16";
  if (text === "Int") return "int32";
  if (text === "Long") return "safe-integer";
  if (text === "Float") return "float32";
  if (text === "Double" || /[.eE]/u.test(expression)) return "number";
  return "safe-integer";
}

/** Never claim an exact finite value when its declared numeric domain differs. */
function validNumber(value: number, domain: NumberDomain): boolean {
  if (!Number.isFinite(value)) return false;
  if (domain === "int8") return Number.isInteger(value) && value >= -128 && value <= 127;
  if (domain === "int16") return Number.isInteger(value) && value >= -32768 && value <= 32767;
  if (domain === "int32") return Number.isInteger(value) && value >= -2147483648 && value <= 2147483647;
  if (domain === "safe-integer") return Number.isSafeInteger(value);
  return domain !== "float32" || Math.fround(value) === value;
}

/** Read only explicit matching kinds; an alias schema never acquires a kind. */
export function knownExampleInput(language: string, type: string | undefined, value: unknown,
  schema = createDeclaredValueSchema(language, type)): KnownExampleValue | undefined {
  const variants = schema.anyOf as Array<Record<string, unknown>> | undefined;
  const rule = variants?.find(item => matchesDeclaredValueSchema(value, item)) ?? schema;
  if (!matchesDeclaredValueSchema(value, rule)) return undefined;
  if ((rule.type === "integer" || rule.type === "number") && typeof value === "number") {
    // An array element schema does not retain Kotlin Float/Double/Long spelling.
    // Its unknown domain cannot justify rounding or overflow conclusions.
    if (language === "kotlin" && type === undefined) return undefined;
    const domain = domainFor(language, type);
    return validNumber(value, domain) ? { kind: "number", value, domain } : undefined;
  }
  if (rule.type === "boolean" && typeof value === "boolean") return { kind: "boolean", value };
  if (rule.type === "string" && typeof value === "string") return { kind: "string", value };
  if (rule.type === "null" && value === null) return { kind: "null", value };
  if (rule.type === "array" && Array.isArray(value)) {
    const text = (type ?? "").replace(/\s/gu, "").replace(/^kotlin\./u, "");
    const elementType = language === "kotlin" ? /^(Int|Long|Short|Byte|Float|Double|Boolean)Array\??$/u.exec(text)?.[1]
      ?? /^Array<((?:kotlin\.)?(?:Int|Long|Short|Byte|Float|Double|Boolean|String)\??)>\??$/u.exec(text)?.[1] : undefined;
    return { kind: "array", value, elementSchema: rule.items as Record<string, unknown>, elementType };
  }
  return undefined;
}

/** Read a bounded atom without eval, getters, calls, arithmetic or recursion. */
export function readExampleOperand(language: string, source: string, bindings: ExampleBindings): KnownExampleValue | undefined {
  let text = source.trim();
  if (text.length > 480) return undefined;
  for (let count = 0; count < 32 && text.startsWith("(") && text.endsWith(")"); count++) text = text.slice(1, -1).trim();
  if (namePattern.test(text)) {
    if (text === "true" || text === "false") return { kind: "boolean", value: text === "true" };
    if (text === "null") return { kind: "null", value: null };
    return bindings.values.get(text);
  }
  const literal = readSourcePrimitiveWrite(language, text, "");
  if (literal && typeof literal.value === "number") {
    const domain = domainFor(language, undefined, text);
    if (validNumber(literal.value, domain)) return { kind: "number", value: literal.value, domain };
  }
  if (text.startsWith('"') && !(language === "kotlin" && text.includes("$"))) {
    try { const value: unknown = JSON.parse(text); if (typeof value === "string") return { kind: "string", value }; } catch { /* Unsupported literal syntax stays unknown. */ }
  }
  const match = access.exec(text);
  if (!match) return undefined;
  const owner = bindings.values.get(match[1]);
  if (match[2]) {
    if (owner?.kind === "array" && match[2] === (language === "kotlin" ? "size" : "length")) return { kind: "number", value: owner.value.length, domain: "int32" };
    if (owner?.kind === "string" && match[2] === "length") return { kind: "number", value: owner.value.length, domain: "int32" };
    return undefined;
  }
  const index = readExampleOperandIndex(match[3], bindings);
  if (owner?.kind !== "array" || index === undefined || index < 0 || index >= owner.value.length) return undefined;
  return knownExampleInput(language, owner.elementType, owner.value[index], owner.elementSchema);
}

/** Array indexes use exact integer atoms only; out-of-bounds reads stay unknown. */
function readExampleOperandIndex(text: string, bindings: ExampleBindings): number | undefined {
  const known = bindings.values.get(text), value = known?.kind === "number" ? known.value : /^-?\d+$/u.test(text) ? Number(text) : undefined;
  return value !== undefined && Number.isSafeInteger(value) ? value : undefined;
}

/** Compute a simple Boolean decision only when both provided operands are known. */
export function readExamplePredicate(language: string, source: string, bindings: ExampleBindings): boolean | undefined {
  let text = source.trim();
  for (let count = 0; count < 32 && text.startsWith("(") && text.endsWith(")"); count++) text = text.slice(1, -1).trim();
  if (text.startsWith("!") && !text.startsWith("!=")) {
    const operand = readExampleOperand(language, text.slice(1), bindings);
    return operand?.kind === "boolean" ? !operand.value : undefined;
  }
  const direct = readExampleOperand(language, text, bindings);
  if (direct?.kind === "boolean") return direct.value;
  const match = /^(.+?)\s*(===|!==|==|!=|<=|>=|<|>)\s*(.+)$/u.exec(text);
  if (!match) return undefined;
  const left = readExampleOperand(language, match[1], bindings), right = readExampleOperand(language, match[3], bindings);
  if (!left || !right || left.kind === "array" || right.kind === "array") return undefined;
  if (["==", "!=", "===", "!=="].includes(match[2])) {
    if (left.kind !== right.kind && left.kind !== "null" && right.kind !== "null") return undefined;
    const equal = left.value === right.value;
    return match[2].includes("!") ? !equal : equal;
  }
  if (left.kind !== "number" || right.kind !== "number") return undefined;
  return match[2] === "<" ? left.value < right.value : match[2] === "<=" ? left.value <= right.value
    : match[2] === ">" ? left.value > right.value : left.value >= right.value;
}

/** Update a sole source-owned local from a literal/copy or simple +=/-= write.
 * Unsupported writes stop the caller's proof rather than borrowing stale state.
 */
export function applyExampleWrite(language: string, code: string, name: string, bindings: ExampleBindings): boolean {
  const match = assignment.exec(code.trim());
  if (match && match[1] !== name) return false;
  if (match?.[2]) bindings.types.set(name, match[2]);
  const type = bindings.types.get(name);
  if (type && !Object.keys(createDeclaredValueSchema(language, type)).length) return false;
  const rhs = match ? match[4].replace(/;$/u, "").trim() : code;
  let value = readExampleOperand(language, rhs, bindings);
  if (!value) return false;
  if (match?.[3] !== "=" && match) {
    const previous = bindings.values.get(name);
    if (previous?.kind !== "number" || value.kind !== "number") return false;
    const result = match[3] === "+=" ? previous.value + value.value : previous.value - value.value;
    if (!validNumber(result, previous.domain)) return false;
    value = { kind: "number", value: result, domain: previous.domain };
  } else if (value.kind === "number") {
    const domain = type ? domainFor(language, type, rhs) : language === "kotlin" && /^-?(?:0|[1-9]\d*)$/u.test(rhs) && value.value >= -2147483648 && value.value <= 2147483647
      ? "int32" : value.domain;
    if (!validNumber(value.value, domain)) return false;
    value = { ...value, domain };
  }
  if (type && !matchesDeclaredValueSchema(value.value, createDeclaredValueSchema(language, type))) return false;
  bindings.values.set(name, value); return true;
}
