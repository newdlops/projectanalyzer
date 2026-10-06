/** Opaque call-reading requests; neither browser source text nor model-authored graph facts cross this boundary. */
import type { FunctionCallsRequest, FunctionCallConnection } from "./functionCalls";
import type { FunctionCallNarrativeChunk, FunctionCallNarrativeScope, FunctionCallReading } from "../shared/functionCallNarratives";
import type { FunctionNarrativeFailure } from "../shared/functionNarratives";
import type { SourceNodeToken } from "./sourceNavigation";
import type { CodeFlowEvidenceToken } from "./functionLogic";
import type { ModelTaskProgress } from "../shared/modelTasks";
export type FunctionCallNarrativesRequest = FunctionCallsRequest & {
  contextId: string;
  scope: FunctionCallNarrativeScope; connectionId?: string; choices?: Array<{ key: string; value: string }>;
  /** Cache-only lookup never prepares or invokes a model or interrupts generation. */
  pageIndex?: number; pageLanguage?: "ko" | "en";
};
export type FunctionCallReadingEntry = FunctionCallReading & {
  connectionId: string; occurrence: number; expression: string; callee: string;
  confidence: FunctionCallConnection["confidence"]; deferred: boolean;
  callerEvidence?: CodeFlowEvidenceToken; calleeEvidence?: CodeFlowEvidenceToken; calleeSourceToken?: SourceNodeToken;
};
export type FunctionCallNarrativesResponse = FunctionCallNarrativesRequest & {
  status: "ready" | "progress" | "working" | "stale" | FunctionNarrativeFailure;
  task?: ModelTaskProgress;
  modelName?: string; language?: "ko" | "en"; cacheHit?: boolean;
  narrative?: Omit<FunctionCallNarrativeChunk, "calls"> & { calls: FunctionCallReadingEntry[] };
  coverage?: { completed: number; total: number; complete: boolean; sourceLimited: boolean };
  page?: { index: number; count: number; offset: number };
};
