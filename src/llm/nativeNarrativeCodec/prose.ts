/** Share only complete strings authored in this one raw response; computed cells never become prose references. */
import { copyCodec, MAX_NATIVE_CHARACTERS, putCodec, requireCodec, sameCodec, type DataPath, type Schema } from "./data";
import { codecValidator, compileCodec, validateCodec } from "./validation";
import type { NativeNarrativeMode, NativeNarrativeSchema, NativeProseWire } from "./types";

/** Recognize the canonical narrative roles, keeping source code, names, conditions and arbitrary computed JSON opaque. */
export function isNativeProsePath(path: readonly (string | number)[], mode: NativeNarrativeMode): boolean {
  const key = path.map(part => typeof part === "number" ? "*" : part).join(".");
  if (/^(?:justification|loopVisits\.\*\.meaning|reading\.summary|reading\.limitations\.\*)$/u.test(key)) return true;
  if (/^reading\.scenarios\.\*\.(?:title|explanation|assumptions\.\*|analysis\.(?:pathReason|stateChange|alternative))$/u.test(key)) return true;
  if (/^reading\.scenarios\.\*\.steps\.\*\.(?:syntax|text|reason|effect)$/u.test(key)) return true;
  return ["source-infeasible", "unverified"].includes(mode) && (
    /^reading\.scenarios\.\*\.(?:exampleInputs\.\*\.value|exampleResult)\.reason$/u.test(key)
    || /^reading\.scenarios\.\*\.steps\.\*\.values\.\*\.(?:before|after)\.reason$/u.test(key));
}

