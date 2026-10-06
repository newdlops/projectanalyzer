/** Correlated source-reading LLM requests; browser input contains no source, model prompt or filesystem path. */
import type { CodeFlowId } from "./codeFlow";
import type { CodeFlowEvidenceToken } from "./functionLogic";
import type { FunctionNarrative, FunctionNarrativeSnippet } from "../shared/functionNarratives";
import type { ModelTaskProgress } from "../shared/modelTasks";

export type FunctionNarrativesRequest = { graphVersion: string; flowId: CodeFlowId; requestId: number;
  /** Cache-only lookup for a graph node whose scenario lives on another saved page. */
  nodeId?: string;
  /** Cache-only paging is a separate intent from generation; it never invokes a provider. */
  pageIndex?: number;
  pageLanguage?: "ko" | "en" };
/** Selects one Host-cached result, never a browser-supplied path, range or evidence token. */
export type FunctionNarrativeSourceRequest = {
  graphVersion: string;
  flowId: CodeFlowId;
  contextId: string;
  language: "ko" | "en";
  scenarioIndex: number;
  stepIndex: number;
  /** Chooses a Host-cached node detail instead of a legacy summary step. */
  nodeIndex?: number;
  pageIndex?: number;
};
export type FunctionNarrativesResponse = FunctionNarrativesRequest & {
  status: "ready" | "progress" | "working" | "queue-full" | "unavailable" | "download-failed" | "cancelled" | "denied" | "timeout" | "invalid-response" | "language-mismatch" | "context-too-large" | "failed" | "stale";
  /** Correlated, source-free scheduler state; this never replaces cached narratives or marks generation complete. */
  task?: ModelTaskProgress;
  modelName?: string;
  language?: "ko" | "en";
  cacheHit?: boolean;
  limited?: boolean;
  narrative?: FunctionNarrative;
  /** Only snippet identities and bounds cross the response boundary; raw source stays in the Host. */
  snippets?: Array<Pick<FunctionNarrativeSnippet, "id" | "startLine" | "endLine">>;
  /** Each entry maps directly to one scenario's ordered steps, using Host-issued source tokens. */
  evidenceTokens?: CodeFlowEvidenceToken[][];
  /** Total becomes known when lazy enumeration is exhausted; completed pages are retained on errors/cancel. */
  coverage?: { completed: number; discovered: number; total?: number; complete: boolean; sourceLimited: boolean };
  page?: { index: number; count: number; offset: number };
};
