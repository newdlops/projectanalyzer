/** Exact P/T/S schema macros share compiler structure only; every source literal and free model value/prose domain remains independent. */
import { copyInput, inputKeys, inputRecord, putInput, requireInput, sameInputJson, type InputRecord } from "./data";
import { notationPositions, NOTATION_MAPS, NOTATION_LISTS, NOTATION_SINGLES } from "./schemaTraversal";

const keysEqual = (node: object, keys: string[]) => JSON.stringify(Object.keys(node)) === JSON.stringify(keys);

/** Name only canonical bounded string patterns, full tuples and the four prose slots of an exact source step. */
export function encodeNativeStepMacros(input: unknown): InputRecord {
  const working = inputRecord(input); inputKeys(working, ["format", "texts", "schema"]); requireInput(working.format === "source-bound-schema-notation-v1");
  const { holder, rows } = notationPositions(working.schema), patterns: InputRecord[] = [], stepForms: InputRecord[] = [], patternIds = new Map<string, number>(), formIds = new Map<string, number>();
  for (const row of rows) requireInput(!Object.hasOwn(row.value, "@"));
  for (const row of rows.sort((a, b) => b.depth - a.depth)) { const node = row.value;
    if (keysEqual(node, ["t", "lo", "hi", "regex"]) && node.t === "string" && node.lo === 1 && Number.isInteger(node.hi) && node.hi > 0 && typeof node.regex === "string") {
      const match = /^(.*\{0,)([0-9]+)(\}\$)$/u.exec(node.regex);
      if (match && Number(match[2]) === node.hi - 1) { const pattern = { prefix: match[1], suffix: match[3] }, key = JSON.stringify(pattern); if (!patternIds.has(key)) { patternIds.set(key, patterns.length); patterns.push(pattern); }
        putInput(row.parent, row.key!, { "@": ["P", patternIds.get(key), node.hi] }); continue; }
    }
    const described = keysEqual(node, ["t", "i", "min", "max", "additionalItems", "d"]), plain = keysEqual(node, ["t", "i", "min", "max", "additionalItems"]);
    if (!(described || plain) || node.t !== "array" || !Array.isArray(node.i) || node.min !== node.i.length || node.max !== node.i.length || node.additionalItems !== false) continue;
    if (described && node.i.length === 5 && node.i.slice(1).every(value => Number.isInteger(value) && value >= 0) && Array.isArray(node.d) && node.d.length === 3 && node.d[1] && keysEqual(node.d[1], ["sourceStep"]) && Number.isInteger(node.d[1].sourceStep) && node.d[1].sourceStep > 0) {
      const form = { tail: copyInput(node.i.slice(1)), prefix: copyInput(node.d[0]) }, key = JSON.stringify(form); if (!formIds.has(key)) { formIds.set(key, stepForms.length); stepForms.push(form); }
      putInput(row.parent, row.key!, { "@": ["S", formIds.get(key), copyInput(node.i[0]), node.d[1].sourceStep, copyInput(node.d[2])] });
    } else putInput(row.parent, row.key!, { "@": ["T", copyInput(node.i), ...(described ? [copyInput(node.d)] : [])] });
  }
  const notation = { format: "source-step-schema-macros-v1", texts: working.texts, patterns, stepForms, schema: holder.schema }; sameInputJson(decodeNativeStepMacros(notation), input); return notation;
}

/** Expand owned pattern/form definitions before source notation, with bounded visits/depth and no recursive macro calls. */
export function decodeNativeStepMacros(input: unknown): InputRecord {
  const working = inputRecord(input); inputKeys(working, ["format", "texts", "patterns", "stepForms", "schema"]); requireInput(working.format === "source-step-schema-macros-v1" && Array.isArray(working.patterns) && Array.isArray(working.stepForms));
  for (const pattern of working.patterns) { inputKeys(pattern, ["prefix", "suffix"]); requireInput(typeof pattern.prefix === "string" && typeof pattern.suffix === "string"); }
  for (const form of working.stepForms) { inputKeys(form, ["tail", "prefix"]); requireInput(Array.isArray(form.tail) && form.tail.length === 4 && form.tail.every((value: unknown) => Number.isInteger(value) && (value as number) >= 0)); }
  const holder = { schema: working.schema }, stack = [{ parent: holder as any, key: "schema" as string | number, depth: 0 }]; let visits = 0;
  while (stack.length) { const row = stack.pop()!; requireInput(++visits < 100000 && row.depth <= 128); let node = row.parent[row.key]; if (!node || typeof node !== "object" || Array.isArray(node)) continue; if (Object.hasOwn(node, "raw")) continue;
    if (Object.hasOwn(node, "@")) { inputKeys(node, ["@"]); const macro = node["@"]; requireInput(Array.isArray(macro));
      if (macro[0] === "P") { requireInput(macro.length === 3); const [, id, length] = macro; requireInput(Number.isInteger(id) && id >= 0 && id < working.patterns.length && Number.isInteger(length) && length > 0); const pattern = working.patterns[id]; node = { t: "string", lo: 1, hi: length, regex: pattern.prefix + (length - 1) + pattern.suffix }; }
      else if (macro[0] === "T") { requireInput((macro.length === 2 || macro.length === 3) && Array.isArray(macro[1])); const items = macro[1]; node = { t: "array", i: copyInput(items), min: items.length, max: items.length, additionalItems: false, ...(macro.length === 3 ? { d: copyInput(macro[2]) } : {}) }; }
      else if (macro[0] === "S") { requireInput(macro.length === 5); const [, id, values, ordinal, suffix] = macro; requireInput(Number.isInteger(id) && id >= 0 && id < working.stepForms.length && Number.isInteger(ordinal) && ordinal > 0); const form = working.stepForms[id]; node = { t: "array", i: [copyInput(values), ...form.tail], min: 5, max: 5, additionalItems: false, d: [copyInput(form.prefix), { sourceStep: ordinal }, copyInput(suffix)] }; }
      else requireInput(false, "native-input-macro"); row.parent[row.key] = node;
    }
    for (const key of NOTATION_MAPS) if (node[key]) for (const name of Object.keys(node[key])) stack.push({ parent: node[key], key: name, depth: row.depth + 1 });
    for (const key of NOTATION_LISTS) if (node[key]) for (let index = node[key].length - 1; index >= 0; index--) stack.push({ parent: node[key], key: index, depth: row.depth + 1 });
    for (const key of NOTATION_SINGLES) if (node[key] && typeof node[key] === "object") { if (key === "i" && Array.isArray(node[key])) for (let index = node[key].length - 1; index >= 0; index--) stack.push({ parent: node[key], key: index, depth: row.depth + 1 }); else stack.push({ parent: node, key, depth: row.depth + 1 }); }
  } return { format: "source-bound-schema-notation-v1", texts: working.texts, schema: holder.schema };
}
