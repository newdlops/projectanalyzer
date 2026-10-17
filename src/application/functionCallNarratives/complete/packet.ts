/** Project complete captured call sources into the native wire while keeping strict decoding and original call identities in the Host. */
import { createNativeCallPacket, type NativeCallSourceContext } from "../../../llm/nativeNarrativeCodec";
import { isFunctionCallNarrativeChunk, isFunctionCallNarrativeLanguage, type FunctionCallNarrativeChunk } from "../../../shared/functionCallNarratives";
import type { FunctionCallNarrativeTask } from "../../../shared/functionCallNarratives";
import { FunctionNarrativeError, type FunctionNarrativeContext } from "../../../shared/functionNarratives";
import type { FunctionNarrativeCallRequest } from "../../functionNarratives/provider";

/** Only declared source fields cross the wire. Host proof/worksheet/prose callbacks never enter the native request. */
export function createCompleteFunctionCallNarrative(context: FunctionNarrativeContext, locale: "ko" | "en"): {
  request: FunctionNarrativeCallRequest; sourceTask: FunctionCallNarrativeTask; decode(raw: string): FunctionCallNarrativeChunk;
} {
  if (!context.callTask) throw new FunctionNarrativeError("invalid-response");
  const source: NativeCallSourceContext = { functionName: context.functionName, language: context.language,
    limited: context.limited, snippets: context.snippets, callTask: context.callTask,
    ...(context.sourceEvidence ? { sourceEvidence: context.sourceEvidence } : {}) };
  try {
    const packet = createNativeCallPacket({ context: source, locale });
    // Bind validation to the owned original packet, never to later mutations of the Host's source DTO.
    const task = packet.restore().sourceData.callTask as NonNullable<FunctionNarrativeContext["callTask"]>;
    const ids = task.targets.map(target => target.callId);
    return { request: packet.payload, sourceTask: structuredClone(task), decode(raw) {
      try {
        const value = packet.decode(raw);
        if (!isFunctionCallNarrativeChunk(value, ids, task.includeSummary)) throw new FunctionNarrativeError("invalid-response");
        if (!isFunctionCallNarrativeLanguage(value, locale)) throw new FunctionNarrativeError("language-mismatch");
        return value;
      } catch (error) {
        if (error instanceof FunctionNarrativeError) throw error;
        throw new FunctionNarrativeError("invalid-response");
      }
    } };
  } catch (error) {
    if (error instanceof FunctionNarrativeError) throw error;
    throw new FunctionNarrativeError("invalid-response");
  }
}
