/** Model-readable call facts and bounded prose; graph/source authority is held separately by the Host. */
export type FunctionCallNarrativeScope = "overview" | "scenario" | "call";
export type FunctionCallNarrativeTarget = {
  callId: string; caller: string; callee: string; language: string; expression: string;
  relation: "call" | "render" | "event"; confidence: "exact" | "resolved" | "inferred" | "unresolved";
  guards: Array<{ expression: string; outcome: string }>; loops: string[]; deferred: boolean;
  callerSnippet?: string; calleeSnippet?: string; sourceLimited: boolean;
  /** Explicit syntax arguments only; an absent list means unknown, not zero arguments. */
  arguments?: string[];
};
export type FunctionCallNarrativeTask = {
  scope: FunctionCallNarrativeScope; signature: string; includeSummary: boolean;
  /** A static route or structure summary; expressions are never runtime observations. */
  sequence: Array<{ callId: string; expression: string; callee: string; deferred: boolean }>;
  conditions: Array<{ expression: string; outcome: string; visit: number }>;
  routeStatus: "structure" | "complete" | "awaiting" | "limited"; terminal?: string;
  sourceLimited: boolean; targets: FunctionCallNarrativeTarget[];
  /** Bounded original callee excerpts collected across earlier chunks; never model-authored evidence. */
  calleeEvidence?: Array<{ callId: string; callee: string; code: string; truncated: boolean }>;
  /** Earlier descriptions are explicitly model inferences, not new static facts. */
  earlierModelReadings?: Array<Pick<FunctionCallReading, "callId" | "inputs" | "output" | "effects">>;
};
export type FunctionCallReading = { callId: string; role: string; inputs: string; output: string; effects: string; reason: string };
export type FunctionCallNarrativeChunk = { summary?: string; flow?: string; calls: FunctionCallReading[]; limitations: string[] };
