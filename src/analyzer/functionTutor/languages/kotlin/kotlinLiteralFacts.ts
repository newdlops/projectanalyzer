/**
 * Source-only Kotlin literal/default decoding. No expressions are executed and
 * unsupported interpolation, numeric precision, or Kotlin suffixes stay unknown.
 */
import type { FunctionTutorParameterTypeKind, FunctionTutorStaticValue } from "../../types";
import { createFunctionTutorUnknown } from "../../staticValue";

/** Classifies an explicit Kotlin type for source examples, without type inference. */
export function kotlinParameterTypeKind(typeText: string | undefined): FunctionTutorParameterTypeKind {
  const type = (typeText ?? "").replace(/\s/gu, "").replace(/\?$/u, "");
  if (/^(?:kotlin\.)?Boolean$/u.test(type)) return "boolean";
  if (/^(?:kotlin\.)?(?:Byte|Short|Int|Long|Float|Double|UByte|UShort|UInt|ULong)$/u.test(type)) return "number";
  if (/^(?:kotlin\.)?(?:String|Char)$/u.test(type)) return "string";
  if (/^(?:kotlin\.(?:collections\.)?)?(?:Array|List|MutableList|Set|MutableSet|Sequence|[A-Za-z]*Array)(?:<|$)/u.test(type)) return "array";
  if (/^(?:kotlin\.(?:collections\.)?)?(?:Map|MutableMap)(?:<|$)/u.test(type)) return "object";
  if (type.includes("->")) return "callable";
  return "unknown";
}

/** Decodes only bounded authored literals; the result is source evidence, never computed Kotlin output. */
export function readKotlinLiteral(text: string): FunctionTutorStaticValue | undefined {
  const value = text.trim();
  if (value === "true" || value === "false") return { kind: "boolean", value: value === "true" };
  if (value === "null") return { kind: "null" };
  if (value.length > 2000) return undefined;
  const numeric = value.replace(/_/gu, "");
  if (/^-?(?:0[xX][0-9a-fA-F]+|0[bB][01]+|\d+)(?:[lL])?$/u.test(numeric)) {
    const unsigned = numeric.replace(/[lL]$/u, "");
    const negative = unsigned.startsWith("-");
    const number = Number(negative ? unsigned.slice(1) : unsigned) * (negative ? -1 : 1);
    return Number.isSafeInteger(number) ? { kind: "number", value: number } : undefined;
  }
  if (/^-?(?:\d+\.\d*|\d*\.\d+|\d+[eE][+-]?\d+)(?:[eE][+-]?\d+)?$/u.test(numeric)) {
    const number = Number(numeric);
    return Number.isFinite(number) ? { kind: "number", value: number } : undefined;
  }
  if (value.startsWith('"""') && value.endsWith('"""') && value.length >= 6) {
    const raw = value.slice(3, -3);
    return raw.includes("$") ? undefined : { kind: "string", value: raw };
  }
  const quote = value[0];
  if ((quote !== '"' && quote !== "'") || value.at(-1) !== quote || value.length < 2) return undefined;
  const body = value.slice(1, -1);
  let decoded = "";
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (character === "$" && quote === '"') return undefined;
    if (character !== "\\") {
      if (character === quote || character === "\n" || character === "\r") return undefined;
      decoded += character; continue;
    }
    const next = body[++index];
    const escaped: Record<string, string> = { t: "\t", b: "\b", n: "\n", r: "\r", "'": "'", '"': '"', "\\": "\\", $: "$" };
    if (next === "u") {
      const hex = body.slice(index + 1, index + 5);
      if (!/^[0-9a-fA-F]{4}$/u.test(hex)) return undefined;
      decoded += String.fromCharCode(Number.parseInt(hex, 16)); index += 4;
    } else if (Object.hasOwn(escaped, next)) decoded += escaped[next];
    else return undefined;
  }
  if (quote === "'" && [...decoded].length !== 1) return undefined;
  return { kind: "string", value: decoded };
}

/** An arbitrary default is retained as unknown rather than translated to JavaScript semantics. */
export function readKotlinDefault(text: string | undefined): FunctionTutorStaticValue | undefined {
  return text === undefined ? undefined : readKotlinLiteral(text)
    ?? createFunctionTutorUnknown("language-gap", "Kotlin default expression is not a bounded literal.");
}