/** Every shared slot keeps its direct original String domain and is revalidated after response-local expansion. */
export function createNativeProseWire(original: NativeNarrativeSchema, mode: NativeNarrativeMode): NativeProseWire {
  const source = copyCodec(original) as Schema;
  requireCodec(source.properties?.mode?.const === mode && !Object.hasOwn(source.properties, "prose"));
  const holder = { schema: copyCodec(source) }, stack: Array<{ node: Schema; parent: Schema | Schema[]; key: string | number; path: DataPath; depth: number }> = [
    { node: holder.schema, parent: holder, key: "schema", path: [], depth: 0 }
  ], slots = new Map<string, { path: DataPath; domain: Schema }>(), domains = new Map<string, Schema>(); let nodes = 0;
  while (stack.length) {
    const row = stack.pop()!, node = row.node; requireCodec(++nodes <= 100000 && row.depth <= 128);
    if (typeof node === "boolean") continue;
    requireCodec(node && typeof node === "object" && !Array.isArray(node)); requireCodec(!Object.hasOwn(node, "$ref") && !Object.hasOwn(node, "$defs"), "native-codec-expanded-schema");
    if (node.type === "string" && isNativeProsePath(row.path, mode)) {
      requireCodec(!Object.hasOwn(node, "const") && !Object.hasOwn(node, "enum"), "native-codec-fixed-prose");
      requireCodec(Number.isInteger(node.maxLength) && node.maxLength >= 1 && node.maxLength <= MAX_NATIVE_CHARACTERS);
      const signature = JSON.stringify(row.path), previous = slots.get(signature);
      if (previous) sameCodec(previous.domain, node); else slots.set(signature, { path: row.path, domain: copyCodec(node) });
      domains.set(JSON.stringify(node), copyCodec(node)); putCodec(row.parent, row.key, { anyOf: [node, { type: "integer", minimum: 0, maximum: MAX_NATIVE_CHARACTERS - 1 }] }); continue;
    }
    if (node.properties) for (const [key, child] of Object.entries(node.properties) as Array<[string, Schema]>) stack.push({ node: child, parent: node.properties, key, path: [...row.path, key], depth: row.depth + 1 });
    if (node.items && typeof node.items === "object") {
      if (Array.isArray(node.items)) for (let index = node.items.length - 1; index >= 0; index--) stack.push({ node: node.items[index], parent: node.items, key: index, path: [...row.path, index], depth: row.depth + 1 });
      else stack.push({ node: node.items, parent: node, key: "items", path: [...row.path, "*"], depth: row.depth + 1 });
    }
    for (const keyword of ["anyOf", "oneOf", "allOf"]) if (node[keyword]) for (let index = node[keyword].length - 1; index >= 0; index--)
      stack.push({ node: node[keyword][index], parent: node[keyword], key: index, path: row.path, depth: row.depth + 1 });
  }
  requireCodec(slots.size > 0 && domains.size > 0);
  const properties: Schema = { mode: holder.schema.properties.mode, prose: { type: "array", items: { anyOf: [...domains.values()] }, maxItems: MAX_NATIVE_CHARACTERS } };
  for (const [key, value] of Object.entries(holder.schema.properties)) if (key !== "mode") putCodec(properties, key, value);
  holder.schema.properties = properties;
  const validation = codecValidator(), originalValid = compileCodec(source, validation), wireValid = compileCodec(holder.schema);

  /** Locate authorized prose cells; literal const/enum objects and calculated values are never traversed as text. */
  function cells(value: Schema): Array<{ value: string | number; parent: object; key: string | number }> {
    const result: Array<{ value: string | number; parent: object; key: string | number }> = [], seen = new WeakMap<object, Set<string | number>>(); let visited = 0;
    for (const slot of slots.values()) {
      const pending: Array<{ value: any; parent?: object; key?: string | number; index: number }> = [{ value, index: 0 }];
      while (pending.length) {
        const row = pending.pop()!; requireCodec(++visited <= 100000);
        if (row.index === slot.path.length) {
          requireCodec(row.parent && row.key !== undefined && (typeof row.value === "string" || Number.isSafeInteger(row.value)));
          let keys = seen.get(row.parent); if (!keys) { keys = new Set(); seen.set(row.parent, keys); }
          requireCodec(!keys.has(row.key), "native-codec-prose-overlap"); keys.add(row.key); result.push({ value: row.value, parent: row.parent, key: row.key }); continue;
        }
        const part = slot.path[row.index];
        if (part === "*") { requireCodec(Array.isArray(row.value)); for (let index = row.value.length - 1; index >= 0; index--) pending.push({ value: row.value[index], parent: row.value, key: index, index: row.index + 1 }); }
        else if (row.value && typeof row.value === "object" && Object.hasOwn(row.value, part)) pending.push({ value: row.value[part], parent: row.value, key: part, index: row.index + 1 });
      }
    }
    return result;
  }

  /** Resolve only this response's model-written table, then enforce every slot's exact original domain. */
  function decode(input: unknown): unknown {
    const value = copyCodec(input, MAX_NATIVE_CHARACTERS) as Schema; validateCodec(wireValid, value); const table = value.prose ?? [];
    for (const cell of cells(value)) if (typeof cell.value === "number") {
      requireCodec(cell.value >= 0 && cell.value < table.length && typeof table[cell.value] === "string", "native-codec-prose-reference"); putCodec(cell.parent, cell.key, table[cell.value]);
    }
    delete value.prose; validateCodec(originalValid, value); return copyCodec(value, MAX_NATIVE_CHARACTERS);
  }

  /** Deterministic authoring/serialization utility; shares only unchanged input strings and never supplies a missing sentence. */
  function encode(input: unknown): unknown {
    const value = copyCodec(input, MAX_NATIVE_CHARACTERS) as Schema; validateCodec(originalValid, value); requireCodec(!Object.hasOwn(value, "prose"));
    const locations = cells(value), counts = new Map<string, number>();
    for (const cell of locations) { requireCodec(typeof cell.value === "string"); counts.set(cell.value, (counts.get(cell.value) ?? 0) + 1); }
    const table = [...counts].filter(([text, count]) => count > 1 && text.length >= 12 && (count - 1) * JSON.stringify(text).length > count * 5 + 4).map(([text]) => text);
    const ids = new Map(table.map((text, index) => [text, index])); requireCodec(table.length <= MAX_NATIVE_CHARACTERS);
    for (const cell of locations) if (typeof cell.value === "string" && ids.has(cell.value)) putCodec(cell.parent, cell.key, ids.get(cell.value));
    const shared = { mode: value.mode, ...(table.length ? { prose: table } : {}), ...Object.fromEntries(Object.entries(value).filter(([key]) => key !== "mode")) };
    validateCodec(wireValid, shared); const output = JSON.stringify(shared).length < JSON.stringify(input).length ? shared : copyCodec(input, MAX_NATIVE_CHARACTERS);
    sameCodec(decode(output), input); return output;
  }
  return { schema: holder.schema, slots: [...slots.values()].map(slot => copyCodec(slot)), encode, decode };
}
