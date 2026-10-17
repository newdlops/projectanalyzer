/** Source-only complete root construction contracts. The Host retains actual capture/graph authority; these DTOs never certify semantic correctness. */
import type { FunctionNarrativeContext, FunctionNarrativeSource } from "../../../shared/functionNarratives";
import type { NativeRootCodecInput, NativeNarrativeSchema } from "../types";
import type { NativeInputJson, NativeRootInput } from "../input/types";

export type NativeRootSourceContext = Pick<FunctionNarrativeContext,
  "functionName" | "language" | "limited" | "snippets" | "sourceEvidence" | "groundingLimited" |
  "returnTypeText" | "valueNames" | "valueFacts" | "scenarioBatch" | "nodePreparation" | "callPriors"> & {
    detailLevel: "rich";
    parameters: NonNullable<FunctionNarrativeContext["parameters"]>;
    sourceFlow: NonNullable<FunctionNarrativeContext["sourceFlow"]>;
  };
export type NativeRootSourceBindings = {
  parentSnippetId: string;
  route: { nodeIds: string[]; edgeIds: string[] };
  occurrences: Array<{ ordinal: number; nodeId: string; occurrence: number; kind: string; code: string; source: FunctionNarrativeSource }>;
};
export type NativeRootSource = {
  sourceData: NativeInputJson;
  sourceReadingRoles?: NativeInputJson;
  codec: NativeRootCodecInput;
  bindings: NativeRootSourceBindings;
};
export type NativeRootSourcePacket = NativeRootInput & {
  bindings: NativeRootSourceBindings;
  /** Original complete reading contract, owned independently from the caller's mutable source DTO. */
  readingSchema: NativeNarrativeSchema;
  decode(raw: string): unknown;
};
