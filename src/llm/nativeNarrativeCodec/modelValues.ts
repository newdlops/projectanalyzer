/** Release every known computed schema constant to its declared domain and require raw model fields before source restoration. */
import { copyCodec, putCodec, requireCodec, sameCodec, type Schema } from "./data";
import { compileCodec, validateCodec } from "./validation";
import type { NativeModelValueSchema, NativeNarrativeSchema, NativeValueAudit } from "./types";

const UNKNOWN = new Set(["선언 전", "미평가", "반환 전", "미확인", "not declared", "not evaluated", "not returned", "unconfirmed"]);
type Slot = { rule: Schema; path: string; depth: number; holder?: Schema | Schema[]; key?: string | number; outerRule?: Schema; originalValue?: unknown };

/** A fixed values container retains exact ordered names/arity while exposing each independently calculated side. */
function structuralValues(value: unknown): Schema {
  requireCodec(Array.isArray(value));
  return { type: "array", minItems: value.length, maxItems: value.length, items: value.map(row => {
    requireCodec(row && typeof row === "object" && !Array.isArray(row) && ["name", "before", "after"].every(name => Object.hasOwn(row, name)));
    return { type: "object", additionalProperties: false, required: Object.keys(row), properties: Object.fromEntries(Object.entries(row).map(([name, item]) => [name, { const: copyCodec(item) }])) };
  }) };
}

/** Only bounded local refs are followed, and prior completed const arrays remain supplied input rather than new work. */
function computedSlots(schema: Schema, knownNullPaths: readonly string[], includeFree = false): Slot[] {
  const knownNull = new Set(knownNullPaths), result: Slot[] = [], work: Slot[] = [{ rule: schema, path: "$", depth: 0 }]; let visits = 0;
  while (work.length) {
    const current = work.pop()!; let rule = current.rule; requireCodec(++visits <= 20000 && current.depth <= 64);
    const refs = new Set<string>();
    while (rule.$ref) {
      requireCodec(typeof rule.$ref === "string" && rule.$ref.startsWith("#/") && !refs.has(rule.$ref) && refs.size < 64); refs.add(rule.$ref);
      let target: Schema = schema;
      for (const key of rule.$ref.slice(2).split("/")) { const decoded = key.replace(/~1/g, "/").replace(/~0/g, "~"); requireCodec(target && Object.hasOwn(target, decoded)); target = target[decoded]; }
      requireCodec(target && typeof target === "object"); rule = target;
    }
    const isComputed = current.path.endsWith(".exampleResult") || current.path.includes(".values[") && /\.(?:before|after)$/.test(current.path);
    const fixed = Object.hasOwn(rule, "const") || rule.enum?.length === 1;
    if (includeFree && isComputed && !fixed) { result.push({ ...current, rule }); continue; }
    if (fixed) {
      const literal: unknown = Object.hasOwn(rule, "const") ? rule.const : rule.enum[0];
      const unknown = literal === null && !knownNull.has(current.path) || typeof literal === "string" && UNKNOWN.has(literal);
      if (isComputed && !unknown && !includeFree) result.push({ ...current, rule, outerRule: current.rule, originalValue: copyCodec(literal) });
      continue;
    }
    if (rule.properties) for (const [name, child] of Object.entries(rule.properties) as Array<[string, Schema]>) {
      if (name === "values" && Object.hasOwn(child, "const")) putCodec(rule.properties, name, structuralValues(child.const));
      work.push({ rule: rule.properties[name], holder: rule.properties, key: name, path: current.path + "." + name, depth: current.depth + 1 });
    }
    if (rule.items) for (const [index, child] of (Array.isArray(rule.items) ? rule.items : [rule.items] as Schema[]).entries()) work.push({ rule: child,
      holder: Array.isArray(rule.items) ? rule.items : rule, key: Array.isArray(rule.items) ? index : "items", path: current.path + "[" + (Array.isArray(rule.items) ? index : "*") + "]", depth: current.depth + 1 });
  }
  return result.sort((left, right) => left.path.localeCompare(right.path));
}

/** Source/answer constants must not reappear inside the model's declared free calculation domain. */
function requireFreeDomain(domain: Schema): void {
  const work: unknown[] = [domain], visited = new Set<object>();
  while (work.length) {
    const current = work.pop(); if (!current || typeof current !== "object") continue; if (visited.has(current)) continue; visited.add(current); requireCodec(visited.size <= 20000);
    const rule = current as Schema; requireCodec(!Object.hasOwn(rule, "const") && !(Array.isArray(rule.enum) && rule.enum.length === 1), "native-codec-fixed-calculation"); work.push(...Object.values(rule));
  }
}

/** No source evaluator or target lookup is invoked: callers provide all original declared/display domains explicitly. */
export function releaseNativeModelValues(original: NativeNarrativeSchema, domains: Readonly<Record<string, NativeNarrativeSchema>>, knownNullPaths: readonly string[] = []): NativeModelValueSchema {
  const schema = copyCodec(original) as Schema, slots = computedSlots(schema, knownNullPaths), audit: NativeValueAudit[] = [];
  sameCodec(Object.keys(domains).sort(), slots.map(slot => slot.path).sort(), "native-codec-calculation-coverage");
  for (const slot of slots) {
    const domain = copyCodec(domains[slot.path]) as Schema; requireFreeDomain(domain); validateCodec(compileCodec(domain), slot.originalValue);
    const retained = Object.fromEntries([...Object.entries(slot.rule), ...Object.entries(slot.outerRule!)].filter(([name]) => !["const", "enum", "$ref"].includes(name)));
    requireCodec(slot.holder && slot.key !== undefined); const released = { ...domain, ...retained }; putCodec(slot.holder, slot.key, released);
    validateCodec(compileCodec(released), slot.originalValue); audit.push({ path: slot.path, originalValue: slot.originalValue, originalDomain: domain, modelAuthored: true });
  }
  return { schema, audit, modelValuePaths: computedSlots(schema, knownNullPaths, true).map(slot => slot.path) };
}

/** Require the model's actual scalar/array/object fields unchanged; missing/wrong fields fail rather than being filled. */
export function requireNativeModelValues(response: unknown, audit: readonly NativeValueAudit[]): void {
  for (const row of audit) {
    requireCodec(/^\$(?:\.[A-Za-z_][A-Za-z0-9_]*|\[\d+\])+$/u.test(row.path), "native-codec-value-path"); let value: any = response;
    const parts = row.path.slice(2).replace(/\[(\d+)\]/g, ".$1").split(".");
    for (const key of parts) { requireCodec(value && typeof value === "object" && Object.hasOwn(value, key), "native-codec-missing-calculation"); value = value[key]; }
    sameCodec(value, row.originalValue, "native-codec-wrong-calculation");
  }
}
