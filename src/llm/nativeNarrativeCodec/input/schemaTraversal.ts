/** Bounded role-aware schema/notation walks shared by input compilers. Literal source const/enum/raw data is never interpreted as schema. */
import { requireInput, INPUT_DEPTH, INPUT_NODES, type InputRecord } from "./data";

export type SchemaPosition = { value: InputRecord; parent?: any; key?: string | number; depth: number; original?: string };
export const NOTATION_MAPS = ["o", "p", "defs", "definitions", "patternProperties", "dependentSchemas"];
export const NOTATION_LISTS = ["any", "one", "all", "prefixItems"];
export const NOTATION_SINGLES = ["a", "i", "not", "if", "then", "else", "contains", "propertyNames", "additionalItems"];

/** Original JSON Schema key insertion order determines the canonical text/reference numbering. */
export function nativeSchemaPositions(root: InputRecord): SchemaPosition[] {
  const dictionaries = new Set(["properties", "patternProperties", "$defs", "definitions", "dependentSchemas"]), lists = new Set(["anyOf", "oneOf", "allOf", "prefixItems"]), singles = new Set(["items", "additionalProperties", "contains", "not", "if", "then", "else", "propertyNames"]);
  const rows: SchemaPosition[] = [], stack: SchemaPosition[] = [{ value: root, depth: 0 }], seen = new Set<object>();
  while (stack.length) { const row = stack.pop()!, node = row.value; if (!node || typeof node !== "object" || Array.isArray(node)) continue;
    requireInput(!seen.has(node) && rows.length < INPUT_NODES && row.depth <= INPUT_DEPTH); seen.add(node); rows.push(row);
    for (const [keyword, value] of Object.entries(node)) {
      if (dictionaries.has(keyword)) for (const [key, child] of Object.entries(value as InputRecord)) stack.push({ value: child as InputRecord, parent: value, key, depth: row.depth + 1 });
      else if (lists.has(keyword) || keyword === "items" && Array.isArray(value)) (value as InputRecord[]).forEach((child, key) => stack.push({ value: child, parent: value, key, depth: row.depth + 1 }));
      else if (singles.has(keyword) && value && typeof value === "object") stack.push({ value, parent: node, key: keyword, depth: row.depth + 1 });
    }
  } return rows;
}

/** Canonical notation walks use fixed schema-role order and visit only the value-schema slots of supported macros. */
export function notationPositions(root: InputRecord, macros = false): { holder: InputRecord; rows: SchemaPosition[] } {
  const holder = { schema: root }, rows: SchemaPosition[] = [], stack: SchemaPosition[] = [{ value: root, parent: holder, key: "schema", depth: 0 }], seen = new Set<object>();
  while (stack.length) { const row = stack.pop()!, node = row.value; if (!node || typeof node !== "object" || Array.isArray(node)) continue;
    requireInput(!seen.has(node) && rows.length < INPUT_NODES && row.depth <= INPUT_DEPTH); seen.add(node); rows.push(row); if (Object.hasOwn(node, "raw")) continue;
    if (macros && Object.hasOwn(node, "@")) { const value = node["@"]; requireInput(Array.isArray(value));
      if (value[0] === "T") value[1].forEach((child: InputRecord, key: number) => stack.push({ value: child, parent: value[1], key, depth: row.depth + 1 }));
      else if (value[0] === "S") stack.push({ value: value[2], parent: value, key: 2, depth: row.depth + 1 });
      else if (value[0] === "V") value[2].forEach((child: InputRecord, key: number) => stack.push({ value: child, parent: value[2], key, depth: row.depth + 1 }));
      else requireInput(value[0] === "P"); continue;
    }
    for (const key of NOTATION_MAPS) if (node[key]) for (const [name, child] of Object.entries(node[key])) stack.push({ value: child as InputRecord, parent: node[key], key: name, depth: row.depth + 1 });
    for (const key of NOTATION_LISTS) if (node[key]) node[key].forEach((child: InputRecord, index: number) => stack.push({ value: child, parent: node[key], key: index, depth: row.depth + 1 }));
    for (const key of NOTATION_SINGLES) if (node[key] && typeof node[key] === "object") {
      if (key === "i" && Array.isArray(node[key])) node[key].forEach((child: InputRecord, index: number) => stack.push({ value: child, parent: node[key], key: index, depth: row.depth + 1 }));
      else stack.push({ value: node[key], parent: node, key, depth: row.depth + 1 });
    }
  } return { holder, rows };
}
