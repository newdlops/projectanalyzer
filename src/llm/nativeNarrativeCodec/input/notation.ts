/** Lossless prompt spelling of the unchanged native schema, including owned definitions and exact source-valued annotations. */
import { expandNativeSchema } from "../schemaSharing";
import { copyInput, inputKeys, inputRecord, putInput, requireInput, sameInput, type InputRecord } from "./data";
import { nativeSchemaPositions } from "./schemaTraversal";

const aliases: Record<string, string> = { type: "t", const: "c", enum: "e", properties: "p", required: "r", additionalProperties: "a", items: "i", minItems: "min", maxItems: "max", minLength: "lo", maxLength: "hi", pattern: "regex", anyOf: "any", oneOf: "one", allOf: "all", $defs: "defs", definitions: "definitions", minimum: "ge", maximum: "le", exclusiveMinimum: "gt", exclusiveMaximum: "lt", description: "d", title: "title", $comment: "comment", not: "not", if: "if", then: "then", else: "else", contains: "contains", propertyNames: "propertyNames", patternProperties: "patternProperties", dependentSchemas: "dependentSchemas", prefixItems: "prefixItems", additionalItems: "additionalItems" };
const reverse = Object.fromEntries(Object.entries(aliases).map(([name, alias]) => [alias, name]));
const maps = new Set(["properties", "$defs", "definitions", "patternProperties", "dependentSchemas"]), lists = new Set(["anyOf", "oneOf", "allOf", "prefixItems"]), singles = new Set(["items", "additionalProperties", "additionalItems", "contains", "not", "if", "then", "else", "propertyNames"]);
const annotations = new Set(["description", "title", "$comment"]), primitives = new Set(["string", "integer", "number", "boolean", "null", "object", "array"]);

/** Only flat canonical string-valued source facts may split into prefix/fact/suffix. All other annotation bytes remain opaque. */
function pieces(text: string): string | [string, InputRecord, string] {
  const begin = text.indexOf("{"), end = text.lastIndexOf("}");
  if (begin >= 0 && end > begin) try { const fact = JSON.parse(text.slice(begin, end + 1));
    if (fact && typeof fact === "object" && !Array.isArray(fact) && Object.values(fact).every(value => typeof value === "string") && JSON.stringify(fact) === text.slice(begin, end + 1)) return [text.slice(0, begin), fact, text.slice(end + 1)];
  } catch { /* A noncanonical annotation remains a complete literal string. */ } return text;
}

