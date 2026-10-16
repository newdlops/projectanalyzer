/** Public complete root source/schema/packet composition. Construction never obtains a calculated example or a source-authored response. */
import { copyCodec, sameCodec } from "../data";
import { inputOptions, requireInput } from "../input/data";
import { createNativeRootInput } from "../input/root";
import { createNativeRootCodec } from "../root";
import { ownNativeRootContext, rootSourceData } from "./context";
import { rootSourceSchema } from "./schema";
import { rootEntryConstraints } from "./syntax";
import { rootSourceRoles } from "./roles";
import { copyRootSource } from "./data";
import type { NativeRootSource, NativeRootSourceContext, NativeRootSourcePacket } from "./types";

export type NativeRootSourceOptions = { context: NativeRootSourceContext; locale: "ko" | "en" };

/** Capture/source/graph provenance is a separate Host responsibility; supplied fields or hashes are not an authority token. */
export function createNativeRootSource(input: NativeRootSourceOptions): NativeRootSource {
  const options = inputOptions(input, ["context", "locale"]); requireInput(options.locale === "ko" || options.locale === "en");
  const { context, bindings } = ownNativeRootContext(options.context), sourceData = rootSourceData(context, rootEntryConstraints(context)), sourceReadingRoles = rootSourceRoles(context), codec = rootSourceSchema(context, options.locale);
  return { sourceData, ...(sourceReadingRoles ? { sourceReadingRoles } : {}), codec, bindings };
}

/** Build the complete source-only native request and strict raw decoder, retaining original occurrence bindings for the later production Host adapter. */
export function createNativeSourceRootPacket(input: NativeRootSourceOptions): NativeRootSourcePacket {
  const source = createNativeRootSource(input), codec = createNativeRootCodec(source.codec), request = createNativeRootInput({ schema: codec.schema, sourceData: source.sourceData, locale: input.locale, ...(source.sourceReadingRoles ? { sourceReadingRoles: source.sourceReadingRoles } : {}) });
  const bindings = copyRootSource(source.bindings), originalBindings = JSON.stringify(bindings);
  function restore(): ReturnType<typeof request.restore> {
    sameCodec(JSON.stringify(copyRootSource(bindings)), originalBindings, "native-root-source-bindings"); return request.restore();
  }
  return { ...request, bindings, readingSchema: copyCodec(source.codec.readingSchema), restore, decode(raw) { restore(); return codec.decode(raw); } };
}
