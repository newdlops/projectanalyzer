/** Complete root native input and output composition: every source field, schema rule, model calculation and complete model sentence remains owned by its original boundary. */
import { FunctionNarrativeError } from "../../../shared/functionNarratives";
import { createNativeRootCodec } from "../root";
import { copyInput, inputKeys, inputOptions, inputRecord, requireInput, sameInput, sameInputJson, type InputRecord } from "./data";
import { encodeNativeSourceSchema, decodeNativeSourceSchema } from "./sourceSchema";
import { packNativeSourceJson, unpackNativeSourceJson } from "./sourceJson";
import { nativeRootInstructions } from "./instructions";
import type { NativeRootInputSource, NativeRootInput, NativeRootPacketInput } from "./types";

const schemaMarker = "SCHEMA NOTATION:\n", sourceMarker = "SOURCE JSON:\n";
const protocol = nativeRootInstructions.protocol;
// Canonical protocol order is source aliases, response-local prose, step tuples, complete step sequences, then compiler text hints.
const prefix = nativeRootInstructions.reviewedGuide + [protocol[0], protocol[1], protocol[2], protocol[3], protocol[4]].join("\n") + "\n";

/** Restore all source blocks and native rules from the actual complete root message, requiring its original source identity. */
export function restoreNativeRootInput(input: unknown, expectedSourceSha256: string): { schema: InputRecord; sourceData: InputRecord; sourceReadingRoles?: unknown } {
  const payload = inputRecord(input); inputKeys(payload, ["schema", "messages"]); requireInput(Array.isArray(payload.messages) && payload.messages.length === 2);
  const [system, user] = payload.messages; inputKeys(system, ["role", "content"]); inputKeys(user, ["role", "content"]);
  requireInput(system.role === "system" && Object.values(nativeRootInstructions.system).includes(system.content) && user.role === "user" && typeof user.content === "string" && user.content.startsWith(prefix + schemaMarker));
  const jsonStart = prefix.length + schemaMarker.length, notationEnd = user.content.indexOf("\n", jsonStart); requireInput(notationEnd > jsonStart);
  let notation: unknown, packet: InputRecord; try { notation = JSON.parse(user.content.slice(jsonStart, notationEnd));
    const sourceStart = user.content.indexOf(sourceMarker, notationEnd); requireInput(sourceStart > notationEnd); packet = inputRecord(JSON.parse(user.content.slice(sourceStart + sourceMarker.length)));
    const legends: Readonly<Record<string, string>> = nativeRootInstructions.sourceLegends; requireInput(Object.hasOwn(legends, packet.format) && user.content.slice(notationEnd + 1, sourceStart) === legends[packet.format] + "\n");
  } catch (error) { if (error instanceof FunctionNarrativeError) throw error; throw new FunctionNarrativeError("invalid-response", "native-input-json"); }
  const blocks = inputRecord(unpackNativeSourceJson(packet)), names = Object.keys(blocks); requireInput(names.length === 1 || names.length === 2); sameInput(names, ["SOURCE DATA:", "sourceReadingRoles:"].slice(0, names.length));
  const sourceData = inputRecord(blocks["SOURCE DATA:"]), schema = decodeNativeSourceSchema(notation, sourceData, expectedSourceSha256); sameInput(schema, payload.schema);
  return { schema, sourceData, ...(names.length === 2 ? { sourceReadingRoles: copyInput(blocks["sourceReadingRoles:"]) } : {}) };
}

/** Build canonical source-only root messages directly, retaining the original intermediate and final whole-packet budgets without clipping. */
export function createNativeRootInput(input: NativeRootInputSource): NativeRootInput {
  inputOptions(input, ["schema", "sourceData", "locale"], ["sourceReadingRoles"]);
  requireInput(input.locale === "ko" || input.locale === "en"); const schema = inputRecord(input.schema), sourceData = inputRecord(input.sourceData), encoded = encodeNativeSourceSchema(schema, sourceData);
  const sourceBlocks: InputRecord = { "SOURCE DATA:": sourceData }; if (input.sourceReadingRoles !== undefined) sourceBlocks["sourceReadingRoles:"] = copyInput(input.sourceReadingRoles);
  // The original whole-block shape layer was admitted before later macros/splitting. Keep that complete input bound even though construction now avoids those redundant passes.
  copyInput({ "SCHEMA NOTATION:": encoded.sourceNotation, ...sourceBlocks });
  const packed = packNativeSourceJson(sourceBlocks), payload: NativeRootInput["payload"] = { schema, messages: [
    { role: "system", content: nativeRootInstructions.system[input.locale] },
    { role: "user", content: prefix + schemaMarker + JSON.stringify(encoded.notation) + "\n" + packed.legend + "\n" + sourceMarker + JSON.stringify(packed.packet) }
  ] };
  if (Buffer.byteLength(JSON.stringify(payload) + "\n") > 196608) throw new FunctionNarrativeError("context-too-large", "native-input-request-bytes");
  const original = copyInput(payload);
  function restore(): ReturnType<NativeRootInput["restore"]> { sameInputJson(payload, original); return restoreNativeRootInput(payload, encoded.sourceInputSha256); }
  const restored = restore(); sameInputJson(restored.sourceData, sourceData); return { payload, sourceInputSha256: encoded.sourceInputSha256, sourceFormat: packed.format, restore };
}

/** Compose already source-owned schema/domain ports with exact input and strict raw output decoding. Host capture/neural provenance remains mandatory. */
export function createNativeRootPacket(input: NativeRootPacketInput): NativeRootInput & { decode(raw: string): unknown } {
  inputOptions(input, ["codec", "sourceData", "locale"], ["sourceReadingRoles"]);
  const options = inputOptions(input.codec, ["readingSchema", "calculatedValueDomains", "loopOperationOrdinals"], ["knownNullPaths"]);
  requireInput(options.calculatedValueDomains && typeof options.calculatedValueDomains === "object"); inputOptions(options.calculatedValueDomains, Object.getOwnPropertyNames(options.calculatedValueDomains));
  const codec = createNativeRootCodec({ ...input.codec, loopOperationOrdinals: copyInput(input.codec.loopOperationOrdinals), ...(input.codec.knownNullPaths !== undefined ? { knownNullPaths: copyInput(input.codec.knownNullPaths) } : {}) }), encoded = createNativeRootInput({ schema: codec.schema, sourceData: input.sourceData, locale: input.locale, ...(input.sourceReadingRoles !== undefined ? { sourceReadingRoles: input.sourceReadingRoles } : {}) });
  return { ...encoded, decode(raw) { encoded.restore(); return codec.decode(raw); } };
}