/** Encode only schema roles; unknown keywords stay as complete raw schema and const/enum data remains literal. */
export function encodeSchemaNotation(original: InputRecord): InputRecord {
  const schema = copyInput(original); expandNativeSchema(schema); const rows = nativeSchemaPositions(schema), counts = new Map<string, number>();
  const add = (text: string) => counts.set(text, (counts.get(text) ?? 0) + 1);
  for (const row of rows) { row.original = JSON.stringify(row.value); for (const key of annotations) if (typeof row.value[key] === "string") { const part = pieces(row.value[key]);
    if (Array.isArray(part)) { add(part[0]); add(part[2]); Object.values(part[1]).forEach(add); } else add(part); } }
  const texts = [...counts].filter(([text, count]) => text.length >= 12 && count >= 2).map(([text]) => text), ids = new Map(texts.map((text, index) => [text, index]));
  const text = (value: string): string | number => ids.has(value) ? ids.get(value)! : value;
  const annotation = (value: string): unknown => { const part = pieces(value); return Array.isArray(part) ? [text(part[0]), Object.fromEntries(Object.entries(part[1]).map(([key, value]) => [key, text(value)])), text(part[2])] : text(part); };
  let root: unknown = schema;
  for (const row of rows.sort((a, b) => b.depth - a.depth)) { const node = row.value, keys = Object.keys(node); let result: any;
    if (keys.length === 1 && keys[0] === "$ref") { const id = /^#\/\$defs\/d([0-9]+)$/u.exec(node.$ref); requireInput(id && Object.hasOwn(schema.$defs ?? {}, "d" + id[1])); result = Number(id[1]); }
    else if (keys.length === 1 && keys[0] === "type" && primitives.has(node.type)) result = node.type;
    else if (keys.some(key => !Object.hasOwn(aliases, key))) result = { raw: JSON.parse(row.original!) };
    else { const names = Object.keys(node.properties ?? {}), required = node.required;
      const closed = node.type === "object" && node.additionalProperties === false && names.length > 0 && Array.isArray(required) && required.length === names.length && new Set(required).size === names.length && required.every(name => names.includes(name)) && keys.every(key => ["type", "properties", "required", "additionalProperties", ...annotations].includes(key)); result = {};
      if (closed) { result.o = node.properties; const order = required.map(name => names.indexOf(name)); if (!order.every((index, position) => index === position)) result.r = names.length <= 10 ? order.join("") : order;
        for (const key of annotations) if (Object.hasOwn(node, key)) putInput(result, aliases[key], typeof node[key] === "string" ? annotation(node[key]) : node[key]);
      } else for (const [key, value] of Object.entries(node)) putInput(result, aliases[key], annotations.has(key) && typeof value === "string" ? annotation(value) : value);
    } if (row.parent) putInput(row.parent, row.key!, result); else root = result;
  }
  const encoded = { format: "schema-notation-v1", texts, schema: root }; sameInput(decodeSchemaNotation(encoded), original); return encoded;
}

/** Decode only locally owned notation references. The original native schema is never replaced with an inferred answer or relaxed constraint. */
export function decodeSchemaNotation(input: unknown): InputRecord {
  const value = inputRecord(input); inputKeys(value, ["format", "texts", "schema"]); requireInput(value.format === "schema-notation-v1" && Array.isArray(value.texts) && value.texts.every((text: unknown) => typeof text === "string"));
  const text = (part: any): string => { if (typeof part === "string") return part; requireInput(Number.isInteger(part) && part >= 0 && part < value.texts.length); return value.texts[part]; };
  const annotation = (part: any): string => { if (!Array.isArray(part)) return text(part); requireInput(part.length === 3 && part[1] && typeof part[1] === "object" && !Array.isArray(part[1])); const fact = {};
    for (const [key, value] of Object.entries(part[1])) putInput(fact, key, text(value)); return text(part[0]) + JSON.stringify(fact) + text(part[2]); };
  const holder: InputRecord = {}, stack = [{ node: value.schema, parent: holder as any, key: "root" as string | number, depth: 0 }]; let count = 0;
  while (stack.length) { const row = stack.pop()!, node = row.node; requireInput(++count <= 100000 && row.depth <= 256); let output: any;
    if (typeof node === "number") { requireInput(Number.isSafeInteger(node) && node >= 0); output = { $ref: "#/$defs/d" + node }; }
    else if (typeof node === "string") { requireInput(primitives.has(node)); output = { type: node }; }
    else if (typeof node === "boolean") output = node;
    else { requireInput(node && typeof node === "object" && !Array.isArray(node));
      if (Object.hasOwn(node, "raw")) { inputKeys(node, ["raw"]); output = copyInput(node.raw); }
      else { output = {}; let entries: Array<[string, any]>;
        if (Object.hasOwn(node, "o")) { requireInput(Object.keys(node).every(key => ["o", "r", "d", "title", "comment"].includes(key))); const names = Object.keys(node.o), order = node.r === undefined ? names.map((_, index) => index) : typeof node.r === "string" ? [...node.r].map(Number) : node.r;
          requireInput(Array.isArray(order) && order.length === names.length && new Set(order).size === names.length && order.every(index => Number.isInteger(index) && index >= 0 && index < names.length)); Object.assign(output, { type: "object", additionalProperties: false, required: order.map(index => names[index]) });
          entries = [["properties", node.o], ...Object.entries(node).filter(([key]) => key !== "o" && key !== "r").map(([key, part]) => [reverse[key], part] as [string, any])];
        } else entries = Object.entries(node).map(([key, part]) => { requireInput(Object.hasOwn(reverse, key)); return [reverse[key], part]; });
        for (const [keyword, part] of entries) {
          if (annotations.has(keyword)) { putInput(output, keyword, annotation(part)); continue; }
          if (maps.has(keyword)) { const map = {}; putInput(output, keyword, map); for (const [key, child] of Object.entries(part)) stack.push({ node: child, parent: map, key, depth: row.depth + 1 }); }
          else if (lists.has(keyword) || keyword === "items" && Array.isArray(part)) { const list = new Array(part.length); putInput(output, keyword, list); part.forEach((child: unknown, key: number) => stack.push({ node: child, parent: list, key, depth: row.depth + 1 })); }
          else if (singles.has(keyword) && (part && typeof part === "object" || ["number", "string", "boolean"].includes(typeof part))) stack.push({ node: part, parent: output, key: keyword, depth: row.depth + 1 });
          else putInput(output, keyword, part);
        }
      }
    } putInput(row.parent, row.key, output);
  }
  expandNativeSchema(holder.root); return holder.root;
}
