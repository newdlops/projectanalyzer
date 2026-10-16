/** Declared source type/display domains only. No expression evaluation, teacher lookup, numerical substitution or inferred runtime value. */
import type { NativeNarrativeSchema } from "../types";

type Rule = Record<string, any>;
const kotlinArrays = new Map([["IntArray", "Int"], ["LongArray", "Long"], ["ShortArray", "Short"], ["ByteArray", "Byte"], ["DoubleArray", "Double"], ["FloatArray", "Float"], ["BooleanArray", "Boolean"]]);

/** Preserve the original explicit scalar spellings. An alias or unsupported spelling retains the original unknown JSON contract. */
function scalar(language: string, type: string): Rule {
  if (language === "kotlin") {
    if (/^(?:kotlin\.)?(?:Int|Long|Short|Byte)$/u.test(type)) return { type: "integer" };
    if (/^(?:kotlin\.)?(?:Double|Float)$/u.test(type)) return { type: "number" };
    if (/^(?:kotlin\.)?Boolean$/u.test(type)) return { type: "boolean" };
    if (/^(?:kotlin\.)?String$/u.test(type)) return { type: "string", maxLength: 1200 };
  } else if (["typescript", "javascript"].includes(language)) {
    if (["number", "boolean"].includes(type)) return { type };
    if (type === "string") return { type: "string", maxLength: 1200 };
  } else if (language === "python") {
    if (type === "int") return { type: "integer" }; if (type === "float") return { type: "number" }; if (type === "bool") return { type: "boolean" };
    if (type === "str") return { type: "string", maxLength: 1200 };
  }
  return {};
}
function unknown(nonNull: boolean): Rule {
  return nonNull ? { anyOf: [{ type: "string", maxLength: 1200 }, { type: "number" }, { type: "boolean" }, { type: "array", items: {} }, { type: "object", additionalProperties: true }] } : {};
}

/** Peel at most 64 explicit array/nullable layers, then rebuild iteratively with the original per-layer nullability. */
export function declaredRootValueDomain(language: string, type: string | undefined, nonNull = false): NativeNarrativeSchema {
  let source = type ?? ""; if (["typescript", "javascript"].includes(language) && /\[\]\s*$/u.test(source)) source = source.replace(/^\s*readonly\s+/u, "");
  let text = source.replace(/\s/gu, ""), nullable = false; const layers: Array<{ nullable: boolean }> = [];
  for (let depth = 0; ; depth++) {
    if (depth >= 64) return unknown(nonNull);
    nullable = language === "kotlin" && text.endsWith("?"); if (nullable) text = text.slice(0, -1);
    if (language === "kotlin") {
      const element = kotlinArrays.get(text.replace(/^kotlin\./u, "")), generic = /^(?:kotlin\.)?Array<(.+)>$/u.exec(text);
      if (element || generic) { layers.push({ nullable }); text = element ?? generic![1]; continue; }
    } else if (["typescript", "javascript"].includes(language) && text.endsWith("[]")) { layers.push({ nullable: false }); text = text.slice(0, -2); continue; }
    break;
  }
  let value = scalar(language, text);
  if (nullable && value.type && (!nonNull || layers.length > 0)) value = { anyOf: [value, { type: "null" }] };
  while (layers.length) { const layer = layers.pop()!; value = { type: "array", items: value }; if (layer.nullable && (!nonNull || layers.length > 0)) value = { anyOf: [value, { type: "null" }] }; }
  return !Object.keys(value).length ? unknown(nonNull) : value;
}

/** Match the original returned JSON domain and null marker, independently of any chosen example or calculated result. */
export function rootResultDomain(language: string, type: string | undefined): NativeNarrativeSchema {
  const value = declaredRootValueDomain(language, type) as Rule;
  if (value.anyOf) return value; if (value.type) return { anyOf: [value, { type: "null" }] };
  return { anyOf: [{ type: "number" }, { type: "boolean" }, { type: "null" }, { type: "string", maxLength: 1200 }, { type: "array", maxItems: 24, items: {} }, { type: "object", additionalProperties: true }] };
}
