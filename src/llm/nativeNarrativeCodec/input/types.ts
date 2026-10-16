/** Public complete native-input contracts; schema/source ownership and actual neural provenance are established by the Host separately. */
import type { NativeNarrativeSchema, NativeRootCodecInput } from "../types";
import type { FunctionNarrativeContext } from "../../../shared/functionNarratives";

export type NativeInputFormat = "json-shapes-v1" | "json-template-shapes-v1" | "json-dag-shapes-v1";
export type NativeInputJson = Record<string, unknown>;
export type NativeSchemaNotation = { format: string; [name: string]: unknown };
export type NativeInputMessage = { role: "system" | "user"; content: string };
export type NativeRootInputSource = {
  schema: NativeNarrativeSchema;
  sourceData: NativeInputJson;
  locale: "ko" | "en";
  /** An absent source-role block stays absent; no role or source fact is synthesized. */
  sourceReadingRoles?: unknown;
};
export type NativeRootInput = {
  payload: { schema: NativeNarrativeSchema; messages: NativeInputMessage[] };
  sourceInputSha256: string;
  sourceFormat: NativeInputFormat;
  /** Audit restoration returns the complete original schema and source blocks, not a model response. */
  restore(): { schema: NativeNarrativeSchema; sourceData: NativeInputJson; sourceReadingRoles?: unknown };
};
export type NativeRootPacketInput = Omit<NativeRootInputSource, "schema"> & { codec: NativeRootCodecInput };
/** Exact source fields of the complete call model input; CPU worksheet/prose ports are outside this contract. */
export type NativeCallSourceContext = Pick<FunctionNarrativeContext, "functionName" | "language" | "limited" | "snippets" | "callTask" | "sourceEvidence">;
export type NativeCallPacketInput = { context: NativeCallSourceContext; locale: "ko" | "en" };
export type NativeCallPacket = {
  payload: { schema: NativeNarrativeSchema; messages: NativeInputMessage[] };
  sourceInputSha256: string;
  restore(): { schema: NativeNarrativeSchema; sourceData: NativeInputJson };
  decode(raw: string): unknown;
};
