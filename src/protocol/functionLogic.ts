/**
 * JSON-only Function Logic Reader contracts. Source ranges and callable IDs
 * remain behind snapshot-local Host tokens so browser code can verify or drill
 * into only the definitions approved for the active graph.
 */

import type { EdgeConfidence } from "../shared/types";
import type { SourceNodeToken } from "./sourceNavigation";

/** Browser-visible function-local block kinds mirrored by the application projector. */
export type FunctionLogicBlockPayloadKind =
  | "entry"
  | "condition"
  | "loop"
  | "switch"
  | "try"
  | "call"
  | "effect"
  | "mutation"
  | "operation"
  | "return"
  | "throw"
  | "break"
  | "continue"
  | "exit"
  | "unknown";

/** Browser-visible transfer labels for structured function-local control flow. */
export type FunctionLogicEdgePayloadKind =
  | "next"
  | "true"
  | "false"
  | "iterate"
  | "repeat"
  | "exit"
  | "case"
  | "exception"
  | "finally"
  | "return"
  | "throw"
  | "break"
  | "continue";

/** Confidence vocabulary for exact syntax and conservative inference. */
export type FunctionLogicPayloadConfidence = "exact" | "inferred";

/** Browser-visible target categories for source-backed value changes. */
export type FunctionLogicValueTargetPayloadKind = "variable" | "property" | "receiver";

/** Browser-visible operation vocabulary for one changed value. */
export type FunctionLogicValueChangePayloadOperation =
  | "initialize"
  | "assign"
  | "update"
  | "delete"
  | "iterate"
  | "mutate";

/** One bounded value-change annotation rendered inside its control block. */
export type FunctionLogicValueChangePayload = {
  target: string;
  targetKind: FunctionLogicValueTargetPayloadKind;
  operation: FunctionLogicValueChangePayloadOperation;
  operator: string;
  value?: string;
  confidence: FunctionLogicPayloadConfidence;
};

/** Opaque reference to one Host-approved source range in the active snapshot. */
export type CodeFlowEvidenceToken = `code-evidence:${string}`;

/** One concrete direct callee that the reader may open as another function flow. */
export type FunctionLogicDrillTargetPayload = {
  sourceToken: SourceNodeToken;
  name: string;
  qualifiedName: string;
  sourceLocation?: string;
  confidence: EdgeConfidence;
  callsiteCount: number;
};

/** One syntax-backed step inside the selected function body. */
export type FunctionLogicBlockPayload = {
  id: string;
  kind: FunctionLogicBlockPayloadKind;
  label: string;
  detail: string;
  depth: number;
  /** Opaque nearest control block that directly owns this statement body. */
  parentBlockId?: string;
  branchLabel?: string;
  confidence: FunctionLogicPayloadConfidence;
  sourceLocation?: string;
  evidenceToken?: CodeFlowEvidenceToken;
  drillTargets?: FunctionLogicDrillTargetPayload[];
  valueChanges?: FunctionLogicValueChangePayload[];
};

/** One possible transfer between function-local logic blocks. */
export type FunctionLogicEdgePayload = {
  id: string;
  sourceId: string;
  targetId: string;
  kind: FunctionLogicEdgePayloadKind;
  label?: string;
  confidence: FunctionLogicPayloadConfidence;
};

/** Counters that orient the reader around internal logic, not graph size. */
export type FunctionLogicSummaryPayload = {
  blockCount: number;
  branchCount: number;
  loopCount: number;
  callCount: number;
  effectCount: number;
  mutationCount: number;
  valueChangeCount: number;
  exitCount: number;
};

/** One positioned node inside the bounded function-logic graph canvas. */
export type FunctionLogicGraphNodeLayoutPayload = {
  blockId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rank: number;
  lane: number;
};

/** One polyline route with a label anchor inside the graph canvas. */
export type FunctionLogicGraphEdgeLayoutPayload = {
  edgeId: string;
  points: Array<{ x: number; y: number }>;
  labelX: number;
  labelY: number;
  route: "forward" | "long" | "back";
};

/** Complete deterministic layout for the bounded function-local graph. */
export type FunctionLogicGraphLayoutPayload = {
  width: number;
  height: number;
  nodes: FunctionLogicGraphNodeLayoutPayload[];
  edges: FunctionLogicGraphEdgeLayoutPayload[];
};

/** Complete selected-function logic projection delivered to the browser. */
export type FunctionLogicPayload = {
  language:
    | "typescript"
    | "javascript"
    | "python"
    | "java"
    | "fsharp"
    | "ocaml"
    | "elixir"
    | "unsupported";
  signature: string;
  blocks: FunctionLogicBlockPayload[];
  edges: FunctionLogicEdgePayload[];
  layout: FunctionLogicGraphLayoutPayload;
  summary: FunctionLogicSummaryPayload;
  callees: FunctionLogicDrillTargetPayload[];
  omittedCalleeCount: number;
};

/** Request to reveal one evidence range previously issued by the Host. */
export type CodeFlowOpenEvidenceRequest = {
  graphVersion: string;
  evidenceToken: CodeFlowEvidenceToken;
};
