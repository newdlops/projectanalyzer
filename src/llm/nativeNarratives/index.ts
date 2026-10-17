/** Public native transport/action surface; import performs no spawn, model import, download or source access. */
export { NativeNarrativeWorker } from "./worker";
export { runNativeNarrativeAction, type NativeNarrativeActionOptions, type NativeNarrativeActionResult, type NativeNarrativeActionSettlement } from "./action";
export { measureNativeReadyDuration, type NativeReadyClockBounds, type NativeReadyDuration } from "./readyClock";
export type { NativeNarrativePacket, NativeNarrativeRequest, NativeNarrativeReply, NativeNarrativeReady, NativeNarrativeClose,
  NativeNarrativeEvent, NativeNarrativeTransport, NativeNarrativeWorkerOptions, NativeNarrativeWorkerObservation } from "./types";
