/** Public source-only native codec API. Imports perform no model load, source evaluation, source-bound request construction or response synthesis. */
export { createNativeNamedWire } from "./named";
export { createNativeObjectTupleWire } from "./tuples";
export { createNativeProseWire } from "./prose";
export { factorNativeSchema, expandNativeSchema } from "./schemaSharing";
export { releaseNativeModelValues, requireNativeModelValues } from "./modelValues";
export { createNativeApplicabilitySchema } from "./applicability";
export { createNativeRootCodec } from "./root";
export { createNativeCallCodec } from "./call";
export { packNativeInputShapes, unpackNativeInputShapes } from "./input/shapes";
export { packNativeInputTemplates, unpackNativeInputTemplates } from "./input/templates";
export { packNativeInputDag, unpackNativeInputDag } from "./input/dag";
export { packNativeSourceJson, unpackNativeSourceJson } from "./input/sourceJson";
export { encodeNativeSourceSchema, decodeNativeSourceSchema } from "./input/sourceSchema";
export { encodeSchemaNotation as encodeNativeSchemaNotation, decodeSchemaNotation as decodeNativeSchemaNotation } from "./input/notation";
export { packNativeInputMessages, unpackNativeInputMessages } from "./input/messages";
export { numberNativeSourceLines } from "./input/numbering";
export { createNativeRootInput, restoreNativeRootInput, createNativeRootPacket } from "./input/root";
export { createNativeCallPacket } from "./input/call";
export { createNativeRootSource, createNativeSourceRootPacket } from "./source/root";
export type { NativeRootSourceOptions } from "./source/root";
export type { NativeRootSourceContext, NativeRootSourceBindings, NativeRootSource, NativeRootSourcePacket } from "./source/types";
export type { NativeInputFormat, NativeInputJson, NativeSchemaNotation, NativeInputMessage, NativeRootInputSource, NativeRootInput, NativeRootPacketInput } from "./input/types";
export type { NativeCallSourceContext, NativeCallPacketInput, NativeCallPacket } from "./input/types";
export type { NativeNarrativeSchema, NativeNarrativeMode, NativeValueAudit, NativeNamedWire, NativeNamedWireOptions, NativeObjectTupleWire,
  NativeProseWire, NativeSchemaFactoring, NativeModelValueSchema, NativeRootCodecInput, NativeRootCodec } from "./types";
