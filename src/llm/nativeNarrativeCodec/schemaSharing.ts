/** Lossless factoring of schema positions only; source literal data and every original constraint remain opaque and exact. */
import { copyCodec, putCodec, requireCodec, sameCodec, type Schema } from "./data";
import type { NativeNarrativeSchema, NativeSchemaFactoring } from "./types";

type Position = { value: Schema; parent?: Schema | Schema[]; key?: string | number; depth: number; originalBytes?: string };
const dictionaries = new Set(["properties", "patternProperties", "$defs", "definitions", "dependentSchemas"]);
const arrays = new Set(["anyOf", "oneOf", "allOf", "prefixItems"]);
const singles = new Set(["items", "additionalProperties", "contains", "not", "if", "then", "else", "propertyNames"]);

/** Traverse only schema keywords with explicit budget/visited guards; const/enum/code data are never interpreted as schemas. */
function positions(root: Schema): Position[] {
  const rows: Position[] = [], stack: Position[] = [{ value: root, depth: 0 }], seen = new Set<object>();
  while (stack.length) {
    const row = stack.pop()!, node = row.value; if (!node || typeof node !== "object" || Array.isArray(node)) continue;
    requireCodec(!seen.has(node)); seen.add(node); requireCodec(rows.length < 100000 && row.depth <= 256); rows.push(row);
    for (const [keyword, value] of Object.entries(node)) {
      if (dictionaries.has(keyword)) for (const [key, child] of Object.entries(value as Schema)) stack.push({ value: child as Schema, parent: value, key, depth: row.depth + 1 });
      else if (arrays.has(keyword) || keyword === "items" && Array.isArray(value)) (value as Schema[]).forEach((child, key) => stack.push({ value: child, parent: value, key, depth: row.depth + 1 }));
      else if (singles.has(keyword) && value && typeof value === "object") stack.push({ value, parent: node, key: keyword, depth: row.depth + 1 });
    }
  }
  return rows;
}

function reference(row: Position, definitions: Schema): string | undefined {
  if (!Object.hasOwn(row.value, "$ref")) return undefined; sameCodec(Object.keys(row.value), ["$ref"]);
  requireCodec(typeof row.value.$ref === "string"); const name = /^#\/\$defs\/(d[0-9]+)$/u.exec(row.value.$ref)?.[1]; requireCodec(name && Object.hasOwn(definitions, name)); return name;
}

/** Prove all definition dependencies acyclic before expanding a single reference. */
function validateDefinitions(definitions: Schema): void {
  const indegree = new Map(Object.keys(definitions).map(name => [name, 0])), edges = new Map<string, Set<string>>();
  for (const [name, value] of Object.entries(definitions)) {
    const dependencies = new Set(positions(value).map(row => reference(row, definitions)).filter((value): value is string => value !== undefined)); edges.set(name, dependencies);
    for (const dependency of dependencies) indegree.set(dependency, indegree.get(dependency)! + 1);
  }
  const queue = [...indegree].filter(([, count]) => count === 0).map(([name]) => name); let completed = 0;
  for (let index = 0; index < queue.length; index++) { const name = queue[index]; completed++;
    for (const dependency of edges.get(name)!) { indegree.set(dependency, indegree.get(dependency)! - 1); if (indegree.get(dependency) === 0) queue.push(dependency); }
  }
  requireCodec(completed === indegree.size, "native-codec-schema-cycle");
}

/** Restore every original subtree, refusing missing/external/root refs and expansion cycles. */
export function expandNativeSchema(compact: NativeNarrativeSchema): NativeNarrativeSchema {
  const schema = copyCodec(compact) as Schema, definitions: Schema = schema.$defs ?? {}; delete schema.$defs; validateDefinitions(definitions); let passes = 0;
  while (true) {
    const refs = positions(schema).filter(row => Object.hasOwn(row.value, "$ref")); if (!refs.length) break; requireCodec(passes++ <= Object.keys(definitions).length, "native-codec-schema-depth");
    for (const row of refs) { const name = reference(row, definitions)!; requireCodec(row.parent && row.key !== undefined); putCodec(row.parent, row.key, copyCodec(definitions[name])); }
  }
  return schema;
}

/** Deterministic definition order matches the canonical codec; single-use definitions are inlined without changing constraints. */
export function factorNativeSchema(original: NativeNarrativeSchema): NativeSchemaFactoring {
  const schema = copyCodec(original) as Schema, rows = positions(schema), groups = new Map<string, { count: number; name?: string }>();
  for (const row of rows) {
    requireCodec(!Object.hasOwn(row.value, "$ref") && !Object.hasOwn(row.value, "$defs") && !Object.hasOwn(row.value, "definitions"));
    row.originalBytes = JSON.stringify(row.value); const group = groups.get(row.originalBytes) ?? { count: 0 }; group.count++; groups.set(row.originalBytes, group);
  }
  const definitions: Schema = {}; let sequence = 0, replacements = 0;
  for (const row of rows.sort((left, right) => right.depth - left.depth)) {
    if (!row.parent) continue; const group = groups.get(row.originalBytes!)!; if (group.count < 2) continue;
    if (!group.name) {
      const name = "d" + sequence, ref = { $ref: "#/$defs/" + name }, bytes = JSON.stringify(row.value).length;
      if (bytes + name.length + 16 + group.count * JSON.stringify(ref).length + 16 >= group.count * bytes) continue;
      group.name = name; sequence++; putCodec(definitions, name, copyCodec(row.value));
    } else sameCodec(definitions[group.name], row.value);
    putCodec(row.parent, row.key!, { $ref: "#/$defs/" + group.name }); replacements++;
  }
  if (Object.keys(definitions).length) schema.$defs = definitions;
  let changed = true;
  while (changed && schema.$defs) {
    changed = false; const refs = new Map<string, Position[]>(Object.keys(definitions).map(name => [name, []]));
    for (const row of positions(schema)) { const name = reference(row, definitions); if (name) refs.get(name)!.push(row); }
    for (const [name, uses] of refs) {
      if (uses.length > 1) continue;
      if (uses.length === 1) { requireCodec(uses[0].parent && uses[0].key !== undefined); putCodec(uses[0].parent, uses[0].key, copyCodec(definitions[name])); }
      delete definitions[name]; changed = true; break;
    }
  }
  if (schema.$defs && !Object.keys(definitions).length) delete schema.$defs;
  sameCodec(expandNativeSchema(schema), original);
  return { schema, originalCharacters: JSON.stringify(original).length, compactCharacters: JSON.stringify(schema).length, definitions: Object.keys(definitions).length, replacements };
}
