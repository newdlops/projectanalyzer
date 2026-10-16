/** Public data contracts for lossless native schema/value/prose codecs; implementations never evaluate source. */
export type NativeNarrativeSchema = Record<string, unknown>;
export type NativeNarrativeMode = "computed" | "loop-visit" | "source-infeasible" | "unverified";
export type NativeValueAudit = { path: string; originalValue: unknown; originalDomain: NativeNarrativeSchema; modelAuthored: true };
export type NativeNamedWire = {
  schema: NativeNarrativeSchema; variableLeaves: number; omittedSingleValues: number;
  encode(value: unknown): string; decode(raw: string): unknown;
};
export type NativeNamedWireOptions = { modelValuePaths?: readonly string[] };
export type NativeObjectTupleWire = {
  schema: NativeNarrativeSchema; transformedClosedObjects: number; unchangedIndependentLeaves: number;
  encode(value: unknown): unknown; decode(value: unknown): unknown;
};
export type NativeProseWire = {
  schema: NativeNarrativeSchema;
  slots: ReadonlyArray<{ path: readonly (string | number)[]; domain: NativeNarrativeSchema }>;
  encode(value: unknown): unknown; decode(value: unknown): unknown;
};
export type NativeSchemaFactoring = {
  schema: NativeNarrativeSchema; originalCharacters: number; compactCharacters: number; definitions: number; replacements: number;
};
export type NativeModelValueSchema = { schema: NativeNarrativeSchema; audit: NativeValueAudit[]; modelValuePaths: readonly string[] };
export type NativeRootCodecInput = {
  /** Complete named schema whose prose is free model output; source constants remain metadata. */
  readingSchema: NativeNarrativeSchema;
  /** Original declared/display domains for every known computed schema constant, no missing/extra paths. */
  calculatedValueDomains: Readonly<Record<string, NativeNarrativeSchema>>;
  knownNullPaths?: readonly string[];
  /** One-based source-operation ordinals only; selecting a loop mode never supplies an answer. */
  loopOperationOrdinals: readonly number[];
};
export type NativeRootCodec = {
  schema: NativeNarrativeSchema; nativeSchema: NativeNarrativeSchema; fullSchema: NativeNarrativeSchema;
  calculatedValueAudit: readonly NativeValueAudit[];
  encode(value: unknown, options?: { shareProse?: boolean }): string;
  decode(raw: string): unknown;
};
