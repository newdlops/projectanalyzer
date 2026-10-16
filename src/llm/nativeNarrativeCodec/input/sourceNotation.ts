/** Bind exact schema annotation facts to this request's complete source operations; no calculation, source inference or cross-request table. */
import { createHash } from "node:crypto";
import { copyInput, inputRecord, putInput, requireInput, sameInput, sameInputJson, type InputRecord } from "./data";
import { encodeSchemaNotation, decodeSchemaNotation } from "./notation";
import { notationPositions } from "./schemaTraversal";

/** Digest the complete JSON source object with its original strings and key order. */
export function nativeSourceInputSha256(source: unknown): string { return createHash("sha256").update(JSON.stringify(copyInput(source))).digest("hex"); }

/** Source identity uses one-based operation ordinals and the exact kind/code/predicate spelling already supplied by the Host. */
function operations(source: InputRecord): { byId: Map<number, InputRecord>; byFact: Map<string, number> } {
  requireInput(Array.isArray(source.selectedRoutes) && source.selectedRoutes.length === 1 && Array.isArray(source.selectedRoutes[0].operations));
  const byId = new Map<number, InputRecord>(), byFact = new Map<string, number>();
  for (const operation of source.selectedRoutes[0].operations) {
    requireInput(operation && typeof operation === "object" && Number.isSafeInteger(operation.ordinal) && operation.ordinal > 0 && !byId.has(operation.ordinal) && typeof operation.kind === "string" && typeof operation.code === "string");
    const fact: InputRecord = { kind: operation.kind, code: operation.code }; if (Object.hasOwn(operation, "predicateResult")) fact.predicateResult = String(operation.predicateResult);
    byId.set(operation.ordinal, fact); const encoded = JSON.stringify(fact); if (!byFact.has(encoded)) byFact.set(encoded, operation.ordinal);
  } return { byId, byFact };
}

/** Enumerate owned text references in annotation positions, leaving all source/const/enum/raw values opaque. */
function textReferences(notation: InputRecord): Array<{ parent: InputRecord | any[]; key: string | number; value: number }> {
  const refs: Array<{ parent: InputRecord | any[]; key: string | number; value: number }> = [];
  const visit = (parent: any, key: string | number) => { const value = parent[key]; if (typeof value === "number") { requireInput(Number.isInteger(value) && value >= 0 && value < notation.texts.length); refs.push({ parent, key, value }); } else requireInput(typeof value === "string"); };
  for (const { value: node } of notationPositions(notation.schema).rows) {
    if (Object.hasOwn(node, "raw")) continue;
    for (const key of ["d", "title", "comment"]) if (Object.hasOwn(node, key)) { const part = node[key]; if (!Array.isArray(part)) { visit(node, key); continue; }
      requireInput(part.length === 3); visit(part, 0); visit(part, 2); const fact = part[1]; requireInput(fact && typeof fact === "object" && !Array.isArray(fact));
      if (Object.keys(fact).length === 1 && Number.isInteger(fact.sourceStep)) continue; for (const property of Object.keys(fact)) visit(fact, property);
    }
  } return refs;
}

/** Bind only byte-identical source facts and remove only unreferenced duplicate annotation strings from the local table. */
export function encodeNativeSourceNotation(schema: InputRecord, sourceInput: InputRecord): { notation: InputRecord; sourceInputSha256: string } {
  const source = inputRecord(sourceInput), packet = encodeSchemaNotation(schema), notation = copyInput(packet), { byFact } = operations(source);
  const text = (part: string | number): string => typeof part === "string" ? part : notation.texts[part];
  for (const { value: node } of notationPositions(notation.schema).rows) {
    if (Object.hasOwn(node, "raw")) continue;
    for (const key of ["d", "title", "comment"]) if (Array.isArray(node[key])) { const part = node[key], fact = Object.fromEntries(Object.entries(part[1]).map(([name, value]) => [name, text(value as string | number)])), ordinal = byFact.get(JSON.stringify(fact)); if (ordinal !== undefined) part[1] = { sourceStep: ordinal }; }
  }
  const refs = textReferences(notation), used = [...new Set(refs.map(row => row.value))].sort((a, b) => a - b), ids = new Map(used.map((old, index) => [old, index])), oldTexts = notation.texts;
  notation.texts = used.map(index => oldTexts[index]); for (const row of refs) putInput(row.parent, row.key, ids.get(row.value)); notation.format = "source-bound-schema-notation-v1";
  const sourceInputSha256 = nativeSourceInputSha256(source); sameInput(decodeNativeSourceNotation(notation, source, sourceInputSha256), schema); sameInputJson(source, sourceInput); return { notation, sourceInputSha256 };
}

/** Expand annotations only from their own full source record, refusing source mutation and missing/foreign operation IDs. */
export function decodeNativeSourceNotation(input: unknown, sourceInput: InputRecord, expectedSourceSha256: string): InputRecord {
  const source = inputRecord(sourceInput); requireInput(typeof expectedSourceSha256 === "string" && nativeSourceInputSha256(source) === expectedSourceSha256, "native-input-source-binding");
  const notation = inputRecord(input); requireInput(notation.format === "source-bound-schema-notation-v1"); const { byId } = operations(source);
  for (const { value: node } of notationPositions(notation.schema).rows) { if (Object.hasOwn(node, "raw")) continue;
    for (const key of ["d", "title", "comment"]) if (Array.isArray(node[key])) { const part = node[key], binding = part[1];
      if (binding && Object.keys(binding).length === 1 && Number.isInteger(binding.sourceStep)) { requireInput(byId.has(binding.sourceStep), "native-input-source-operation"); part[1] = copyInput(byId.get(binding.sourceStep)); }
    }
  } notation.format = "schema-notation-v1"; return decodeSchemaNotation(notation);
}
