/** Projects a captured rich source route into the public native codec while retaining its decoder and source bindings exclusively in the Host. */
import { createNativeSourceRootPacket, type NativeRootSourceContext } from "../../../llm/nativeNarrativeCodec";
import { FunctionNarrativeError, type FunctionNarrativeContext, type FunctionNarrativePage } from "../../../shared/functionNarratives";
import type { FunctionNarrativeRootRequest } from "../provider";
import { projectCompleteRootReply } from "./reply";

/** Only declared source data crosses this boundary. Host worksheet/call/proof/session capabilities are never forwarded or executed. */
export function createCompleteFunctionNarrativeRoot(context: FunctionNarrativeContext, locale: "ko" | "en"): {
  request: FunctionNarrativeRootRequest; decode(raw: string): FunctionNarrativePage;
} {
  if (context.detailLevel !== "rich" || !context.parameters || !context.sourceFlow) throw new FunctionNarrativeError("invalid-response");
  const source: NativeRootSourceContext = { functionName: context.functionName, language: context.language, limited: context.limited,
    detailLevel: "rich", parameters: context.parameters, snippets: context.snippets, sourceFlow: context.sourceFlow };
  for (const key of ["sourceEvidence", "groundingLimited", "returnTypeText", "valueNames", "valueFacts", "scenarioBatch", "callPriors"] as const) {
    if (context[key] !== undefined) Object.assign(source, { [key]: context[key] });
  }
  try {
    const packet = createNativeSourceRootPacket({ context: source, locale });
    // Provider-side validation may run before Host validation. Cache only this exact raw string and never expose the retained projection to the provider.
    let previous: { raw: string; page: FunctionNarrativePage } | undefined;
    return { request: packet.payload, decode(raw) {
      try {
        if (previous?.raw === raw) { packet.restore(); return structuredClone(previous.page); }
        const page = projectCompleteRootReply(packet.decode(raw), packet.readingSchema, packet.bindings);
        previous = { raw, page }; return structuredClone(page);
      } catch { throw new FunctionNarrativeError("invalid-response"); }
    } };
  } catch (error) {
    if (error instanceof FunctionNarrativeError && error.code === "context-too-large") throw error;
    throw new FunctionNarrativeError("invalid-response");
  }
}
