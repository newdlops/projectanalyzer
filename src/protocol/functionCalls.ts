/** Opaque, request-correlated direct neighborhoods for the separate Function Calls mode. */
import type { EdgeConfidence } from "../shared/types";
import type { SourceNodeToken } from "./sourceNavigation";
import type { CodeFlowEvidenceToken } from "./functionLogic";

export type FunctionCallsRequest = { graphVersion: string; sourceToken: SourceNodeToken; requestId: number };
export type FunctionCallNode = {
  id: string; name: string; qualifiedName: string; sourceLocation?: string;
  sourceToken?: SourceNodeToken;
  resolution: "concrete" | "unresolved";
};
export type FunctionCallConnection = {
  id: string; from: string; to: string; label: string;
  relation: "call" | "render" | "event";
  confidence: EdgeConfidence;
  guards: Array<{ expression: string; outcome: string }>;
  loops: string[]; deferred: boolean; limited: boolean;
  sourceLocation?: string; evidenceToken?: CodeFlowEvidenceToken;
};
export type FunctionCallsResponse = FunctionCallsRequest & {
  status: "ready" | "unavailable" | "stale" | "failed";
  nodes: FunctionCallNode[]; connections: FunctionCallConnection[];
  omittedCount: number; limited: boolean;
};
