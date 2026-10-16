/** Compose exact source-bound schema notation and all canonical P/T/S, instruction-text and complete-step sequence macros. */
import { inputRecord, sameInput, type InputRecord } from "./data";
import { encodeNativeSourceNotation, decodeNativeSourceNotation } from "./sourceNotation";
import { encodeNativeStepMacros, decodeNativeStepMacros } from "./stepMacros";
import { encodeNativeHintMacros, decodeNativeHintMacros } from "./hintMacros";
import { encodeNativeSequenceMacros, decodeNativeSequenceMacros } from "./sequenceMacros";

/** The complete native schema remains unchanged; only its prompt spelling and source-identical annotation references are shared. */
export function encodeNativeSourceSchema(schema: InputRecord, sourceData: InputRecord): { notation: InputRecord; sourceInputSha256: string; sourceNotation: InputRecord } {
  const source = encodeNativeSourceNotation(schema, sourceData), notation = encodeNativeSequenceMacros(encodeNativeHintMacros(encodeNativeStepMacros(source.notation)));
  sameInput(decodeNativeSourceSchema(notation, sourceData, source.sourceInputSha256), schema); return { notation, sourceInputSha256: source.sourceInputSha256, sourceNotation: source.notation };
}

/** Expand each owned representation in the original order before validating the complete source binding and native schema. */
export function decodeNativeSourceSchema(input: unknown, sourceData: InputRecord, expectedSourceSha256: string): InputRecord {
  const notation = inputRecord(input); return decodeNativeSourceNotation(decodeNativeStepMacros(decodeNativeHintMacros(decodeNativeSequenceMacros(notation))), sourceData, expectedSourceSha256);
}
