/**
 * Language-neutral value-change evidence emitted by Function Logic adapters.
 * Exact writes stay distinct from receiver-mutation hints whose runtime
 * semantics cannot be proven from a method name alone.
 */

/** The source-level entity whose value or observable state may change. */
export type FunctionLogicValueTargetKind = "variable" | "property" | "receiver";

/** A compact operation vocabulary shared by analyzers and the graph UI. */
export type FunctionLogicValueChangeOperation =
  | "initialize"
  | "assign"
  | "update"
  | "delete"
  | "iterate"
  | "mutate";

/** One bounded change annotation attached to a control-flow block. */
export type FunctionLogicValueChange = {
  target: string;
  targetKind: FunctionLogicValueTargetKind;
  operation: FunctionLogicValueChangeOperation;
  operator: string;
  value?: string;
  confidence: "exact" | "inferred";
};
