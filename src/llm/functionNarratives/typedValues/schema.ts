/** Map explicit source type spellings to JSON kinds without evaluating source or resolving aliases.
 * Array nesting is peeled iteratively; unsupported element annotations keep unknown JSON items.
 */
type ValueSchema = Record<string, unknown>;
interface ArrayLayer { nullable: boolean; }

const kotlinArrays = new Map([
  ["IntArray", "Int"], ["LongArray", "Long"], ["ShortArray", "Short"], ["ByteArray", "Byte"],
  ["DoubleArray", "Double"], ["FloatArray", "Float"], ["BooleanArray", "Boolean"]
]);

/** Preserve existing scalar/null rules and require explicit arrays to contain the declared JSON kind.
 * This constrains illustrative JSON only; it does not prove runtime execution or source-language range validity.
 */
export function createDeclaredValueSchema(language: string, type: string | undefined, nonNull = false): ValueSchema {
  let source = type ?? "";
  if (["typescript", "javascript"].includes(language) && /\[\]\s*$/u.test(source)) source = source.replace(/^\s*readonly\s+/u, "");
  let text = source.replace(/\s/gu, "");
  const layers: ArrayLayer[] = [];
  let nullable = false;
  // Every peel shortens the annotation. The guard prevents hostile, deeply nested type text from
  // creating an unbounded schema; such annotations retain the original unknown-value contract.
  for (let depth = 0; ; depth++) {
    if (depth >= 64) return unknownValueSchema(nonNull);
    nullable = language === "kotlin" && text.endsWith("?");
    if (nullable) text = text.slice(0, -1);
    if (language === "kotlin") {
      const primitiveElement = kotlinArrays.get(text.replace(/^kotlin\./u, ""));
      const generic = /^(?:kotlin\.)?Array<(.+)>$/u.exec(text);
      if (primitiveElement || generic) {
        layers.push({ nullable }); text = primitiveElement ?? generic![1]; continue;
      }
    } else if (["typescript", "javascript"].includes(language) && text.endsWith("[]")) {
      layers.push({ nullable: false }); text = text.slice(0, -2); continue;
    }
    break;
  }
  let value = scalarSchema(language, text);
  if (nullable && value.type && (!nonNull || layers.length > 0)) value = { anyOf: [value, { type: "null" }] };
  while (layers.length) {
    const layer = layers.pop()!;
    value = { type: "array", items: value };
    if (layer.nullable && (!nonNull || layers.length > 0)) value = { anyOf: [value, { type: "null" }] };
  }
  return !Object.keys(value).length ? unknownValueSchema(nonNull) : value;
}

/** Match only the original direct scalar spellings; aliases retain unknown kinds. */
function scalarSchema(language: string, primitive: string): ValueSchema {
  if (language === "kotlin") {
    if (/^(?:kotlin\.)?(?:Int|Long|Short|Byte)$/u.test(primitive)) return { type: "integer" };
    if (/^(?:kotlin\.)?(?:Double|Float)$/u.test(primitive)) return { type: "number" };
    if (/^(?:kotlin\.)?Boolean$/u.test(primitive)) return { type: "boolean" };
    if (/^(?:kotlin\.)?String$/u.test(primitive)) return { type: "string", maxLength: 1200 };
  } else if (["typescript", "javascript"].includes(language)) {
    if (primitive === "number" || primitive === "boolean") return { type: primitive };
    if (primitive === "string") return { type: "string", maxLength: 1200 };
  } else if (language === "python") {
    if (primitive === "int") return { type: "integer" };
    if (primitive === "float") return { type: "number" };
    if (primitive === "bool") return { type: "boolean" };
    if (primitive === "str") return { type: "string", maxLength: 1200 };
  }
  return {};
}

/** Non-null source choices exclude null but do not invent an alias's JSON kind. */
function unknownValueSchema(nonNull: boolean): ValueSchema {
  return nonNull ? { anyOf: [{ type: "string", maxLength: 1200 }, { type: "number" }, { type: "boolean" },
    { type: "array", items: {} }, { type: "object", additionalProperties: true }] } : {};
}
