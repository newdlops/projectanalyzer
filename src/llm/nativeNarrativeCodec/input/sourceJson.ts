/** Choose the canonical source-only shape/template/DAG representation by its complete encoded character cost, including its legend. */
import { inputRecord, requireInput, sameInputJson, type InputRecord } from "./data";
import { packNativeInputShapes, unpackNativeInputShapes } from "./shapes";
import { packNativeInputTemplates, unpackNativeInputTemplates } from "./templates";
import { packNativeInputDag, unpackNativeInputDag } from "./dag";
import { nativeRootInstructions } from "./instructions";
import type { NativeInputFormat } from "./types";

/** Decode complete source input with this packet's local tables only; an unknown format is never treated as a fallback. */
export function unpackNativeSourceJson(input: unknown): unknown {
  const packet = inputRecord(input);
  if (packet.format === "json-shapes-v1") return unpackNativeInputShapes(packet);
  if (packet.format === "json-template-shapes-v1") return unpackNativeInputTemplates(packet);
  requireInput(packet.format === "json-dag-shapes-v1", "native-input-format"); return unpackNativeInputDag(packet);
}

/** Selection reads only complete provided source JSON, never a target, model response, semantic score or inference state. */
export function packNativeSourceJson(value: unknown): { packet: InputRecord; format: NativeInputFormat; legend: string } {
  const legends: Readonly<Record<string, string>> = nativeRootInstructions.sourceLegends, candidates = [packNativeInputShapes(value), packNativeInputTemplates(value), packNativeInputDag(value)];
  const distinct = [...new Map(candidates.map(packet => [JSON.stringify(packet), packet])).values()];
  distinct.sort((left, right) => (legends[left.format].length + JSON.stringify(left).length) - (legends[right.format].length + JSON.stringify(right).length));
  const packet = distinct[0]; sameInputJson(unpackNativeSourceJson(packet), value); return { packet, format: packet.format as NativeInputFormat, legend: legends[packet.format] };
}
