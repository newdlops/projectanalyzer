/** Correlated source-reading LLM requests; browser input contains no source, model prompt or filesystem path. */
import type { CodeFlowId } from "./codeFlow";
import type { CodeFlowEvidenceToken } from "./functionLogic";
import type { FunctionNarrative, FunctionNarrativeSnippet } from "../shared/functionNarratives";

export type FunctionNarrativesRequest = { graphVersion: string; flowId: CodeFlowId; requestId: number };
/** Selects one Host-cached result, never a browser-supplied path, range or evidence token. */
export type FunctionNarrativeSourceRequest = {
  graphVersion: string;
  flowId: CodeFlowId;
  contextId: string;
  language: "ko" | "en";
  scenarioIndex: number;
  stepIndex: number;
};
export type FunctionNarrativesResponse = FunctionNarrativesRequest & {
  status: "ready" | "unavailable" | "cancelled" | "denied" | "timeout" | "invalid-response" | "context-too-large" | "failed" | "stale";
  modelName?: string;
  language?: "ko" | "en";
  cacheHit?: boolean;
  limited?: boolean;
  narrative?: FunctionNarrative;
  /** Only snippet identities and bounds cross the response boundary; raw source stays in the Host. */
  snippets?: Array<Pick<FunctionNarrativeSnippet, "id" | "startLine" | "endLine">>;
  /** Each entry maps directly to one scenario's ordered steps, using Host-issued source tokens. */
  evidenceTokens?: CodeFlowEvidenceToken[][];
};
