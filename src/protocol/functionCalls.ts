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

/** A source decision has its own identity even when another decision has identical text. */
export type FunctionCallControlGuard = { id: string; expression: string; outcome: string };
export type FunctionCallControlBlock = {
  id: string; kind: string; label: string;
  calls: Array<{ connectionId: string; expression: string; guards: FunctionCallControlGuard[] }>;
  next: Array<{ id: string; to: string; kind: string; label?: string; cleanups?: Array<{ ownerId: string; entryId: string }> }>;
  /** Iterator expressions run once; while predicates run on every loop test. */
  loopKind?: "iterator" | "condition" | "unknown";
  loopIds: string[];
  finallyOwnerIds: string[];
  /** The shared CFG does not resolve the thrown value to a surrounding catch handler. */
  unresolvedException?: boolean;
  sourceLocation?: string; evidenceToken?: CodeFlowEvidenceToken;
};
/** Bounded parent CFG; identities and evidence remain opaque across the Webview boundary. */
export type FunctionCallControlPlan = {
  signature: string; entryId?: string; blocks: FunctionCallControlBlock[];
  unorderedCallIds: string[]; limited: boolean;
};
export type FunctionCallsResponse = FunctionCallsRequest & {
  status: "ready" | "unavailable" | "stale" | "failed";
  nodes: FunctionCallNode[]; connections: FunctionCallConnection[];
  omittedCount: number; limited: boolean;
  control?: FunctionCallControlPlan;
};
