/** Portable input/output contracts for the shared source-only call-route traversal. */
export type FunctionCallTracePlan = {
  entryId?: string; limited: boolean;
  blocks: Array<{
    id: string; kind: string; label: string;
    calls: Array<{ connectionId: string; expression: string; guards: Array<{ id: string; expression: string; outcome: string }> }>;
    next: Array<{ id: string; to: string; kind: string; label?: string; cleanups?: Array<{ ownerId: string; entryId: string }> }>;
    loopKind?: string; loopIds: string[]; finallyOwnerIds: string[]; unresolvedException?: boolean;
  }>;
};
export type FunctionCallTraceConnection = { deferred: boolean; relation: string };
export type FunctionCallTraceOption = { value: string; kind: string; label?: string };
export type FunctionCallTraceDecision = {
  key: string; label: string; options: FunctionCallTraceOption[]; kind: string; visit: number; blockId: string; value?: string;
};
export type FunctionCallTraceRow = {
  kind: string; blockId: string; label?: string; expression?: string; decisionKey?: string; value?: string;
  connectionId?: string; ordinal?: number; visit?: number; iteration?: number; count?: number;
  loops?: Array<{ label: string; iteration: number }>;
};
export type FunctionCallTrace = {
  rows: FunctionCallTraceRow[]; decisions: FunctionCallTraceDecision[]; callIds: string[];
  pending?: FunctionCallTraceDecision; terminal?: { kind: string; label: string; blockId: string };
  status: "complete" | "awaiting" | "limited"; limited: boolean;
};
