/** Share complete source-step layout sequences only; mode choices, value schemas, every field and model prose remain independent. */
import { copyInput, inputKeys, inputRecord, putInput, requireInput, sameInputJson, type InputRecord } from "./data";
import { notationPositions } from "./schemaTraversal";

/** Exact repeated step lists must prove original one-based ordinals before being assigned a local sequence definition. */
export function encodeNativeSequenceMacros(input: unknown): InputRecord {
  const working = inputRecord(input); requireInput(working.format === "source-hint-schema-macros-v1"); const { holder, rows } = notationPositions(working.schema, true), stepSequences: InputRecord[] = [], ids = new Map<string, number>();
  for (const row of rows.sort((a, b) => b.depth - a.depth)) { const node = row.value;
    if (JSON.stringify(Object.keys(node)) !== JSON.stringify(["t", "min", "max", "i"]) || node.t !== "array" || !Array.isArray(node.i) || !node.i.length || node.min !== node.i.length || node.max !== node.i.length) continue;
    const steps = node.i.map(item => item?.["@"]); if (!steps.every((step, index) => Array.isArray(step) && step.length === 5 && step[0] === "S" && step[1] === steps[0][1] && step[3] === index + 1)) continue;
    const sequence = { form: steps[0][1], suffixes: steps.map(step => copyInput(step[4])) }, key = JSON.stringify(sequence); if (!ids.has(key)) { ids.set(key, stepSequences.length); stepSequences.push(sequence); }
    putInput(row.parent, row.key!, { "@": ["V", ids.get(key), steps.map(step => copyInput(step[2]))] });
  }
  const notation = { ...working, format: "source-sequence-schema-macros-v1", schema: holder.schema, stepSequences }; sameInputJson(decodeNativeSequenceMacros(notation), input); return notation;
}

/** Expand complete locally owned step sequences before hint/tuple/source restoration, refusing changed arity and foreign forms. */
export function decodeNativeSequenceMacros(input: unknown): InputRecord {
  const working = inputRecord(input); requireInput(working.format === "source-sequence-schema-macros-v1" && Array.isArray(working.stepSequences) && Array.isArray(working.stepForms));
  for (const sequence of working.stepSequences) { inputKeys(sequence, ["form", "suffixes"]); requireInput(Number.isInteger(sequence.form) && sequence.form >= 0 && sequence.form < working.stepForms.length && Array.isArray(sequence.suffixes) && sequence.suffixes.length > 0 && sequence.suffixes.length <= 24000); }
  const { holder, rows } = notationPositions(working.schema, true);
  for (const row of rows.sort((a, b) => b.depth - a.depth)) { const node = row.value, macro = node["@"]; if (!macro || macro[0] !== "V") continue; inputKeys(node, ["@"]); requireInput(macro.length === 3); const [, id, values] = macro;
    requireInput(Number.isInteger(id) && id >= 0 && id < working.stepSequences.length && Array.isArray(values)); const sequence = working.stepSequences[id]; requireInput(values.length === sequence.suffixes.length);
    putInput(row.parent, row.key!, { t: "array", min: values.length, max: values.length, i: values.map((value, index) => ({ "@": ["S", sequence.form, copyInput(value), index + 1, copyInput(sequence.suffixes[index])] })) });
  }
  delete working.stepSequences; working.schema = holder.schema; working.format = "source-hint-schema-macros-v1"; return working;
}
